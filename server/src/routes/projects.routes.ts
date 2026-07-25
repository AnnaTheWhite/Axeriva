import fs from "fs";
import path from "path";
import { Router } from "express";
import prisma from "../database/prisma";
import { requireRole } from "../middleware/role.middleware";
import { ROLES } from "../constants/roles";
import { companyScope } from "../utils/scope";
import { validateGeofenceFields } from "../utils/validateGeofence";
import { isProjectLimitReached } from "../utils/planLimits";
import { UPLOADS_DIR } from "../middleware/upload.middleware";

const router = Router();

router.get("/", async (req, res) => {
  const where =
    req.user!.role === ROLES.EMPLOYEE
      ? { assignments: { some: { employeeId: req.user!.employeeId! } } }
      : companyScope(req);

  const projects = await prisma.project.findMany({
    where,
    include: {
      assignments: {
        include: {
          employee: true,
        },
      },
      customer: true,
    },
    orderBy: { id: "desc" },
  });

  return res.json(projects);
});

router.post(
  "/",
  requireRole(ROLES.BUSINESS_OWNER, ROLES.DEVELOPER),
  async (req, res) => {
    const {
      name,
      description,
      status,
      deadline,
      customerId,
      address,
      latitude,
      longitude,
      geofenceRadius,
      geofenceEnabled,
    } = req.body;

    if (!req.user!.companyId) {
      return res.status(400).json({ error: "companyId is required" });
    }

    if (await isProjectLimitReached(req.user!.companyId)) {
      return res.status(403).json({
        error: "Free plan limit reached. Upgrade to Axeriva Pro to create more projects.",
      });
    }

    const geofenceError = validateGeofenceFields({
      latitude,
      longitude,
      geofenceRadius,
    });

    if (geofenceError) {
      return res.status(400).json({ error: geofenceError });
    }

    const project = await prisma.project.create({
      data: {
        name,
        description,
        status,
        deadline: deadline ? new Date(deadline) : null,
        customerId: customerId ? Number(customerId) : null,
        companyId: req.user!.companyId,
        address: address ?? null,
        latitude: latitude !== undefined && latitude !== null ? Number(latitude) : null,
        longitude: longitude !== undefined && longitude !== null ? Number(longitude) : null,
        geofenceRadius:
          geofenceRadius !== undefined && geofenceRadius !== null
            ? Number(geofenceRadius)
            : null,
        geofenceEnabled: Boolean(geofenceEnabled),
      },
    });

    return res.status(201).json(project);
  }
);

// Update project
router.put(
  "/:id",
  requireRole(ROLES.BUSINESS_OWNER, ROLES.DEVELOPER),
  async (req, res) => {
    const {
      name,
      description,
      status,
      deadline,
      customerId,
      address,
      latitude,
      longitude,
      geofenceRadius,
      geofenceEnabled,
    } = req.body;

    const geofenceError = validateGeofenceFields({
      latitude,
      longitude,
      geofenceRadius,
    });

    if (geofenceError) {
      return res.status(400).json({ error: geofenceError });
    }

    try {
      const { id } = req.params;

      const updated = await prisma.project.update({
        where: { id: Number(id), ...companyScope(req) },
        data: {
          name,
          description,
          status,
          deadline: deadline ? new Date(deadline) : null,
          customerId: customerId ? Number(customerId) : null,
          address: address ?? null,
          latitude: latitude !== undefined && latitude !== null ? Number(latitude) : null,
          longitude: longitude !== undefined && longitude !== null ? Number(longitude) : null,
          geofenceRadius:
            geofenceRadius !== undefined && geofenceRadius !== null
              ? Number(geofenceRadius)
              : null,
          geofenceEnabled: Boolean(geofenceEnabled),
        },
      });

      return res.json(updated);
    } catch (error) {
      return res.status(500).json({ error: "Update failed" });
    }
  }
);

