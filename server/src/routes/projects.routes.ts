import { Router } from "express";
import prisma from "../database/prisma";
import { requireRole } from "../middleware/role.middleware";
import { ROLES } from "../constants/roles";
import { companyScope } from "../utils/scope";
import { validateGeofenceFields } from "../utils/validateGeofence";

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

// Assign employee to project
router.post(
  "/:projectId/assign",
  requireRole(ROLES.BUSINESS_OWNER, ROLES.DEVELOPER),
  async (req, res) => {
    const { projectId } = req.params;
    const { employeeId } = req.body;

    const assignment = await prisma.projectAssignment.create({
      data: {
        projectId: Number(projectId),
        employeeId: Number(employeeId),
      },
    });

    return res.status(201).json(assignment);
  }
);

// Remove assignment
router.delete(
  "/:projectId/assign/:employeeId",
  requireRole(ROLES.BUSINESS_OWNER, ROLES.DEVELOPER),
  async (req, res) => {
    const { projectId, employeeId } = req.params;

    await prisma.projectAssignment.deleteMany({
      where: {
        projectId: Number(projectId),
        employeeId: Number(employeeId),
      },
    });

    return res.status(204).send();
  }
);

router.delete(
  "/:id",
  requireRole(ROLES.BUSINESS_OWNER, ROLES.DEVELOPER),
  async (req, res) => {
    const { id } = req.params;

    await prisma.projectAssignment.deleteMany({
      where: { projectId: Number(id) },
    });

    await prisma.project.delete({
      where: { id: Number(id), ...companyScope(req) },
    });

    return res.status(204).send();
  }
);

export default router;
