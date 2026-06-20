import { Router } from "express";
import prisma from "../database/prisma";
import { requireRole } from "../middleware/role.middleware";
import { ROLES } from "../constants/roles";
import { companyScope } from "../utils/scope";

const router = Router();

router.use(requireRole(ROLES.BUSINESS_OWNER, ROLES.DEVELOPER));

router.get("/", async (req, res) => {
  const customers = await prisma.customer.findMany({
    where: companyScope(req),
    orderBy: { id: "desc" },
    include: { projects: true },
  });

  return res.json(customers);
});

router.get("/:id", async (req, res) => {
  const { id } = req.params;

  const customer = await prisma.customer.findFirst({
    where: { id: Number(id), ...companyScope(req) },
    include: { projects: true },
  });

  if (!customer) {
    return res.status(404).json({ message: "Customer not found" });
  }

  return res.json(customer);
});

router.post("/", async (req, res) => {
  const { name, email, phone, address } = req.body;

  if (!req.user!.companyId) {
    return res.status(400).json({ error: "companyId is required" });
  }

  const customer = await prisma.customer.create({
    data: { name, email, phone, address, companyId: req.user!.companyId },
  });

  return res.status(201).json(customer);
});

router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, phone, address } = req.body;

    const updated = await prisma.customer.update({
      where: { id: Number(id), ...companyScope(req) },
      data: { name, email, phone, address },
    });

    return res.json(updated);
  } catch (error) {
    return res.status(500).json({ error: "Update failed" });
  }
});

router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  await prisma.customer.delete({
    where: { id: Number(id), ...companyScope(req) },
  });

  return res.status(204).send();
});

export default router;
