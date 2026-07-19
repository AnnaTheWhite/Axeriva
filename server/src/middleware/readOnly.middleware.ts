import { Request, Response, NextFunction } from "express";
import prisma from "../database/prisma";
import { isReadOnly, READ_ONLY_SELECT } from "../services/readOnly";

// S2.7 — the single authorization layer that blocks writes for a company in
// Read-only Mode. Mounted once per tenant-write router in index.ts (and on
// the two authenticated invite-write routes), so controllers stay thin and
// new modules inherit it just by being mounted through the same chain. The
// read-only *decision* lives in services/readOnly.ts; this middleware only
// enforces it.
//
// Behavior:
//   - Read requests (GET/HEAD/OPTIONS) always pass — read-only never blocks
//     viewing or exporting existing data.
//   - Requests with no authenticated tenant (public routes) or a DEVELOPER
//     platform operator (companyId === null) pass — read-only is a per-tenant
//     billing state, not a platform concern.
//   - Otherwise the acting user's company is checked; a read-only company's
//     write is refused with 403 and the standard { error: "READ_ONLY_MODE" }
//     body (no stack trace, ever).
export const READ_ONLY_ERROR = "READ_ONLY_MODE";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function blockWritesWhenReadOnly(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (READ_METHODS.has(req.method.toUpperCase())) {
    return next();
  }

  const user = req.user;
  // Public route (no auth yet) or DEVELOPER (no company) → nothing to enforce.
  if (!user || user.companyId == null) {
    return next();
  }

  const company = await prisma.company.findUnique({
    where: { id: user.companyId },
    select: READ_ONLY_SELECT,
  });

  // Missing company is an auth/consistency problem for a downstream handler,
  // not something this guard should mask.
  if (!company) {
    return next();
  }

  if (isReadOnly(company)) {
    return res.status(403).json({
      error: READ_ONLY_ERROR,
      message:
        "Your company is in read-only mode because your trial or subscription has ended. Upgrade or resume your subscription to continue editing.",
    });
  }

  return next();
}
