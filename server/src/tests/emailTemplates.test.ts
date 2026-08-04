import { describe, expect, it, vi } from "vitest";

// N1.8 Slice 2 — stubs the Resend HTTP client so the REAL ResendEmailService can
// be constructed and its method → template binding checked (see the describe
// block below). vi.hoisted is required: vi.mock's factory is lifted above the
// imports, so the array it writes into has to exist before them.
const { mockSentSubjects } = vi.hoisted(() => ({ mockSentSubjects: [] as string[] }));

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (payload: { subject: string }) => {
        mockSentSubjects.push(payload.subject);
        return { data: { id: "re_test_message" }, error: null };
      },
    };
  },
}));
import { welcomeEmailTemplate } from "../emails/templates/auth/WelcomeEmail";
import { verificationEmailTemplate } from "../emails/templates/auth/VerificationEmail";
import { passwordResetEmailTemplate } from "../emails/templates/auth/PasswordResetEmail";
import { invitationEmailTemplate } from "../emails/templates/employees/InvitationEmail";
import { subscriptionConfirmedEmailTemplate } from "../emails/templates/billing/SubscriptionConfirmedEmail";
import { subscriptionRenewedEmailTemplate } from "../emails/templates/billing/SubscriptionRenewedEmail";
import { invoicePaidEmailTemplate } from "../emails/templates/billing/InvoicePaidEmail";
import { invoiceFailedEmailTemplate } from "../emails/templates/billing/InvoiceFailedEmail";
import {
  contrastTextColor,
  ctaColors,
  resolveAccentColor,
  resolveLogoUrl,
} from "../emails/components/theme";
import { NOTIFICATION_LOCALES, type NotificationLocale } from "../constants/notifications";
import { t } from "../i18n";
import { INVITE_TTL_DAYS, VERIFICATION_TTL_HOURS } from "../constants/tokenTtl";

// N1.3 — the five emails, now rendered by React Email.
//
// R1.5 rationale, unchanged: `companyName` is attacker-controlled (anyone
// picks it at registration, and the invitation email carries it to a THIRD
// PARTY). Sent from Axeriva's SPF/DKIM-signed domain, injected markup is
// phishing with our reputation attached. The previous version of this file
// tested escapeHtml() directly because the templates concatenated HTML by
// hand; React escapes for us now, so the same guarantee is asserted
// end-to-end instead: hostile input in, no live markup out.

// A payload that is simultaneously a link injection and an attribute break.
const MALICIOUS = `<a href="https://evil.example/login">Click to verify</a>"'`;

