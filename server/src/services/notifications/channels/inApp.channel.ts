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
export async function deliverInApp(deliveryId: number): Promise<void> {
  const delivery = await prisma.notificationDelivery.findUnique({
    where: { id: deliveryId },
    include: { event: true },
  });

  if (!delivery) throw new Error(`delivery ${deliveryId} not found`);
  if (delivery.status !== "pending") return;
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
}
