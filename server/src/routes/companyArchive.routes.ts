import { Router } from "express";
import bcrypt from "bcryptjs";
import prisma from "../database/prisma";
import { requireRole } from "../middleware/role.middleware";
import { ROLES } from "../constants/roles";
import { logAudit } from "../services/audit/auditLog";
import { AUDIT_ACTIONS } from "../constants/auditActions";

const router = Router();

const CONFIRMATION_TEXT = "ARCHIVE";

// C1.7 — Archive Company. Owner-only, requires re-entering the password and
// typing "ARCHIVE" (mirrors account.routes.ts's account-deletion
// confirmation exactly).
//
// Deliberately mounted as its own router at /company/archive — BEFORE the
// general /company mount in index.ts, which carries the S2.7 read-only
// write-guard — so archiving stays possible even when the company is
// already read-only (same reasoning as /subscription staying writable so an
// owner can upgrade/resume out of read-only: this is a subscription/tenant-
// lifecycle action, not a "modify business data" write).
//
// Mechanism: sets Company.active=false + deletedAt=now — the EXACT same
// flags account.routes.ts sets when a BUSINESS_OWNER deletes their account.
// auth.middleware.ts already refuses login for any user of an inactive
// company, which is precisely Archive's "disable login for company users"
// requirement. Nothing is deleted: employees/customers/projects/invoices/
// Stripe fields are all left completely untouched. Unlike account deletion,
// the owner's own User row is NOT touched (no tombstoned email, no
// tokenVersion bump) — archiving the company is not the same as the owner
// deleting their personal account.
router.post("/", requireRole(ROLES.BUSINESS_OWNER), async (req, res) => {
  const { password, confirmation } = req.body ?? {};
  const userId = req.user!.userId;
  const companyId = req.user!.companyId;

  if (!companyId) {
    return res.status(400).json({ error: "No company to archive." });
  }

  if (confirmation !== CONFIRMATION_TEXT) {
    return res.status(400).json({
      error: `Please type "${CONFIRMATION_TEXT}" to confirm.`,
    });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const validPassword = await bcrypt.compare(password ?? "", user.password);
  if (!validPassword) {
    return res.status(401).json({ error: "Incorrect password" });
  }

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) {
    return res.status(404).json({ error: "Company not found" });
  }

  if (!company.active) {
    return res.status(409).json({ error: "This company is already archived." });
  }

  await prisma.company.update({
    where: { id: companyId },
    data: { active: false, deletedAt: new Date() },
  });

  await logAudit({
    action: AUDIT_ACTIONS.COMPANY_ARCHIVED,
    userId,
    companyId,
  });

  return res.json({ archived: true });
});

export default router;
