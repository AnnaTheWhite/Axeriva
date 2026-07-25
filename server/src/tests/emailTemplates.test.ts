import { describe, expect, it } from "vitest";
import { invitationEmailTemplate } from "../services/email/templates/invitationEmail";
import { welcomeEmailTemplate } from "../services/email/templates/welcomeEmail";
import { subscriptionConfirmedEmailTemplate } from "../services/email/templates/subscriptionConfirmedEmail";
import { escapeHtml } from "../utils/escapeHtml";

// R1.5 — `companyName` is attacker-controlled (anyone picks it at
// registration, and the invitation email carries it to a THIRD PARTY). Sent
// from Axeriva's SPF/DKIM-signed domain, injected markup is phishing with our
// reputation attached, so the templates are tested directly at the boundary
// where HTML is produced.

// A payload that is simultaneously a link injection and an attribute break.
const MALICIOUS = `<a href="https://evil.example/login">Click to verify</a>"'`;

describe("escapeHtml", () => {
  it("neutralizes every HTML-significant character", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  it("escapes the ampersand first so entities cannot be smuggled through", () => {
    expect(escapeHtml("&lt;script&gt;")).toBe("&amp;lt;script&amp;gt;");
  });

  it("renders null and undefined as an empty string, not as text", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
});

describe("invitation email", () => {
  it("escapes a malicious company name in the HTML body", () => {
    const { html } = invitationEmailTemplate({
      companyName: MALICIOUS,
      inviteLink: "https://app.axeriva.com/invite/abc123",
    });

    expect(html).not.toContain("<a href=\"https://evil.example/login\">");
    expect(html).toContain("&lt;a href=&quot;https://evil.example/login&quot;&gt;");
  });

  it("still renders an ordinary company name readably", () => {
    const { html } = invitationEmailTemplate({
      companyName: "Villanyszerelő Kft",
      inviteLink: "https://app.axeriva.com/invite/abc123",
    });

    expect(html).toContain("<strong>Villanyszerelő Kft</strong>");
  });

  it("keeps the real invite link intact", () => {
    const link = "https://app.axeriva.com/invite/abc123";
    const { html } = invitationEmailTemplate({ companyName: "Acme", inviteLink: link });

    expect(html).toContain(`href="${link}"`);
  });
});

describe("welcome email", () => {
  it("escapes a malicious company name", () => {
    const { html } = welcomeEmailTemplate({ companyName: MALICIOUS });

    expect(html).not.toContain('<a href="https://evil.example/login">');
    expect(html).toContain("&lt;a href=");
  });
});

describe("subscription confirmed email", () => {
  it("escapes both the company and the plan name", () => {
    const { html } = subscriptionConfirmedEmailTemplate({
      companyName: MALICIOUS,
      planName: "<script>alert(1)</script>",
    });

    expect(html).not.toContain("<script>");
    expect(html).not.toContain('<a href="https://evil.example/login">');
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("plain-text parts", () => {
  // The text/plain alternative is not HTML — escaping it would show literal
  // "&amp;" to the reader, and there is nothing to inject into.
  it("leaves the text body unescaped", () => {
    const { text } = welcomeEmailTemplate({ companyName: "Smith & Sons" });

    expect(text).toContain("Smith & Sons");
    expect(text).not.toContain("&amp;");
  });
});
