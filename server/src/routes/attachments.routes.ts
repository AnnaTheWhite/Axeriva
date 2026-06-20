import fs from "fs";
import path from "path";
import { Router } from "express";
import prisma from "../database/prisma";
import { requireRole } from "../middleware/role.middleware";
import { ROLES } from "../constants/roles";
import { companyScope } from "../utils/scope";
import { UPLOADS_DIR } from "../middleware/upload.middleware";

const router = Router();

// Only BUSINESS_OWNER (own tenant) and DEVELOPER (any tenant) can delete —
// EMPLOYEE can upload but not remove other people's files.
router.delete(
  "/:id",
  requireRole(ROLES.BUSINESS_OWNER, ROLES.DEVELOPER),
  async (req, res) => {
    const id = Number(req.params.id);

    const attachment = await prisma.projectAttachment.findFirst({
      where: { id, project: companyScope(req) },
    });

    if (!attachment) {
      return res.status(404).json({ error: "Attachment not found" });
    }

    await prisma.projectAttachment.delete({ where: { id } });

    const filePath = path.join(UPLOADS_DIR, path.basename(attachment.fileUrl));
    fs.unlink(filePath, (error) => {
      if (error && error.code !== "ENOENT") {
        console.error("[attachments] failed to delete file from disk", error);
      }
    });

    return res.status(204).send();
  }
);

export default router;
