import { afterAll, beforeEach } from "vitest";
import prisma from "../database/prisma";
import { resetDatabase } from "./helpers/db";
import { resetRateLimiters } from "../middleware/rateLimit.middleware";

// Per-test-file setup. Environment variables are set in vitest.config.ts
// (test.env) so they are in place before config.ts is imported — config.ts
// exits the process on a missing DATABASE_URL/JWT_SECRET, and dotenv does
// not override already-set values, so the real server/.env cannot leak in.

// Every test starts from an empty database. Truncation (rather than a
// transaction rollback) keeps the app code completely unaware it is under
// test: routes open their own Prisma calls exactly as they do in production.
beforeEach(async () => {
  await resetDatabase();
  // The rate limiters are in-memory and process-local, so counters would
  // otherwise leak across tests — six login attempts spread over three
  // tests would trip the per-email limiter in whichever test ran sixth.
  resetRateLimiters();
});

afterAll(async () => {
  await prisma.$disconnect();
});
