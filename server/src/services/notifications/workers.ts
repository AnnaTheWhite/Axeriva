import { config } from "../../config";
import { ensureQueue, registerWorker } from "../queue";
import { requireBoss } from "../queue/boss";
import { deliverEmail } from "./channels/email.channel";
import {
  dispatchEvent,
  recordDeadLetter,
  sweepPendingDeliveries,
  sweepPendingEvents,
} from "./dispatcher";
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
    // N1.7.1 — same run, one level down: deliveries that committed but whose
    // enqueue never landed. Sequential on purpose; the first sweep can create
    // work the second would otherwise only see a minute later.
    await sweepPendingDeliveries();
  });

  // N1.7.1 (H5) — the dead-letter queue has existed since N1.4 and had no
  // consumer, so an exhausted retry budget left the delivery sitting in
  // `pending` indefinitely with nothing to distinguish it from a job still
  // waiting its turn. This gives every permanently failed job a terminal state
  // and a log line loud enough to alert on.
  await registerWorker<Record<string, unknown>>(config.queue.deadLetterQueue, async (payload) => {
    await recordDeadLetter(payload);
  });

  // Every minute is the finest granularity pg-boss's 5-field cron allows, and
  // it is ample: this only catches events stranded by a crash between the
  // outbox INSERT and its enqueue, which the age filter already delays past.
  await requireBoss().schedule(NOTIFY_QUEUES.SWEEP, "* * * * *");

  console.log("[notify] workers registered (dispatch, email, sweep, dead-letter)");
}