// Every template, rendered with the props a real caller passes.
function everyTemplate(locale: NotificationLocale) {
  return [
    {
      name: "welcome",
      render: () => welcomeEmailTemplate({ companyName: "Villanyszerelő Kft", locale }),
    },
    {
      name: "verification",
      render: () =>
        verificationEmailTemplate({
          verifyLink: "https://axeriva.com/verify/abc123",
          expiryHours: VERIFICATION_TTL_HOURS,
          locale,
        }),
    },
    {
      name: "passwordReset",
      render: () =>
        passwordResetEmailTemplate({ resetLink: "https://axeriva.com/reset/abc123", locale }),
    },
    {
      name: "invitation",
      render: () =>
        invitationEmailTemplate({
          companyName: "Villanyszerelő Kft",
          inviteLink: "https://axeriva.com/invite/abc123",
          expiryDays: INVITE_TTL_DAYS,
          locale,
        }),
    },
    {
      name: "subscriptionConfirmed",
      render: () =>
        subscriptionConfirmedEmailTemplate({
          companyName: "Villanyszerelő Kft",
          planName: "Professional",
          locale,
        }),
    },
    // N1.8 Slice 1. What membership of this list actually buys is the
    // well-formedness block below (renders, has a subject, no raw i18n key, has
    // a plain-text part, no unresolved placeholders) — and nothing more.
    //
    // An earlier version of this comment claimed it also bought escaping, dark
    // mode, CTA rules and branding coverage. It does not: those describe blocks
    // name their templates explicitly rather than iterating this list, so a
    // template can join here and still have zero escaping coverage. That is a
    // comment asserting a guarantee the code does not provide, which is exactly
    // the class of mistake this milestone has been correcting. The escaping loop
    // below now includes this template explicitly.
    {
      name: "subscriptionRenewed",
      render: () =>
        subscriptionRenewedEmailTemplate({
          companyName: "Villanyszerelő Kft",
          planName: "Professional",
          amountFormatted: "€25.00",
          periodStartFormatted: "1 October 2026",
          periodEndFormatted: "1 November 2026",
          invoiceUrl: "https://invoice.stripe.com/i/abc123",
          locale,
        }),
    },
    // N1.8 Slice 2. The dates are a PART-month window on purpose: this receipt
    // covers the remainder of a cycle, not a whole one, and a fixture reusing
    // the renewal's full-month range would read as if the two templates said
    // the same thing.
    {
      name: "invoicePaid",
      render: () =>
        invoicePaidEmailTemplate({
          companyName: "Villanyszerelő Kft",
          planName: "Business",
          amountFormatted: "€12.50",
          periodStartFormatted: "15 October 2026",
          periodEndFormatted: "1 November 2026",
          invoiceUrl: "https://invoice.stripe.com/i/abc123",
          locale,
        }),
    },
    // N1.8 Slice 3 — BOTH branches, as two entries. They are structurally
    // different messages with disjoint i18n keys, so a single entry would leave
    // half of this template's copy unrendered by the well-formedness block and
    // a missing key in the other half would surface only in production.
    {
      name: "invoiceFailed(retry scheduled)",
      render: () =>
        invoiceFailedEmailTemplate({
          companyName: "Villanyszerelő Kft",
          amountFormatted: "€59.99",
          attemptNumber: 1,
          nextAttemptFormatted: "18 October 2026",
          portalUrl: "https://app.axeriva.com/subscription",
          locale,
        }),
    },
    {
      name: "invoiceFailed(no further attempt)",
      render: () =>
        invoiceFailedEmailTemplate({
          companyName: "Villanyszerelő Kft",
          amountFormatted: "€59.99",
          attemptNumber: 4,
          nextAttemptFormatted: null,
          portalUrl: "https://app.axeriva.com/subscription",
          locale,
        }),
    },
  ];
}

describe.each(NOTIFICATION_LOCALES)("every template renders in %s", (locale) => {
  it.each(everyTemplate(locale).map((template) => [template.name, template] as const))(
    "%s produces a complete, well-formed message",
    async (_name, template) => {
      const { subject, html, text } = await template.render();

      expect(subject.trim().length).toBeGreaterThan(0);
      // A raw dotted key as the subject means a missing translation reached a
      // customer's inbox.
      expect(subject).not.toMatch(/^[a-z]+\.[a-z]+\./i);
      expect(html).toContain("<!DOCTYPE html");
      expect(html).toContain(`lang="${locale}"`);

      // A plain-text alternative is mandatory: some recipients refuse HTML
      // outright, and a missing text part is itself a spam signal.
      expect(text.trim().length).toBeGreaterThan(0);
      expect(text).not.toContain("<");

      // No unresolved placeholders anywhere.
      expect(html).not.toContain("{{");
      expect(text).not.toContain("{{");
      expect(subject).not.toContain("{{");
    }
  );
});

