import prisma from "../../../database/prisma";
import { emailService } from "../../email";
import type { NotificationLocale } from "../../../constants/notifications";
import { INVITE_TTL_DAYS, VERIFICATION_TTL_HOURS } from "../../../constants/tokenTtl";
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
    await send(delivery.event.type, delivery.recipientAddress, locale, context);

    await prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: {
        status: "sent",
        sentAt: new Date(),
        attempts: { increment: 1 },
        lastError: null,
      },
    });
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
  context: DeliveryContext
): Promise<void> {
  if (!isNotificationType(type)) {
    throw new Error(`unknown notification type: ${type}`);
  }

  switch (type) {
    case "auth.welcome":
      return emailService.sendWelcomeEmail(to, requireString(context, "companyName"), { locale });

    case "auth.verify_email":
      return emailService.sendVerificationEmail(to, requireString(context, "verifyLink"), {
        locale,
      });

    case "auth.password_reset":
      return emailService.sendPasswordResetEmail(to, requireString(context, "resetLink"), {
        locale,
      });

    case "employees.invitation":
      return emailService.sendInvitationEmail(
        to,
        requireString(context, "inviteLink"),
        requireString(context, "companyName"),
        { locale }
      );

    case "billing.subscription_created":
      return emailService.sendSubscriptionConfirmedEmail(
        to,
        requireString(context, "companyName"),
        requireString(context, "planName"),
        { locale }
      );
  }
}

// Exported for the tests that assert the TTL constants reach the templates
// through this path rather than being re-stated in prose.
export const EMAIL_TTL_FACTS = { INVITE_TTL_DAYS, VERIFICATION_TTL_HOURS };
