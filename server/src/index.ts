// Process entry point. The Express application itself lives in app.ts and is
// import-side-effect-free, so the integration tests can mount it without a
// listening socket; this file owns everything that must happen exactly once
// per process.
//
// Startup sequence: env validation (config import inside app.ts, which runs
// first as part of the import below) → upload directory creation (upload
// middleware import) → explicit DB connect → HTTP listen. Connecting to
// Prisma up front means a broken DATABASE_URL kills the process at startup
// instead of failing on the first query.
import app from "./app";
import { config } from "./config";
import prisma from "./database/prisma";

async function start() {
  try {
    await prisma.$connect();
  } catch (error) {
    console.error("FATAL: cannot connect to the database. Check DATABASE_URL.", error);
    process.exit(1);
  }

  app.listen(config.port, () => {
    console.log(
      `Axeriva API v${config.version} running on port ${config.port} (${config.nodeEnv})`
    );
  });
}

start();
