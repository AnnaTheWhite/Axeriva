import { Router } from "express";
import bcrypt from "bcryptjs";
import prisma from "../database/prisma";
import { requireRole } from "../middleware/role.middleware";
import { ROLES } from "../constants/roles";
import { logAudit } from "../services/audit/auditLog";
import { AUDIT_ACTIONS } from "../constants/auditActions";
import { createRateLimiter } from "../middleware/rateLimit.middleware";
import { RATE_LIMITS } from "../constants/rateLimits";
import { ACTIVE_SUBSCRIPTION_STATUSES } from "../constants/subscriptionStatuses";

const router = Router();

const CONFIRMATION_TEXT = "ARCHIVE";

// Throttles the password check below (B2). Same oracle as /account/delete:
// the endpoint re-checks the caller's password, so a stolen JWT could
// otherwise brute-force it. Keyed per USER, with its OWN limiter name so it
// never shares a window with the account-delete limiter — one feature's
// legitimate attempts must not spend the other's budget.
const archiveCompanyLimiter = createRateLimiter({
  name: "company-archive",
  ...RATE_LIMITS.COMPANY_ARCHIVE,
  keyGenerator: (req) => String(req.user?.userId ?? req.ip ?? "unknown"),
});

// C1.7 — Archive Company. Owner-only, requires re-entering the password and
// typing "ARCHIVE" (mirrors account.routes.ts's account-deletion
// confirmation exactly).
//
// Deliberately mounted as its own router at /company/archive — BEFORE the
// general /company mount in app.ts, which carries the S2.7 read-only
// write-guard — so archiving stays possible even when the company is
// already read-only (same reasoning as /subscription staying writable so an
// owner can upgrade/resume out of read-only: this is a subscription/tenant-
// lifecycle action, not a "modify business data" write).
//
// Mechanism: sets Company.active=false + deletedAt=now — the EXACT same
// flags account.routes.ts sets when a BUSINESS_OWNER deletes their account.
// auth.middleware.ts already refuses login for any user of an inactive
// company, which is precisely Archive's "disable login for company users"
// requirement. Nothing is deleted: employees/customers/projects/invoices/
// Stripe fields are all left completely untouched. Unlike account deletion,
// the owner's own User row is NOT touched (no tombstoned email, no
// tokenVersion bump) — archiving the company is not the same as the owner
// deleting their personal account.
router.post("/", requireRole(ROLES.BUSINESS_OWNER), archiveCompanyLimiter, async (req, res) => {
  const { password, confirmation } = req.body ?? {};
  const userId = req.user!.userId;
  const companyId = req.user!.companyId;

  if (!companyId) {
    return res.status(400).json({ error: "No company to archive." });
  }

  if (confirmation !== CONFIRMATION_TEXT) {
    return res.status(400).json({
      error: `Please type "${CONFIRMATION_TEXT}" to confirm.`,
    });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const validPassword = await bcrypt.compare(password ?? "", user.password);
  if (!validPassword) {
    return res.status(401).json({ error: "Incorrect password" });
  }

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) {
    return res.status(404).json({ error: "Company not found" });
  }

  // Unreachable today: auth.middleware.ts 401s every user of an inactive
  // company before this handler runs. Kept because a future admin
  // unarchive endpoint (or any relaxation of that middleware rule) would
  // make it live again, and the correct answer is this 409, not a repeat
  // archive.
  if (!company.active) {
    return res.status(409).json({ error: "This company is already archived." });
  }

  // B2 — the archive flag locks every company user out permanently
  // (auth.middleware.ts 401s them on every request, and auth.routes.ts
  // refuses login, verify-email, forgot- and reset-password alike), while
  // Stripe carries on billing — and /subscription sits behind the same
  // authMiddleware, so cancelling AFTER archiving is impossible. A live,
  // billed subscription must therefore be settled first.
  //
  // The stripeSubscriptionId check is deliberate (and a deliberate
  // difference from account.routes.ts's guard): registration seeds every
  // new company as "trialing" WITHOUT a Stripe subscription — there is
  // nothing to cancel and nothing that will ever charge, so blocking that
  // company would only produce an unactionable error. A Stripe-backed
  // trial (trialing + stripeSubscriptionId) WILL charge at period end, so
  // it is blocked like any other live subscription.
  const isBilled =
    ACTIVE_SUBSCRIPTION_STATUSES.includes(company.subscriptionStatus) &&
    company.stripeSubscriptionId !== null;

  if (isBilled) {
    await logAudit({
      action: AUDIT_ACTIONS.COMPANY_ARCHIVE_BLOCKED_SUBSCRIPTION,
      userId,
      companyId,
      metadata: { subscriptionStatus: company.subscriptionStatus },
    });

    return res.status(409).json({
      error:
        "Your subscription is still active. Cancel it on the Subscription page and wait for the current period to end before archiving the company.",
    });
  }

  await prisma.company.update({
    where: { id: companyId },
    data: { active: false, deletedAt: new Date() },
  });

  await logAudit({
    action: AUDIT_ACTIONS.COMPANY_ARCHIVED,
    userId,
    companyId,
  });

  return res.json({ archived: true });
});

export default router;
