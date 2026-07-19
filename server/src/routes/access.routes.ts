import { Router } from "express";
import prisma from "../database/prisma";
import { isReadOnly, READ_ONLY_SELECT } from "../services/readOnly";

// S2.7 — lightweight, role-agnostic access state for the frontend's GLOBAL
// read-only detection. The /subscription endpoint is BUSINESS_OWNER/DEVELOPER
// only, but EMPLOYEE users are subject to read-only too (e.g. clock-in is a
// write), so they need a source they're allowed to read. Mounted under
// authMiddleware for every authenticated role.
const router = Router();

// GET /access/read-only → { readOnly: boolean }
// DEVELOPER (no company) is never read-only. Any authenticated tenant user
// gets their company's current read-only state, computed by the single
// services/readOnly.ts rule.
router.get("/read-only", async (req, res) => {
  const companyId = req.user!.companyId;

  if (companyId == null) {
    return res.json({ readOnly: false });
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: READ_ONLY_SELECT,
  });

  if (!company) {
    return res.json({ readOnly: false });
  }

  return res.json({ readOnly: isReadOnly(company) });
});

export default router;