describe("the transport binds each method to the RIGHT template", () => {
  // N1.8 Slice 2. The two billing receipts take an IDENTICAL payload and render
  // near-identical layouts, so `sendInvoicePaidEmail` calling
  // `subscriptionRenewedEmailTemplate` — a one-token slip in a method that was
  // copy-pasted from the one above it — produces a perfectly valid email that
  // tells a customer who just paid a mid-cycle difference that their
  // subscription renewed for another billing period.
  //
  // Nothing else catches it. Until Slice 2 the compiler did: each template had
  // its own props type, so crossing them would not typecheck. Unifying the
  // payload onto InvoiceReceiptEmailPayload — which is the right call, it is
  // one contract — removed that protection. And no integration test reaches
  // here either: the suite runs on MockEmailService, which is a logger and
  // never renders, so ResendEmailService is the one file in the send path that
  // no test constructs.
  //
  // So it is constructed here, with the network stubbed at the Resend client
  // and the SUBJECT the transport actually produced compared against each
  // template's own output. The subjects differ between the two receipts, which
  // is what makes the binding observable.
  const payload = {
    companyName: "Villanyszerelő Kft",
    planName: "Professional",
    amountFormatted: "€12.50",
    periodStartFormatted: "15 October 2026",
    periodEndFormatted: "1 November 2026",
    invoiceUrl: "https://invoice.stripe.com/i/abc123",
  };

  it("sends the plan-change receipt from sendInvoicePaidEmail", async () => {
    const { ResendEmailService } = await import("../services/email/ResendEmailService");
    const service = new ResendEmailService("re_test_key", "Axeriva <test@example.invalid>");

    mockSentSubjects.length = 0;
    await service.sendInvoicePaidEmail("owner@example.com", payload, { locale: "en" });

    const expected = await invoicePaidEmailTemplate({ ...payload, locale: "en" });
    const renewal = await subscriptionRenewedEmailTemplate({ ...payload, locale: "en" });

    expect(mockSentSubjects).toHaveLength(1);
    expect(mockSentSubjects[0]).toBe(expected.subject);
    // The assertion that gives the one above teeth: the two subjects are not
    // the same string, so matching the right one is a real constraint.
    expect(expected.subject).not.toBe(renewal.subject);
  });

  it("sends the failure notice from sendInvoiceFailedEmail", async () => {
    const { ResendEmailService } = await import("../services/email/ResendEmailService");
    const service = new ResendEmailService("re_test_key", "Axeriva <test@example.invalid>");

    mockSentSubjects.length = 0;
    await service.sendInvoiceFailedEmail(
      "owner@example.com",
      {
        companyName: "Villanyszerelő Kft",
        amountFormatted: "€59.99",
        attemptNumber: 1,
        nextAttemptFormatted: "18 October 2026",
        portalUrl: "https://app.axeriva.com/subscription",
      },
      { locale: "en" }
    );

    const expected = await invoiceFailedEmailTemplate({
      companyName: "Villanyszerelő Kft",
      amountFormatted: "€59.99",
      attemptNumber: 1,
      nextAttemptFormatted: "18 October 2026",
      portalUrl: "https://app.axeriva.com/subscription",
      locale: "en",
    });

    expect(mockSentSubjects).toHaveLength(1);
    expect(mockSentSubjects[0]).toBe(expected.subject);
    // And it is not one of the receipts — the three billing methods now take
    // three different payload types, but a wrong template would still render.
    expect(expected.subject).not.toBe(
      (await subscriptionRenewedEmailTemplate({ ...payload, locale: "en" })).subject
    );
  });

  it("sends the renewal receipt from sendSubscriptionRenewedEmail", async () => {
    const { ResendEmailService } = await import("../services/email/ResendEmailService");
    const service = new ResendEmailService("re_test_key", "Axeriva <test@example.invalid>");

    mockSentSubjects.length = 0;
    await service.sendSubscriptionRenewedEmail("owner@example.com", payload, { locale: "en" });

    const expected = await subscriptionRenewedEmailTemplate({ ...payload, locale: "en" });

    expect(mockSentSubjects).toHaveLength(1);
    expect(mockSentSubjects[0]).toBe(expected.subject);
  });
});

