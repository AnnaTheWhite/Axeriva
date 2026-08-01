import prisma from "../../database/prisma";
import type { DeliveryStatus, SuppressionReason } from "../../constants/notifications";
import { suppressionKey } from "../../constants/notifications";
import { maskEmail } from "../../utils/maskEmail";

// N1.6 — what a provider delivery event does to our state.
//
// Kept out of the route so the mapping is testable on its own and the route
// stays what it should be: verify, hand off, ack.

// Which events change a delivery's status, and to what.
//
// The one that matters: `email.sent` means only that Resend ACCEPTED the API
// call — their own docs are explicit about this. It is emphatically not
// delivery, and must never be shown to a user as such. Our delivery row is
// already "sent" when the send call returned, so this event carries no new
// information and deliberately maps to nothing.
const STATUS_BY_EVENT: Partial<Record<string, DeliveryStatus>> = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
  // Resend refused to send because the address is on THEIR suppression list.
  "email.suppressed": "suppressed",
};

// Events that mean "never email this address again". A hard bounce is the
// mailbox telling us it does not exist; a complaint is the human telling us
// they consider our mail spam. Continuing after either damages the sending
// domain's reputation for every tenant, which is why the suppression list is
// global rather than per-company.
const SUPPRESSION_BY_EVENT: Partial<Record<string, SuppressionReason>> = {
  "email.bounced": "bounced",
  "email.complained": "complained",
};

// Only a permanent bounce should suppress. A "transient" bounce is a full
// mailbox or a temporary server problem — blocking that address forever would
// punish a customer for their mail server having a bad afternoon.
function isPermanentBounce(payload: Record<string, unknown>): boolean {
  const data = payload.data as Record<string, unknown> | undefined;
  const bounce = data?.bounce as Record<string, unknown> | undefined;
  const type = typeof bounce?.type === "string" ? bounce.type.toLowerCase() : null;
  // Resend reports SES-style types. Absent type → treat as permanent: a
  // bounce we cannot classify is safer suppressed than retried forever.
  return type === null || type === "permanent" || type === "hard";
}

export type DeliveryEventInput = {
  // The provider's own event id (Svix). Used as the primary key, so a
  // redelivery collides instead of double-applying — the same replay
  // protection ProcessedStripeEvent uses for Stripe.
  eventId: string;
  type: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
};

export type DeliveryEventOutcome = "applied" | "duplicate" | "unmatched";

export async function recordDeliveryEvent(
  input: DeliveryEventInput
): Promise<DeliveryEventOutcome> {
  const existing = await prisma.emailEvent.findUnique({ where: { id: input.eventId } });
  if (existing) return "duplicate";

  const data = (input.payload.data ?? {}) as Record<string, unknown>;
  const providerMessageId = typeof data.email_id === "string" ? data.email_id : null;
  const recipients = Array.isArray(data.to) ? (data.to as unknown[]) : [];
  const recipientAddress = typeof recipients[0] === "string" ? (recipients[0] as string) : null;

  // Correlate to our own delivery row. A miss is possible and must not throw:
  // Resend also delivers events for mail we did not send through this
  // pipeline (the N1.3 test-send script, for one).
  const delivery = providerMessageId
    ? await prisma.notificationDelivery.findFirst({
        where: { providerMessageId },
        orderBy: { id: "desc" },
      })
    : null;

  await prisma.emailEvent.create({
    data: {
      id: input.eventId,
      deliveryId: delivery?.id ?? null,
      type: input.type,
      payload: JSON.stringify(input.payload),
      occurredAt: input.occurredAt,
    },
  });

  const nextStatus = STATUS_BY_EVENT[input.type];
  if (delivery && nextStatus) {
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: nextStatus,
        ...(nextStatus === "delivered" ? { deliveredAt: input.occurredAt } : {}),
        ...(nextStatus === "bounced" || nextStatus === "failed"
          ? { lastError: `provider reported ${input.type}` }
          : {}),
      },
    });
  }

  const suppressionReason = SUPPRESSION_BY_EVENT[input.type];
  const address = recipientAddress ?? delivery?.recipientAddress ?? null;

  if (suppressionReason && address) {
    const permanent = suppressionReason === "complained" || isPermanentBounce(input.payload);

    if (permanent) {
      // upsert, not create: the same address can bounce for several tenants,
      // and the list is global.
      await prisma.emailSuppression.upsert({
        where: { email: suppressionKey(address) },
        create: {
          email: suppressionKey(address),
          reason: suppressionReason,
          companyId: delivery?.companyId ?? null,
          detail: JSON.stringify(input.payload),
        },
        update: {},
      });
      // maskEmail: the module's stated rule is that addresses never reach the
      // logs in the clear (plan §15). This line was the one place breaking it.
      console.warn(`[notify] suppressed ${maskEmail(address)} (${suppressionReason})`);
    }
  }

  return delivery ? "applied" : "unmatched";
}
