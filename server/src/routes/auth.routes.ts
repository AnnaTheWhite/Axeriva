import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import prisma from "../database/prisma";
import { ROLES } from "../constants/roles";
import { emailService } from "../services/email";
import { authMiddleware } from "../middleware/auth.middleware";
import { signAuthToken } from "../utils/authToken";
import { hashToken } from "../utils/tokenHash";
import { createRateLimiter, maskEmail } from "../middleware/rateLimit.middleware";
import { RATE_LIMITS } from "../constants/rateLimits";
import { config } from "../config";

const router = Router();

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

// Two independent login limiters (K2.1.3): a per-IP ceiling against bulk
// credential stuffing, and a tighter per-IP+email limit against targeted
// brute force. The email is masked in the key so a rate-limit log line
// never carries the full address.
const loginPerIpLimiter = createRateLimiter({
  name: "login-ip",
  ...RATE_LIMITS.LOGIN_PER_IP,
});

const loginPerEmailLimiter = createRateLimiter({
  name: "login-email",
  ...RATE_LIMITS.LOGIN_PER_EMAIL,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === "string" ? req.body.email : null;
    // No email in the body — the route's own 400 validation handles it.
    if (!email) return null;
    return `${req.ip}:${maskEmail(email.toLowerCase())}`;
  },
});

const registerLimiter = createRateLimiter({ name: "register", ...RATE_LIMITS.REGISTER });
const forgotPasswordLimiter = createRateLimiter({
  name: "forgot-password",
  ...RATE_LIMITS.FORGOT_PASSWORD,
});
const resetPasswordLimiter = createRateLimiter({
  name: "reset-password",
  ...RATE_LIMITS.RESET_PASSWORD,
});
const verifyEmailLimiter = createRateLimiter({
  name: "resend-verification",
  ...RATE_LIMITS.VERIFY_EMAIL,
});

function buildVerifyLink(token: string) {
  return `${config.frontendUrl}/verify-email/${token}`;
}

function buildResetLink(token: string) {
  return `${config.frontendUrl}/reset-password/${token}`;
}

router.post("/register", registerLimiter, async (req, res) => {
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
      // Only the hash hits the database (K2.1.4) — the raw token lives in
      // the emailed link alone.
      emailVerificationToken: hashToken(verificationToken),
      emailVerificationExpiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
    },
  });

  const token = signAuthToken(user);

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

router.post("/login", loginPerIpLimiter, loginPerEmailLimiter, async (req, res) => {
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

  const token = signAuthToken(user);

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

// Server-side logout (K2.1.2): bumping tokenVersion invalidates EVERY
// outstanding JWT for this user, not just the one used here — with a single
// integer per user there is no way to target one device, and that
// trade-off is deliberate (no session table, no denylist). The current
// frontend still only clears localStorage; this endpoint is the backend
// support for a future "log out everywhere" / forced-logout feature.
router.post("/logout", authMiddleware, async (req, res) => {
  await prisma.user.update({
    where: { id: req.user!.userId },
    data: { tokenVersion: { increment: 1 } },
  });

  return res.json({ loggedOut: true });
});

// Public — the link sent in the verification email points here.
router.get("/verify-email/:token", async (req, res) => {
  const { token } = req.params;

  const user = await prisma.user.findUnique({
    where: { emailVerificationToken: hashToken(token) },
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
router.post("/resend-verification", verifyEmailLimiter, authMiddleware, async (req, res) => {
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
      emailVerificationToken: hashToken(verificationToken),
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

// Always returns a generic success message, regardless of whether the
// email matches an account — this can't be used to probe which emails are
// registered.
router.post("/forgot-password", forgotPasswordLimiter, async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "email is required" });
  }

  const genericResponse = {
    message: "If an account with that email exists, a reset link has been sent.",
  };

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !user.active) {
    return res.json(genericResponse);
  }

  const resetToken = crypto.randomBytes(32).toString("hex");

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordResetToken: hashToken(resetToken),
      passwordResetExpiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
    },
  });

  emailService
    .sendPasswordResetEmail(user.email, buildResetLink(resetToken))
    .catch((error) => {
      console.error("[auth] password reset email failed", error);
    });

  return res.json(genericResponse);
});

// Public — the link sent in the password reset email points here.
router.post("/reset-password/:token", resetPasswordLimiter, async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ error: "password is required" });
  }

  const user = await prisma.user.findUnique({
    where: { passwordResetToken: hashToken(token) },
  });

  // Same generic message for "no such token", "expired", and
  // "soft-deleted" — mirrors forgot-password's existing !user.active
  // check, so this endpoint can't be used to distinguish a deleted
  // account from an expired link.
  if (
    !user ||
    !user.active ||
    !user.passwordResetExpiresAt ||
    user.passwordResetExpiresAt < new Date()
  ) {
    return res.status(400).json({ error: "Invalid or expired reset link" });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: hashedPassword,
      passwordResetToken: null,
      passwordResetExpiresAt: null,
      // Kill every outstanding session: whoever just proved control of the
      // email owns the account now — any previously issued JWT (including a
      // potential attacker's) dies on its next request (see
      // auth.middleware.ts tokenVersion check).
      tokenVersion: { increment: 1 },
    },
  });

  return res.json({ reset: true });
});

export default router;
