import { Router, Request } from "express";
import prisma from "../database/prisma";
import { requireRole } from "../middleware/role.middleware";
import { ROLES } from "../constants/roles";
import { companyScope } from "../utils/scope";
import { normalizeOwnerNoteStatus, OWNER_NOTE_STATUSES } from "../constants/ownerNoteStatuses";

const router = Router();

// Owner Command Center — BUSINESS_OWNER and DEVELOPER only, never EMPLOYEE.
router.use(requireRole(ROLES.BUSINESS_OWNER, ROLES.DEVELOPER));

// BUSINESS_OWNER is always scoped to their own company (companyScope
// enforces this from the JWT, ignoring anything in the query string).
// DEVELOPER belongs to no company, so they must say which tenant they want
// via ?companyId= — same convention as GET/PUT /company/settings.
function resolveCompanyId(req: Request): number | null {
  const scope = companyScope(req);

  if (typeof scope.companyId === "number") {
    return scope.companyId;
  }

  const queryId = req.query.companyId ?? req.body?.companyId;
  return queryId ? Number(queryId) : null;
}

router.get("/", async (req, res) => {
  const companyId = resolveCompanyId(req);
  if (!companyId) {
    return res.status(400).json({ error: "companyId is required" });
  }

  const { status, projectId, customerId, date } = req.query;

  const where: Record<string, unknown> = { companyId };

  if (status && OWNER_NOTE_STATUSES.includes(status as never)) {
    where.status = status;
  }

  if (projectId) {
    where.projectId = Number(projectId);
  }

  if (customerId) {
    where.customerId = Number(customerId);
  }

  if (typeof date === "string" && date) {
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(`${date}T23:59:59.999Z`);
    where.createdAt = { gte: start, lte: end };
  }

  const notes = await prisma.ownerNote.findMany({
    where,
    include: {
      project: { select: { id: true, name: true } },
      customer: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return res.json(notes);
});

router.post("/", async (req, res) => {
  const companyId = resolveCompanyId(req);
  if (!companyId) {
    return res.status(400).json({ error: "companyId is required" });
  }

  const { title, content, projectId, customerId } = req.body;

  if (!title || typeof title !== "string" || !title.trim()) {
    return res.status(400).json({ error: "title is required" });
  }

  if (!content || typeof content !== "string" || !content.trim()) {
    return res.status(400).json({ error: "content is required" });
  }

  // Cross-tenant linking would let a note leak which other company owns a
  // given project/customer id — verify both belong to the same company
  // before attaching them.
  if (projectId) {
    const project = await prisma.project.findFirst({
      where: { id: Number(projectId), companyId },
    });
    if (!project) {
      return res.status(400).json({ error: "Project not found" });
    }
  }

  if (customerId) {
    const customer = await prisma.customer.findFirst({
      where: { id: Number(customerId), companyId },
    });
    if (!customer) {
      return res.status(400).json({ error: "Customer not found" });
    }
  }

  const note = await prisma.ownerNote.create({
    data: {
      title: title.trim(),
      content: content.trim(),
      companyId,
      userId: req.user!.userId,
      projectId: projectId ? Number(projectId) : null,
      customerId: customerId ? Number(customerId) : null,
    },
    include: {
      project: { select: { id: true, name: true } },
      customer: { select: { id: true, name: true } },
    },
  });

  return res.status(201).json(note);
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const companyId = resolveCompanyId(req);
  if (!companyId) {
    return res.status(400).json({ error: "companyId is required" });
  }

  const existing = await prisma.ownerNote.findFirst({ where: { id, companyId } });
  if (!existing) {
    return res.status(404).json({ error: "Note not found" });
  }

  const { title, content, status, projectId, customerId } = req.body;

  if (projectId) {
    const project = await prisma.project.findFirst({
      where: { id: Number(projectId), companyId },
    });
    if (!project) {
      return res.status(400).json({ error: "Project not found" });
    }
  }

  if (customerId) {
    const customer = await prisma.customer.findFirst({
      where: { id: Number(customerId), companyId },
    });
    if (!customer) {
      return res.status(400).json({ error: "Customer not found" });
    }
  }

  const note = await prisma.ownerNote.update({
    where: { id },
    data: {
      title: title !== undefined ? String(title).trim() : undefined,
      content: content !== undefined ? String(content).trim() : undefined,
      status: status !== undefined ? normalizeOwnerNoteStatus(status) : undefined,
      projectId: projectId !== undefined ? (projectId ? Number(projectId) : null) : undefined,
      customerId: customerId !== undefined ? (customerId ? Number(customerId) : null) : undefined,
    },
    include: {
      project: { select: { id: true, name: true } },
      customer: { select: { id: true, name: true } },
    },
  });

  return res.json(note);
});

export default router;
