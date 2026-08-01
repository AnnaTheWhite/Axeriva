import prisma from "../../../database/prisma";
import { emailService } from "../../email";
import type { EmailContext, EmailSendResult } from "../../email/EmailService";
import type { NotificationLocale } from "../../../constants/notifications";
import { INVITE_TTL_DAYS, VERIFICATION_TTL_HOURS } from "../../../constants/tokenTtl";
import { redactEventContextIfSettled } from "../notify";
import { isNotificationType } from "../registry";

// N1.5 — turns one NotificationDelivery row into a sent email.
//
// This runs inside a queue worker, so throwing is the correct way to report
// failure: pg-boss retries with backoff and, when the budget is exhausted,
// moves the job to the dead-letter queue. That is the entire reason the five
// emails were worth moving onto the pipeline — until now a transient Resend
// outage lost the message permanently, with a console.error as the only trace.

type DeliveryContext = Record<string, unknown>;

function requireString(context: DeliveryContext, key: string): string {
  const value = context[key];
  if (typeof value !== "string" || value.length === 0) {
    // A permanent failure: retrying cannot conjure a missing link. It still
    // throws (the job dead-letters) rather than silently succeeding, because
    // a notification nobody receives must be visible somewhere.
    throw new Error(`notification context is missing "${key}"`);
  }
  return value;
}

export async function deliverEmail(deliveryId: number): Promise<void> {
  const delivery = await prisma.notificationDelivery.findUnique({
    where: { id: deliveryId },
    include: { event: true },
  });

  if (!delivery) throw new Error(`delivery ${deliveryId} not found`);

  // Already sent — a redelivered job must not send twice. pg-boss is
  // at-least-once, so this check is load-bearing, not defensive decoration.
  if (delivery.status !== "pending") return;

  const context: DeliveryContext = delivery.event.context
    ? (JSON.parse(delivery.event.context) as DeliveryContext)
    : {};
  const locale = delivery.locale as NotificationLocale;

  try {
    // N1.7.1 — the key is derived from the DELIVERY id, which is exactly the
    // unit pg-boss retries: the same row retried an hour later presents the
    // same key, so Resend returns the original message instead of sending a
    // second copy. Deriving it from the event id instead would be wrong — one
    // event fans out to many recipients, and they must not deduplicate against
    // each other.
    const result = await send(delivery.event.type, delivery.recipientAddress, locale, context, {
      idempotencyKey: `notif-delivery-${deliveryId}`,
    });

    await prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: {
        status: "sent",
        sentAt: new Date(),
        attempts: { increment: 1 },
        lastError: null,
        // THE join key for every provider webhook (N1.6). Until N1.7.1 this
        // was never written, so every delivery event arrived unmatched and no
        // row could ever reach delivered/bounced/complained.
        providerMessageId: result.messageId,
      },
    });

    // H1 — the send is done, so a raw reset/verify/invite link in the event
    // context has served its purpose and must not outlive it. See notify.ts.
    await redactEventContextIfSettled(delivery.eventId);
  } catch (error) {
    // Record the attempt before rethrowing, so a job that eventually
    // dead-letters leaves a readable trail rather than just disappearing.
    await prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: {
        attempts: { increment: 1 },
        lastError: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}

// One switch rather than a table of function pointers: each template takes
// different props, and a switch is the shape TypeScript can actually check.
async function send(
  type: string,
  to: string,
  locale: NotificationLocale,
  context: DeliveryContext,
  options: { idempotencyKey: string }
): Promise<EmailSendResult> {
  if (!isNotificationType(type)) {
    throw new Error(`unknown notification type: ${type}`);
  }

  const emailContext: EmailContext = { locale, idempotencyKey: options.idempotencyKey };

  switch (type) {
    case "auth.welcome":
      return emailService.sendWelcomeEmail(
        to,
        requireString(context, "companyName"),
        emailContext
      );

    case "auth.verify_email":
      return emailService.sendVerificationEmail(
        to,
        requireString(context, "verifyLink"),
        emailContext
      );

    case "auth.password_reset":
      return emailService.sendPasswordResetEmail(
        to,
        requireString(context, "resetLink"),
        emailContext
      );

    case "employees.invitation":
      return emailService.sendInvitationEmail(
        to,
        requireString(context, "inviteLink"),
        requireString(context, "companyName"),
        emailContext
      );

    case "billing.subscription_created":
      return emailService.sendSubscriptionConfirmedEmail(
        to,
        requireString(context, "companyName"),
        requireString(context, "planName"),
        emailContext
      );
  }

  // N1.7.1 — exhaustiveness guard. The switch above returns for every member of
  // NotificationTypeKey, so this line is unreachable TODAY and TypeScript
  // proves it: `type` narrows to never. The moment a registry entry adds EMAIL
  // to its channels without a case here, that proof fails at compile time
  // instead of the delivery being silently marked "sent" with nothing sent.
  return assertNoEmailTemplate(type);
}

function assertNoEmailTemplate(type: never): never {
  throw new Error(`notification type has an EMAIL channel but no template: ${String(type)}`);
}

// Exported for the tests that assert the TTL constants reach the templates
// through this path rather than being re-stated in prose.
export const EMAIL_TTL_FACTS = { INVITE_TTL_DAYS, VERIFICATION_TTL_HOURS };
