import { defineConfig } from "vitest/config";
import path from "node:path";

// The integration suite talks to a REAL database — a throwaway SQLite file
// provisioned by tests/globalSetup.ts from the committed migrations, never
// the development database. Keeping it a real DB (rather than mocking
// Prisma) is the whole point: tenant scoping, unique constraints and
// cascade behaviour are exactly what these tests exist to prove.
const TEST_DB = path.join(__dirname, "prisma", "test.db");

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
    globalSetup: ["src/tests/globalSetup.ts"],
    setupFiles: ["src/tests/setup.ts"],

    // One shared SQLite file means the suite must not run files in parallel:
    // two workers truncating each other's rows mid-test would produce
    // failures that have nothing to do with the code under test.
    fileParallelism: false,
    pool: "forks",
    maxWorkers: 1,
    minWorkers: 1,

    // bcrypt hashing (cost 10) runs for real in the auth tests — the default
    // 5s timeout is tight once a test does several logins.
    testTimeout: 20_000,
    hookTimeout: 30_000,

    env: {
      NODE_ENV: "test",
      DATABASE_URL: `file:${TEST_DB}`,
      JWT_SECRET: "test-only-jwt-secret-not-used-anywhere-else",
      // Stripe: a fake-but-well-formed secret and a webhook signing secret
      // the tests sign their own payloads with. No network call is made —
      // the webhook route only verifies signatures locally.
      STRIPE_SECRET_KEY: "sk_test_axeriva_integration_suite",
      STRIPE_WEBHOOK_SECRET: "whsec_axeriva_integration_suite",
      // RESEND_API_KEY intentionally unset → MockEmailService, so no test
      // can send a real email.
    },
  },
});
