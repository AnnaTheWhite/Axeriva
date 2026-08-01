import { Prisma } from "@prisma/client";
import prisma from "../../database/prisma";
import { enqueue } from "../queue";
import { deliverInApp } from "./channels/inApp.channel";
import { evaluateGates } from "./gates";
import { redactEventContextIfSettled } from "./notify";
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
    // H1 — nothing will ever be sent for this event, so a raw token in its
    // context is dead weight that must not be kept.
    await redactEventContextIfSettled(eventId);
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
      //
      // N1.7.2: caught, not propagated. This runs AFTER the transaction has
      // committed, so a throw here used to abort the loop and escape
      // dispatchEvent — pg-boss then retried the DISPATCH job, which hit the
      // `status !== "pending"` pre-check and returned immediately. The in-app
      // row stayed `pending` forever, unreachable by any retry, and (because
      // the sweep only looked at EMAIL) unrecoverable: the same silent
      // permanent loss H3 was raised over, surviving for one channel. The
      // sweep now covers IN_APP too, so leaving the row pending is a recovery
      // path rather than a grave.
      try {
        await deliverInApp(delivery.id);
      } catch (error) {
        console.error(`[notify] in-app delivery ${delivery.id} failed — left for the sweep`, error);
      }
    }
  }

  // H1 — an event whose deliveries were ALL suppressed (or in-app only) never
  // reaches the email channel, which was the only caller of this. Its raw
  // token would then have sat in the context forever, which is the original
  // defect. Cheap: it no-ops unless something is actually redactable.
  await redactEventContextIfSettled(eventId);
}

async function markFailed(eventId: number, reason: string): Promise<void> {
  console.error(`[notify] event ${eventId} failed: ${reason}`);
  await prisma.notificationEvent.update({
    where: { id: eventId },
    data: { status: "failed" },
  });
  // H1 — a permanently failed event will never be rendered, so its raw token
  // has no further purpose. Without this, an unknown type or a corrupt context
  // kept the plaintext forever.
  await redactEventContextIfSettled(eventId);
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
// `attempts: 0` is the discriminator that makes this safe, and it only became
// trustworthy in N1.7.2: deliverEmail now increments `attempts` as an
// optimistic CLAIM before the network call, not after it resolved. Previously
// a row read attempts=0 for the whole duration of the provider request, so the
// sweep's own definition of "untouched" was false exactly while a send was in
// flight — and re-enqueuing there meant mailing the customer twice.
//
// The 30-minute default is not arbitrary either. pg-boss expires an in-flight
// job after 900s (its default, which ensureQueue does not override), so a job
// genuinely still working is resolved one way or another well inside this
// window. Anything older with attempts=0 was never picked up at all. The
// claim in deliverEmail is the real correctness guarantee; this threshold only
// keeps the sweep from doing pointless work.
export async function sweepPendingDeliveries(olderThanSeconds = 1800): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanSeconds * 1000);

  const stranded = await prisma.notificationDelivery.findMany({
    where: {
      status: "pending",
      // N1.7.2 — IN_APP included. It was EMAIL-only, which left an in-app row
      // whose inline delivery threw stuck in `pending` with no recovery path
      // at all: the DISPATCH retry short-circuits on the event's status, so
      // nothing was ever coming back for it.
      channel: { in: ["EMAIL", "IN_APP"] },
      attempts: 0,
      createdAt: { lt: cutoff },
    },
    select: { id: true, channel: true },
    take: 100,
  });

  for (const delivery of stranded) {
    if (delivery.channel === "IN_APP") {
      // Local write, same as the dispatcher does — no queue hop worth its
      // latency, and deliverInApp is itself a no-op on a non-pending row.
      try {
        await deliverInApp(delivery.id);
      } catch (error) {
        console.error(`[notify] sweep could not deliver in-app ${delivery.id}`, error);
      }
      continue;
    }

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
      // H1 — this delivery will never be retried, so if it was the last one
      // holding the event open, the raw token must go now. Without this a
      // permanently failed send kept the plaintext forever.
      const delivery = await prisma.notificationDelivery.findUnique({
        where: { id: data.deliveryId },
        select: { eventId: true },
      });
      if (delivery) await redactEventContextIfSettled(delivery.eventId);
    }
    return;
  }

  if (typeof data.eventId === "number") {
    // N1.7.2 — `pending` only. The previous guard was `status: { not: "failed" }`,
    // which happily overwrote `fanned_out` — the SUCCESS terminal state for an
    // event. A dispatch job that dead-lettered for an unrelated reason (a
    // persistently throwing in-app delivery, say) would then mark an event
    // `failed` whose emails had already gone out, permanently misreporting a
    // successful send as a failure in the support record.
    const updated = await prisma.notificationEvent.updateMany({
      where: { id: data.eventId, status: "pending" },
      data: { status: "failed" },
    });
    if (updated.count > 0) {
      console.error(`[notify] event ${data.eventId} failed permanently (dead-lettered)`);
      await redactEventContextIfSettled(data.eventId);
    }
    return;
  }

  console.error("[notify] dead-lettered job with an unrecognised payload", payload);
}
