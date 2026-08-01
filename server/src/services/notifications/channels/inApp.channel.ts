import { Prisma } from "@prisma/client";
import prisma from "../../../database/prisma";
import { t } from "../../../i18n";
import type { NotificationLocale } from "../../../constants/notifications";
import { getNotificationType, isNotificationType } from "../registry";

// N1.5 — writes the row the bell feed will read (the UI lands in N1.7).
//
// Unlike email this needs no queue: it is a single local INSERT with no
// external dependency, nothing to retry and nothing to rate-limit. Putting it
// through the queue would add latency and failure modes to buy nothing.
//
// Title and body are stored ALREADY RENDERED in the recipient's language, so
// the feed endpoint stays a plain read — no template engine, no locale
// negotiation at request time, and the text a user saw stays what they saw
// even if the copy is later reworded.

// Small on purpose: an in-app write is a local INSERT with no network and no
// external dependency, so the realistic failure is a transient DB blip, not a
// provider outage. Three tries covers that; anything beyond it is a bug in the
// registry or the copy, and retrying a bug forever only hides it.
const IN_APP_MAX_ATTEMPTS = 3;

export async function deliverInApp(deliveryId: number): Promise<void> {
  const delivery = await prisma.notificationDelivery.findUnique({
    where: { id: deliveryId },
    include: { event: true },
  });

  if (!delivery) throw new Error(`delivery ${deliveryId} not found`);
  if (delivery.status !== "pending") return;

  // N1.7.3 — count the attempt, and give a deterministically failing in-app
  // delivery a terminal state.
  //
  // This channel had no attempt accounting at all, which N1.7.2 turned from a
  // cosmetic gap into an infinite loop: the dispatcher now CATCHES a throw from
  // here (so the DISPATCH job reports success and pg-boss never retries or
  // dead-letters it), and sweepPendingDeliveries keeps re-selecting the row. A
  // type whose registry entry lists IN_APP with no `inApp` block therefore
  // threw the same deterministic error every 60 seconds forever, never reached
  // a terminal state, and the recipient was never told — while the permanently
  // `pending` row also blocked H1's context redaction for the whole event,
  // including a sibling email that had already gone out.
  //
  // Unlike the email channel there is no provider and no queue behind this, so
  // the retry budget is enforced here rather than by pg-boss.
  //
  // What this compare-and-set does and does NOT buy, stated precisely because
  // N1.7.3 originally overclaimed it: it serialises two callers that read the
  // SAME `attempts` value, so the loser does nothing. It is a ticket, not a
  // lease — the row stays `pending` through the render and insert below, so a
  // caller that reads AFTER the increment gets its own valid ticket and can
  // reach notification.create too. The duplicate that would cause is prevented
  // by the @@unique([eventId, userId]) constraint on Notification, handled at
  // the bottom of this function.
  const attempts = delivery.attempts + 1;
  const claimed = await prisma.notificationDelivery.updateMany({
    where: { id: deliveryId, status: "pending", attempts: delivery.attempts },
    data: { attempts },
  });
  if (claimed.count === 0) return;

  if (attempts > IN_APP_MAX_ATTEMPTS) {
    await prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: {
        status: "failed",
        lastError: `in-app delivery gave up after ${IN_APP_MAX_ATTEMPTS} attempts`,
      },
    });
    console.error(`[notify] in-app delivery ${deliveryId} failed permanently`);
    return;
  }
  // An in-app notification with no user has nowhere to appear.
  if (delivery.recipientUserId === null) {
    await prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: { status: "suppressed", suppressionReason: "no_valid_recipient" },
    });
    return;
  }

  const type = delivery.event.type;
  if (!isNotificationType(type)) throw new Error(`unknown notification type: ${type}`);

  const definition = getNotificationType(type);
  if (!definition.inApp) throw new Error(`${type} has no in-app copy`);

  const locale = delivery.locale as NotificationLocale;
  const context = delivery.event.context
    ? (JSON.parse(delivery.event.context) as Record<string, string | number>)
    : {};

  try {
    await prisma.$transaction([
      prisma.notification.create({
        data: {
          eventId: delivery.eventId,
          companyId: delivery.companyId,
          userId: delivery.recipientUserId,
          type,
          severity: definition.severity,
          title: t(locale, definition.inApp.titleKey, context),
          body: t(locale, definition.inApp.bodyKey, context),
          ctaLabel: definition.inApp.ctaLabelKey
            ? t(locale, definition.inApp.ctaLabelKey)
            : null,
          ctaPath: definition.inApp.ctaPath ?? null,
        },
      }),
      // "delivered" rather than "sent": there is no provider in between whose
      // acknowledgement we would still be waiting for.
      prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: { status: "delivered", sentAt: new Date(), deliveredAt: new Date() },
      }),
    ]);
  } catch (error) {
    // A concurrent caller got there first and the @@unique([eventId, userId])
    // constraint stopped the duplicate. That is the mechanism working, not a
    // failure: the user HAS their notification. Settle this delivery so it does
    // not sit `pending` and get swept again forever.
    //
    // Not swallowed generically — only P2002 on this constraint. Any other
    // error still throws, so a genuine failure keeps its retry budget.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      await prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: { status: "delivered", sentAt: new Date(), deliveredAt: new Date() },
      });
      return;
    }
    throw error;
  }
}
