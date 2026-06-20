import { Router } from "express";
import prisma from "../database/prisma";
import { requireRole } from "../middleware/role.middleware";
import { ROLES } from "../constants/roles";
import { companyScope } from "../utils/scope";
import { getHoursByProject } from "../utils/projectHours";

const router = Router();

router.get(
  "/",
  requireRole(ROLES.BUSINESS_OWNER, ROLES.DEVELOPER),
  async (req, res) => {
    const shifts = await prisma.shift.findMany({
      where: { employee: companyScope(req) },
      include: {
        employee: true,
        project: true,
      },
      orderBy: {
        start: "asc",
      },
    });

    return res.json(shifts);
  }
);

// Total worked hours per project, for the caller's company. BUSINESS_OWNER/DEVELOPER only.
router.get(
  "/hours-by-project",
  requireRole(ROLES.BUSINESS_OWNER, ROLES.DEVELOPER),
  async (req, res) => {
    return res.json(await getHoursByProject(req));
  }
);

// The caller's own shifts. EMPLOYEE only.
router.get("/me", requireRole(ROLES.EMPLOYEE), async (req, res) => {
  const shifts = await prisma.shift.findMany({
    where: { employeeId: req.user!.employeeId! },
    include: { project: true },
    orderBy: { start: "desc" },
  });

  return res.json(shifts);
});

// Starts an open shift (no end time yet) for the caller. EMPLOYEE only.
// A project must be selected — worked time always rolls up to a project.
router.post("/clock-in", requireRole(ROLES.EMPLOYEE), async (req, res) => {
  const { projectId } = req.body;

  if (!projectId) {
    return res.status(400).json({ error: "projectId is required" });
  }

  const project = await prisma.project.findFirst({
    where: { id: Number(projectId), companyId: req.user!.companyId! },
  });

  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  const open = await prisma.shift.findFirst({
    where: { employeeId: req.user!.employeeId!, end: null },
  });

  if (open) {
    return res.status(409).json({ error: "Already clocked in" });
  }

  const shift = await prisma.shift.create({
    data: {
      employeeId: req.user!.employeeId!,
      projectId: Number(projectId),
      start: new Date(),
      end: null,
    },
    include: { project: true },
  });

  return res.status(201).json(shift);
});

// Closes the caller's open shift. EMPLOYEE only.
router.post("/clock-out", requireRole(ROLES.EMPLOYEE), async (req, res) => {
  const open = await prisma.shift.findFirst({
    where: { employeeId: req.user!.employeeId!, end: null },
  });

  if (!open) {
    return res.status(404).json({ error: "No open shift" });
  }

  const shift = await prisma.shift.update({
    where: { id: open.id },
    data: { end: new Date() },
    include: { project: true },
  });

  return res.json(shift);
});

router.post(
  "/",
  requireRole(ROLES.BUSINESS_OWNER, ROLES.DEVELOPER),
  async (req, res) => {
    const { employeeId, projectId, start, end, notes } = req.body;

    const employee = await prisma.employee.findFirst({
      where: { id: Number(employeeId), ...companyScope(req) },
    });

    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }

    const shift = await prisma.shift.create({
      data: {
        employeeId: Number(employeeId),
        projectId: projectId ? Number(projectId) : null,
        start: new Date(start),
        end: end ? new Date(end) : null,
        notes,
      },
      include: {
        employee: true,
        project: true,
      },
    });

    return res.status(201).json(shift);
  }
);

router.put(
  "/:id",
  requireRole(ROLES.BUSINESS_OWNER, ROLES.DEVELOPER),
  async (req, res) => {
    const { id } = req.params;

    const { employeeId, projectId, start, end, notes } = req.body;

    const existing = await prisma.shift.findFirst({
      where: { id: Number(id), employee: companyScope(req) },
    });

    if (!existing) {
      return res.status(404).json({ error: "Shift not found" });
    }

    const shift = await prisma.shift.update({
      where: {
        id: Number(id),
      },
      data: {
        employeeId: Number(employeeId),
        projectId: projectId ? Number(projectId) : null,
        start: new Date(start),
        end: end ? new Date(end) : null,
        notes,
      },
      include: {
        employee: true,
        project: true,
      },
    });

    return res.json(shift);
  }
);

router.delete(
  "/:id",
  requireRole(ROLES.BUSINESS_OWNER, ROLES.DEVELOPER),
  async (req, res) => {
    const { id } = req.params;

    const existing = await prisma.shift.findFirst({
      where: { id: Number(id), employee: companyScope(req) },
    });

    if (!existing) {
      return res.status(404).json({ error: "Shift not found" });
    }

    await prisma.shift.delete({
      where: {
        id: Number(id),
      },
    });

    return res.status(204).send();
  }
);

export default router;
