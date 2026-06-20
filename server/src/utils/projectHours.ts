import { Request } from "express";
import prisma from "../database/prisma";
import { companyScope } from "./scope";

export type ProjectHours = {
  projectId: number;
  projectName: string;
  hours: number;
};

// Total worked hours per project, from completed shifts, scoped to the
// caller's company (or every company for DEVELOPER). Shared by
// GET /shifts/hours-by-project and GET /dashboard so both report the same
// numbers from a single implementation.
export async function getHoursByProject(req: Request): Promise<ProjectHours[]> {
  const shifts = await prisma.shift.findMany({
    where: {
      employee: companyScope(req),
      end: { not: null },
      projectId: { not: null },
    },
    include: { project: true },
  });

  const totals = new Map<number, ProjectHours>();

  for (const shift of shifts) {
    if (!shift.project) continue;

    const hours = (shift.end!.getTime() - shift.start.getTime()) / (1000 * 60 * 60);

    const entry = totals.get(shift.project.id) ?? {
      projectId: shift.project.id,
      projectName: shift.project.name,
      hours: 0,
    };

    entry.hours += hours;
    totals.set(shift.project.id, entry);
  }

  return Array.from(totals.values()).sort((a, b) => b.hours - a.hours);
}
