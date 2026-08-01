import dotenv from "dotenv";
import { checkStripeKeyMode } from "./config/stripeKeyMode";

// The single source of truth for environment configuration. This module is
// the ONLY place allowed to read process.env — routes, middleware, services
// and scripts must import from here instead. Loading dotenv here (and only
// here) also removes the per-file dotenv.config() calls that previously
// guarded against import-order surprises.
dotenv.config();

const nodeEnv = process.env.NODE_ENV || "development";
const isProduction = nodeEnv === "production";
// Set by the Vitest setup file (src/tests/setup.ts). Only ever used to
// silence per-request logging during a test run — it must NOT relax any
// validation or security behaviour, or the tests would stop testing the real
// application.
const isTest = nodeEnv === "test";

// Single source of the application version — read from package.json so the
// number isn't duplicated in code. Resolves correctly both from src/ (ts-node)
// and dist/ (compiled) since both sit one level under server/.
// `require` rather than `import`: package.json sits outside tsconfig's
// rootDir ("./src"), so importing it would break the build. The rule was
// renamed no-var-requires -> no-require-imports in typescript-eslint 8, and
// the stale directive name was itself reported as an error.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const packageJson = require("../package.json") as { version: string };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// Required in every environment: the app cannot do anything meaningful
// without these, so fail fast even in development.
const ALWAYS_REQUIRED = ["DATABASE_URL", "JWT_SECRET"] as const;

// Required in production only. In development each has a safe fallback
// (localhost URLs, mock email service, ./uploads) — but production must be
// explicit about all of them, so a half-configured deploy fails at startup
// instead of surfacing as broken checkout/email/upload behaviour later.
const PRODUCTION_REQUIRED = [
  "APP_URL",
  "STRIPE_SECRET_KEY",
  "STRIPE_PRICE_ID",
  "STRIPE_WEBHOOK_SECRET",
  // Commercial plan prices (S2.3) — required in production so a
  // half-configured deploy fails at startup instead of checkout silently
  // 500ing per-plan later. Development stays lenient (unset = null, and
  // resolveCheckoutPrice() reports a clear per-request error).
  "STRIPE_PRICE_STARTER_EUR",
  "STRIPE_PRICE_STARTER_HUF",
  "STRIPE_PRICE_PROFESSIONAL_EUR",
  "STRIPE_PRICE_PROFESSIONAL_HUF",
  "STRIPE_PRICE_BUSINESS_EUR",
  "STRIPE_PRICE_BUSINESS_HUF",
  // Design C — the dedicated Billing Portal configuration used ONLY for the
  // hosted upgrade-confirmation flow (subscription_update enabled with the
  // six prices, always_invoice, end_trial). Created by `npm run stripe:setup`.
  // Required in production so paid→paid upgrades fail at startup, not at the
  // customer's first upgrade attempt.
  "STRIPE_PORTAL_FLOW_CONFIG_ID",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "UPLOAD_ROOT",
] as const;

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

const missing: string[] = [
  ...ALWAYS_REQUIRED.filter((name) => !readEnv(name)),
  ...(isProduction ? PRODUCTION_REQUIRED.filter((name) => !readEnv(name)) : []),
];

if (missing.length > 0) {
  console.error(
    `FATAL: missing required environment variable(s): ${missing.join(", ")}.\n` +
      `Refusing to start Axeriva API (NODE_ENV=${nodeEnv}). ` +
      "See server/.env.example and docs/environment.md."
  );
  process.exit(1);
}

// B4.1 — Stripe key-mode check (test key under production is fatal unless
// ALLOW_TEST_STRIPE_KEY=true makes staging a deliberate, documented choice;
// a live key under NODE_ENV=test is always fatal). The decision table is a
// pure function in config/stripeKeyMode.ts — this block only owns the side
// effects, extending the fail-fast pattern above. Strict string comparison
// on purpose: Boolean("false") would be true.
const stripeKeyCheck = checkStripeKeyMode({
  nodeEnv,
  secretKey: readEnv("STRIPE_SECRET_KEY") ?? null,
  allowTestKey: readEnv("ALLOW_TEST_STRIPE_KEY") === "true",
});
if (stripeKeyCheck.level === "fatal") {
  console.error(stripeKeyCheck.message);
  process.exit(1);
} else if (stripeKeyCheck.level === "warn") {
  console.warn(stripeKeyCheck.message);
}

// ---------------------------------------------------------------------------
// Config object
// ---------------------------------------------------------------------------

// Raw APP_URL (may be unset in development). Kept separate from frontendUrl
// because CORS wants "unset means allow-all" locally, while link-building
// wants "unset means the Vite dev server".
const appUrl = readEnv("APP_URL") ?? null;

