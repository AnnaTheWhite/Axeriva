import { Request } from "express";
import prisma from "../database/prisma";
import { ROLES } from "../constants/roles";
import { companyScope } from "./scope";

// Same access rule as GET /projects (see routes/projects.routes.ts): EMPLOYEE
// is scoped to projects they're assigned to, everyone else by companyScope
// (own tenant, or unrestricted for DEVELOPER).
export async function findAccessibleProject(req: Request, projectId: number) {
  if (req.user!.role === ROLES.EMPLOYEE) {
    return prisma.project.findFirst({
      where: {
        id: projectId,
        assignments: { some: { employeeId: req.user!.employeeId! } },
      },
    });
  }

  return prisma.project.findFirst({
    where: { id: projectId, ...companyScope(req) },
  });
}
