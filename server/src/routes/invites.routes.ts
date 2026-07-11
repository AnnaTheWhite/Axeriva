import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import prisma from "../database/prisma";
import { authMiddleware } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { ROLES } from "../constants/roles";
import { emailService } from "../services/email";
import { isEmployeeLimitReached } from "../utils/planLimits";
import { signAuthToken } from "../utils/authToken";
import { hashToken } from "../utils/tokenHash";
import { createRateLimiter } from "../middleware/rateLimit.middleware";
import { RATE_LIMITS } from "../constants/rateLimits";
import { config } from "../config";

const router = Router();

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const inviteAcceptLimiter = createRateLimiter({
  name: "invite-accept",
  ...RATE_LIMITS.INVITE_ACCEPT,
});

function buildInviteLink(token: string) {
  return `${config.frontendUrl}/invite/${token}`;
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

    if (await isEmployeeLimitReached(company.id)) {
      return res.status(403).json({
        error: "Free plan limit reached. Upgrade to Axeriva Pro to invite more employees.",
      });
    }

    const token = crypto.randomBytes(24).toString("hex");

    const invitation = await prisma.invitation.create({
      data: {
        email,
        // Only the hash is stored (K2.1.4); the raw token goes into the
        // emailed link (and the inviteLink echoed in the response below).
        token: hashToken(token),
        role: ROLES.EMPLOYEE,
        companyId: req.user!.companyId!,
        invitedByUserId: req.user!.userId,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });

    const inviteLink = buildInviteLink(token);

    // The invitation itself is already saved at this point — don't let a
    // flaky email provider (rate limit, sandbox restrictions, an outage)
    // fail the whole request. The owner can still see/share `inviteLink`
    // from the response (the EmployeesPage UI already does this) even if
    // the email never lands.
    try {
      await emailService.sendInvitationEmail(email, inviteLink, company.name);
    } catch (error) {
      console.error("[invites] invitation email failed", error);
    }

    // `invitation.token` is the stored hash — echo the RAW token instead,
    // exactly as this endpoint responded before K2.1.4 (the owner UI builds
    // on inviteLink; the response shape must not change).
    return res.status(201).json({ ...invitation, token, inviteLink });
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
    where: { token: hashToken(token) },
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
router.post("/:token/accept", inviteAcceptLimiter, async (req, res) => {
  const { token } = req.params;
  const { firstName, lastName, password } = req.body;

  if (!firstName || !lastName || !password) {
    return res.status(400).json({
      error: "firstName, lastName and password are required",
    });
  }

  const invitation = await prisma.invitation.findUnique({
    where: { token: hashToken(token) },
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
      // They just proved ownership of this address by opening the emailed
      // invite link — no separate verification email needed.
      emailVerified: true,
    },
  });

  await prisma.invitation.update({
    where: { id: invitation.id },
    data: { acceptedAt: new Date() },
  });

  const jwtToken = signAuthToken(user);

  return res.status(201).json({
    token: jwtToken,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      companyId: user.companyId,
      employeeId: user.employeeId,
      emailVerified: user.emailVerified,
    },
  });
});

export default router;