describe("the failure notice's copy logic (N1.8 Slice 3)", () => {
  const base = {
    companyName: "Villanyszerelő Kft",
    amountFormatted: "€59.99",
    portalUrl: "https://app.axeriva.com/subscription",
  };

  const scheduled = (attemptNumber: number, locale: NotificationLocale) =>
    invoiceFailedEmailTemplate({
      ...base,
      attemptNumber,
      nextAttemptFormatted: "18 October 2026",
      locale,
    });

  const noRetry = (attemptNumber: number, locale: NotificationLocale) =>
    invoiceFailedEmailTemplate({ ...base, attemptNumber, nextAttemptFormatted: null, locale });

  it.each(NOTIFICATION_LOCALES)(
    "never prints the attempt number, in %s",
    async (locale) => {
      // Stripe counts AUTOMATIC retries only — "manual payment attempts after
      // the first attempt do not affect the retry schedule" (Invoices.d.ts:176)
      // — so the number is a floor on what the customer experienced, not a
      // count of it. There is also no total in the payload, so "attempt 3 of 4"
      // cannot be supported.
      //
      // Asserted by RENDERING TWICE with two different counts that select the
      // same wording branch and requiring the output to be identical. A
      // "not.toContain('7')" cannot express this — the digit occurs in hex
      // colours and font sizes throughout the layout, so that assertion fails
      // on a correct template and would have to be weakened until it proved
      // nothing.
      const seven = await scheduled(7, locale);
      const nine = await scheduled(9, locale);

      expect(seven.html).toBe(nine.html);
      expect(seven.text).toBe(nine.text);
      expect(seven.subject).toBe(nine.subject);
    }
  );

  it.each(NOTIFICATION_LOCALES)(
    "uses a DIFFERENT opening for a repeat failure, in %s",
    async (locale) => {
      // The other half of the same contract: attemptNumber must not be printed,
      // but it must still do something. A payload field that changes nothing is
      // a dead contract field, and this is what stops the branch being deleted
      // as unused.
      const first = await scheduled(1, locale);
      const repeat = await scheduled(3, locale);

      expect(first.html).not.toBe(repeat.html);

      // Pinned at the BOUNDARY, not merely somewhere either side of it.
      // Comparing 1 with 3 leaves `attemptNumber > 2` passing, which would tell
      // a customer on their second failure that this is the first — the exact
      // moment the tone is supposed to change.
      const second = await scheduled(2, locale);
      expect(second.html).not.toBe(first.html);
      expect(second.html).toBe(repeat.html);
    }
  );

  it.each(NOTIFICATION_LOCALES)(
    "says nothing about a next attempt when none is scheduled, in %s",
    async (locale) => {
      // THE BRANCH THAT MATTERS. A single message with an optional "we'll try
      // again on X" tail leaves, when the tail is dropped, a reassuring
      // sentence in the one case where nothing further happens automatically.
      // Asserted in BOTH languages because a Hungarian translation that
      // flattens the two branches makes the message false in Hungarian only —
      // which no English-reading reviewer would catch.
      const { html } = await noRetry(4, locale);

      expect(html).not.toContain("18 October 2026");
      // The scheduled branch's whole sentence must be absent, not merely the
      // date: its text is what promises another attempt.
      const scheduledSentence = t(locale, "billing.invoiceFailed.retryScheduled", {
        date: "18 October 2026",
      });
      expect(html).not.toContain(scheduledSentence.slice(0, 30));
      // ...and the urgent instruction is present instead.
      expect(html).toContain(t(locale, "billing.invoiceFailed.retryNone").slice(0, 30));
    }
  );

  it.each(NOTIFICATION_LOCALES)("keeps the CTA in BOTH branches, in %s", async (locale) => {
    // The action is identical whether or not Stripe intends to retry, so the
    // urgent branch losing its CTA would be the worst possible place for it.
    for (const render of [() => scheduled(1, locale), () => noRetry(4, locale)]) {
      const { html } = await render();
      expect(html).toContain("https://app.axeriva.com/subscription");
      const anchors = html.match(/<a\s/g) ?? [];
      expect(anchors.length).toBe(1);
    }
  });

  it("does not promise a retry in the no-further-attempt copy, in either language", async () => {
    // The branch test above compares the rendered output against the i18n
    // string it came from, so it is self-referential: rewrite the Hungarian
    // retryNone to say "hamarosan újra próbálkozunk" and that test still
    // passes while the message becomes FALSE — in Hungarian only, where no
    // English-reading reviewer would notice.
    //
    // This asserts the property directly, on the copy, per language. The words
    // are the ones a retry promise cannot avoid: EN "again", HU "újra"
    // (again) and "próbálkoz-" (attempt).
    // Banning the word "attempt" outright does not work and the failure is
    // instructive: the correct Hungarian is "Több automatikus próbálkozás
    // NINCS ütemezve" — it contains "próbálkozás" inside a NEGATION. A
    // word-ban cannot tell a promise from a denial, so the test asserts the
    // denial positively and bans only the words that mean "again".
    // Asserted as a DENIAL that is present in one branch and absent from the
    // other. An earlier version of this test also banned the words meaning
    // "again" — and that ban committed the very error the comment above warns
    // about: "we will NOT try again automatically" is a correct denial that
    // contains "again", so the ban would fail on good copy. Word bans cannot
    // read polarity in either direction; only the paired presence/absence can.
    const NEGATION: Record<NotificationLocale, string> = { en: "no further", hu: "nincs" };

    for (const locale of NOTIFICATION_LOCALES) {
      const none = t(locale, "billing.invoiceFailed.retryNone").toLowerCase();
      const scheduled = t(locale, "billing.invoiceFailed.retryScheduled").toLowerCase();

      expect(none, `${locale}/retryNone does not deny a further attempt`).toContain(
        NEGATION[locale]
      );
      // The scheduled branch must NOT carry the denial — otherwise the two
      // strings could be swapped, or made identical, and the assertion above
      // would still hold. This is what catches the urgent branch being
      // flattened into a retry promise.
      expect(scheduled, `${locale}/retryScheduled denies the retry it announces`).not.toContain(
        NEGATION[locale]
      );
    }
  });

  it("escalates the SUBJECT only when no further attempt is scheduled", async () => {
    // Not on the attempt count, which cannot be trusted to reflect how many
    // times the customer has actually been charged.
    const scheduledLate = await scheduled(9, "en");
    const urgent = await noRetry(1, "en");

    expect(scheduledLate.subject).toBe(
      "We couldn't collect your Axeriva payment — €59.99"
    );
    expect(urgent.subject).toBe(
      "Action needed — your Axeriva payment didn't go through (€59.99)"
    );
  });

  it("has no plan name anywhere in its copy", async () => {
    // This is the test that holds the trigger's no-liveness-gate decision in
    // place. Slice 3 sends without checking Company state, which is only safe
    // while the copy asserts nothing about it — and a copy edit is all it would
    // take to reintroduce a claim with nothing behind it.
    //
    // Asserted against the i18n STRINGS rather than the rendered HTML, because
    // the rendered page carries shared chrome this template does not control:
    // the footer tagline is "Workforce Management for Field Service
    // Businesses", so a scan of the HTML for "Business" fails on a correct
    // template. The property that matters is a property of the copy.
    const KEYS = [
      "subject",
      "subjectFinal",
      "introFirst",
      "introRepeat",
      "retryScheduled",
      "retryNone",
      "cta",
      "consequence",
    ];

    for (const locale of NOTIFICATION_LOCALES) {
      for (const key of KEYS) {
        const value = t(locale, `billing.invoiceFailed.${key}`);
        expect(value, `${locale}/${key}`).not.toBe(`billing.invoiceFailed.${key}`);
        for (const plan of ["Starter", "Professional", "Business", "Enterprise", "planName"]) {
          expect(value, `${locale}/${key} names ${plan}`).not.toContain(plan);
        }
      }
    }
  });
});

