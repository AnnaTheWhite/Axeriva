export const ROLES = {
  DEVELOPER: "DEVELOPER",
  BUSINESS_OWNER: "BUSINESS_OWNER",
  EMPLOYEE: "EMPLOYEE",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export type AuthUser = {
  id: number;
  email: string;
  role: Role;
  companyId: number | null;
  employeeId: number | null;
  emailVerified: boolean;
};

export type AuthResponse = {
  token: string;
  user: AuthUser;
};
