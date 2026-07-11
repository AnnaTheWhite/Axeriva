import { Router } from "express";
import bcrypt from "bcryptjs";
import prisma from "../database/prisma";
import { requireRole } from "../middleware/role.middleware";
import { ROLES } from "../constants/roles";
import { logAudit } from "../services/audit/auditLog";
import { AuthEvent, logAuthEvent } from "../services/audit/authAudit";

const router = Router();

const ACTIVE_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due"];
const CONFIRMATION_TEXT = "DELETE";

router.use(requireRole(ROLES.BUSINESS_OWNER, ROLES.EMPLOYEE));

// Soft-deletes the caller's own account. Requires re-entering the password
// and typing "DELETE" — this is a deliberately heavy confirmation for an
// irreversible-feeling action, even though nothing is physically removed.
router.post("/delete", async (req, res) => {
  const { password, confirmation } = req.body;
  const userId = req.user!.userId;
  const companyId = req.user!.companyId;
  const role = req.user!.role;

  if (confirmation !== CONFIRMATION_TEXT) {
    await logAudit({
      action: "ACCOUNT_DELETE_FAILED_CONFIRMATION",
      userId,
      companyId,
    });

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
    await logAudit({
      action: "ACCOUNT_DELETE_FAILED_PASSWORD",
      userId,
      companyId,
    });

    return res.status(401).json({ error: "Incorrect password" });
  }

  if (role === ROLES.BUSINESS_OWNER && companyId) {
    const company = await prisma.company.findUnique({ where: { id: companyId } });

    if (company && ACTIVE_SUBSCRIPTION_STATUSES.includes(company.subscriptionStatus)) {
      await logAudit({
        action: "ACCOUNT_DELETE_BLOCKED_SUBSCRIPTION",
        userId,
        companyId,
        metadata: { subscriptionStatus: company.subscriptionStatus },
      });

      return res.status(409).json({
        error:
          "You have an active subscription. Cancel it from the Subscription page before deleting your account.",
      });
    }
  }

  const now = new Date();

  // Free up the email for reuse (K3 business decision): User.email stays
  // a DB-level @unique column, so a soft-deleted row would otherwise
  // permanently block both new registrations and invite-accept on this
  // address (both look the row up by the literal email string). Rewriting
  // it to a tombstone value — userId guarantees no collision with any
  // other row, deleted user's own primary key is unique by definition —
  // frees the original address without touching the unique constraint,
  // without reactivating this row, and without any change needed in
  // auth.routes.ts or invites.routes.ts: their existing lookups simply no
  // longer find a match on the original address.
  const tombstoneEmail = `deleted+${userId}+${now.getTime()}__${user.email}`;

  await prisma.user.update({
    where: { id: userId },
    // tokenVersion bump: the `active: false` check in auth.middleware.ts
    // already blocks soft-deleted users on every request; incrementing the
    // version as well is defence in depth (K2.1.2) — the tokens die even if
    // the active-check ever changes.
    data: {
      active: false,
      deletedAt: now,
      email: tombstoneEmail,
      tokenVersion: { increment: 1 },
    },
  });

  if (role === ROLES.BUSINESS_OWNER && companyId) {
    await prisma.company.update({
      where: { id: companyId },
      data: { active: false, deletedAt: now },
    });
  }

  await logAudit({
    action: "ACCOUNT_DELETED",
    userId,
    companyId,
    metadata: { role },
  });

  // Console auth-audit alongside the persistent DB audit above — destructive
  // account event, surfaced in the same structured stream as the rest of
  // the auth flow.
  logAuthEvent(AuthEvent.ACCOUNT_DELETED, {
    req,
    level: "WARN",
    result: "success",
    userId,
    companyId,
    role,
  });

  return res.json({ deleted: true });
});

export default router;
