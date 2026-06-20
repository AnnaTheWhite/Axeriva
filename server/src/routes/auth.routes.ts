import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../database/prisma";
import { ROLES } from "../constants/roles";
import { emailService } from "../services/email";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

function buildVerifyLink(token: string) {
  const appUrl = process.env.APP_URL || "http://localhost:5173";
  return `${appUrl}/verify-email/${token}`;
}

router.post("/register", async (req, res) => {
  const { companyName, email, password } = req.body;

  if (!companyName || !email || !password) {
    return res.status(400).json({
      error: "companyName, email and password are required",
    });
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    return res.status(409).json({ error: "Email already in use" });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const company = await prisma.company.create({
    data: { name: companyName },
  });

  const verificationToken = crypto.randomBytes(32).toString("hex");

  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      role: ROLES.BUSINESS_OWNER,
      companyId: company.id,
      emailVerificationToken: verificationToken,
      emailVerificationExpiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
    },
  });

  const token = jwt.sign(
    {
      userId: user.id,
      companyId: user.companyId,
      role: user.role,
      employeeId: user.employeeId,
    },
    process.env.JWT_SECRET as string,
    { expiresIn: "7d" }
  );

  // Two separate emails, two separate concerns: the welcome email is just a
  // greeting, the verification email is the one with the actionable link.
  // Neither failing should fail registration itself — log and move on.
  emailService.sendWelcomeEmail(user.email, company.name).catch((error) => {
    console.error("[auth] welcome email failed", error);
  });

  emailService
    .sendVerificationEmail(user.email, buildVerifyLink(verificationToken))
    .catch((error) => {
      console.error("[auth] verification email failed", error);
    });

  return res.status(201).json({
    token,
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

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const valid = await bcrypt.compare(password, user.password);

  if (!valid) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  // Soft-deleted account — don't reveal that distinction from "wrong
  // password", same as the unknown-email case above.
  if (!user.active) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = jwt.sign(
    {
      userId: user.id,
      companyId: user.companyId,
      role: user.role,
      employeeId: user.employeeId,
    },
    process.env.JWT_SECRET as string,
    { expiresIn: "7d" }
  );

  return res.json({
    token,
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

// Public — the link sent in the verification email points here.
router.get("/verify-email/:token", async (req, res) => {
  const { token } = req.params;

  const user = await prisma.user.findUnique({
    where: { emailVerificationToken: token },
  });

  if (
    !user ||
    !user.emailVerificationExpiresAt ||
    user.emailVerificationExpiresAt < new Date()
  ) {
    return res.status(400).json({ error: "Invalid or expired verification link" });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpiresAt: null,
    },
  });

  return res.json({ verified: true });
});

// Re-sends the verification email for the logged-in user. Requires auth so
// this can't be used to probe whether an arbitrary email is registered.
router.post("/resend-verification", authMiddleware, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
  });

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  if (user.emailVerified) {
    return res.status(400).json({ error: "Email is already verified" });
  }

  const verificationToken = crypto.randomBytes(32).toString("hex");

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerificationToken: verificationToken,
      emailVerificationExpiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
    },
  });

  try {
    await emailService.sendVerificationEmail(
      user.email,
      buildVerifyLink(verificationToken)
    );
  } catch (error) {
    console.error("[auth] resend verification email failed", error);
    return res.status(502).json({ error: "Failed to send verification email" });
  }

  return res.json({ sent: true });
});

export default router;
