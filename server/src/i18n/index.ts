import { config } from "../config";
import {
  DEFAULT_NOTIFICATION_LOCALE,
  isNotificationLocale,
  type NotificationLocale,
} from "../constants/notifications";
import en from "./en/notifications.json";
import hu from "./hu/notifications.json";

// N1.2 — backend translation for anything the server generates and a HUMAN
// reads: notification copy, email subjects and bodies. Deliberately a mirror
// of the frontend engine (src/i18n/index.tsx): same dotted keys, same
// {{var}} interpolation, same fall back to English, same "return the key
// itself" last resort. Two engines that behave differently would be a trap
// the first time a string moves between them.
//
// What is intentionally NOT here:
//   - API error messages. Those stay English literals; the agreed approach is
//     stable error CODES mapped client-side (post-launch backlog #7).
//   - Date/number/currency formatting. No message needs it yet — the five
//     existing emails carry no formatted date — so it lands with the first
//     template that does (N1.8 billing), rather than as speculative surface.
//
// Adding a language is a file-only change: drop hu/en-shaped JSON next to
// these two, register it below, and extend NOTIFICATION_LOCALES.

const DICTIONARIES: Record<NotificationLocale, Record<string, unknown>> = { en, hu };

// Looks up "a.b.c" inside a nested dictionary object. Identical to the
// frontend's resolveKey.
function resolveKey(dict: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    if (typeof node === "object" && node !== null && part in node) {
      return (node as Record<string, unknown>)[part];
    }
    return undefined;
  }, dict);
}

// Replaces {{name}} with vars.name. Word characters only, and an unknown
// placeholder is left standing rather than blanked — a visible {{amount}} in
// a test inbox is a louder bug report than a silent empty gap.
function interpolate(template: string, vars?: TranslationVars): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  );
}

export type TranslationVars = Record<string, string | number>;

// Resolves one message. NEVER throws and never returns empty: a missing
// translation must not be able to stop an email from going out. The failure
// is loud in the logs and visibly wrong in the message (the raw key), which
// is the right trade for a delivery path.
export function t(
  locale: NotificationLocale,
  key: string,
  vars?: TranslationVars
): string {
  const value =
    resolveKey(DICTIONARIES[locale], key) ??
    resolveKey(DICTIONARIES[DEFAULT_NOTIFICATION_LOCALE], key);

  if (typeof value !== "string") {
    // The frontend silently returns the key here. On the server we also say
    // so out loud: nobody is watching a background worker's output, and a
    // missing string would otherwise ship to a customer unnoticed.
    if (!config.isTest) {
      console.warn(`[i18n] missing translation: ${locale}/${key}`);
    }
    return key;
  }

  return interpolate(value, vars);
}

// Convenience for a template that resolves many keys in one locale.
export function translator(locale: NotificationLocale) {
  return (key: string, vars?: TranslationVars): string => t(locale, key, vars);
}

export type LocaleSources = {
  // User.language — the per-user override (Q6). Null for every existing row.
  userLanguage?: string | null;
  // Company.language — the C1.4 display preference. Validated only as
  // /^[a-z]{2}$/ on write, so it can legitimately hold a language we do not
  // translate into ("de"); unknown values fall through rather than break.
  companyLanguage?: string | null;
};

// User → Company → English. A per-user column exists precisely because the
// company-wide default is wrong for half of a mixed-language team.
export function resolveLocale({
  userLanguage,
  companyLanguage,
}: LocaleSources): NotificationLocale {
  for (const candidate of [userLanguage, companyLanguage]) {
    const normalized = typeof candidate === "string" ? candidate.trim().toLowerCase() : null;
    if (normalized && isNotificationLocale(normalized)) {
      return normalized;
    }
  }
  return DEFAULT_NOTIFICATION_LOCALE;
}
