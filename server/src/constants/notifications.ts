// Notification module vocabulary (N1.1) — the single source for every
// string-typed column of the six notification models. Following the schema's
// established rule, these are plain strings validated at the API layer rather
// than Prisma enums, so adding a channel or a category later is a data change,
// not a migration (same reasoning as constants/plans.ts and features.ts).
//
// The notification TYPE catalog (billing.trial_ending etc.) is deliberately
// NOT here: it carries behaviour (recipients, channels, template, severity)
// and lands in services/notifications/registry.ts at N1.5. This file holds
// only the closed vocabularies the database columns are drawn from.

// --- Channels --------------------------------------------------------------
// EMAIL and IN_APP ship in N1.5. PUSH and SMS are listed from day one so the
// column vocabulary never needs widening when they arrive — adding a channel
// is then one file under channels/ plus a registry entry.
export const NOTIFICATION_CHANNELS = ["EMAIL", "IN_APP", "PUSH", "SMS"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export function isNotificationChannel(value: unknown): value is NotificationChannel {
  return typeof value === "string" && (NOTIFICATION_CHANNELS as readonly string[]).includes(value);
}

// N1.7 — the channels the preference API accepts. PUSH and SMS are part of the
// column vocabulary above but have no transport behind them, so a preference
// row for either would be a switch wired to nothing: the user flips it, saves,
// and it changes no outcome. Widen this the day a channel ships, not before.
export const CONFIGURABLE_CHANNELS: readonly NotificationChannel[] = ["EMAIL", "IN_APP"];

// --- Categories ------------------------------------------------------------
// What a user can switch on/off. `mandatory` categories are refused by the
// preference API: security notices and critical billing warnings must reach
// the owner, because silencing them harms the recipient (a read-only company
// with no warning) — Q2.
export const NOTIFICATION_CATEGORIES = [
  "security",
  "billing",
  "billing_receipts",
  "projects",
  "employees",
  "digest",
  "marketing",
  "ops",
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export function isNotificationCategory(value: unknown): value is NotificationCategory {
  return (
    typeof value === "string" && (NOTIFICATION_CATEGORIES as readonly string[]).includes(value)
  );
}

// Categories no preference row can switch off (Q2). `ops` is absent from the
// user-facing surface entirely — it is DEVELOPER-only and never configurable.
export const MANDATORY_CATEGORIES: readonly NotificationCategory[] = ["security", "billing"];

// Categories that are off unless explicitly enabled — the only ones that need
// real opt-in plus a List-Unsubscribe header (Q4 marketing stream).
export const OPT_IN_CATEGORIES: readonly NotificationCategory[] = ["digest", "marketing"];

// Categories a tenant user may configure at all (ops is operator-internal).
export const CONFIGURABLE_CATEGORIES: readonly NotificationCategory[] =
  NOTIFICATION_CATEGORIES.filter(
    (category) => category !== "ops" && !MANDATORY_CATEGORIES.includes(category)
  );

// Categories a tenant user SEES on the preference screen: the configurable
// ones plus the mandatory ones, which are shown locked-on rather than hidden.
// Hiding them would make the screen a lie — the user would conclude they had
// switched off everything and still receive security and billing mail.
export const VISIBLE_CATEGORIES: readonly NotificationCategory[] =
  NOTIFICATION_CATEGORIES.filter((category) => category !== "ops");

// What applies when NO preference row exists at either level — the third and
// last step of the resolution chain (plan §7.1). Opt-in categories are off
// until someone says yes; for `marketing` that is a legal requirement, not a
// product choice. Exported so the gate that suppresses a send and the API that
// tells the user what will happen cannot answer this question differently.
export function defaultEnabledForCategory(category: NotificationCategory): boolean {
  return !OPT_IN_CATEGORIES.includes(category);
}

// --- Severity --------------------------------------------------------------
// Mirrors the four levels the billing UX spec already defined (§13), so the
// in-app feed and the billing banners speak the same language.
export const NOTIFICATION_SEVERITIES = ["info", "success", "warning", "critical"] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

// --- Event lifecycle -------------------------------------------------------
// NotificationEvent.status: written by notify() as "pending", moved on by the
// outbox drainer once every channel has a delivery row.
export const NOTIFICATION_EVENT_STATUSES = ["pending", "fanned_out", "failed"] as const;
export type NotificationEventStatus = (typeof NOTIFICATION_EVENT_STATUSES)[number];

// --- Delivery lifecycle ----------------------------------------------------
// "sent" means the provider accepted the API call; "delivered" is only ever
// written from a provider webhook. Never conflate the two on a user-facing
// surface — Resend's own docs are explicit that email.sent ≠ delivered.
export const DELIVERY_STATUSES = [
  "pending",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed",
  "suppressed",
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

// Why a delivery never left the building. Recorded on every suppressed row so
// support can answer "why didn't my customer get it?" from the admin log
// instead of reading code.
export const DELIVERY_SUPPRESSION_REASONS = [
  // Company.notificationsEnabled = false (global kill switch).
  "company_notifications_off",
  // Company.emailNotificationsEnabled / desktopNotificationsEnabled = false.
  "company_channel_off",
  // NotificationPreference said no.
  "user_preference",
  // No preference row anywhere and the category is opt-in (digest, marketing):
  // silence is a "no", not a "yes". Distinct from "user_preference" on purpose
  // — support must be able to tell "they turned it off" from "they were never
  // asked", and for `marketing` that distinction is the consent record.
  "not_opted_in",
  // Address is on the EmailSuppression list (hard bounce / spam complaint).
  "suppression_list",
  // Recipient could not be resolved, is inactive, or is a deleted-account
  // tombstone address.
  "no_valid_recipient",
] as const;
export type DeliverySuppressionReason = (typeof DELIVERY_SUPPRESSION_REASONS)[number];

// --- Suppression list ------------------------------------------------------
export const SUPPRESSION_REASONS = ["bounced", "complained", "manual"] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

// N1.7.2 — the single normalisation for every read and write of
// EmailSuppression.email. The column is a plain @unique String: PostgreSQL
// compares it byte-for-byte, so without this "User@x.com" and "user@x.com" are
// two independent rows. That split the list three ways — the webhook wrote
// whatever casing the provider reported, the gate looked up whatever casing
// the recipient row held, and the operator removal endpoint lowercased — so a
// suppression could block sends it could not be removed by.
//
// Lower-casing the whole address (not just the domain) is technically
// over-broad: RFC 5321 says the local part is case-sensitive. In practice no
// mail provider this product will meet treats it that way, and the failure
// mode of being over-broad here (one extra address suppressed) is far cheaper
// than the alternative (an un-liftable block, or a bounce list that silently
// misses).
export function suppressionKey(email: string): string {
  return email.trim().toLowerCase();
}

// --- Locales ---------------------------------------------------------------
// The languages backend-generated messages exist in. Mirrors the frontend's
// LANGUAGES (src/i18n/index.tsx) — the two must not drift.
export const NOTIFICATION_LOCALES = ["en", "hu"] as const;
export type NotificationLocale = (typeof NOTIFICATION_LOCALES)[number];
export const DEFAULT_NOTIFICATION_LOCALE: NotificationLocale = "en";

export function isNotificationLocale(value: unknown): value is NotificationLocale {
  return typeof value === "string" && (NOTIFICATION_LOCALES as readonly string[]).includes(value);
}
