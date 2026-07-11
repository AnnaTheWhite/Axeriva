import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import prisma from "../database/prisma";
import { config } from "../config";

export type AuthPayload = {
  userId: number;
  companyId: number | null;
  role: string;
  employeeId: number | null;
  // Absent from tokens issued before K2.1.2 — treated as 0, the schema
  // default, so pre-existing sessions stay valid until the user's version
  // is first bumped.
  tokenVersion?: number;
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
    payload = jwt.verify(token, config.jwtSecret) as AuthPayload;
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
    select: {
      active: true,
      tokenVersion: true,
      // Company activity enforcement (K2.1.5) — nested select on the same
      // findUnique call, not a separate query. DEVELOPER users have no
      // company (company stays null) and must keep working.
      company: { select: { active: true } },
    },
  });

  if (!user || !user.active) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  // A user whose company was deactivated (owner deleted their account) must
  // lose access immediately, existing JWTs included — same generic 401 as
  // every other auth failure, so company status doesn't leak. Users without
  // a company (DEVELOPER) pass: company is null, not inactive.
  if (user.company && !user.company.active) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  // Session invalidation (K2.1.2): the token carries the tokenVersion it
  // was issued with; if the user's current version has been bumped since
  // (password reset, account deletion, future forced/manual logout), every
  // older token dies here — same generic 401 as any other auth failure.
  // Reuses the lookup above, no extra query.
  if ((payload.tokenVersion ?? 0) !== user.tokenVersion) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  req.user = payload;

  return next();
}
