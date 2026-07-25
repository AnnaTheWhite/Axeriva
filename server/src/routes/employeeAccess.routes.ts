import { Router } from "express";
import prisma from "../database/prisma";
import { requireRole } from "../middleware/role.middleware";
import { ROLES } from "../constants/roles";
import { companyScope } from "../utils/scope";
import { logAudit } from "../services/audit/auditLog";
import { AUDIT_ACTIONS } from "../constants/auditActions";
import { AuthEvent, logAuthEvent } from "../services/audit/authAudit";

const router = Router();

router.use(requireRole(ROLES.BUSINESS_OWNER, ROLES.DEVELOPER));

const CONFIRMATION_TEXT = "REVOKE";

// B1 — offboarding. Revokes a departed employee's LOGIN without touching
// anything else: the Employee row, its status, shifts and project
// assignments all survive untouched. This is the approved option (A) — a
// separate, explicit action, deliberately NOT a side effect of the
// free-text Employee.status field, which is written by two unvalidated
// endpoints and rendered as a no-confirmation inline dropdown; hanging an
// irreversible security effect on it would make offboarding one accidental
// click. The status dropdown stays a pure availability control.
//
// Mechanism: User.active=false (auth.middleware.ts 401s on the next
// request and login refuses outright) + tokenVersion bump (kills every
// outstanding JWT, K2.1.2). Both fields already exist — no migration.
//
// Mounted at /employee-access WITHOUT the tenantWrite chain (app.ts):
// revoking a departed employee's access is a security control and must
// work in a read-only (lapsed-subscription) company too — the same
// reasoning that keeps /company/archive and /subscription outside the
// read-only guard. A second /employees mount was considered and rejected:
// it would run authMiddleware (and its per-request DB check) twice on the
// busiest list route.
//
// Confirmation is a typed keyword WITHOUT a password re-check — lighter
// than account-delete/company-archive on purpose: those guard the caller's
// OWN account/company against a stolen token doing irreversible damage,
// while revoke affects one other user, is recoverable (re-invite — the
// email is tombstoned free below), and is an urgent HR action a password
// prompt would actively delay. The typed keyword alone closes the
// "accidental single click" failure mode.
router.post("/:id/revoke", async (req, res) => {
  const employeeId = Number(req.params.id);

  if (!Number.isInteger(employeeId)) {
    return res.status(400).json({ error: "Invalid employee id" });
  }

  // Before any DB read, mirroring account.routes.ts's ordering.
  const { confirmation } = req.body ?? {};
  if (confirmation !== CONFIRMATION_TEXT) {
    return res.status(400).json({
      error: `Please type "${CONFIRMATION_TEXT}" to confirm.`,
    });
  }

  // companyScope: {} for DEVELOPER (platform operator may revoke in any
  // tenant — same reach DELETE /employees/:id already has), company-bound
  // for owners.
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, ...companyScope(req) },
    include: { user: true },
  });

  if (!employee) {
    return res.status(404).json({ error: "Employee not found" });
  }

  // Employees without a login exist (test fixtures, any legacy rows) — the
  // schema keeps the relation optional even though the invite flow always
  // pairs them in production. Nothing to revoke is a conflict, not a crash.
  if (!employee.user) {
    return res.status(409).json({ error: "This employee has no login to revoke." });
  }

  if (!employee.user.active) {
    // Idempotence guard — also keeps tokenVersion from incrementing twice.
    return res.status(409).json({ error: "Access has already been revoked." });
  }

  const now = new Date();

  // Tombstone the email (account.routes.ts:99 pattern, "revoked+" prefix):
  // User.email is @unique and invite-accept rejects on an existing address,
  // so keeping the original would permanently block re-inviting this person.
  // The human-readable address is NOT lost — Employee.email still holds it,
  // and the Employee row is untouched.
  const tombstoneEmail = `revoked+${employee.user.id}+${now.getTime()}__${employee.user.email}`;

  // A single-row update — no transaction needed.
  await prisma.user.update({
    where: { id: employee.user.id },
    data: {
      active: false,
      deletedAt: now,
      email: tombstoneEmail,
      // Defence in depth (K2.1.2): active=false already blocks every
      // request, but bumping the version kills outstanding JWTs even if
      // the active-check ever changes.
      tokenVersion: { increment: 1 },
    },
  });

  await logAudit({
    action: AUDIT_ACTIONS.EMPLOYEE_ACCESS_REVOKED,
    userId: req.user!.userId,
    companyId: req.user!.companyId,
    metadata: { employeeId, revokedUserId: employee.user.id },
  });

  // AuthAuditContext is a closed type (no metadata field) — the
  // employeeId/revokedUserId pair lives in the logAudit entry above only.
  logAuthEvent(AuthEvent.EMPLOYEE_ACCESS_REVOKED, {
    req,
    level: "WARN",
    result: "success",
    userId: req.user!.userId,
    companyId: req.user!.companyId,
    role: req.user!.role,
    reason: "employee_access_revoked",
  });

  return res.json({ revoked: true });
});

export default router;