describe("localization", () => {
  it("renders the same template differently per language", async () => {
    const en = await welcomeEmailTemplate({ companyName: "Teszt Kft", locale: "en" });
    const hu = await welcomeEmailTemplate({ companyName: "Teszt Kft", locale: "hu" });

    expect(en.subject).toBe("Welcome to Axeriva");
    expect(hu.subject).toBe("Üdvözlünk az Axerivában");
    expect(en.html).not.toBe(hu.html);
  });

  it("interpolates the company name into the invitation subject", async () => {
    const hu = await invitationEmailTemplate({
      companyName: "Villanyszerelő Kft",
      inviteLink: "https://axeriva.com/invite/x",
      expiryDays: INVITE_TTL_DAYS,
      locale: "hu",
    });

    expect(hu.subject).toContain("Villanyszerelő Kft");
  });

  it("states the REAL token lifetime, not prose that can drift from it", async () => {
    // The old templates hard-coded "24 hours" and "7 days" beside constants
    // they could not see. Both now come from constants/tokenTtl.ts.
    const verification = await verificationEmailTemplate({
      verifyLink: "https://axeriva.com/verify/x",
      expiryHours: VERIFICATION_TTL_HOURS,
      locale: "en",
    });
    const invitation = await invitationEmailTemplate({
      companyName: "Teszt",
      inviteLink: "https://axeriva.com/invite/x",
      expiryDays: INVITE_TTL_DAYS,
      locale: "en",
    });

    expect(verification.html).toContain(`${VERIFICATION_TTL_HOURS} hours`);
    expect(invitation.html).toContain(`${INVITE_TTL_DAYS} days`);
  });
});

