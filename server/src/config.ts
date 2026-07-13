import dotenv from "dotenv";

// The single source of truth for environment configuration. This module is
// the ONLY place allowed to read process.env — routes, middleware, services
// and scripts must import from here instead. Loading dotenv here (and only
// here) also removes the per-file dotenv.config() calls that previously
// guarded against import-order surprises.
dotenv.config();

const nodeEnv = process.env.NODE_ENV || "development";
const isProduction = nodeEnv === "production";

// Single source of the application version — read from package.json so the
// number isn't duplicated in code. Resolves correctly both from src/ (ts-node)
// and dist/ (compiled) since both sit one level under server/.
// eslint-disable-next-line @typescript-eslint/no-var-requires
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
    // Per-plan, per-currency Stripe Price IDs (S2.3). Required in production
    // (see PRODUCTION_REQUIRED above — fails fast at startup if missing);
    // optionally unset in development until `npm run stripe:setup` has been
    // run against a test account. Test vs Live is selected by which
    // STRIPE_SECRET_KEY (and therefore which price IDs) the deploy is
    // configured with. Resolved via config/stripePricing.ts — no price IDs
    // are referenced anywhere else.
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
  },

  // Used only by scripts/seedDeveloper.ts (CLI args take precedence).
  developerEmail: readEnv("DEVELOPER_EMAIL") ?? null,
  developerPassword: readEnv("DEVELOPER_PASSWORD") ?? null,
} as const;
