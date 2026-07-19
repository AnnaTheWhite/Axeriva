import { useAuth } from "../context/AuthContext";
import { ROLES } from "../types/auth";

// C1 — "Only Owner may edit company settings; Managers and Employees have
// read-only access." This codebase's role model has BUSINESS_OWNER/EMPLOYEE/
// DEVELOPER only (no separate "Manager" tier) — see
// docs/company-management.md for how that maps onto the requested
// Owner/Manager/Employee wording without inventing a new role. Reuses the
// existing auth context/role constants; this is a read, not a new
// permission system. The server is the real gate (company.routes.ts
// requires BUSINESS_OWNER/DEVELOPER on every write route) — this hook only
// drives which controls the UI shows as editable.
export function useIsOwner(): boolean {
  const { user } = useAuth();
  return user?.role === ROLES.BUSINESS_OWNER || user?.role === ROLES.DEVELOPER;
}