describe("escaping — the guarantee that replaced escapeHtml()", () => {
  it("never emits attacker-supplied markup as live HTML", async () => {
    const { html, subject } = await invitationEmailTemplate({
      companyName: MALICIOUS,
      inviteLink: "https://axeriva.com/invite/x",
      expiryDays: INVITE_TTL_DAYS,
      locale: "en",
    });

    expect(html).not.toContain(`<a href="https://evil.example/login">`);
    expect(html).toContain("&lt;a href=");
    // The subject is not HTML, so it carries the raw value — same as before.
    expect(subject).toContain(MALICIOUS);
  });

  it("escapes in every template that interpolates tenant input", async () => {
    for (const render of [
      () => welcomeEmailTemplate({ companyName: MALICIOUS, locale: "en" }),
      () =>
        subscriptionConfirmedEmailTemplate({
          companyName: MALICIOUS,
          planName: MALICIOUS,
          locale: "en",
        }),
      // N1.8 Slice 1. companyName is attacker-chosen at registration and
      // planName is a display string, so both reach this template as tenant
      // input. Adding it to everyTemplate() did NOT cover this — that list only
      // drives the well-formedness block — so it is named here explicitly.
      () =>
        subscriptionRenewedEmailTemplate({
          companyName: MALICIOUS,
          planName: MALICIOUS,
          amountFormatted: "€25.00",
          periodStartFormatted: "1 October 2026",
          periodEndFormatted: "1 November 2026",
          invoiceUrl: null,
          locale: "en",
        }),
      // N1.8 Slice 2 — same two tenant-controlled values, same reasoning. The
      // template being a near-copy of the one above is exactly why it is named
      // here: a copied template does not inherit the original's coverage.
      () =>
        invoicePaidEmailTemplate({
          companyName: MALICIOUS,
          planName: MALICIOUS,
          amountFormatted: "€12.50",
          periodStartFormatted: "15 October 2026",
          periodEndFormatted: "1 November 2026",
          invoiceUrl: null,
          locale: "en",
        }),
      // N1.8 Slice 3 — companyName is interpolated into both opening variants.
      () =>
        invoiceFailedEmailTemplate({
          companyName: MALICIOUS,
          amountFormatted: "€59.99",
          attemptNumber: 1,
          nextAttemptFormatted: "18 October 2026",
          portalUrl: "https://app.axeriva.com/subscription",
          locale: "en",
        }),
      () =>
        invoiceFailedEmailTemplate({
          companyName: MALICIOUS,
          amountFormatted: "€59.99",
          attemptNumber: 4,
          nextAttemptFormatted: null,
          portalUrl: "https://app.axeriva.com/subscription",
          locale: "en",
        }),
    ]) {
      const { html } = await render();
      expect(html).not.toContain(`<a href="https://evil.example/login">`);
    }
  });

  it("carries hostile input into the plain-text part inertly (documented, unchanged)", async () => {
    // The text part is not markup, so injected tags are literal characters
    // there and cannot execute — exactly as in the pre-N1.3 templates, whose
    // `text` parts interpolated companyName raw and said so. Pinned so the
    // difference between the two parts is a decision on record, not a
    // surprise: HTML is escaped, plain text is inert.
    const { text } = await welcomeEmailTemplate({ companyName: MALICIOUS, locale: "en" });
    expect(text).toContain("Click to verify");
    expect(text).not.toContain("&lt;");
  });
});

