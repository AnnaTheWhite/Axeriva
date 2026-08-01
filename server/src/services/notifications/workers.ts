import { ensureQueue, registerWorker } from "../queue";
import { requireBoss } from "../queue/boss";
import { deliverEmail } from "./channels/email.channel";
import { dispatchEvent, sweepPendingEvents } from "./dispatcher";
import { NOTIFY_QUEUES } from "./queues";

// N1.5 — wires the notification queues to their handlers. Called once per
// process from index.ts, right after the queue itself starts.

// Creating the queues is separate from consuming them on purpose. Enqueuing
// requires the queue to exist; running a worker means "this process will do
// the work". A producer-only process — or a test that drives dispatch
// directly — needs the first without the second.
export async function ensureNotificationQueues(): Promise<void> {
  // Dispatch and delivery are separate queues because they fail for different
  // reasons: a recipient-resolution bug must not burn an email's retry budget,
  // and a provider outage must not re-run the fan-out.
  await ensureQueue({ name: NOTIFY_QUEUES.DISPATCH });
  await ensureQueue({ name: NOTIFY_QUEUES.EMAIL });
  // The sweep is a safety net; a missed run is harmless because the next one
  // covers the same rows, so it must never accumulate a retry backlog.
  await ensureQueue({ name: NOTIFY_QUEUES.SWEEP, retryLimit: 0, deadLetter: null });
}

export async function registerNotificationWorkers(): Promise<void> {
  await ensureNotificationQueues();

  await registerWorker<{ eventId: number }>(NOTIFY_QUEUES.DISPATCH, async ({ eventId }) => {
    await dispatchEvent(eventId);
  });

  await registerWorker<{ deliveryId: number }>(NOTIFY_QUEUES.EMAIL, async ({ deliveryId }) => {
    await deliverEmail(deliveryId);
  });

  await registerWorker(NOTIFY_QUEUES.SWEEP, async () => {
    await sweepPendingEvents();
  });

  // Every minute is the finest granularity pg-boss's 5-field cron allows, and
  // it is ample: this only catches events stranded by a crash between the
  // outbox INSERT and its enqueue, which the age filter already delays past.
  await requireBoss().schedule(NOTIFY_QUEUES.SWEEP, "* * * * *");

  console.log("[notify] workers registered (dispatch, email, sweep)");
}
