import { describe, expect, it } from "vitest";
import { checkStripeKeyMode, stripeKeyMode } from "../config/stripeKeyMode";

// B4.1 — the boot-time key-mode decision table. checkStripeKeyMode() is a
// pure function precisely so it CAN be tested: config.ts calls
// process.exit(1) at module load, so importing it under a bad env would
// kill the vitest worker. One `it` per row of the decision table in
// docs/launch-blockers-plan.md.

describe("stripeKeyMode classification", () => {
  it("classifies secret and restricted keys in both modes", () => {
    expect(stripeKeyMode("sk_live_abc")).toBe("live");
    expect(stripeKeyMode("rk_live_abc")).toBe("live");
    expect(stripeKeyMode("sk_test_abc")).toBe("test");
    expect(stripeKeyMode("rk_test_abc")).toBe("test");
    expect(stripeKeyMode("whatever")).toBe("unknown");
    expect(stripeKeyMode(null)).toBe("unknown");
  });
});

describe("checkStripeKeyMode decision table", () => {
  it("production + test key without the escape hatch is FATAL", () => {
    const result = checkStripeKeyMode({
      nodeEnv: "production",
      secretKey: "sk_test_abc",
      allowTestKey: false,
    });

    expect(result.level).toBe("fatal");
    if (result.level === "fatal") {
      expect(result.message).toContain("Refusing to start");
      expect(result.message).toContain("ALLOW_TEST_STRIPE_KEY");
    }
  });

  it("production + test key WITH the escape hatch starts with a STAGING MODE warning", () => {
    const result = checkStripeKeyMode({
      nodeEnv: "production",
      secretKey: "sk_test_abc",
      allowTestKey: true,
    });

    expect(result.level).toBe("warn");
    if (result.level === "warn") {
      expect(result.message).toContain("STAGING MODE");
    }
  });

  it("production + live key is silently ok", () => {
    expect(
      checkStripeKeyMode({
        nodeEnv: "production",
        secretKey: "sk_live_abc",
        allowTestKey: false,
      })
    ).toEqual({ level: "ok" });
  });

  it("production + restricted live key is silently ok", () => {
    expect(
      checkStripeKeyMode({
        nodeEnv: "production",
        secretKey: "rk_live_abc",
        allowTestKey: false,
      })
    ).toEqual({ level: "ok" });
  });

  it("production + unrecognised prefix warns instead of blocking the deploy", () => {
    const result = checkStripeKeyMode({
      nodeEnv: "production",
      secretKey: "whatever_not_a_stripe_key",
      allowTestKey: false,
    });

    expect(result.level).toBe("warn");
    if (result.level === "warn") {
      expect(result.message).toContain("Could not classify");
    }
  });

  it("production + MISSING key is silently ok — PRODUCTION_REQUIRED already handles it", () => {
    // The null branch must precede classification: falling into the
    // "unrecognised prefix" warning for a missing key would double-report
    // what the required-vars check already failed on.
    expect(
      checkStripeKeyMode({
        nodeEnv: "production",
        secretKey: null,
        allowTestKey: false,
      })
    ).toEqual({ level: "ok" });
  });

  it("test env + live key is FATAL with no escape hatch", () => {
    const result = checkStripeKeyMode({
      nodeEnv: "test",
      secretKey: "sk_live_abc",
      allowTestKey: true, // even the staging hatch must not unlock this
    });

    expect(result.level).toBe("fatal");
    if (result.level === "fatal") {
      expect(result.message).toContain("live Stripe account");
    }
  });

  it("development + live key warns loudly but starts (the stripe:setup workflow)", () => {
    const result = checkStripeKeyMode({
      nodeEnv: "development",
      secretKey: "sk_live_abc",
      allowTestKey: false,
    });

    expect(result.level).toBe("warn");
    if (result.level === "warn") {
      expect(result.message).toContain("REAL");
    }
  });

  it("development + test key is silently ok", () => {
    expect(
      checkStripeKeyMode({
        nodeEnv: "development",
        secretKey: "sk_test_abc",
        allowTestKey: false,
      })
    ).toEqual({ level: "ok" });
  });

  it("allowTestKey=false never unlocks anything — the caller compares to the exact string 'true'", () => {
    // config.ts passes readEnv("ALLOW_TEST_STRIPE_KEY") === "true", so a
    // literal "false" (or anything else) arrives here as boolean false and
    // the fatal branch stands.
    const result = checkStripeKeyMode({
      nodeEnv: "production",
      secretKey: "sk_test_abc",
      allowTestKey: false,
    });

    expect(result.level).toBe("fatal");
  });
});
