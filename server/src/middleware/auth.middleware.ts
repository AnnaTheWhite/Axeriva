import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import prisma from "../database/prisma";

export type AuthPayload = {
  userId: number;
  companyId: number | null;
  role: string;
  employeeId: number | null;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid token" });
  }

  const token = header.slice("Bearer ".length);

  let payload: AuthPayload;

  try {
    payload = jwt.verify(
      token,
      process.env.JWT_SECRET as string
    ) as AuthPayload;
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  // The JWT itself stays valid for up to 7 days after issuance, but the
  // account it names may have been soft-deleted since then (see
  // account.routes.ts POST /account/delete). Re-checking `active` here —
  // on every request, not just at login — closes that gap without
  // needing to revoke or track individual tokens. Same generic error as
  // an invalid/expired token, so this can't be used to distinguish a
  // deleted account from any other auth failure. Company-level
  // deactivation is intentionally out of scope here (separate
  // stabilization pass).
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { active: true },
  });

  if (!user || !user.active) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  req.user = payload;

  return next();
}
