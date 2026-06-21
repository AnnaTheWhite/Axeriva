import { Router } from "express";
import prisma from "../database/prisma";
import { findAccessibleProject } from "../utils/projectAccess";
import { userDisplayName } from "../utils/userDisplayName";
import { logProjectActivity } from "../services/activity/logProjectActivity";
import { PROJECT_ACTIVITY_TYPES } from "../constants/projectActivity";
import { uploadProjectFiles, isImageMimeType } from "../middleware/upload.middleware";
import { normalizeCategory } from "../constants/attachmentCategories";

const router = Router();

const USER_SELECT = {
  id: true,
  email: true,
  employee: { select: { firstName: true, lastName: true } },
} as const;

type AttachmentWithUser = {
  id: number;
  projectId: number;
  userId: number;
  user: Parameters<typeof userDisplayName>[0];
  fileName: string;
  fileType: string;
  fileSize: number;
  fileUrl: string;
  category: string;
  createdAt: Date;
};

function serializeAttachment(attachment: AttachmentWithUser) {
  return {
    id: attachment.id,
    projectId: attachment.projectId,
    userId: attachment.userId,
    userName: userDisplayName(attachment.user),
    fileName: attachment.fileName,
    fileType: attachment.fileType,
    fileSize: attachment.fileSize,
    fileUrl: attachment.fileUrl,
    category: attachment.category,
    isImage: isImageMimeType(attachment.fileType),
    createdAt: attachment.createdAt,
  };
}

// --- Notes ---------------------------------------------------------------

router.get("/:id/notes", async (req, res) => {
  const projectId = Number(req.params.id);

  const project = await findAccessibleProject(req, projectId);
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  const notes = await prisma.projectNote.findMany({
    where: { projectId },
    include: { user: { select: USER_SELECT } },
    orderBy: { createdAt: "desc" },
  });

  return res.json(
    notes.map((note) => ({
      id: note.id,
      projectId: note.projectId,
      userId: note.userId,
      userName: userDisplayName(note.user),
      content: note.content,
      createdAt: note.createdAt,
    }))
  );
});

// Any role with project access can add a note — EMPLOYEE included.
router.post("/:id/notes", async (req, res) => {
  const projectId = Number(req.params.id);
  const { content } = req.body;

  if (!content || typeof content !== "string" || !content.trim()) {
    return res.status(400).json({ error: "content is required" });
  }

  const project = await findAccessibleProject(req, projectId);
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  const note = await prisma.projectNote.create({
    data: {
      projectId,
      userId: req.user!.userId,
      content: content.trim(),
    },
    include: { user: { select: USER_SELECT } },
  });

  await logProjectActivity({
    projectId,
    userId: req.user!.userId,
    type: PROJECT_ACTIVITY_TYPES.NOTE_CREATED,
    metadata: { preview: note.content.slice(0, 140) },
  });

  return res.status(201).json({
    id: note.id,
    projectId: note.projectId,
    userId: note.userId,
    userName: userDisplayName(note.user),
    content: note.content,
    createdAt: note.createdAt,
  });
});

// --- Attachments ----------------------------------------------------------

router.get("/:id/attachments", async (req, res) => {
  const projectId = Number(req.params.id);

  const project = await findAccessibleProject(req, projectId);
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  const attachments = await prisma.projectAttachment.findMany({
    where: { projectId },
    include: { user: { select: USER_SELECT } },
    orderBy: { createdAt: "desc" },
  });

  return res.json(attachments.map(serializeAttachment));
});

// Any role with project access can upload — EMPLOYEE included. Accepts one
// or many files in a single request (field name "files"); every file
// becomes its own ProjectAttachment row and its own activity entry, same
// as if they'd been uploaded one at a time.
router.post("/:id/attachments", async (req, res) => {
  const projectId = Number(req.params.id);

  const project = await findAccessibleProject(req, projectId);
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  uploadProjectFiles(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    const files = req.files as Express.Multer.File[] | undefined;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: "At least one file is required" });
    }

    const category = normalizeCategory(req.body.category);

    const created = [];

    for (const file of files) {
      const attachment = await prisma.projectAttachment.create({
        data: {
          projectId,
          userId: req.user!.userId,
          fileName: file.originalname,
          fileType: file.mimetype,
          fileSize: file.size,
          fileUrl: `/uploads/projects/${file.filename}`,
          category,
        },
        include: { user: { select: USER_SELECT } },
      });

      const isImage = isImageMimeType(attachment.fileType);

      await logProjectActivity({
        projectId,
        userId: req.user!.userId,
        type: isImage
          ? PROJECT_ACTIVITY_TYPES.PHOTO_UPLOADED
          : PROJECT_ACTIVITY_TYPES.FILE_UPLOADED,
        metadata: { fileName: attachment.fileName, category },
      });

      created.push(serializeAttachment(attachment));
    }

    return res.status(201).json(created);
  });
});

// --- Activity timeline ------------------------------------------------------

router.get("/:id/activity", async (req, res) => {
  const projectId = Number(req.params.id);

  const project = await findAccessibleProject(req, projectId);
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  const activities = await prisma.projectActivity.findMany({
    where: { projectId },
    include: { user: { select: USER_SELECT } },
    orderBy: { createdAt: "desc" },
  });

  return res.json(
    activities.map((activity) => ({
      id: activity.id,
      projectId: activity.projectId,
      userId: activity.userId,
      userName: userDisplayName(activity.user),
      type: activity.type,
      metadata: activity.metadata ? JSON.parse(activity.metadata) : null,
      createdAt: activity.createdAt,
    }))
  );
});

export default router;
