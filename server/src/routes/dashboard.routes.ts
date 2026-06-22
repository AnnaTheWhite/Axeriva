import { Router } from "express";
import prisma from "../database/prisma";
import { requireRole } from "../middleware/role.middleware";
import { ROLES } from "../constants/roles";
import { companyScope } from "../utils/scope";
import { getHoursByProject } from "../utils/projectHours";

const router = Router();

router.use(requireRole(ROLES.BUSINESS_OWNER, ROLES.DEVELOPER));

// Same accumulation rule used by every hours KPI on this dashboard: a shift
// still in progress (end === null) counts up to "now", exactly like
// todaysHours always has. Weekly Hours reuses this so the two KPIs never
// diverge in how they treat a running shift.
function sumShiftHours(shifts: { start: Date; end: Date | null }[]): number {
  return shifts.reduce((sum, shift) => {
    const end = shift.end ?? new Date();
    return sum + (end.getTime() - shift.start.getTime()) / (1000 * 60 * 60);
  }, 0);
}

router.get("/", async (req, res) => {
  const scope = companyScope(req);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const in7Days = new Date();
  in7Days.setDate(in7Days.getDate() + 7);

  // Monday 00:00:00 of the current week, mirroring startOfToday but for the
  // whole week. Upper bound stays endOfToday (same as the daily KPI) since
  // shifts later in the week haven't happened yet.
  const startOfWeek = new Date();
  const dayOfWeek = startOfWeek.getDay();
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  startOfWeek.setDate(startOfWeek.getDate() - daysSinceMonday);
  startOfWeek.setHours(0, 0, 0, 0);

  const [
    activeEmployees,
    activeProjects,
    totalCustomers,
    activeNowShifts,
    todaysCompletedShifts,
    weeklyShifts,
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
        start: { gte: startOfWeek, lte: endOfToday },
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

  const todaysHours = sumShiftHours(todaysCompletedShifts);
  const weeklyHours = sumShiftHours(weeklyShifts);

  return res.json({
    kpis: {
      activeEmployees,
      activeProjects,
      totalCustomers,
      todaysHours,
      weeklyHours,
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
