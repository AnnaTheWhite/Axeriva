import { Router } from "express";
import prisma from "../database/prisma";
import { requireRole } from "../middleware/role.middleware";
import { ROLES } from "../constants/roles";
import { companyScope } from "../utils/scope";
import { getHoursByProject } from "../utils/projectHours";
import { logProjectActivity } from "../services/activity/logProjectActivity";
import { PROJECT_ACTIVITY_TYPES } from "../constants/projectActivity";

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
// Includes project.customer so the frontend can show a work address
// (falling back to the customer's address when the project has none set)
// instead of raw GPS coordinates — see MyTimePage/MySchedulePage.
router.get("/me", requireRole(ROLES.EMPLOYEE), async (req, res) => {
  const shifts = await prisma.shift.findMany({
    where: { employeeId: req.user!.employeeId! },
    include: { project: { include: { customer: true } } },
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

  if (shift.projectId) {
    await logProjectActivity({
      projectId: shift.projectId,
      userId: req.user!.userId,
      type: PROJECT_ACTIVITY_TYPES.CLOCK_IN,
    });
  }

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

  if (shift.projectId) {
    await logProjectActivity({
      projectId: shift.projectId,
      userId: req.user!.userId,
      type: PROJECT_ACTIVITY_TYPES.CLOCK_OUT,
    });
  }

  return res.json(shift);
});

// A shift points at two tenant-owned rows, and BOTH ids arrive in the request
// body. The employee was already re-read under companyScope; the project was
// not, so a shift could be linked to another company's project — and since
// both write endpoints answer with `include: { project: true }`, that foreign
// project's full row came straight back in the response. Resolving the
// project under the same scope closes the write and the read at once.
//
// Returns `undefined` when nothing was requested (projectId omitted/blank →
// the shift simply has no project) and `null` when an id was requested but
// does not belong to this tenant.
async function resolveScopedProjectId(
  req: Parameters<typeof companyScope>[0],
  rawProjectId: unknown
): Promise<number | null | undefined> {
  if (!rawProjectId) {
    return undefined;
  }

  const projectId = Number(rawProjectId);

  if (!Number.isInteger(projectId)) {
    return null;
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, ...companyScope(req) },
  });

  return project ? projectId : null;
}

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

    const scopedProjectId = await resolveScopedProjectId(req, projectId);

    if (scopedProjectId === null) {
      return res.status(404).json({ error: "Project not found" });
    }

    const shift = await prisma.shift.create({
      data: {
        employeeId: Number(employeeId),
        projectId: scopedProjectId ?? null,
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

    // `existing` only proves the shift being edited is ours — it says nothing
    // about the employee the body wants to move it TO. Without this check an
    // owner could reassign their own shift onto another tenant's employee and
    // read that employee back out of the response `include`.
    const employee = await prisma.employee.findFirst({
      where: { id: Number(employeeId), ...companyScope(req) },
    });

    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }

    const scopedProjectId = await resolveScopedProjectId(req, projectId);

    if (scopedProjectId === null) {
      return res.status(404).json({ error: "Project not found" });
    }

    const shift = await prisma.shift.update({
      where: {
        id: Number(id),
      },
      data: {
        employeeId: Number(employeeId),
        projectId: scopedProjectId ?? null,
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
