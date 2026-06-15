import { Router } from "express";
import prisma from "../database/prisma";

const router = Router();

router.get("/", async (_req, res) => {
  const employees = await prisma.employee.findMany({
    orderBy: {
      id: "desc",
    },
  });

  return res.json(employees);
});

router.post("/", async (req, res) => {
  const { firstName, lastName, phone, email } = req.body;

  const employee = await prisma.employee.create({
    data: {
      firstName,
      lastName,
      phone,
      email,
    },
  });

  return res.status(201).json(employee);
});

export default router;