// Both sides of an assignment must belong to the caller's tenant. Neither id
// arrives from a trusted source — the project comes from the URL and the
// employee from the request body — so both are re-read under companyScope
// before any write. Without this, an authenticated owner could link their own
// employee to another company's project (granting themselves visibility into
// that project) or attach a stranger's employee to their own.
//
// Both failures answer 404, never 403 or a distinct message: a tenant must
// not be able to tell "this id exists but belongs to someone else" apart from
// "this id does not exist".
async function resolveAssignmentPair(
  req: Parameters<typeof companyScope>[0],
  projectId: number,
  employeeId: number
) {
  const scope = companyScope(req);

  const [project, employee] = await Promise.all([
    prisma.project.findFirst({ where: { id: projectId, ...scope } }),
    prisma.employee.findFirst({ where: { id: employeeId, ...scope } }),
  ]);

  return project && employee ? { project, employee } : null;
}

// Assign employee to project
router.post(
  "/:projectId/assign",
  requireRole(ROLES.BUSINESS_OWNER, ROLES.DEVELOPER),
  async (req, res) => {
    const projectId = Number(req.params.projectId);
    const employeeId = Number(req.body?.employeeId);

    if (!Number.isInteger(projectId) || !Number.isInteger(employeeId)) {
      return res.status(400).json({ error: "projectId and employeeId are required" });
    }

    if (!(await resolveAssignmentPair(req, projectId, employeeId))) {
      return res.status(404).json({ error: "Project or employee not found" });
    }

    const assignment = await prisma.projectAssignment.create({
      data: { projectId, employeeId },
    });

    return res.status(201).json(assignment);
  }
);

// Remove assignment
router.delete(
  "/:projectId/assign/:employeeId",
  requireRole(ROLES.BUSINESS_OWNER, ROLES.DEVELOPER),
  async (req, res) => {
    const projectId = Number(req.params.projectId);
    const employeeId = Number(req.params.employeeId);

    if (!Number.isInteger(projectId) || !Number.isInteger(employeeId)) {
      return res.status(400).json({ error: "projectId and employeeId are required" });
    }

    // Same tenant check as the create path — deleteMany with an unscoped
    // where silently succeeds (204, zero rows) against another tenant's
    // assignment, which is exactly how this went unnoticed.
    if (!(await resolveAssignmentPair(req, projectId, employeeId))) {
      return res.status(404).json({ error: "Project or employee not found" });
    }

    await prisma.projectAssignment.deleteMany({
      where: { projectId, employeeId },
    });

    return res.status(204).send();
  }
);

router.delete(
  "/:id",
  requireRole(ROLES.BUSINESS_OWNER, ROLES.DEVELOPER),
  async (req, res) => {
    const projectId = Number(req.params.id);

    const project = await prisma.project.findFirst({
      where: { id: projectId, ...companyScope(req) },
    });

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    // Notes/attachments/activity only make sense scoped to this project —
    // remove them with it. Shifts are real worked-time history (payroll-
    // relevant), so they're detached (projectId set to null) instead of
    // deleted, same care as employee deletion takes with shift history.
    const attachments = await prisma.projectAttachment.findMany({
      where: { projectId },
    });

    await prisma.projectActivity.deleteMany({ where: { projectId } });
    await prisma.projectNote.deleteMany({ where: { projectId } });
    await prisma.projectAttachment.deleteMany({ where: { projectId } });
    await prisma.shift.updateMany({
      where: { projectId },
      data: { projectId: null },
    });
    await prisma.projectAssignment.deleteMany({ where: { projectId } });

    await prisma.project.delete({ where: { id: projectId } });

    for (const attachment of attachments) {
      const filePath = path.join(UPLOADS_DIR, path.basename(attachment.fileUrl));
      fs.unlink(filePath, (error) => {
        if (error && error.code !== "ENOENT") {
          console.error("[projects] failed to delete attachment file from disk", error);
        }
      });
    }

    return res.status(204).send();
  }
);

export default router;
