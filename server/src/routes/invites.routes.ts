import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../database/prisma";
import { authMiddleware } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { ROLES } from "../constants/roles";
import { emailService } from "../services/email";

const router = Router();

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function buildInviteLink(token: string) {
  const appUrl = process.env.APP_URL || "http://localhost:5173";
  return `${appUrl}/invite/${token}`;
}

// Create an invitation for the caller's company. BUSINESS_OWNER only.
router.post(
  "/",
  authMiddleware,
  requireRole(ROLES.BUSINESS_OWNER),
  async (req, res) => {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "email is required" });
    }

    const company = await prisma.company.findUnique({
      where: { id: req.user!.companyId! },
    });

    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }

    const token = crypto.randomBytes(24).toString("hex");

    const invitation = await prisma.invitation.create({
      data: {
        email,
        token,
        role: ROLES.EMPLOYEE,
        companyId: req.user!.companyId!,
        invitedByUserId: req.user!.userId,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });

    const inviteLink = buildInviteLink(token);

    await emailService.sendInvitationEmail(email, inviteLink, company.name);

    return res.status(201).json({ ...invitation, inviteLink });
  }
);

// List the caller's company invitations. BUSINESS_OWNER only.
router.get(
  "/",
  authMiddleware,
  requireRole(ROLES.BUSINESS_OWNER),
  async (req, res) => {
    const invitations = await prisma.invitation.findMany({
      where: { companyId: req.user!.companyId! },
      orderBy: { id: "desc" },
    });

    return res.json(invitations);
  }
);

// Revoke a pending invitation. BUSINESS_OWNER only.
router.delete(
  "/:id",
  authMiddleware,
  requireRole(ROLES.BUSINESS_OWNER),
  async (req, res) => {
    const { id } = req.params;

    await prisma.invitation.deleteMany({
      where: { id: Number(id), companyId: req.user!.companyId! },
    });

    return res.status(204).send();
  }
);

// Public — used by the accept-invite page to show who/what the invite is for.
router.get("/:token", async (req, res) => {
  const { token } = req.params;

  const invitation = await prisma.invitation.findUnique({
    where: { token },
    include: { company: true },
  });

  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) {
    return res.status(404).json({ error: "Invitation not found or expired" });
  }

  return res.json({
    email: invitation.email,
    companyName: invitation.company.name,
  });
});

// Public — sets a password and activates the invited employee's account.
router.post("/:token/accept", async (req, res) => {
  const { token } = req.params;
  const { firstName, lastName, password } = req.body;

  if (!firstName || !lastName || !password) {
    return res.status(400).json({
      error: "firstName, lastName and password are required",
    });
  }

  const invitation = await prisma.invitation.findUnique({
    where: { token },
  });

  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) {
    return res.status(404).json({ error: "Invitation not found or expired" });
  }

  const existing = await prisma.user.findUnique({
    where: { email: invitation.email },
  });

  if (existing) {
    return res.status(409).json({ error: "Email already in use" });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const employee = await prisma.employee.create({
    data: {
      firstName,
      lastName,
      email: invitation.email,
      status: "Active",
      companyId: invitation.companyId,
    },
  });

  const user = await prisma.user.create({
    data: {
      email: invitation.email,
      password: hashedPassword,
      role: ROLES.EMPLOYEE,
      companyId: invitation.companyId,
      employeeId: employee.id,
    },
  });

  await prisma.invitation.update({
    where: { id: invitation.id },
    data: { acceptedAt: new Date() },
  });

  const jwtToken = jwt.sign(
    {
      userId: user.id,
      companyId: user.companyId,
      role: user.role,
      employeeId: user.employeeId,
    },
    process.env.JWT_SECRET as string,
    { expiresIn: "7d" }
  );

  return res.status(201).json({
    token: jwtToken,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      companyId: user.companyId,
      employeeId: user.employeeId,
    },
  });
});

export default router;
