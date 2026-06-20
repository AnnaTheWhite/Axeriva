import { Router } from "express";
import prisma from "../database/prisma";
import { findAccessibleProject } from "../utils/projectAccess";
import { userDisplayName } from "../utils/userDisplayName";
import { logProjectActivity } from "../services/activity/logProjectActivity";
import { PROJECT_ACTIVITY_TYPES } from "../constants/projectActivity";
import { uploadProjectFile, isImageMimeType } from "../middleware/upload.middleware";

const router = Router();

const USER_SELECT = {
  id: true,
  email: true,
  employee: { select: { firstName: true, lastName: true } },
} as const;

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

  return res.json(
    attachments.map((attachment) => ({
      id: attachment.id,
      projectId: attachment.projectId,
      userId: attachment.userId,
      userName: userDisplayName(attachment.user),
      fileName: attachment.fileName,
      fileType: attachment.fileType,
      fileSize: attachment.fileSize,
      fileUrl: attachment.fileUrl,
      isImage: isImageMimeType(attachment.fileType),
      createdAt: attachment.createdAt,
    }))
  );
});

// Any role with project access can upload — EMPLOYEE included.
router.post("/:id/attachments", async (req, res) => {
  const projectId = Number(req.params.id);

  const project = await findAccessibleProject(req, projectId);
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  uploadProjectFile(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: "file is required" });
    }

    const attachment = await prisma.projectAttachment.create({
      data: {
        projectId,
        userId: req.user!.userId,
        fileName: req.file.originalname,
        fileType: req.file.mimetype,
        fileSize: req.file.size,
        fileUrl: `/uploads/projects/${req.file.filename}`,
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
      metadata: { fileName: attachment.fileName },
    });

    return res.status(201).json({
      id: attachment.id,
      projectId: attachment.projectId,
      userId: attachment.userId,
      userName: userDisplayName(attachment.user),
      fileName: attachment.fileName,
      fileType: attachment.fileType,
      fileSize: attachment.fileSize,
      fileUrl: attachment.fileUrl,
      isImage,
      createdAt: attachment.createdAt,
    });
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
