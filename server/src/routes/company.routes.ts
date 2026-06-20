import { Router, Request } from "express";
import prisma from "../database/prisma";
import { requireRole } from "../middleware/role.middleware";
import { ROLES } from "../constants/roles";
import { companyScope } from "../utils/scope";

const router = Router();

router.use(requireRole(ROLES.BUSINESS_OWNER, ROLES.DEVELOPER));

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
} as const;

// BUSINESS_OWNER is always scoped to their own company (companyScope
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

router.put("/settings", async (req, res) => {
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

  const {
    name,
    logoUrl,
    billingEmail,
    contactEmail,
    phone,
    website,
    address,
    taxNumber,
    vatNumber,
  } = req.body;

  const company = await prisma.company.update({
    where: { id: companyId },
    data: {
      name,
      logoUrl,
      billingEmail,
      contactEmail,
      phone,
      website,
      address,
      taxNumber,
      vatNumber,
    },
    select: SETTINGS_SELECT,
  });

  return res.json(company);
});

export default router;
