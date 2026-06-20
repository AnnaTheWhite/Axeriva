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
  const { id } = req.params;

  await prisma.employee.delete({
    where: { id: Number(id), ...companyScope(req) },
  });

  return res.status(204).send();
});

export default router;
