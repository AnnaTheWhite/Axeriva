import prisma from "../../database/prisma";
import {
  defaultEnabledForCategory,
  suppressionKey,
  type DeliverySuppressionReason,
  type NotificationChannel,
} from "../../constants/notifications";
import type { NotificationTypeDefinition } from "./registry";

// N1.5 — everything that can stop a notification before it is sent, in one
// place and in a fixed order. Every "no" is RECORDED (the caller writes it to
// NotificationDelivery.suppressionReason) rather than being a silent skip,
// because "why didn't my customer get it?" is the expensive support question
// and the answer has to be in the database, not in someone's memory of the
// code.
//
// Order matters:
//   1. mandatory        security / critical billing overrides everything
//   2. company toggles  the owner's global kill switch
//   3. user preference  per-category, per-channel
//   4. suppression list bounced / complained addresses (global)
//
// Until this milestone the three Company toggles were dead configuration:
// present in the schema, editable in the UI, returned by the API — and read
// by no sending path whatsoever. This is the first code that honours them.

export type GateDecision =
  | { allowed: true }
  | { allowed: false; reason: DeliverySuppressionReason };

const ALLOWED: GateDecision = { allowed: true };

type GateInput = {
  definition: NotificationTypeDefinition;
  channel: NotificationChannel;
  companyId: number | null;
  userId: number | null;
  email: string;
};

export async function evaluateGates({
  definition,
  channel,
  companyId,
  userId,
  email,
}: GateInput): Promise<GateDecision> {
  // 1. Mandatory types bypass preferences entirely — but NOT the suppression
  // list: continuing to mail a hard-bounced address damages the sending
  // domain's reputation for every tenant, and no single message is worth that.
  if (!definition.mandatory) {
    const companyDecision = await evaluateCompanyToggles(channel, companyId);
    if (!companyDecision.allowed) return companyDecision;

    const preferenceDecision = await evaluatePreference(definition, channel, companyId, userId);
    if (!preferenceDecision.allowed) return preferenceDecision;
  }

  if (channel === "EMAIL") {
    // N1.7.2 — normalised. The column is a plain @unique String with no citext
    // and no case-insensitive collation, so "User@x.com" and "user@x.com" were
    // two different rows: a suppression written from one casing did not block
    // the other, and the operator removal path (which lowercases) could not
    // lift it. Every read and write of this table now goes through the same
    // normalisation — see suppressionKey().
    const suppressed = await prisma.emailSuppression.findUnique({
      where: { email: suppressionKey(email) },
    });
    if (suppressed && !survivesSuppression(definition, suppressed.reason)) {
      return { allowed: false, reason: "suppression_list" };
    }
  }

  return ALLOWED;
}

// N1.7.1 (H2) — the one exception to the suppression list, and it exists to
// stop a spam click from becoming a permanent account lockout.
//
// The list is global, permanent and had no removal path at all: two references
// in the whole codebase, an upsert and this lookup. Combined with the rule that
// suppression outranks `mandatory`, a single "mark as spam" on any Axeriva mail
// meant that address could never receive a password reset again — the user was
// locked out of their account with no route back that did not involve
// hand-written SQL.
//
// The distinction that resolves it is the REASON, not the category alone:
//
//   bounced    — the mailbox does not exist. Keep blocking: sending cannot
//                reach them, and repeatedly mailing a dead address is exactly
//                what wrecks a domain's reputation for every other tenant.
//   complained — the mailbox exists and the person is reading it. Blocking
//                buys reputation protection on bulk mail, but a password reset
//                is user-initiated, expected, and arrives seconds after they
//                asked for it. Refusing that one is a lockout, not hygiene.
//
// N1.7.2 narrowed the test itself. It was `category === "security" &&
// mandatory`, which is true of `auth.welcome` too — a courtesy mail that has no
// business overriding someone who explicitly marked us as spam. The exemption
// is now an explicit per-type registry flag (`bypassesComplaintSuppression`),
// carried today by exactly one message: the password reset.
function survivesSuppression(definition: NotificationTypeDefinition, reason: string): boolean {
  return reason === "complained" && definition.bypassesComplaintSuppression === true;
}

async function evaluateCompanyToggles(
  channel: NotificationChannel,
  companyId: number | null
): Promise<GateDecision> {
  if (companyId === null) return ALLOWED;

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      notificationsEnabled: true,
      emailNotificationsEnabled: true,
      desktopNotificationsEnabled: true,
    },
  });
  if (!company) return ALLOWED;

  // The master switch. The UI has always presented it as gating the other
  // two; the API accepted contradictory combinations because nothing enforced
  // it. Enforced here, once, for every channel.
  if (!company.notificationsEnabled) {
    return { allowed: false, reason: "company_notifications_off" };
  }

  if (channel === "EMAIL" && !company.emailNotificationsEnabled) {
    return { allowed: false, reason: "company_channel_off" };
  }

  // desktopNotificationsEnabled governs PUSH, which does not exist yet. It is
  // read here so the toggle means something the day the channel ships.
  if (channel === "PUSH" && !company.desktopNotificationsEnabled) {
    return { allowed: false, reason: "company_channel_off" };
  }

  return ALLOWED;
}

// Three levels, most specific first: the user's own row, then the company
// default (userId null), then the registry's opinion — categories that are
// opt-in default to off, everything else to on.
async function evaluatePreference(
  definition: NotificationTypeDefinition,
  channel: NotificationChannel,
  companyId: number | null,
  userId: number | null
): Promise<GateDecision> {
  if (companyId === null) return ALLOWED;

  const rows = await prisma.notificationPreference.findMany({
    where: {
      companyId,
      category: definition.category,
      channel,
      OR: [{ userId }, { userId: null }],
    },
  });

  // findFirst on a NULL-able unique cannot be trusted to return the user row
  // first, so pick explicitly. The company-default rows are additionally
  // ordered by id: the composite unique does NOT cover them (PostgreSQL treats
  // NULLs as distinct — the N1.1 known limitation), so more than one can exist,
  // and "which one wins" must not depend on the planner's mood. Oldest wins,
  // and preferences.ts collapses duplicates on every write.
  const userRow = userId === null ? undefined : rows.find((row) => row.userId === userId);
  const companyRow = rows
    .filter((row) => row.userId === null)
    .sort((a, b) => a.id - b.id)[0];
  const effective = userRow ?? companyRow;

  // No row at any level: the registry decides. This branch was documented from
  // N1.5 but not implemented — the code returned ALLOWED unconditionally, so an
  // opt-in category would have sent on first use with nobody having opted in.
  // Unreachable until now (no shipped type is in `digest` or `marketing`), and
  // fixed here because N1.7 publishes this default through the preference API:
  // a screen that says "Marketing: off" while the gate says "send" is worse
  // than either behaviour on its own.
  if (!effective) {
    return defaultEnabledForCategory(definition.category)
      ? ALLOWED
      : { allowed: false, reason: "not_opted_in" };
  }

  if (!effective.enabled) {
    return {
      allowed: false,
      reason: userRow ? "user_preference" : "company_channel_off",
    };
  }

  return ALLOWED;
}
