import { Request } from "express";
import { ROLES } from "../constants/roles";

// DEVELOPER sees every tenant's data; everyone else is scoped to their own company.
export function companyScope(req: Request): { companyId?: number } {
  if (req.user!.role === ROLES.DEVELOPER) {
    return {};
  }

  return { companyId: req.user!.companyId! };
}
