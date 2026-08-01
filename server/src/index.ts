// Process entry point. The Express application itself lives in app.ts and is
// import-side-effect-free, so the integration tests can mount it without a
// listening socket; this file owns everything that must happen exactly once
// per process.
//
// Startup sequence: env validation (config import inside app.ts, which runs
// first as part of the import below) → upload directory creation (upload
// middleware import) → explicit DB connect → queue start → HTTP listen.
// Connecting to Prisma up front means a broken DATABASE_URL kills the process
// at startup instead of failing on the first query.
import type { Server } from "http";
import app from "./app";
import { config } from "./config";
import prisma from "./database/prisma";
import { startQueue, stopQueue } from "./services/queue";
import { registerNotificationWorkers } from "./services/notifications/workers";

let server: Server | null = null;
let shuttingDown = false;

async function start() {
  try {
    await prisma.$connect();
  } catch (error) {
    console.error("FATAL: cannot connect to the database. Check DATABASE_URL.", error);
    process.exit(1);
  }

  // N1.4 — the job queue runs in this same process. It is started BEFORE the
  // socket opens so a request can never arrive for a subsystem that is not
  // ready. A queue that cannot start is fatal for the same reason a database
  // that cannot connect is: the alternative is a server that accepts work it
  // will silently drop.
  try {
    await startQueue();
    // N1.5 — the notification workers (dispatch, email, sweep). Registered
    // after the queue is up and before the socket opens, so a request can
    // never produce a notification nothing is listening for.
    await registerNotificationWorkers();
  } catch (error) {
    console.error("FATAL: cannot start the job queue.", error);
    process.exit(1);
  }

  server = app.listen(config.port, () => {
    console.log(
      `Axeriva API v${config.version} running on port ${config.port} (${config.nodeEnv})`
    );
  });
}

// Until N1.4 this process had NO shutdown handling at all: a Render redeploy
// hard-killed in-flight HTTP requests, and would now also kill a half-finished
// job. The order below is the point — stop taking new work, then let what is
// already running finish, then let go of the database.
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`[shutdown] ${signal} received — draining`);

  // Render follows SIGTERM with SIGKILL. If draining somehow hangs, exiting
  // ourselves is better than being killed mid-write, so this backstop is
  // deliberately shorter than the platform's grace period. unref() so it
  // never keeps an otherwise-finished process alive.
  const forceExit = setTimeout(() => {
    console.error("[shutdown] drain timed out — exiting");
    process.exit(1);
  }, config.queue.shutdownTimeoutMs + 5_000);
  forceExit.unref();

  try {
    // 1. Stop accepting new connections; in-flight requests keep running.
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    // 2. Let running jobs finish (bounded by config.queue.shutdownTimeoutMs).
    await stopQueue();
    // 3. Only now release the database — both of the above may still need it.
    await prisma.$disconnect();
    console.log("[shutdown] complete");
    process.exit(0);
  } catch (error) {
    console.error("[shutdown] failed", error);
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

start();
