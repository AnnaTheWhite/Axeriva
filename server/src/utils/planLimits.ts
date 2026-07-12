import prisma from "../database/prisma";
import { getLimit, isUnlimited } from "../services/planAccess";

// Creation-time plan-limit checks. These now resolve entirely through the
// centralized Limit Registry / plan-access service — no hardcoded plan
// strings or per-plan numbers here. Limits are checked at creation time only,
// not enforced retroactively (a downgrade never deletes existing
// projects/employees over the limit).
//
// Public API (isProjectLimitReached / isEmployeeLimitReached) is unchanged, so
// existing callers (projects.routes.ts, invites.routes.ts) keep working.

async function isLimitReached(
  companyId: number,
  limitId: "projects" | "employees",
  count: () => Promise<number>,
): Promise<boolean> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { plan: true },
  });

  // No company resolved → nothing to enforce (matches prior behavior).
  if (!company) return false;
  if (isUnlimited(company.plan, limitId)) return false;

  const current = await count();
  return current >= getLimit(company.plan, limitId);
}

export async function isProjectLimitReached(companyId: number): Promise<boolean> {
  return isLimitReached(companyId, "projects", () =>
    prisma.project.count({ where: { companyId } }),
  );
}

export async function isEmployeeLimitReached(companyId: number): Promise<boolean> {
  return isLimitReached(companyId, "employees", () =>
    prisma.employee.count({ where: { companyId } }),
  );
}
