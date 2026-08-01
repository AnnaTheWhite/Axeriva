import { PgBoss } from "pg-boss";
import { config } from "../../config";

// N1.4 — the pg-boss instance's lifecycle, and NOTHING else. The queue's
// public surface (enqueue / registerWorker) lives in ./index.ts so no caller
// ever touches pg-boss directly; that seam is the entire cost of a future
// move to another queue backend, paid once, up front.
//
// This module is import-side-effect-free on purpose: app.ts is mounted by
// Supertest in every integration test, and it must never open a database
// connection just by being imported. The instance is created on the first
// startQueue() call, which only index.ts (and the queue tests) make.
//
// Connection strategy — a deviation from the milestone note, deliberately.
// The plan said "pass the existing pool via the db option". Prisma 6 does not
// expose a pg.Pool to hand over, and shimming pg-boss's SQL through
// $queryRawUnsafe would put Prisma's type marshalling (BigInt, Date) in the
// middle of the queue's own queries — a subtle, late-failing risk on the path
// that must be the most reliable thing in the system. pg-boss therefore opens
// its own pool, deliberately tiny (see config.queue.maxConnections), which
// costs a couple of connections on the Basic-256mb instance and buys the
// supported configuration.

let boss: PgBoss | null = null;
let startedAt: Date | null = null;

function createBoss(): PgBoss {
  const instance = new PgBoss({
    connectionString: config.databaseUrl,
    // pg-boss owns this schema entirely; Prisma owns `public`. Two migration
    // systems, two namespaces, no possible collision.
    schema: config.queue.schema,
    max: config.queue.maxConnections,
    // Note: pollingIntervalSeconds is a PER-WORKER option in pg-boss v12, not
    // a constructor one — it is applied in registerWorker() (services/queue).
  });

  // pg-boss is an EventEmitter: an unhandled 'error' event would crash the
  // process. These listeners are the difference between a logged blip and a
  // 3am restart.
  instance.on("error", (error) => {
    console.error("[queue] pg-boss error", error);
  });

  instance.on("warning", (warning) => {
    // Emitted for slow queries, queue backlog and clock skew between the app
    // and the database — all things worth seeing before they become outages.
    console.warn("[queue] pg-boss warning", warning);
  });

  return instance;
}

// Starts the queue and returns the instance. Idempotent: calling it twice
// returns the already-started instance rather than opening a second pool.
export async function startQueue(): Promise<PgBoss> {
  if (boss && startedAt) return boss;

  boss = boss ?? createBoss();
  await boss.start();
  startedAt = new Date();

  await boss.createQueue(config.queue.deadLetterQueue);

  console.log(
    `[queue] started (schema: ${config.queue.schema}, poll: ${config.queue.pollingIntervalSeconds}s per worker)`
  );
  return boss;
}

// Drains and shuts down. `graceful` lets in-flight handlers finish; `timeout`
// bounds how long we wait, because Render follows SIGTERM with SIGKILL and an
// unbounded wait would just get killed anyway — with the job's state less
// clear than if we had stopped ourselves.
export async function stopQueue(): Promise<void> {
  if (!boss || !startedAt) return;

  await boss.stop({
    graceful: true,
    close: true,
    timeout: config.queue.shutdownTimeoutMs,
  });

  boss = null;
  startedAt = null;
  console.log("[queue] stopped");
}

// Throws rather than lazily starting: a caller that enqueues before the queue
// is up has an ordering bug, and silently starting a second instance here
// would hide it.
export function requireBoss(): PgBoss {
  if (!boss || !startedAt) {
    throw new Error("Queue is not started — call startQueue() first (see src/index.ts).");
  }
  return boss;
}

export function isQueueStarted(): boolean {
  return Boolean(boss && startedAt);
}

// Deliberately minimal: whether the subsystem is up, and since when. Queue
// depths and failure counts are admin surface (N1.10), not something the
// public health endpoint should publish — they would leak business volume.
export function queueStatus(): { started: boolean; startedAt: string | null } {
  return { started: isQueueStarted(), startedAt: startedAt?.toISOString() ?? null };
}
