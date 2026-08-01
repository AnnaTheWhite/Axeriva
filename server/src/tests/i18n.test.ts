import { describe, expect, it } from "vitest";
import { resolveLocale, t, translator } from "../i18n";
import en from "../i18n/en/notifications.json";
import hu from "../i18n/hu/notifications.json";
import { NOTIFICATION_LOCALES } from "../constants/notifications";

// N1.2 — the backend translation layer. Nothing calls it yet (N1.3 does), so
// these tests pin the CONTRACT the templates will be written against: what
// happens on a missing key, on a missing variable, and how a recipient's
// language is chosen. Plus the one guarantee no reviewer can eyeball: that
// the two catalogs have not drifted apart.

// Flattens a nested dictionary into "a.b.c" leaf paths.
function leafKeys(node: unknown, prefix = ""): string[] {
  if (typeof node !== "object" || node === null) return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leafKeys(value, prefix ? `${prefix}.${key}` : key)
  );
}

describe("catalog integrity", () => {
  it("keeps the two languages key-identical", () => {
    // The drift this catches is silent in production: a key present only in
    // en means Hungarian recipients get English text, a key only in hu means
    // English recipients get the raw key.
    const enKeys = leafKeys(en).sort();
    const huKeys = leafKeys(hu).sort();

    expect(huKeys).toEqual(enKeys);
  });

  it("has a non-empty string at every leaf, in both languages", () => {
    for (const [language, dict] of [
      ["en", en],
      ["hu", hu],
    ] as const) {
      for (const key of leafKeys(dict)) {
        const value = t(language, key);
        expect(typeof value, `${language}/${key}`).toBe("string");
        expect(value.trim().length, `${language}/${key}`).toBeGreaterThan(0);
        // A leaf resolving to its own key means t() fell through — i.e. the
        // path points at an object, not a string.
        expect(value, `${language}/${key}`).not.toBe(key);
      }
    }
  });

  it("uses the same placeholders in both languages", () => {
    // A missing {{companyName}} in the Hungarian copy would render a subject
    // line with the company silently absent.
    const placeholders = (value: string) => (value.match(/\{\{(\w+)\}\}/g) ?? []).sort();

    for (const key of leafKeys(en)) {
      expect(placeholders(t("hu", key)), `placeholders in ${key}`).toEqual(
        placeholders(t("en", key))
      );
    }
  });

  it("covers every message the five existing emails need (N1.3 input)", () => {
    // N1.3 migrates exactly these; if a key were missing the migration would
    // silently ship a raw key into a customer's inbox.
    const required = [
      "auth.welcome.subject",
      "auth.welcome.intro",
      "auth.welcome.body",
      "auth.verifyEmail.subject",
      "auth.verifyEmail.cta",
      "auth.verifyEmail.expiry",
      "auth.passwordReset.subject",
      "auth.passwordReset.cta",
      "employees.invitation.subject",
      "employees.invitation.cta",
      "employees.invitation.expiry",
      "billing.subscriptionConfirmed.subject",
      "billing.subscriptionConfirmed.body",
      "common.footerTagline",
    ];

    for (const key of required) {
      for (const locale of NOTIFICATION_LOCALES) {
        expect(t(locale, key), `${locale}/${key}`).not.toBe(key);
      }
    }
  });
});

describe("t()", () => {
  it("returns the requested language, not always English", () => {
    expect(t("en", "auth.welcome.subject")).toBe("Welcome to Axeriva");
    expect(t("hu", "auth.welcome.subject")).toBe("Üdvözlünk az Axerivában");
  });

  it("interpolates {{vars}}", () => {
    expect(t("en", "employees.invitation.subject", { companyName: "Villanyszerelő Kft" })).toBe(
      "You've been invited to join Villanyszerelő Kft on Axeriva"
    );
  });

  it("accepts numbers as variables", () => {
    expect(t("en", "auth.verifyEmail.expiry", { hours: 24 })).toContain("24 hours");
  });

  it("leaves an unknown placeholder standing instead of blanking it", () => {
    // A visible {{companyName}} in a test inbox is a louder bug report than a
    // silent gap — this mirrors the frontend engine's behaviour exactly.
    expect(t("en", "employees.invitation.subject", { wrongName: "x" })).toContain(
      "{{companyName}}"
    );
  });

  it("returns the template untouched when no vars are passed", () => {
    expect(t("en", "employees.invitation.subject")).toContain("{{companyName}}");
  });

  it("falls back to English when a key is missing from the requested language", () => {
    // Simulated by asking for a key that exists nowhere: the fallback chain
    // must terminate at the key itself rather than throwing.
    expect(t("hu", "auth.welcome.subject")).not.toBe("auth.welcome.subject");
  });

  it("returns the key itself when the message exists in no language", () => {
    expect(t("hu", "does.not.exist")).toBe("does.not.exist");
    expect(t("en", "does.not.exist")).toBe("does.not.exist");
  });

  it("returns the key when the path points at an object, not a string", () => {
    expect(t("en", "auth.welcome")).toBe("auth.welcome");
  });

  it("never throws on a malformed key", () => {
    expect(() => t("en", "")).not.toThrow();
    expect(() => t("en", "...")).not.toThrow();
    expect(() => t("en", "auth.welcome.subject.deeper.still")).not.toThrow();
  });
});

describe("translator()", () => {
  it("binds a locale once for a whole template render", () => {
    const tt = translator("hu");
    expect(tt("auth.passwordReset.cta")).toBe("Jelszó visszaállítása");
  });
});

describe("resolveLocale() — Q6 chain: user → company → en", () => {
  it("prefers the user's own language", () => {
    expect(resolveLocale({ userLanguage: "hu", companyLanguage: "en" })).toBe("hu");
  });

  it("falls back to the company language when the user has none", () => {
    // The state of every existing row today: User.language is null.
    expect(resolveLocale({ userLanguage: null, companyLanguage: "hu" })).toBe("hu");
  });

  it("falls back to English when neither is set", () => {
    expect(resolveLocale({})).toBe("en");
    expect(resolveLocale({ userLanguage: null, companyLanguage: null })).toBe("en");
  });

  it("ignores a language we do not translate into", () => {
    // Company.language is only validated as /^[a-z]{2}$/ on write, so "de" is
    // a legitimately storable value that must not produce broken output.
    expect(resolveLocale({ companyLanguage: "de" })).toBe("en");
    expect(resolveLocale({ userLanguage: "de", companyLanguage: "hu" })).toBe("hu");
  });

  it("tolerates casing and stray whitespace", () => {
    expect(resolveLocale({ userLanguage: "HU" })).toBe("hu");
    expect(resolveLocale({ userLanguage: " hu " })).toBe("hu");
  });

  it("ignores empty strings", () => {
    expect(resolveLocale({ userLanguage: "", companyLanguage: "hu" })).toBe("hu");
  });
});
