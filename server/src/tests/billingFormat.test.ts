import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_BILLING_TIME_ZONE,
  formatDate,
  formatDateTime,
  formatMoney,
  fromStripeTimestamp,
  resolveTimeZone,
} from "../utils/billingFormat";
import {
  BillingContractError,
  assertInvoiceEmailData,
  assertPaymentFailureEmailData,
  assertPaymentMethodEmailData,
  assertPlanChangeEmailData,
  assertSubscriptionLifecycleEmailData,
  assertUpcomingRenewalEmailData,
} from "../emails/billingTypes";

// N1.8 Fázis 0 — the billing formatting layer and the template data contracts.
//
// EXACT EXPECTED STRINGS, not snapshots. These are amounts and dates a paying
// customer reads in an email about their money; "it matches whatever it
// produced last time" is not a standard worth holding them to. If ICU ever
// changes its output the failure should be a deliberate decision, not an
// auto-accepted snapshot update.

describe("formatMoney — HUF", () => {
  it("renders Hungarian forint with no decimals, in Hungarian", () => {
    // ICU knows HUF is a zero-decimal currency; we never tell it so. The
    // narrow no-break spaces are what hu-HU actually emits for group and
    // currency separators.
    expect(formatMoney({ amountMinor: 1234560, currency: "HUF", locale: "hu" })).toBe(
      "12\u00A0346\u00A0Ft"
    );
  });

  it("renders forint in English too, since the currency is not the language", () => {
    // A Hungarian company whose owner reads English still gets HUF.
    expect(formatMoney({ amountMinor: 1234560, currency: "HUF", locale: "en" })).toBe(
      "HUF\u00A012,346"
    );
  });

  it("divides Stripe's minor units by 100", () => {
    // THE regression that matters. Stripe sends 100000 for 1000 Ft; forgetting
    // the division shows the customer 100 000 Ft — a 100x overstatement on a
    // billing email.
    expect(formatMoney({ amountMinor: 100000, currency: "HUF", locale: "hu" })).toBe(
      "1000\u00A0Ft"
    );
  });
});

describe("formatMoney — EUR", () => {
  it("renders euro with two decimals, in English", () => {
    expect(formatMoney({ amountMinor: 1234560, currency: "EUR", locale: "en" })).toBe(
      "€12,345.60"
    );
  });

  it("renders euro with Hungarian conventions when the locale is hu", () => {
    expect(formatMoney({ amountMinor: 1234560, currency: "EUR", locale: "hu" })).toBe(
      "12\u00A0345,60\u00A0EUR"
    );
  });

  it("divides minor units by 100", () => {
    expect(formatMoney({ amountMinor: 1000, currency: "EUR", locale: "en" })).toBe("€10.00");
  });

  it("keeps the cents on an amount that is not a round euro", () => {
    expect(formatMoney({ amountMinor: 999, currency: "EUR", locale: "en" })).toBe("€9.99");
  });
});

describe("formatMoney — edges that matter for money", () => {
  it("renders a zero amount rather than treating it as missing", () => {
    // A fully discounted invoice is legitimate, and "€0.00" is the honest
    // rendering. An emptiness check upstream would turn this into "—".
    expect(formatMoney({ amountMinor: 0, currency: "EUR", locale: "en" })).toBe("€0.00");
  });

  it("renders a refund/credit as negative rather than dropping the sign", () => {
    expect(formatMoney({ amountMinor: -2500, currency: "EUR", locale: "en" })).toBe("-€25.00");
  });

  it("accepts Stripe's lowercase currency codes", () => {
    // Stripe sends "eur"; the API returns "EUR". Both must work.
    expect(formatMoney({ amountMinor: 1000, currency: "eur", locale: "en" })).toBe("€10.00");
  });

  it("never throws on an unsupported currency, and says so loudly", () => {
    // Reaching this means the minor-unit assumption may not hold (a true
    // zero-decimal currency is not divided by 100 by Stripe), so it must be
    // impossible to miss — but it must not break the send.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(formatMoney({ amountMinor: 1000, currency: "JPY", locale: "en" })).toContain("JPY");
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it("never throws on a non-finite amount", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(formatMoney({ amountMinor: Number.NaN, currency: "EUR", locale: "en" })).toBe(
        "EUR —"
      );
    } finally {
      error.mockRestore();
    }
  });
});

describe("formatDate / formatDateTime", () => {
  // 2026-09-01T14:30:00Z
  const instant = new Date("2026-09-01T14:30:00.000Z");

  it("formats a long date in English", () => {
    expect(formatDate({ value: instant, locale: "en" })).toBe("1 September 2026");
  });

  it("formats a long date in Hungarian", () => {
    expect(formatDate({ value: instant, locale: "hu" })).toBe("2026. szeptember 1.");
  });

  it("uses en-GB rather than en-US conventions", () => {
    // Bare "en" would give "September 1, 2026" and $ for currency — wrong for a
    // product priced in EUR and HUF and sold in Europe.
    expect(formatDate({ value: instant, locale: "en" })).not.toContain(",");
  });

  it("includes the time in formatDateTime", () => {
    expect(formatDateTime({ value: instant, locale: "en" })).toContain("14:30");
  });

  it("converts Stripe's seconds-since-epoch, not milliseconds", () => {
    // THE classic Stripe bug: passing seconds to new Date() yields 1970.
    const seconds = Math.floor(instant.getTime() / 1000);
    expect(formatDate({ value: seconds, locale: "en" })).toBe("1 September 2026");
    expect(fromStripeTimestamp(seconds).toISOString()).toBe(instant.toISOString());
  });

  it("returns a placeholder for an invalid date instead of throwing", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(formatDate({ value: new Date("nonsense"), locale: "en" })).toBe("—");
    } finally {
      error.mockRestore();
    }
  });
});

