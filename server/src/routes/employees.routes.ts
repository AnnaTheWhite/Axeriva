import { Router } from "express";
import prisma from "../database/prisma";
import { requireRole } from "../middleware/role.middleware";
import { ROLES } from "../constants/roles";
import { companyScope } from "../utils/scope";

const router = Router();

router.use(requireRole(ROLES.BUSINESS_OWNER, ROLES.DEVELOPER));

router.get("/", async (req, res) => {
  // B1 — accessRevoked is derived from the linked User (Employee itself has
  // no offboarding column by design). Only the derived boolean leaves the
  // API: the nested user object must NEVER reach the response, or User
  // columns (tombstoned email, tokenVersion) would leak to the client.
  // user == null means "never had a login" — nothing was revoked.
  const rows = await prisma.employee.findMany({
    where: companyScope(req),
    orderBy: { id: "desc" },
    include: { user: { select: { active: true } } },
  });

  return res.json(
    rows.map(({ user, ...employee }) => ({
      ...employee,
      accessRevoked: user ? !user.active : false,
    }))
  );
});

// No POST "/" here by design — employees may only enter the system through
// the invitation flow (see invites.routes.ts POST "/:token/accept"). Do not
// add a manual-creation endpoint here; this is a permanent product rule.

// Which Employee columns this endpoint may write. Same allow-list pattern as
// COMPANY_WRITABLE_FIELDS (constants/companyWritableFields.ts), kept local
// because this route is the only consumer.
//
// The critical omission is `companyId`: the `where` clause below is tenant-
// scoped, so an owner can only reach their OWN employees — but with
// `data: req.body` they could still hand that employee to another company by
// rewriting its tenant link, moving a worker (and their shift history) out of
// their own tenant. Everything not listed here — companyId, the primary key
// and the system timestamps — is silently dropped.
const EMPLOYEE_WRITABLE_FIELDS = ["firstName", "lastName", "phone", "email", "status"] as const;

function pickEmployeeWritableFields(body: unknown): Record<string, unknown> {
  const source = (body ?? {}) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  for (const field of EMPLOYEE_WRITABLE_FIELDS) {
    if (field in source) {
      data[field] = source[field];
    }
  }
  return data;
}

// Full update (edit modal)
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const updated = await prisma.employee.update({
      where: { id: Number(id), ...companyScope(req) },
      // Never spread req.body into `data` — see EMPLOYEE_WRITABLE_FIELDS.
      data: pickEmployeeWritableFields(req.body),
    });

    return res.json(updated);
  } catch (error) {
    return res.status(500).json({ error: "Update failed" });
  }
});

// Status-only update
router.put("/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const employee = await prisma.employee.update({
    where: { id: Number(id), ...companyScope(req) },
    data: { status },
  });

  return res.json(employee);
});

router.delete("/:id", async (req, res) => {
  const employeeId = Number(req.params.id);

  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, ...companyScope(req) },
    include: {
      user: true,
      _count: { select: { Shift: true } },
    },
  });

  if (!employee) {
    return res.status(404).json({ error: "Employee not found" });
  }

  // Shifts are historical time-tracking records — refuse to silently delete
  // them along with the employee. The owner can deactivate the employee
  // instead of permanently losing that history.
  if (employee._count.Shift > 0) {
    return res.status(409).json({
      error:
        "This employee has shift history and can't be deleted. Revoke their access instead — that disables their login and keeps the shift history.",
    });
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Project assignments are just links, not records worth keeping on
      // their own — safe to clear before removing the employee.
      await tx.projectAssignment.deleteMany({ where: { employeeId } });

      // An EMPLOYEE-role login only makes sense tied to this worker record;
      // remove it together with the employee instead of leaving an orphan.
      if (employee.user) {
        await tx.user.delete({ where: { id: employee.user.id } });
      }

      await tx.employee.delete({ where: { id: employeeId } });
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to delete employee" });
  }

  return res.status(204).send();
});

export default router;
