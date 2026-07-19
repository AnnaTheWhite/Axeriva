import { Router, Request, Response } from "express";
import prisma from "../database/prisma";
import { requireRole } from "../middleware/role.middleware";
import { ROLES } from "../constants/roles";
import { companyScope } from "../utils/scope";
import { logAudit } from "../services/audit/auditLog";
import { AUDIT_ACTIONS } from "../constants/auditActions";
import { validateCompanySettings } from "../services/companyValidation";
import { uploadCompanyLogo } from "../middleware/upload.middleware";
import { processUploadedLogo, deleteLogoFile } from "../services/companyLogo";

const router = Router();

// C1 — read access (view settings) is available to every authenticated
// tenant role, including EMPLOYEE: "Managers and Employees have read-only
// access" (this codebase's role model has BUSINESS_OWNER/EMPLOYEE/DEVELOPER
// only — see docs/company-management.md for how that maps onto the
// requested Owner/Manager/Employee tiers without inventing a new role).
// Every WRITE route below carries its own explicit requireRole(OWNER,
// DEVELOPER) — there is no more router-level blanket guard.
router.use(requireRole(ROLES.BUSINESS_OWNER, ROLES.DEVELOPER, ROLES.EMPLOYEE));

// Every company-level setting this module manages. Single source of truth
// for both GET (what the client receives) and PUT (what can be echoed back)
// — the branding/localization/preferences sections all read from this same
// shape, so nothing is redeclared per feature.
const SETTINGS_SELECT = {
  id: true,
  name: true,
  logoUrl: true,
  billingEmail: true,
  contactEmail: true,
  phone: true,
  website: true,
  address: true,
  taxNumber: true,
  vatNumber: true,
  // C1.1
  legalName: true,
  registrationNumber: true,
  postalCode: true,
  city: true,
  country: true,
  // C1.3
  primaryColor: true,
  accentColor: true,
  // C1.4
  language: true,
  currency: true,
  timezone: true,
  dateFormat: true,
  timeFormat: true,
  // C1.5
  firstDayOfWeek: true,
  defaultWorkStart: true,
  defaultWorkEnd: true,
  defaultShiftMinutes: true,
  notificationsEnabled: true,
  emailNotificationsEnabled: true,
  desktopNotificationsEnabled: true,
} as const;

const WRITABLE_FIELDS = [
  "name",
  "logoUrl",
  "billingEmail",
  "contactEmail",
  "phone",
  "website",
  "address",
  "taxNumber",
  "vatNumber",
  "legalName",
  "registrationNumber",
  "postalCode",
  "city",
  "country",
  "primaryColor",
  "accentColor",
  "language",
  "currency",
  "timezone",
  "dateFormat",
  "timeFormat",
  "firstDayOfWeek",
  "defaultWorkStart",
  "defaultWorkEnd",
  "defaultShiftMinutes",
  "notificationsEnabled",
  "emailNotificationsEnabled",
  "desktopNotificationsEnabled",
] as const;

// BUSINESS_OWNER/EMPLOYEE are always scoped to their own company (companyScope
// enforces this from the JWT, ignoring anything in the query string).
// DEVELOPER belongs to no company, so they must say which tenant they want
// via ?companyId= — same convention as GET/PUT /companies/:id.
function resolveCompanyId(req: Request): number | null {
  const scope = companyScope(req);

  if (typeof scope.companyId === "number") {
    return scope.companyId;
  }

  const queryId = req.query.companyId;
  return queryId ? Number(queryId) : null;
}

router.get("/settings", async (req, res) => {
  const companyId = resolveCompanyId(req);

  if (!companyId) {
    return res.status(400).json({ error: "companyId is required" });
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: SETTINGS_SELECT,
  });

  if (!company) {
    return res.status(404).json({ error: "Company not found" });
  }

  return res.json(company);
});

