import prisma from "../../database/prisma";
import { enqueue } from "../queue";
import { deliverInApp } from "./channels/inApp.channel";
import { evaluateGates } from "./gates";
import { NOTIFY_QUEUES } from "./queues";
import { getNotificationType, isNotificationType } from "./registry";
import { resolveRecipients } from "./recipients";

// N1.5 — fan-out. Takes one NotificationEvent and turns it into
// NotificationDelivery rows: one per recipient per channel, each either queued
// for sending or recorded as suppressed with the reason why.

export async function dispatchEvent(eventId: number): Promise<void> {
  // Claim the event atomically. `updateMany` with status in the WHERE is a
  // compare-and-set: whoever flips pending → fanned_out first wins, and the
  // loser does nothing. That is what makes it safe for both the immediate
  // dispatch job AND the periodic sweep to target the same event — without
  // it, a redelivered job would duplicate every message.
  const claim = await prisma.notificationEvent.updateMany({
    where: { id: eventId, status: "pending" },
    data: { status: "fanned_out", processedAt: new Date() },
  });
  if (claim.count === 0) return;

  const event = await prisma.notificationEvent.findUnique({ where: { id: eventId } });
  if (!event) return;

  if (!isNotificationType(event.type)) {
    await markFailed(eventId, `unknown notification type: ${event.type}`);
    return;
  }

  const definition = getNotificationType(event.type);
  const context = event.context ? (JSON.parse(event.context) as Record<string, unknown>) : {};

  const recipients = await resolveRecipients({
    strategy: definition.recipients,
    companyId: event.companyId,
    context,
  });

  if (recipients.length === 0) {
    // Not an error: a company can legitimately have no active users left.
    // The event stays fanned_out with zero deliveries, which is itself the
    // diagnostic — "events with no deliveries" is a query, not a mystery.
    console.warn(`[notify] event ${eventId} (${event.type}) resolved no recipients`);
    return;
  }

  for (const recipient of recipients) {
    for (const channel of definition.channels) {
      const gate = await evaluateGates({
        definition,
        channel,
        companyId: event.companyId,
        userId: recipient.userId,
        email: recipient.email,
      });

      // The row is written whether or not anything is sent. A suppressed
      // delivery with its reason is the answer to "why didn't they get it?".
      const delivery = await prisma.notificationDelivery.create({
        data: {
          eventId,
          companyId: event.companyId,
          channel,
          recipientUserId: recipient.userId,
          recipientAddress: recipient.email,
          locale: recipient.locale,
          status: gate.allowed ? "pending" : "suppressed",
          suppressionReason: gate.allowed ? null : gate.reason,
        },
      });

      if (!gate.allowed) continue;

      if (channel === "EMAIL") {
        // Queued: sending crosses the network and must be retryable.
        await enqueue(NOTIFY_QUEUES.EMAIL, { deliveryId: delivery.id });
      } else if (channel === "IN_APP") {
        // Local INSERT — no queue hop worth its latency.
        await deliverInApp(delivery.id);
      }
    }
  }
}

async function markFailed(eventId: number, reason: string): Promise<void> {
  console.error(`[notify] event ${eventId} failed: ${reason}`);
  await prisma.notificationEvent.update({
    where: { id: eventId },
    data: { status: "failed" },
  });
}

// The safety net for the outbox. notify() writes the row and then enqueues;
// a crash between those two leaves a pending event nobody is coming back for.
// This finds them. The age filter keeps it from racing the dispatch job that
// is probably already in flight for a just-created event.
export async function sweepPendingEvents(olderThanSeconds = 60): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanSeconds * 1000);

  const stranded = await prisma.notificationEvent.findMany({
    where: { status: "pending", createdAt: { lt: cutoff } },
    select: { id: true },
    take: 100,
  });

  for (const event of stranded) {
    await enqueue(NOTIFY_QUEUES.DISPATCH, { eventId: event.id });
  }

  if (stranded.length > 0) {
    console.warn(`[notify] sweep re-queued ${stranded.length} stranded event(s)`);
  }

  return stranded.length;
}
