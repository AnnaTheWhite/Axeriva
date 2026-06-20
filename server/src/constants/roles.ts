export const ROLES = {
  DEVELOPER: "DEVELOPER",
  BUSINESS_OWNER: "BUSINESS_OWNER",
  EMPLOYEE: "EMPLOYEE",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];
