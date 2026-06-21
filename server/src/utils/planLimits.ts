import prisma from "../database/prisma";

export const FREE_PLAN_PROJECT_LIMIT = 1;
export const FREE_PLAN_EMPLOYEE_LIMIT = 2;

// Free-tier ceilings — Pro (or any other non-"free" plan value) is
// unlimited. Checked at creation time, not enforced retroactively (e.g. a
// downgrade never deletes existing projects/employees over the limit).
export async function isProjectLimitReached(companyId: number): Promise<boolean> {
  const company = await prisma.company.findUnique({ where: { id: companyId } });

  if (company?.plan !== "free") {
    return false;
  }

  const projectCount = await prisma.project.count({ where: { companyId } });
  return projectCount >= FREE_PLAN_PROJECT_LIMIT;
}

export async function isEmployeeLimitReached(companyId: number): Promise<boolean> {
  const company = await prisma.company.findUnique({ where: { id: companyId } });

  if (company?.plan !== "free") {
    return false;
  }

  const employeeCount = await prisma.employee.count({ where: { companyId } });
  return employeeCount >= FREE_PLAN_EMPLOYEE_LIMIT;
}
