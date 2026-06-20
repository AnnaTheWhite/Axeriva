import { Request, Response, NextFunction } from "express";
import type { Role } from "../constants/roles";

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role as Role)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    return next();
  };
}
