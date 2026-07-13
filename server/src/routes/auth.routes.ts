import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import prisma from "../database/prisma";
import { ROLES } from "../constants/roles";
import { emailService } from "../services/email";
import { authMiddleware } from "../middleware/auth.middleware";
import { signAuthToken } from "../utils/authToken";
import { hashToken } from "../utils/tokenHash";
import { validatePassword } from "../utils/passwordPolicy";
import { validateEmail } from "../utils/emailValidation";
import { createRateLimiter, maskEmail } from "../middleware/rateLimit.middleware";
import { RATE_LIMITS } from "../constants/rateLimits";
import { AuthEvent, logAuthEvent } from "../services/audit/authAudit";
import { logAudit } from "../services/audit/auditLog";
import { AUDIT_ACTIONS } from "../constants/auditActions";
import { PLAN_TRIAL_DAYS } from "../config/stripePricing";
import { config } from "../config";

const router = Router();

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

// Timing-attack mitigation (K2.1.8): a valid bcrypt hash of a random value,
// generated ONCE at module load — never per request, and no plaintext
// password lives in the source. When a login hits an unknown email, we run
// bcrypt.compare() against this hash so the request costs the same as a
// wrong-password attempt on a real account; without it, the fast "no such
// user" path let response times reveal which emails are registered. Cost
// factor 10 matches real user hashes, so compare timing matches too.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
  crypto.randomBytes(32).toString("hex"),
  10
);

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

// Registration enumeration protection (K2.1.9): every valid registration
// attempt gets this one response — new account or already-taken email alike.
// It deliberately carries NO token/user object: an identical body is only
// possible if neither case exposes account-specific data (a real session
// token could never be minted for an existing account without takeover). The
// frontend already logs in via a separate POST /auth/login after register,
// so dropping the token here doesn't change the UX.
const GENERIC_REGISTER_RESPONSE = {
  message: "Registration received. Please check your email to verify your account.",
};

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

  const emailCheck = validateEmail(email);

  if (!emailCheck.ok) {
    return res.status(400).json({ error: emailCheck.error });
  }

  const passwordCheck = validatePassword(password);

  if (!passwordCheck.ok) {
    return res.status(400).json({ error: passwordCheck.error });
  }

  const existing = await prisma.user.findUnique({
    where: { email: emailCheck.email },
  });

  if (existing) {
    // Duplicate email (K2.1.9): return the exact same generic success as a
    // real signup — no 409, no distinct body — so registration can't be
    // used to probe which emails are registered. Deliberately do NOT resend
    // a verification email: that would both confirm the account exists to
    // an off-channel observer and let registration be abused to spam an
    // existing user's inbox. Burn one bcrypt cost against the shared dummy
    // hash so this path matches the timing of the bcrypt.hash() below and
    // no new timing side-channel replaces the removed status-code leak.
    await bcrypt.compare(passwordCheck.password, DUMMY_PASSWORD_HASH);
    logAuthEvent(AuthEvent.REGISTRATION_DUPLICATE, {
      req,
      level: "WARN",
      result: "failure",
      email: emailCheck.email,
    });
    return res.status(201).json(GENERIC_REGISTER_RESPONSE);
  }

  const hashedPassword = await bcrypt.hash(passwordCheck.password, 10);

  // Every new company starts on Starter with its trial already running — no
  // Stripe interaction required to begin it (matches the pricing page's
  // "14-day free trial, no credit card required"). Trial length comes from
  // the centralized Stripe pricing config (PLAN_TRIAL_DAYS.starter), not a
  // magic number here, so it can never drift from what Checkout itself would
  // apply if the owner later subscribes for real. If a plan is ever
  // configured with no trial, the company simply starts inactive instead of
  // fabricating a trial that doesn't exist.
  const starterTrialDays = PLAN_TRIAL_DAYS.starter;
  const trialEndsAt =
    starterTrialDays > 0 ? new Date(Date.now() + starterTrialDays * 24 * 60 * 60 * 1000) : null;

  const company = await prisma.company.create({
    data: {
      name: companyName,
      plan: "starter",
      ...(trialEndsAt ? { subscriptionStatus: "trialing", subscriptionEndsAt: trialEndsAt } : {}),
    },
  });

  const verificationToken = crypto.randomBytes(32).toString("hex");

  const user = await prisma.user.create({
    data: {
      email: emailCheck.email,
      password: hashedPassword,
      role: ROLES.BUSINESS_OWNER,
      companyId: company.id,
      // Only the hash hits the database (K2.1.4) — the raw token lives in
      // the emailed link alone.
      emailVerificationToken: hashToken(verificationToken),
      emailVerificationExpiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
    },
  });

  // No token is minted here anymore: registration returns the generic
  // enumeration-safe body (no session), and the frontend logs in via a
  // separate POST /auth/login right after — see GENERIC_REGISTER_RESPONSE.

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

  logAuthEvent(AuthEvent.REGISTRATION_SUCCEEDED, {
    req,
    level: "INFO",
    result: "success",
    userId: user.id,
    companyId: user.companyId,
    role: user.role,
    email: user.email,
  });

  return res.status(201).json(GENERIC_REGISTER_RESPONSE);
});

