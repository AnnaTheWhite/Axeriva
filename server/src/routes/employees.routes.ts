import { Router } from "express";
import prisma from "../database/prisma";
import { requireRole } from "../middleware/role.middleware";
import { ROLES } from "../constants/roles";
import { companyScope } from "../utils/scope";

const router = Router();

router.use(requireRole(ROLES.BUSINESS_OWNER, ROLES.DEVELOPER));

router.get("/", async (req, res) => {
  const employees = await prisma.employee.findMany({
    where: companyScope(req),
    orderBy: { id: "desc" },
  });

  return res.json(employees);
});

router.post("/", async (req, res) => {
  const { firstName, lastName, phone, email, status } = req.body;

  if (!req.user!.companyId) {
    return res.status(400).json({ error: "companyId is required" });
  }

  const employee = await prisma.employee.create({
    data: {
      firstName,
      lastName,
      phone,
      email,
      status: status || "Active",
      companyId: req.user!.companyId,
    },
  });

  return res.status(201).json(employee);
});

// Full update (edit modal)
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const updated = await prisma.employee.update({
      where: { id: Number(id), ...companyScope(req) },
      data: req.body,
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
        "This employee has shift history and can't be deleted. Set their status instead of removing them.",
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
