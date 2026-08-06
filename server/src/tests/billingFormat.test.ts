import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_BILLING_TIME_ZONE,
  currencyDecimals,
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
  parseInvoiceNotificationContext,
  parsePaymentMethodNotificationContext,
  parsePlanChangeNotificationContext,
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
    // WE tell ICU that HUF has no decimals — asking it was the bug (see the
    // ICU-independence block below). The no-break spaces are what hu-HU emits
    // for group and currency separators, and those are still ICU's call.
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

describe("formatMoney — precision does not depend on the runtime's ICU", () => {
  // THE REGRESSION THIS BLOCK EXISTS FOR. ICU ships inside Node and its CLDR
  // data is versioned with it, so anything ICU decides from *data* rather than
  // from our options can differ per machine. HUF's fraction digits are such a
  // value: the ICU in Node 22.12 (CI, Render) answers 2, the one in Node 24
  // (local dev) answers 0. formatMoney used to just ask, so the same invoice
  // rendered "12 345,60 Ft" on one tier and "12 346 Ft" on another.
  //
  // These tests must therefore never assert what this runtime's ICU believes —
  // that would rebuild the version dependency inside the suite. They assert
  // that our output is the same either way.

  it("uses the project's precision mapping, which needs no Intl to answer", () => {
    // Pure data, no ICU involved: this is where precision is decided now.
    expect(currencyDecimals("HUF")).toBe(0);
    expect(currencyDecimals("EUR")).toBe(2);
    // Not a currency this product sells in, so it falls to the project's
    // pre-existing default of two — unchanged by this fix.
    expect(currencyDecimals("USD")).toBe(2);
    // Stripe sends lowercase; the mapping must not care.
    expect(currencyDecimals("huf")).toBe(0);
  });

  it("renders HUF the zero-decimal way on ANY ICU, not the way this one would", () => {
    // Both possible ICU answers are constructed explicitly here, on whatever
    // Node is running, and our output is pinned to one of them. This assertion
    // holds identically on Node 22.12 and Node 24 — which is the definition of
    // the fix working.
    const asZeroDecimalIcu = new Intl.NumberFormat("hu-HU", {
      style: "currency",
      currency: "HUF",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(12345.6);
    const asTwoDecimalIcu = new Intl.NumberFormat("hu-HU", {
      style: "currency",
      currency: "HUF",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(12345.6);

    const actual = formatMoney({ amountMinor: 1234560, currency: "HUF", locale: "hu" });

    expect(actual).toBe(asZeroDecimalIcu);
    expect(actual).not.toBe(asTwoDecimalIcu);
  });

  it("leaves EUR at two decimals, so pinning changed nothing where ICU agreed", () => {
    // The other half of "do not change the formatting". EUR was never the
    // unstable one; stating its precision must be a no-op, not a new rendering.
    expect(formatMoney({ amountMinor: 1234560, currency: "EUR", locale: "en" })).toBe(
      new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" }).format(12345.6)
    );
  });

  it("keeps ICU in charge of everything that is NOT precision", () => {
    // Grouping, symbol and symbol position still come from CLDR — the fix
    // narrowed what we override to fraction digits and nothing else. hu-HU
    // trails the currency, en-GB leads it, and both still do.
    expect(formatMoney({ amountMinor: 1234560, currency: "EUR", locale: "hu" })).toMatch(
      /EUR$/
    );
    expect(formatMoney({ amountMinor: 1234560, currency: "EUR", locale: "en" })).toMatch(
      /^€/
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

  it("parses a raw invoice context and normalises the optional URL", () => {
    // The wire format between a trigger and the email channel. Tested directly
    // because the webhook trigger happens to filter empty URLs itself, so a
    // pipeline test can never reach this branch — a mutation run proved it
    // survived. Slices 2-12 share this parser and may not filter upstream.
    const base = {
      companyName: "Acme",
      planName: "Professional",
      amountMinor: 2500,
      currency: "eur",
      periodStartAt: 1_760_000_000,
      periodEndAt: 1_762_000_000,
    };

    expect(parseInvoiceNotificationContext({ ...base }).invoiceUrl).toBeNull();
    // An empty string is ABSENT, not a URL: a CTA pointing at "" renders a dead
    // button rather than no button.
    expect(parseInvoiceNotificationContext({ ...base, invoiceUrl: "" }).invoiceUrl).toBeNull();
    expect(
      parseInvoiceNotificationContext({ ...base, invoiceUrl: "https://x/i" }).invoiceUrl
    ).toBe("https://x/i");

    // Timezone is optional and non-string values are ignored rather than
    // reaching Intl, which would throw on a billing path.
    expect(parseInvoiceNotificationContext({ ...base, timeZone: 42 }).timeZone).toBeNull();

    // Required fields fail loudly, naming themselves.
    expect(() => parseInvoiceNotificationContext({ ...base, companyName: "" })).toThrow(
      /companyName/
    );
    // 0 is a legitimate amount (a fully discounted invoice) and must pass the
    // numeric check, while a missing one must not.
    expect(() => parseInvoiceNotificationContext({ ...base, amountMinor: 0 })).not.toThrow();
    expect(() =>
      parseInvoiceNotificationContext({ ...base, amountMinor: undefined })
    ).toThrow(/amountMinor/);
  });

  it("parses a raw payment-method context, and refuses a card it cannot name", () => {
    // N1.8 Slice 5. Tested directly for the same reason the invoice parser is:
    // the webhook trigger checks brand and last4 itself, so no pipeline test can
    // reach these branches — a sabotage run confirmed that relaxing this parser
    // to String(... ?? "") left the entire suite green.
    //
    // It is not redundant with the trigger's check. The trigger guards the ONE
    // path that exists today; this guards the JSON string column, which is what
    // the channel actually reads, and which a sweep replaying an older row or a
    // future trigger could populate differently.
    const base = { companyName: "Acme", brand: "visa", last4: "4242" };

    expect(parsePaymentMethodNotificationContext({ ...base })).toEqual(base);

    // Every field is required and names itself when absent. An empty last4 is
    // the one that matters most: it renders "Visa •••• " in a message whose
    // entire content is those four digits.
    expect(() => parsePaymentMethodNotificationContext({ ...base, last4: "" })).toThrow(/last4/);
    expect(() =>
      parsePaymentMethodNotificationContext({ ...base, brand: undefined })
    ).toThrow(/brand/);
    expect(() =>
      parsePaymentMethodNotificationContext({ ...base, companyName: "" })
    ).toThrow(/companyName/);

    // A NUMERIC last4 is rejected rather than coerced. Stripe sends a string,
    // but 42 is what a coercing parser would turn "0042" into somewhere
    // upstream, and a card ending the customer does not recognise is worse
    // than a dead-lettered job.
    expect(() => parsePaymentMethodNotificationContext({ ...base, last4: 4242 })).toThrow(
      /last4/
    );
  });

  it("parses a raw plan-change context, and refuses a transition it cannot state", () => {
    // N1.8 Slice 6. Direct coverage for the same reason as the two parsers
    // above: the trigger builds this context itself, so no pipeline test can
    // reach the failure branches.
    const base = {
      companyName: "Acme",
      fromPlanName: "Starter",
      toPlanName: "Professional",
      effectiveAt: 1_760_000_000,
    };

    expect(parsePlanChangeNotificationContext({ ...base })).toEqual({
      ...base,
      timeZone: null,
    });

    // Both ends are required. A message that names only its destination is the
    // shape a "from" read AFTER applySubscriptionUpdate produces, and it must
    // not be renderable.
    expect(() => parsePlanChangeNotificationContext({ ...base, fromPlanName: "" })).toThrow(
      /fromPlanName/
    );
    expect(() =>
      parsePlanChangeNotificationContext({ ...base, toPlanName: undefined })
    ).toThrow(/toPlanName/);

    // effectiveAt goes through the NUMBER check, so a missing one fails loudly
    // rather than reaching formatDate — where undefined becomes an Invalid Date
    // and renders the "—" fallback in the middle of a confirmation.
    expect(() =>
      parsePlanChangeNotificationContext({ ...base, effectiveAt: undefined })
    ).toThrow(/effectiveAt/);
    expect(() =>
      parsePlanChangeNotificationContext({ ...base, effectiveAt: "1760000000" })
    ).toThrow(/effectiveAt/);

    // Timezone is optional and a non-string is ignored rather than reaching
    // Intl, which would throw on a billing path.
    expect(parsePlanChangeNotificationContext({ ...base, timeZone: 42 }).timeZone).toBeNull();
    expect(
      parsePlanChangeNotificationContext({ ...base, timeZone: "Europe/Budapest" }).timeZone
    ).toBe("Europe/Budapest");
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
