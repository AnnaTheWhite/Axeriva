import { Router } from "express";
import prisma from "../database/prisma";
import { requireRole } from "../middleware/role.middleware";
import { ROLES } from "../constants/roles";

const router = Router();

router.use(requireRole(ROLES.BUSINESS_OWNER, ROLES.DEVELOPER));

function ownsCompany(req: import("express").Request, id: number) {
  return req.user!.role === ROLES.DEVELOPER || id === req.user!.companyId;
}

router.get("/", async (req, res) => {
  const companies = await prisma.company.findMany({
    where:
      req.user!.role === ROLES.DEVELOPER
        ? {}
        : { id: req.user!.companyId! },
    orderBy: {
      id: "desc",
    },
  });

  return res.json(companies);
});

router.get("/:id", async (req, res) => {
  const { id } = req.params;

  if (!ownsCompany(req, Number(id))) {
    return res.status(404).json({ error: "Company not found" });
  }

  const company = await prisma.company.findUnique({
    where: {
      id: Number(id),
    },
  });

  if (!company) {
    return res.status(404).json({
      error: "Company not found",
    });
  }

  return res.json(company);
});

router.put("/:id", async (req, res) => {
  const { id } = req.params;

  if (!ownsCompany(req, Number(id))) {
    return res.status(404).json({ error: "Company not found" });
  }

  const company = await prisma.company.update({
    where: {
      id: Number(id),
    },
    data: req.body,
  });

  return res.json(company);
});

export default router;
