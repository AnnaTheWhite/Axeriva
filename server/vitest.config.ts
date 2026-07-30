import { defineConfig } from "vitest/config";
import { TEST_DATABASE_URL } from "./src/tests/testDatabaseUrl";

// The integration suite talks to a REAL database — a disposable PostgreSQL
// database brought up to the committed migrations by tests/globalSetup.ts,
// never the development one. Keeping it a real DB (rather than mocking
// Prisma) is the whole point: tenant scoping, unique constraints, index
// behaviour and cascade semantics are exactly what these tests exist to
// prove. Since the PostgreSQL migration this must be a real server, so the
// connection string comes from the environment instead of being a file path
// the suite could create itself (see ./src/tests/testDatabaseUrl.ts).
//
// globalSetup refuses to run against a database whose name does not contain
// "test", so a mis-set variable cannot touch real data.

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
    globalSetup: ["src/tests/globalSetup.ts"],
    setupFiles: ["src/tests/setup.ts"],

    // One shared database means the suite must not run files in parallel: two
    // workers truncating each other's rows mid-test would produce failures
    // that have nothing to do with the code under test.
    fileParallelism: false,
    pool: "forks",
    maxWorkers: 1,
    minWorkers: 1,

    // bcrypt hashing (cost 10) runs for real in the auth tests — the default
    // 5s timeout is tight once a test does several logins.
    testTimeout: 20_000,
    // The global setup runs `prisma migrate deploy`, which on a blank CI
    // container applies both migrations from scratch; that is slower than the
    // 10s default, and slower again against a remote managed database.
    hookTimeout: 60_000,

    env: {
      NODE_ENV: "test",
      DATABASE_URL: TEST_DATABASE_URL,
      JWT_SECRET: "test-only-jwt-secret-not-used-anywhere-else",
      // Stripe: a fake-but-well-formed secret and a webhook signing secret
      // the tests sign their own payloads with. No network call is made —
      // the webhook route only verifies signatures locally.
      STRIPE_SECRET_KEY: "sk_test_axeriva_integration_suite",
      STRIPE_WEBHOOK_SECRET: "whsec_axeriva_integration_suite",
      // Per-plan price IDs. Fake but distinct per plan AND per currency, so a
      // test can assert WHICH price a plan change sends to Stripe — that is
      // the whole point of the currency-matching rule in
      // services/stripe/subscriptionChange.ts. Without these, priceIdFor()
      // returns null and every plan-change path short-circuits into "no price
      // configured", leaving the logic untestable.
      STRIPE_PRICE_STARTER_EUR: "price_test_starter_eur",
      STRIPE_PRICE_STARTER_HUF: "price_test_starter_huf",
      STRIPE_PRICE_PROFESSIONAL_EUR: "price_test_professional_eur",
      STRIPE_PRICE_PROFESSIONAL_HUF: "price_test_professional_huf",
      STRIPE_PRICE_BUSINESS_EUR: "price_test_business_eur",
      STRIPE_PRICE_BUSINESS_HUF: "price_test_business_huf",
      // Design C — the hosted upgrade-confirmation flow's dedicated portal
      // configuration. Fake but present, so the upgrade path is testable
      // (billingPortal.sessions.create is spied, never called for real).
      STRIPE_PORTAL_FLOW_CONFIG_ID: "bpc_test_upgrade_flow",
      // RESEND_API_KEY intentionally unset → MockEmailService, so no test
      // can send a real email.
    },
  },
});