router.put(
  "/settings",
  requireRole(ROLES.BUSINESS_OWNER, ROLES.DEVELOPER),
  async (req, res) => {
    const companyId = resolveCompanyId(req);

    if (!companyId) {
      return res.status(400).json({ error: "companyId is required" });
    }

    const existing = await prisma.company.findUnique({
      where: { id: companyId },
    });

    if (!existing) {
      return res.status(404).json({ error: "Company not found" });
    }

    // Server-side validation is authoritative — the frontend's own checks
    // are UX only. Reject the whole request with field-level errors rather
    // than silently dropping/clamping bad values.
    const errors = validateCompanySettings(req.body ?? {});
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ error: "Validation failed", fields: errors });
    }

    // Only ever write the known, allow-listed fields — req.body is never
    // spread directly into `data` (unlike companies.routes.ts's admin PUT),
    // so a client can never smuggle in plan/subscription/Stripe fields
    // through this endpoint.
    const data: Record<string, unknown> = {};
    for (const field of WRITABLE_FIELDS) {
      if (field in req.body) {
        data[field] = req.body[field];
      }
    }

    const company = await prisma.company.update({
      where: { id: companyId },
      data,
      select: SETTINGS_SELECT,
    });

    logAudit({
      action: AUDIT_ACTIONS.SETTINGS_CHANGED,
      userId: req.user?.userId ?? null,
      companyId,
    });

    return res.json(company);
  }
);

// C1.2 — upload/replace the company logo. Owner-only; reuses the shared
// multer factory (upload.middleware.ts) for MIME/size validation — no
// validation logic is duplicated here. Multer is invoked with a callback
// (same pattern as projectActivity.routes.ts) so size/MIME rejections come
// back as clean 400s instead of falling through to the global 500 handler.
const runLogoUpload = (req: Request, res: Response) =>
  new Promise<boolean>((resolve) => {
    uploadCompanyLogo(req, res, (err: unknown) => {
      if (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "Upload failed." });
        return resolve(false);
      }
      resolve(true);
    });
  });

router.post(
  "/logo",
  requireRole(ROLES.BUSINESS_OWNER, ROLES.DEVELOPER),
  async (req, res) => {
    if (!(await runLogoUpload(req, res))) {
      return;
    }
    const companyId = resolveCompanyId(req);
    if (!companyId) {
      return res.status(400).json({ error: "companyId is required" });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No logo file was uploaded." });
    }

    const existing = await prisma.company.findUnique({
      where: { id: companyId },
      select: { logoUrl: true },
    });

    let finalFilename: string;
    try {
      finalFilename = await processUploadedLogo(file.path, file.mimetype);
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to process the uploaded image.",
      });
    }

    // Replace: remove the previous file from disk only after the new one is
    // confirmed valid, so a bad upload never destroys a working logo.
    await deleteLogoFile(existing?.logoUrl);

    const logoUrl = `/uploads/logos/${finalFilename}`;

    const company = await prisma.company.update({
      where: { id: companyId },
      data: { logoUrl },
      select: SETTINGS_SELECT,
    });

    logAudit({
      action: AUDIT_ACTIONS.SETTINGS_CHANGED,
      userId: req.user?.userId ?? null,
      companyId,
      metadata: { field: "logoUrl" },
    });

    return res.json(company);
  }
);

// C1.2 — remove the logo entirely (distinct from replacing it).
router.delete(
  "/logo",
  requireRole(ROLES.BUSINESS_OWNER, ROLES.DEVELOPER),
  async (req, res) => {
    const companyId = resolveCompanyId(req);
    if (!companyId) {
      return res.status(400).json({ error: "companyId is required" });
    }

    const existing = await prisma.company.findUnique({
      where: { id: companyId },
      select: { logoUrl: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Company not found" });
    }

    await deleteLogoFile(existing.logoUrl);

    const company = await prisma.company.update({
      where: { id: companyId },
      data: { logoUrl: null },
      select: SETTINGS_SELECT,
    });

    logAudit({
      action: AUDIT_ACTIONS.SETTINGS_CHANGED,
      userId: req.user?.userId ?? null,
      companyId,
      metadata: { field: "logoUrl", removed: true },
    });

    return res.json(company);
  }
);

// C1.6 — export every company setting as a versioned JSON document. Read
// access (any tenant role, matching the GET /settings read policy above) —
// exporting what you can already see is not a "write".
router.get("/export", async (req, res) => {
  const companyId = resolveCompanyId(req);
  if (!companyId) {
    return res.status(400).json({ error: "companyId is required" });
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: SETTINGS_SELECT,
  });

  if (!company) {
    return res.status(404).json({ error: "Company not found" });
  }

  // `version` makes this format future-compatible: a later export version
  // can add fields without breaking anything that already parsed v1.
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    company,
  };

  res.setHeader("Content-Type", "application/json");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="axeriva-company-settings-${companyId}.json"`
  );
  return res.send(JSON.stringify(payload, null, 2));
});

export default router;
