import { Router } from "express";
import prisma from "../database/prisma";
import { requireRole } from "../middleware/role.middleware";
import { ROLES } from "../constants/roles";

const router = Router();

router.use(requireRole(ROLES.DEVELOPER));

router.get("/companies", async (_req, res) => {
  const companies = await prisma.company.findMany({
    orderBy: { id: "desc" },
    select: {
      id: true,
      name: true,
      plan: true,
      subscriptionStatus: true,
      createdAt: true,
      _count: { select: { users: true, employees: true } },
    },
  });

  return res.json(companies);
});

router.get("/users", async (_req, res) => {
  const users = await prisma.user.findMany({
    orderBy: { id: "desc" },
    select: {
      id: true,
      email: true,
      role: true,
      companyId: true,
      createdAt: true,
    },
  });

  return res.json(users);
});

// Platform-level activity log. Not implemented yet — this needs a real
// logging/observability backend (e.g. shipping request logs somewhere
// queryable). Returning an empty list keeps the frontend honest about that
// instead of fabricating fake log entries.
router.get("/logs", async (_req, res) => {
  return res.json([]);
});

export default router;