router.post("/login", loginPerIpLimiter, loginPerEmailLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  // Format-only check — a malformed address can't match any account, and
  // rejecting it early keeps the lookup below working with the same
  // normalized form (trimmed, lowercased domain) that registration stores.
  const emailCheck = validateEmail(email);

  if (!emailCheck.ok) {
    return res.status(400).json({ error: emailCheck.error });
  }

  const user = await prisma.user.findUnique({
    where: { email: emailCheck.email },
    include: { company: { select: { active: true } } },
  });

  if (!user) {
    // Burn the same bcrypt cost as a real comparison (see
    // DUMMY_PASSWORD_HASH above), then return the exact same error as the
    // wrong-password path — status, body and (absence of) logging are
    // identical, so neither the response nor its timing distinguishes
    // "unknown email" from "wrong password".
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
    // Log fields are identical in shape to the wrong-password branch below
    // (one masked-email LOGIN_FAILED); only the internal `reason` differs,
    // so neither timing nor the client response distinguishes the cases.
    logAuthEvent(AuthEvent.LOGIN_FAILED, {
      req,
      level: "WARN",
      result: "failure",
      email: emailCheck.email,
      reason: "unknown_email",
    });
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const valid = await bcrypt.compare(password, user.password);

  if (!valid) {
    logAuthEvent(AuthEvent.LOGIN_FAILED, {
      req,
      level: "WARN",
      result: "failure",
      userId: user.id,
      companyId: user.companyId,
      role: user.role,
      email: user.email,
      reason: "bad_password",
    });
    return res.status(401).json({ error: "Invalid credentials" });
  }

  // Soft-deleted account — don't reveal that distinction from "wrong
  // password", same as the unknown-email case above.
  if (!user.active) {
    logAuthEvent(AuthEvent.LOGIN_FAILED, {
      req,
      level: "WARN",
      result: "failure",
      userId: user.id,
      companyId: user.companyId,
      role: user.role,
      email: user.email,
      reason: "user_inactive",
    });
    return res.status(401).json({ error: "Invalid credentials" });
  }

  // Inactive company (K2.1.5) — its members must not sign in. Same generic
  // error, so company status doesn't leak. DEVELOPER users have no company
  // (company is null) and pass through.
  if (user.company && !user.company.active) {
    logAuthEvent(AuthEvent.LOGIN_FAILED, {
      req,
      level: "WARN",
      result: "failure",
      userId: user.id,
      companyId: user.companyId,
      role: user.role,
      email: user.email,
      reason: "company_inactive",
    });
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = signAuthToken(user);

  // Record the sign-in time for the admin analytics dashboard (Active Users /
  // Last Login / status), and persist a LOGIN audit row for the activity
  // timeline. Both are additive to the existing console auth-audit below.
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  logAudit({
    action: AUDIT_ACTIONS.USER_LOGIN,
    userId: user.id,
    companyId: user.companyId,
  });

  logAuthEvent(AuthEvent.LOGIN_SUCCEEDED, {
    req,
    level: "INFO",
    result: "success",
    userId: user.id,
    companyId: user.companyId,
    role: user.role,
    email: user.email,
  });

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

  logAudit({
    action: AUDIT_ACTIONS.USER_LOGOUT,
    userId: req.user!.userId,
    companyId: req.user!.companyId,
  });

  logAuthEvent(AuthEvent.LOGOUT, {
    req,
    level: "INFO",
    result: "success",
    userId: req.user!.userId,
    companyId: req.user!.companyId,
    role: req.user!.role,
  });

  return res.json({ loggedOut: true });
});

// Public — the link sent in the verification email points here.
router.get("/verify-email/:token", async (req, res) => {
  const { token } = req.params;

  const user = await prisma.user.findUnique({
    where: { emailVerificationToken: hashToken(token) },
    include: { company: { select: { active: true } } },
  });

  // Inactive user / inactive company (K2.1.5) get the same generic error as
  // a bad token — verifying an email for a locked-out account would be
  // harmless in itself, but consistent enforcement is cheaper to reason
  // about than per-endpoint exceptions.
  if (
    !user ||
    !user.active ||
    (user.company && !user.company.active) ||
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

  logAudit({
    action: AUDIT_ACTIONS.EMAIL_VERIFIED,
    userId: user.id,
    companyId: user.companyId,
  });

  logAuthEvent(AuthEvent.EMAIL_VERIFIED, {
    req,
    level: "INFO",
    result: "success",
    userId: user.id,
    companyId: user.companyId,
    role: user.role,
    email: user.email,
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

  logAuthEvent(AuthEvent.EMAIL_VERIFICATION_REQUESTED, {
    req,
    level: "INFO",
    result: "success",
    userId: user.id,
    companyId: user.companyId,
    role: user.role,
    email: user.email,
  });

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

  // Malformed address: 400 on format only — reveals nothing about whether
  // an account exists, so the enumeration protection of the generic
  // response below is unaffected.
  const emailCheck = validateEmail(email);

  if (!emailCheck.ok) {
    return res.status(400).json({ error: emailCheck.error });
  }

  // Logged uniformly for every well-formed request, before the account
  // lookup — so the audit trail never distinguishes "account exists" from
  // "doesn't", preserving the enumeration protection of the generic
  // response.
  logAuthEvent(AuthEvent.PASSWORD_RESET_REQUESTED, {
    req,
    level: "INFO",
    result: "success",
    email: emailCheck.email,
  });

  const user = await prisma.user.findUnique({
    where: { email: emailCheck.email },
    include: { company: { select: { active: true } } },
  });

  // Inactive user OR inactive company (K2.1.5): no reset token is even
  // generated — the most secure option, since a reset link would otherwise
  // let a member of a deactivated company regain a working password (and a
  // valid-looking session) for an account that must stay locked out.
  // Response stays generic either way.
  if (!user || !user.active || (user.company && !user.company.active)) {
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

  const passwordCheck = validatePassword(password);

  if (!passwordCheck.ok) {
    return res.status(400).json({ error: passwordCheck.error });
  }

  const user = await prisma.user.findUnique({
    where: { passwordResetToken: hashToken(token) },
    include: { company: { select: { active: true } } },
  });

  // Same generic message for "no such token", "expired", "soft-deleted"
  // and "inactive company" (K2.1.5) — mirrors forgot-password's checks, so
  // this endpoint can't be used to distinguish a locked-out account from
  // an expired link. The company check also covers tokens issued BEFORE
  // the company was deactivated.
  if (
    !user ||
    !user.active ||
    (user.company && !user.company.active) ||
    !user.passwordResetExpiresAt ||
    user.passwordResetExpiresAt < new Date()
  ) {
    return res.status(400).json({ error: "Invalid or expired reset link" });
  }

  const hashedPassword = await bcrypt.hash(passwordCheck.password, 10);

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

  logAuthEvent(AuthEvent.PASSWORD_RESET_COMPLETED, {
    req,
    level: "INFO",
    result: "success",
    userId: user.id,
    companyId: user.companyId,
    role: user.role,
    email: user.email,
  });

  return res.json({ reset: true });
});

export default router;
