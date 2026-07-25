// B4.1 — Stripe key-mode boot check. PURE decision logic only: this module
// must never read process.env, import config.ts or call process.exit —
// config.ts owns the side effects (log + exit) and passes everything in.
// That separation is what makes the decision table testable at all: config.ts
// exits the process at module load, so a test importing it with a bad env
// would kill the vitest worker.

export type StripeKeyModeCheck =
  | { level: "ok" }
  | { level: "warn"; message: string }
  | { level: "fatal"; message: string };

// Restricted keys (rk_) are classified too — Stripe issues them and the
// stripe:setup workflow may legitimately use one.
export function stripeKeyMode(key: string | null): "live" | "test" | "unknown" {
  if (!key) return "unknown";
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) return "live";
  if (key.startsWith("sk_test_") || key.startsWith("rk_test_")) return "test";
  return "unknown";
}

// The decision table (docs/launch-blockers-plan.md, B4.1). Why fatal and not
// a warning: server/package.json's start is "prisma migrate deploy && node
// dist/index.js", so on Render a failed boot fails the DEPLOY and the
// previous version keeps serving — fatal blocks a bad deploy instead of
// taking a live site down, while a warning would drown in the deploy log.
export function checkStripeKeyMode(input: {
  nodeEnv: string;
  secretKey: string | null;
  allowTestKey: boolean;
}): StripeKeyModeCheck {
  const { nodeEnv, secretKey, allowTestKey } = input;

  // Missing key is handled BEFORE classification: PRODUCTION_REQUIRED
  // already fails fast on it in production, and development legitimately
  // runs without one — duplicating either message here would only confuse.
  if (secretKey === null) {
    return { level: "ok" };
  }

  const mode = stripeKeyMode(secretKey);

  if (nodeEnv === "production") {
    if (mode === "test") {
      if (allowTestKey) {
        return {
          level: "warn",
          message:
            "[stripe] STAGING MODE: running with a TEST-mode Stripe key under NODE_ENV=production because ALLOW_TEST_STRIPE_KEY=true. No real payment can be taken on this deploy.",
        };
      }
      return {
        level: "fatal",
        message:
          "FATAL: STRIPE_SECRET_KEY is a TEST-mode key (sk_test_…) but NODE_ENV=production. " +
          "Refusing to start Axeriva API — real customers would be charged in Stripe Test mode. " +
          "Set a live key, or set ALLOW_TEST_STRIPE_KEY=true if this is a deliberate staging deploy. " +
          "See docs/environment.md.",
      };
    }

    if (mode === "unknown") {
      // Fail-open on classification: an unrecognised prefix might be a new
      // Stripe key format — warn loudly rather than block the deploy.
      return {
        level: "warn",
        message:
          "[stripe] Could not classify STRIPE_SECRET_KEY as test or live (unrecognised prefix) — mode check skipped.",
      };
    }

    return { level: "ok" }; // live key in production — the happy path
  }

  if (mode === "live") {
    if (nodeEnv === "test") {
      // No escape hatch on purpose: the integration suite truncates its
      // database before every test and must never touch a live account.
      return {
        level: "fatal",
        message:
          "FATAL: STRIPE_SECRET_KEY is a LIVE-mode key but NODE_ENV=test. " +
          "Refusing to start — the integration suite must never touch a live Stripe account.",
      };
    }

    // development + live key is a documented, legitimate workflow (running
    // `npm run stripe:setup` locally against the live account, see
    // docs/render-deployment.md) — so warn, never block.
    return {
      level: "warn",
      message:
        "[stripe] WARNING: a LIVE Stripe key is configured on a non-production environment. " +
        "Any checkout started here creates a REAL subscription and takes REAL money.",
    };
  }

  return { level: "ok" };
}
