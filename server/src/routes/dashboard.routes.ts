import { Router } from "express";
import prisma from "../database/prisma";
import { requireRole } from "../middleware/role.middleware";
import { ROLES } from "../constants/roles";
import { companyScope } from "../utils/scope";
import { getHoursByProject } from "../utils/projectHours";

const router = Router();

router.use(requireRole(ROLES.BUSINESS_OWNER, ROLES.DEVELOPER));

router.get("/", async (req, res) => {
  const scope = companyScope(req);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const in7Days = new Date();
  in7Days.setDate(in7Days.getDate() + 7);

  const [
    activeEmployees,
    activeProjects,
    totalCustomers,
    activeNowShifts,
    todaysCompletedShifts,
    upcomingShifts,
    hoursByProject,
  ] = await Promise.all([
    prisma.employee.count({ where: { ...scope, status: "Active" } }),
    prisma.project.count({ where: { ...scope, status: "Active" } }),
    prisma.customer.count({ where: scope }),
    prisma.shift.findMany({
      where: { employee: scope, end: null },
      include: { employee: true, project: true },
      orderBy: { start: "asc" },
    }),
    prisma.shift.findMany({
      where: {
        employee: scope,
        start: { gte: startOfToday, lte: endOfToday },
      },
    }),
    prisma.shift.findMany({
      where: {
        employee: scope,
        start: { gte: new Date(), lte: in7Days },
      },
      include: { employee: true, project: true },
      orderBy: { start: "asc" },
    }),
    getHoursByProject(req),
  ]);

  const todaysHours = todaysCompletedShifts.reduce((sum, shift) => {
    const end = shift.end ?? new Date();
    return sum + (end.getTime() - shift.start.getTime()) / (1000 * 60 * 60);
  }, 0);

  return res.json({
    kpis: {
      activeEmployees,
      activeProjects,
      totalCustomers,
      todaysHours,
    },
    activeNow: activeNowShifts.map((shift) => ({
      id: shift.id,
      employeeName: `${shift.employee.firstName} ${shift.employee.lastName}`,
      projectName: shift.project?.name ?? null,
      start: shift.start,
    })),
    hoursByProject,
    upcomingShifts: upcomingShifts.map((shift) => ({
      id: shift.id,
      employeeName: `${shift.employee.firstName} ${shift.employee.lastName}`,
      projectName: shift.project?.name ?? null,
      start: shift.start,
    })),
  });
});

export default router;
