import { Prisma } from "@prisma/client";
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
  const event = await prisma.notificationEvent.findUnique({ where: { id: eventId } });
  if (!event) return;
  // Cheap pre-check so the expensive work below is skipped for an event another
  // worker already handled. It is NOT the guard — the claim inside the
  // transaction is, because this read and that write are not atomic together.
  if (event.status !== "pending") return;

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
    // Not an error: a company can legitimately have no active users left. Claim
    // the event anyway so the sweep stops revisiting it; zero deliveries on a
    // fanned_out event is itself the diagnostic — that is a query, not a
    // mystery.
    await prisma.notificationEvent.updateMany({
      where: { id: eventId, status: "pending" },
      data: { status: "fanned_out", processedAt: new Date() },
    });
    console.warn(`[notify] event ${eventId} (${event.type}) resolved no recipients`);
    return;
  }

  // Decide everything BEFORE writing anything. These are all reads, so they are
  // safe to do outside the transaction and keep it short.
  const rows: Prisma.NotificationDeliveryCreateManyInput[] = [];
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
      rows.push({
        eventId,
        companyId: event.companyId,
        channel,
        recipientUserId: recipient.userId,
        recipientAddress: recipient.email,
        locale: recipient.locale,
        status: gate.allowed ? "pending" : "suppressed",
        suppressionReason: gate.allowed ? null : gate.reason,
      });
    }
  }

  // N1.7.1 (H3) — the claim and the delivery rows now commit TOGETHER.
  //
  // Before, the claim was its own committed statement and the rows were
  // created one at a time in a loop afterwards. A crash anywhere in that loop —
  // a deploy landing mid-dispatch is the everyday case — left the event
  // `fanned_out` with only some of its recipients written, and
  // sweepPendingEvents only ever looks for `pending`, so nothing was coming
  // back for it. The remaining recipients were lost silently and permanently.
  //
  // Atomic now: either the event is claimed AND every delivery row exists, or
  // neither happened and the event is still `pending` for the sweep to retry.
  // The claim stays a compare-and-set inside the transaction, so two concurrent
  // dispatchers still produce exactly one fan-out.
  const created = await prisma.$transaction(async (tx) => {
    const claim = await tx.notificationEvent.updateMany({
      where: { id: eventId, status: "pending" },
      data: { status: "fanned_out", processedAt: new Date() },
    });
    if (claim.count === 0) return null;

    return tx.notificationDelivery.createManyAndReturn({ data: rows });
  });

  // Lost the race — another worker owns this event's fan-out.
  if (created === null) return;

  // Side effects only AFTER the rows are durable. An enqueue that fails here
  // leaves a `pending` delivery with no job, which is exactly what
  // sweepPendingDeliveries() below exists to recover.
  for (const delivery of created) {
    if (delivery.status !== "pending") continue;

    if (delivery.channel === "EMAIL") {
      // Queued: sending crosses the network and must be retryable.
      const jobId = await enqueue(NOTIFY_QUEUES.EMAIL, { deliveryId: delivery.id });
      if (jobId === null) {
        // enqueue() returns null when pg-boss drops the send. Treating that as
        // success is the documented way to lose work silently; the sweep will
        // pick the row up instead.
        console.warn(`[notify] delivery ${delivery.id} was not enqueued — leaving it to the sweep`);
      }
    } else if (delivery.channel === "IN_APP") {
      // Local INSERT — no queue hop worth its latency.
      await deliverInApp(delivery.id);
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

// N1.7.1 — the same safety net one level down.
//
// sweepPendingEvents covers the gap between the outbox INSERT and its enqueue.
// This covers the gap between a delivery row committing and ITS enqueue: the
// dispatcher writes the rows in a transaction and only then queues them, so a
// crash — or an enqueue() that returned null — leaves a `pending` row nobody is
// coming back for. Before this, that row sat there forever and the recipient
// simply never heard anything.
//
// `attempts: 0` is the discriminator that makes this safe. A delivery the
// worker has actually picked up has attempts >= 1 whether it succeeded or
// threw, so a job still working through its retry backoff (up to an hour) is
// never re-queued underneath itself. Only rows no worker has ever touched
// qualify.
export async function sweepPendingDeliveries(olderThanSeconds = 300): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanSeconds * 1000);

  const stranded = await prisma.notificationDelivery.findMany({
    where: {
      status: "pending",
      channel: "EMAIL",
      attempts: 0,
      createdAt: { lt: cutoff },
    },
    select: { id: true },
    take: 100,
  });

  for (const delivery of stranded) {
    await enqueue(NOTIFY_QUEUES.EMAIL, { deliveryId: delivery.id });
  }

  if (stranded.length > 0) {
    console.warn(`[notify] sweep re-queued ${stranded.length} stranded delivery(ies)`);
  }

  return stranded.length;
}

// N1.7.1 (H5) — the terminal state that did not exist.
//
// pg-boss moves a job to the dead-letter queue once its retries are exhausted,
// and `notify/dlq` was created at boot from N1.4 onward — but nothing ever
// consumed it. A delivery whose send permanently failed therefore stayed
// `pending` forever: DELIVERY_STATUSES declares `failed`, and the only writer
// of it was the provider webhook, which needed the providerMessageId that was
// never written either. So no delivery in production could ever leave `sent` or
// `pending`, and a permanently failed message was indistinguishable from one
// still waiting its turn.
//
// Both notification queues dead-letter here, so the handler dispatches on the
// payload shape rather than assuming one.
export async function recordDeadLetter(payload: unknown): Promise<void> {
  const data = (payload ?? {}) as { deliveryId?: unknown; eventId?: unknown };

  if (typeof data.deliveryId === "number") {
    // Only from a non-terminal state: a delivery the provider later reported
    // as bounced must keep that more specific status.
    const updated = await prisma.notificationDelivery.updateMany({
      where: { id: data.deliveryId, status: "pending" },
      data: {
        status: "failed",
        lastError: "retries exhausted — job dead-lettered",
      },
    });
    if (updated.count > 0) {
      console.error(`[notify] delivery ${data.deliveryId} failed permanently (dead-lettered)`);
    }
    return;
  }

  if (typeof data.eventId === "number") {
    await prisma.notificationEvent.updateMany({
      where: { id: data.eventId, status: { not: "failed" } },
      data: { status: "failed" },
    });
    console.error(`[notify] event ${data.eventId} failed permanently (dead-lettered)`);
    return;
  }

  console.error("[notify] dead-lettered job with an unrecognised payload", payload);
}
