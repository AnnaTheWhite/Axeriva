import jwt from "jsonwebtoken";
import { config } from "../config";

// The one place a session JWT is created — register, login and
// invite-accept all issue tokens through this, so the claim set (including
// tokenVersion, see auth.middleware.ts) can't drift between call sites.
type AuthTokenUser = {
  id: number;
  companyId: number | null;
  role: string;
  employeeId: number | null;
  tokenVersion: number;
};

export function signAuthToken(user: AuthTokenUser): string {
  return jwt.sign(
    {
      userId: user.id,
      companyId: user.companyId,
      role: user.role,
      employeeId: user.employeeId,
      tokenVersion: user.tokenVersion,
    },
    config.jwtSecret,
    { expiresIn: "7d" }
  );
}
