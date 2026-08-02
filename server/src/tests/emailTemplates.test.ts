import { describe, expect, it } from "vitest";
import { welcomeEmailTemplate } from "../emails/templates/auth/WelcomeEmail";
import { verificationEmailTemplate } from "../emails/templates/auth/VerificationEmail";
import { passwordResetEmailTemplate } from "../emails/templates/auth/PasswordResetEmail";
import { invitationEmailTemplate } from "../emails/templates/employees/InvitationEmail";
import { subscriptionConfirmedEmailTemplate } from "../emails/templates/billing/SubscriptionConfirmedEmail";
import { subscriptionRenewedEmailTemplate } from "../emails/templates/billing/SubscriptionRenewedEmail";
import {
  contrastTextColor,
  ctaColors,
  resolveAccentColor,
  resolveLogoUrl,
} from "../emails/components/theme";
import { NOTIFICATION_LOCALES, type NotificationLocale } from "../constants/notifications";
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