export const config = {
  nodeEnv,
  isProduction,
  isTest,
  version: packageJson.version,

  port: Number(readEnv("PORT")) || 5000,

  databaseUrl: readEnv("DATABASE_URL")!,
  jwtSecret: readEnv("JWT_SECRET")!,

  // The frontend origin as configured — null locally when APP_URL is unset,
  // in which case CORS stays allow-all (see index.ts).
  appUrl,

  // The frontend base URL used to build links in emails (verify, reset,
  // invite) and Stripe redirect URLs. Falls back to the Vite dev server.
  frontendUrl: appUrl ?? "http://localhost:5173",

  // Absolute path production must point at a persistent disk; development
  // defaults to ./uploads under the server working directory (resolved in
  // upload.middleware.ts to keep path logic in one place there).
  uploadRoot: readEnv("UPLOAD_ROOT") ?? null,

  stripe: {
    secretKey: readEnv("STRIPE_SECRET_KEY") ?? null,
    // Legacy single price ("Axeriva Pro"). Kept for backward compatibility —
    // still required in production and used by the legacy checkout path and as
    // the legacy "pro" mapping in the webhook.
    priceId: readEnv("STRIPE_PRICE_ID") ?? null,
    webhookSecret: readEnv("STRIPE_WEBHOOK_SECRET") ?? null,
    // Design C — dedicated portal configuration for the hosted
    // upgrade-confirmation flow. The DEFAULT portal configuration (used by
    // POST /subscription/portal) keeps plan changes disabled; this one
    // exists solely so subscription_update_confirm flow sessions can offer
    // the six prices with always_invoice + end_trial.
    portalFlowConfigId: readEnv("STRIPE_PORTAL_FLOW_CONFIG_ID") ?? null,
    // Per-plan, per-currency Stripe Price IDs (S2.3). Required in production
    // (see PRODUCTION_REQUIRED above — fails fast at startup if missing);
    // optionally unset in development until `npm run stripe:setup` has been
    // run against a test account. Test vs Live is selected by which
    // STRIPE_SECRET_KEY the deploy is configured with — and that choice is
    // VERIFIED at startup (see config/stripeKeyMode.ts above): a test key
    // under NODE_ENV=production refuses to boot. Resolved via
    // config/stripePricing.ts — no price IDs are referenced anywhere else.
    prices: {
      starter: {
        eur: readEnv("STRIPE_PRICE_STARTER_EUR") ?? null,
        huf: readEnv("STRIPE_PRICE_STARTER_HUF") ?? null,
      },
      professional: {
        eur: readEnv("STRIPE_PRICE_PROFESSIONAL_EUR") ?? null,
        huf: readEnv("STRIPE_PRICE_PROFESSIONAL_HUF") ?? null,
      },
      business: {
        eur: readEnv("STRIPE_PRICE_BUSINESS_EUR") ?? null,
        huf: readEnv("STRIPE_PRICE_BUSINESS_HUF") ?? null,
      },
    },
  },

  resend: {
    apiKey: readEnv("RESEND_API_KEY") ?? null,
    fromEmail: readEnv("RESEND_FROM_EMAIL") ?? "Axeriva <onboarding@resend.dev>",
    // N1.6 — Svix signing secret for the delivery-event webhook
    // (POST /notifications/webhook/resend). Deliberately NOT in
    // PRODUCTION_REQUIRED: without it the endpoint refuses every request with
    // a 400, which loses delivery TELEMETRY but breaks nothing that sends
    // mail. Making it fatal at boot would turn a missing nice-to-have into an
    // outage — the opposite of the trade STRIPE_WEBHOOK_SECRET makes, where a
    // missed event means money state drifts.
    webhookSecret: readEnv("RESEND_WEBHOOK_SECRET") ?? null,
  },

  // N1.4 — the durable job queue (pg-boss). No new service and no new
  // credential: it runs inside the same Postgres, in its own schema. Values
  // are set explicitly rather than inherited from pg-boss's defaults, because
  // every one of them has a reason.
  queue: {
    // pg-boss owns this schema; Prisma owns `public`. Kept apart so the two
    // migration systems can never see each other's tables.
    schema: "pgboss",
    // pg-boss opens its own small pool (Prisma 6 exposes none to share). Two
    // connections is enough for one polling worker plus maintenance, and the
    // production database is a Basic-256mb instance where the budget is real.
    maxConnections: 2,
    // The default is 2s — ~43k idle fetch queries per day per queue. Email
    // tolerates latency, so 10s cuts that fivefold. Tests poll fast because
    // they cannot afford to wait (0.5s is pg-boss's documented minimum).
    pollingIntervalSeconds: isTest ? 0.5 : 10,
    // Parallel handlers per process. Resend allows 10 requests/second and the
    // expected volume is a small fraction of that, so extra concurrency buys
    // nothing and only widens the blast radius of a bad job.
    concurrency: 2,
    // Retry span must stay well inside 24 hours: that is when the Resend
    // idempotency key which makes a retried send safe expires. Exponential
    // from 1s, capped at 1h, 5 attempts — worst case a few hours.
    retryLimit: 5,
    retryDelaySeconds: 1,
    retryDelayMaxSeconds: 60 * 60,
    // Slash-namespaced: pg-boss v12 rejects colons in queue names.
    deadLetterQueue: "notify/dlq",
    // How long a graceful shutdown waits for in-flight handlers. Render sends
    // SIGTERM and then SIGKILL, so an unbounded wait would simply be killed —
    // with the job's state less clear than if we had stopped ourselves.
    shutdownTimeoutMs: 15_000,
  },

  // Used only by scripts/seedDeveloper.ts (CLI args take precedence).
  developerEmail: readEnv("DEVELOPER_EMAIL") ?? null,
  developerPassword: readEnv("DEVELOPER_PASSWORD") ?? null,
} as const;