describe("links and CTAs", () => {
  it("puts the actionable link in both the HTML and the text part", async () => {
    const link = "https://axeriva.com/verify/token-abc";
    const { html, text } = await verificationEmailTemplate({
      verifyLink: link,
      expiryHours: VERIFICATION_TTL_HOURS,
      locale: "en",
    });

    expect(html).toContain(link);
    // A recipient reading plain text must still be able to act.
    expect(text).toContain(link);
  });

  it("renders exactly one CTA per email that has one", async () => {
    const { html } = await passwordResetEmailTemplate({
      resetLink: "https://axeriva.com/reset/x",
      locale: "en",
    });

    const anchors = html.match(/<a\s/g) ?? [];
    expect(anchors.length).toBe(1);
  });
});

describe("dark mode and client compatibility", () => {
  it("declares colour-scheme support and ships a dark override", async () => {
    const { html } = await welcomeEmailTemplate({ companyName: "Teszt", locale: "en" });

    expect(html).toContain("color-scheme");
    expect(html).toContain("prefers-color-scheme: dark");
  });

  it("sets lang on both html and body (clients strip one or the other)", async () => {
    const { html } = await welcomeEmailTemplate({ companyName: "Teszt", locale: "hu" });
    const langAttributes = html.match(/lang="hu"/g) ?? [];
    expect(langAttributes.length).toBeGreaterThanOrEqual(2);
  });
});

describe("branding (capability shipped in N1.3, activated in N1.5)", () => {
  it("uses the Axeriva accent when no branding is supplied", async () => {
    const { html } = await passwordResetEmailTemplate({
      resetLink: "https://axeriva.com/reset/x",
      locale: "en",
    });
    expect(html).toContain("#f97316");
  });

  it("applies a valid company colour to the CTA", async () => {
    const { html } = await passwordResetEmailTemplate({
      resetLink: "https://axeriva.com/reset/x",
      locale: "en",
      branding: { primaryColor: "#1d4ed8" },
    });
    expect(html).toContain("#1d4ed8");
  });

  it("renders a company logo only over http(s)", () => {
    expect(resolveLogoUrl({ logoUrl: "https://cdn.example.com/logo.png" })).toBe(
      "https://cdn.example.com/logo.png"
    );
    // A data: or javascript: URL in an <img src> is both a client-compat
    // problem and an injection surface, and the field is tenant-writable.
    expect(resolveLogoUrl({ logoUrl: "javascript:alert(1)" })).toBeNull();
    expect(resolveLogoUrl({ logoUrl: "data:image/png;base64,AAA" })).toBeNull();
    expect(resolveLogoUrl({ logoUrl: "   " })).toBeNull();
    expect(resolveLogoUrl(undefined)).toBeNull();
  });

  it("falls back to the Axeriva accent for a malformed colour", () => {
    expect(resolveAccentColor({ primaryColor: "red" })).toBe("#f97316");
    expect(resolveAccentColor({ primaryColor: "#fff" })).toBe("#f97316");
    expect(resolveAccentColor({ primaryColor: "" })).toBe("#f97316");
    expect(resolveAccentColor(undefined)).toBe("#f97316");
  });

  it("picks readable CTA text for light and dark brand colours", () => {
    // Without this, a company whose brand is pale yellow ships white-on-yellow
    // buttons nobody can read.
    expect(contrastTextColor("#facc15")).toBe("#1e293b");
    expect(contrastTextColor("#0f172a")).toBe("#ffffff");
  });

  it("keeps the Axeriva default button EXACTLY as it looks today", async () => {
    // Deliberate: white-on-#f97316 measures 2.83:1 and fails WCAG AA, so the
    // contrast helper would flip it to dark text. Changing the brand's own
    // button is a design decision, not something a migration milestone gets
    // to do silently — the finding is raised separately.
    expect(contrastTextColor("#f97316")).toBe("#1e293b");
    expect(ctaColors(undefined)).toEqual({ background: "#f97316", text: "#ffffff" });

    const { html } = await passwordResetEmailTemplate({
      resetLink: "https://axeriva.com/reset/x",
      locale: "en",
    });
    expect(html).toContain("#ffffff");
  });

  it("contrast-checks a company colour, since it has no legacy to preserve", () => {
    expect(ctaColors({ primaryColor: "#facc15" })).toEqual({
      background: "#facc15",
      text: "#1e293b",
    });
  });
});
