import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import {
  QUEUES,
  ensureQueue,
  enqueue,
  isQueueStarted,
  queueStatus,
  registerWorker,
  startQueue,
  stopQueue,
} from "../services/queue";
import { requireBoss } from "../services/queue/boss";

// N1.4 — the queue infrastructure. No production job exists yet (N1.5 brings
// the first), so what is tested here is the CONTRACT every later milestone
// will rely on: a job that is enqueued gets processed exactly once, a job that
// keeps failing ends up somewhere a human can find it, and a shutdown does not
// abandon work half-done.
//
// These run against the same real PostgreSQL as the rest of the suite;
// pg-boss keeps its own `pgboss` schema, untouched by resetDatabase().

// Queue names are unique per run so leftovers from a previous run (pg-boss
// tables survive resetDatabase, which only truncates `public`) can never make
// a test pass or fail for the wrong reason.
const suffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
// Slash-namespaced for the same reason production queues are: pg-boss v12
// rejects colons in queue names.
const queueName = (label: string) => `test/${label}/${suffix}`;

// pg-boss polls; assertions therefore wait for a condition instead of a fixed
// sleep, which keeps the tests both fast and non-flaky.
async function waitFor<T>(
  probe: () => T | undefined | null,
  { timeoutMs = 12_000, intervalMs = 100 } = {}
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== undefined && value !== null && value !== false) return value as T;
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

beforeAll(async () => {
  // First start also runs pg-boss's own migrations — the reason this lives in
  // a hook (60s budget) rather than inside a test.
  await startQueue();
}, 60_000);

afterAll(async () => {
  await stopQueue();
});

describe("lifecycle", () => {
  it("reports itself started, and is idempotent", async () => {
    expect(isQueueStarted()).toBe(true);
    expect(queueStatus().startedAt).not.toBeNull();

    // Calling start twice must not open a second pool.
    const first = requireBoss();
    await startQueue();
    expect(requireBoss()).toBe(first);
  });

  it("exposes liveness on /health/workers without touching the database", async () => {
    const res = await request(app).get("/health/workers");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.startedAt).toBeTruthy();
  });

  it("keeps /health free of the queue's state", async () => {
    // The platform probe must not fail over a background subsystem.
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("queue");
  });
});

describe("enqueue → worker", () => {
  it("delivers the payload to the handler exactly once", async () => {
    const name = queueName("delivery");
    const received: Array<{ value: number }> = [];

    await ensureQueue({ name });
    await registerWorker<{ value: number }>(name, async (payload) => {
      received.push(payload);
    });

    const jobId = await enqueue(name, { value: 42 });
    // A null here would mean pg-boss dropped the send (throttling) — the
    // documented gotcha the seam surfaces rather than swallows.
    expect(jobId).toBeTruthy();

    await waitFor(() => received.length === 1);
    expect(received[0]).toEqual({ value: 42 });

    // Give a full poll cycle a chance to redeliver; it must not.
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(received).toHaveLength(1);
  });

  it("hands the handler one job at a time, not a batch", async () => {
    // pg-boss's native handler signature takes an array. The seam unwraps it
    // so a handler never has to reason about partial batch failure.
    const name = queueName("single");
    const sizes: number[] = [];

    await ensureQueue({ name });
    await registerWorker<{ n: number }>(name, async (payload) => {
      sizes.push(payload.n);
    });

    await enqueue(name, { n: 1 });
    await enqueue(name, { n: 2 });

    await waitFor(() => sizes.length === 2);
    expect(sizes.sort()).toEqual([1, 2]);
  });
});

describe("failure handling", () => {
  it("retries a failing job, then dead-letters it where a human can find it", async () => {
    // retryLimit 1 + no delay keeps this fast; the production policy (5
    // retries, exponential backoff) is the same mechanism with bigger numbers.
    const name = queueName("failing");
    const dlq = queueName("dlq");
    let attempts = 0;

    await ensureQueue({ name: dlq, deadLetter: null });
    await ensureQueue({
      name,
      retryLimit: 1,
      retryDelaySeconds: 0,
      deadLetter: dlq,
    });

    await registerWorker(name, async () => {
      attempts += 1;
      throw new Error("handler always fails");
    });

    const dead: unknown[] = [];
    await registerWorker(dlq, async (payload) => {
      dead.push(payload);
    });

    await enqueue(name, { doomed: true });

    // Two attempts: the original plus one retry.
    await waitFor(() => attempts >= 2);
    // And then the payload must resurface in the dead-letter queue rather
    // than vanishing — a poison message that disappears silently is the worst
    // outcome of the three.
    await waitFor(() => dead.length === 1);
    expect(dead[0]).toEqual({ doomed: true });
  });

  it("creates the shared dead-letter queue at startup", async () => {
    const boss = requireBoss();
    const queue = await boss.getQueue(QUEUES.DEAD_LETTER);
    expect(queue).not.toBeNull();
  });
});

describe("graceful shutdown", () => {
  it("lets an in-flight job finish before the queue stops", async () => {
    // The behaviour a Render redeploy depends on: SIGTERM must not abandon a
    // half-processed job. Until N1.4 the process had no shutdown handling at
    // all, so this is new ground being pinned.
    const name = queueName("inflight");
    let started = false;
    let finished = false;

    await ensureQueue({ name });
    await registerWorker(name, async () => {
      started = true;
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      finished = true;
    });

    await enqueue(name, { slow: true });
    await waitFor(() => started);

    // stopQueue() drains: it returns only once the handler above has run to
    // completion.
    await stopQueue();
    expect(finished).toBe(true);
    expect(isQueueStarted()).toBe(false);

    // Restart for the remaining tests / afterAll.
    await startQueue();
  }, 30_000);

  it("refuses to enqueue while stopped instead of silently starting a second instance", async () => {
    await stopQueue();

    await expect(enqueue(queueName("nope"), { a: 1 })).rejects.toThrow(/not started/i);

    const res = await request(app).get("/health/workers");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("stopped");

    await startQueue();
  }, 30_000);
});
