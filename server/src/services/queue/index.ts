import type { Job, SendOptions } from "pg-boss";
import { config } from "../../config";
import { requireBoss } from "./boss";
import type { QueueName } from "./queues";

// N1.4 — THE SEAM. Application code calls enqueue() and registerWorker();
// nothing outside services/queue/ imports pg-boss. That single rule is what
// makes a later move (BullMQ on its Postgres backend, or on Redis) an
// afternoon's work instead of a rewrite — and it is cheapest to enforce now,
// while there is exactly one caller to keep honest.

export { startQueue, stopQueue, isQueueStarted, queueStatus } from "./boss";
export { QUEUES } from "./queues";
export type { QueueName } from "./queues";

export type EnqueueOptions = {
  // Delay before the job becomes eligible, in seconds.
  startAfterSeconds?: number;
  // Higher runs first.
  priority?: number;
  // Overrides the queue's retry policy for this one job.
  retryLimit?: number;
};

export type QueueDefinition = {
  name: QueueName;
  // Defaults come from config.queue; a queue only overrides what it must.
  retryLimit?: number;
  retryDelaySeconds?: number;
  retryDelayMaxSeconds?: number;
  // Jobs that exhaust their retries land here. Defaults to the shared DLQ;
  // pass null for a queue that should simply fail (the DLQ itself).
  deadLetter?: QueueName | null;
};

// Creates the queue if it does not exist, with the retry policy attached.
// pg-boss v12 requires a queue to exist before send() or work(), so every
// entry point funnels through here.
//
// Retry span matters beyond reliability: the Resend idempotency key that
// makes a retried send safe expires after 24 hours, so the whole retry
// window must stay comfortably inside that. With the defaults below
// (5 retries, exponential from 1s, capped at 1h) the worst case is a few
// hours — well clear of the cliff.
export async function ensureQueue(definition: QueueDefinition): Promise<void> {
  const boss = requireBoss();

  await boss.createQueue(definition.name, {
    retryLimit: definition.retryLimit ?? config.queue.retryLimit,
    retryDelay: definition.retryDelaySeconds ?? config.queue.retryDelaySeconds,
    retryDelayMax: definition.retryDelayMaxSeconds ?? config.queue.retryDelayMaxSeconds,
    retryBackoff: true,
    // `null` means "this queue IS a terminus" — the dead-letter queue itself
    // must not point at another one, or a poison message would loop.
    ...(definition.deadLetter === null
      ? {}
      : { deadLetter: String(definition.deadLetter ?? config.queue.deadLetterQueue) }),
  });
}

// Adds a job. Returns the job id, or NULL when pg-boss dropped the send
// (throttling/debounce). Callers that care must check: a null here means "no
// job was created", not "an error occurred", and treating it as success is
// the documented way to silently lose work.
export async function enqueue<T extends object>(
  queue: QueueName,
  data: T,
  options: EnqueueOptions = {}
): Promise<string | null> {
  const boss = requireBoss();

  const sendOptions: SendOptions = {
    ...(options.startAfterSeconds === undefined
      ? {}
      : { startAfter: options.startAfterSeconds }),
    ...(options.priority === undefined ? {} : { priority: options.priority }),
    ...(options.retryLimit === undefined ? {} : { retryLimit: options.retryLimit }),
  };

  return boss.send(queue, data, sendOptions);
}

export type JobHandler<T> = (payload: T, job: Job<T>) => Promise<void>;

// Registers a handler. pg-boss hands workers an ARRAY of jobs (it supports
// batching); the seam keeps batchSize at 1 and unwraps it, so a handler never
// has to think about partial batch failure — one job, one outcome, one retry
// decision.
export async function registerWorker<T extends object>(
  queue: QueueName,
  handler: JobHandler<T>,
  options: { concurrency?: number } = {}
): Promise<string> {
  const boss = requireBoss();

  return boss.work<T>(
    queue,
    {
      batchSize: 1,
      // Parallel handlers per process. Kept small by default: the downstream
      // (Resend) allows 10 requests/second and the expected volume is a
      // fraction of that, so concurrency buys nothing and only widens the
      // blast radius of a bad job.
      localConcurrency: options.concurrency ?? config.queue.concurrency,
      // Per-worker in pg-boss v12 (not a constructor option). The 2s default
      // would mean ~43k idle fetch queries per day per queue.
      pollingIntervalSeconds: config.queue.pollingIntervalSeconds,
    },
    async (jobs) => {
      for (const job of jobs) {
        await handler(job.data, job);
      }
    }
  );
}
