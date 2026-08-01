import prisma from "../../database/prisma";
import type {
  DeliverySuppressionReason,
  NotificationChannel,
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
    const suppressed = await prisma.emailSuppression.findUnique({ where: { email } });
    if (suppressed) return { allowed: false, reason: "suppression_list" };
  }

  return ALLOWED;
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
  // first, so pick explicitly.
  const userRow = userId === null ? undefined : rows.find((row) => row.userId === userId);
  const companyRow = rows.find((row) => row.userId === null);
  const effective = userRow ?? companyRow;

  if (effective && !effective.enabled) {
    return {
      allowed: false,
      reason: userRow ? "user_preference" : "company_channel_off",
    };
  }

  return ALLOWED;
}