describe("timezone handling", () => {
  it("defaults to UTC when the company has not set one", () => {
    expect(resolveTimeZone(null)).toBe(DEFAULT_BILLING_TIME_ZONE);
    expect(resolveTimeZone("")).toBe(DEFAULT_BILLING_TIME_ZONE);
    expect(resolveTimeZone("   ")).toBe(DEFAULT_BILLING_TIME_ZONE);
  });

  it("honours a valid company timezone", () => {
    expect(resolveTimeZone("Europe/Budapest")).toBe("Europe/Budapest");
  });

  it("falls back rather than throwing on tenant-supplied nonsense", () => {
    // Company.timezone is free text a tenant can write. An invalid zone makes
    // Intl THROW, which on this path would take down a billing notification.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(resolveTimeZone("Mars/Olympus_Mons")).toBe(DEFAULT_BILLING_TIME_ZONE);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("shifts the rendered time into the company's zone", () => {
    // 14:30 UTC is 16:30 in Budapest (CEST, UTC+2 in September).
    const instant = new Date("2026-09-01T14:30:00.000Z");
    expect(formatDateTime({ value: instant, locale: "en", timeZone: "Europe/Budapest" })).toContain(
      "16:30"
    );
  });

  it("can name a DIFFERENT DAY than UTC, which is why the zone matters", () => {
    // 23:30 UTC on 31 August is already 1 September in Budapest. An invoice
    // period boundary rendered in the wrong zone names the wrong day, and on a
    // billing email that is a support ticket.
    const nearMidnight = new Date("2026-08-31T23:30:00.000Z");

    expect(formatDate({ value: nearMidnight, locale: "en" })).toBe("31 August 2026");
    expect(formatDate({ value: nearMidnight, locale: "en", timeZone: "Europe/Budapest" })).toBe(
      "1 September 2026"
    );
  });
});

describe("billing data contracts", () => {
  const invoice = {
    amountFormatted: "€10.00",
    currency: "EUR",
    periodStartFormatted: "1 September 2026",
    periodEndFormatted: "1 October 2026",
  };

  it("accepts a complete invoice payload", () => {
    expect(() => assertInvoiceEmailData(invoice)).not.toThrow();
  });

  it("names the missing field rather than failing vaguely", () => {
    // The point of validating at the trigger: the message has to be actionable
    // where there is still a stack trace and a Stripe event id to look at.
    expect(() =>
      assertInvoiceEmailData({ ...invoice, periodEndFormatted: "" })
    ).toThrow(/periodEndFormatted/);
  });

  it("rejects an undefined field as firmly as an empty one", () => {
    expect(() =>
      assertInvoiceEmailData({ ...invoice, amountFormatted: undefined as unknown as string })
    ).toThrow(BillingContractError);
  });

  it("accepts attemptNumber 0 but rejects a non-number", () => {
    // 0 is falsy, so an emptiness check would wrongly reject it. Numbers get
    // their own guard for exactly this reason.
    const failure = { amountFormatted: "€10.00", attemptNumber: 0, portalUrl: "https://x" };
    expect(() => assertPaymentFailureEmailData(failure)).not.toThrow();
    expect(() =>
      assertPaymentFailureEmailData({
        ...failure,
        attemptNumber: undefined as unknown as number,
      })
    ).toThrow(/attemptNumber/);
  });

  it("treats nextAttemptFormatted as genuinely optional", () => {
    // Absent means Stripe scheduled no further retry — which is when the copy
    // has to change tone, not when it should fail validation.
    expect(() =>
      assertPaymentFailureEmailData({
        amountFormatted: "€10.00",
        attemptNumber: 3,
        nextAttemptFormatted: null,
        portalUrl: "https://x",
      })
    ).not.toThrow();
  });

  it("validates the remaining contracts", () => {
    expect(() =>
      assertUpcomingRenewalEmailData({ amountFormatted: "€10.00", renewalDateFormatted: "1 Oct" })
    ).not.toThrow();
    expect(() => assertPaymentMethodEmailData({ brand: "visa", last4: "4242" })).not.toThrow();
    expect(() => assertPaymentMethodEmailData({ brand: "visa", last4: "" })).toThrow(/last4/);
    expect(() =>
      assertPlanChangeEmailData({
        fromPlanName: "Starter",
        toPlanName: "Professional",
        effectiveAtFormatted: "1 Oct",
      })
    ).not.toThrow();
    expect(() => assertSubscriptionLifecycleEmailData({ planName: "Starter" })).not.toThrow();
    expect(() => assertSubscriptionLifecycleEmailData({ planName: "" })).toThrow(/planName/);
  });
});
