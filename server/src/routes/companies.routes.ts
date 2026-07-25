import { Router } from "express";
import prisma from "../database/prisma";
import { requireRole } from "../middleware/role.middleware";
import { ROLES } from "../constants/roles";
import { pickCompanyWritableFields } from "../constants/companyWritableFields";

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

  // Never spread req.body into `data` — build the update from the shared
  // allow-list so billing/subscription/Stripe/ID/system fields can never be
  // written here.
  const data = pickCompanyWritableFields(req.body);

  const company = await prisma.company.update({
    where: {
      id: Number(id),
    },
    data,
  });

  return res.json(company);
});

export default router;
