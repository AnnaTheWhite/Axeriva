import { DEFAULT_NOTIFICATION_LOCALE, type NotificationLocale } from "../constants/notifications";

// N1.8 Fázis 0 — money, dates and times for billing notifications.
//
// This is the formatting layer i18n/index.ts deferred by name ("Date/number/
// currency formatting. No message needs it yet — the five existing emails carry
// no formatted date — so it lands with the first template that does (N1.8
// billing)"). Twelve billing templates all show an amount and a date, in two
// languages and two currencies, so it lands here rather than being scattered
// across twelve call sites.
//
// WHERE THIS RUNS: in the notification TRIGGER, never inside a template. A
// template is snapshot-tested, and an Intl call inside one would make those
// snapshots depend on the ICU version of whatever machine runs the suite. The
// trigger formats, the template receives finished strings.
//
// Intl needs no polyfill here — Node 22.12 (the pinned floor, Q1) ships
// full-icu. Verified on the target runtime rather than assumed:
//   HUF / hu-HU  →  "12 346 Ft"        (zero decimals, chosen by ICU)
//   EUR / en-GB  →  "€12,345.60"
//   date / hu-HU →  "2026. szeptember 1."
//   date / en-GB →  "1 September 2026"

// The BCP 47 tag each notification locale maps to. NotificationLocale is
// "en" | "hu"; bare "en" would give US conventions (MM/DD/YYYY, $), which is
// wrong for a product priced in EUR and HUF and sold in Europe.
const INTL_LOCALE: Record<NotificationLocale, string> = {
  en: "en-GB",
  hu: "hu-HU",
};

function intlLocale(locale: NotificationLocale): string {
  return INTL_LOCALE[locale] ?? INTL_LOCALE[DEFAULT_NOTIFICATION_LOCALE];
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

// Stripe reports every amount in the currency's MINOR unit, and both currencies
// this product sells in are handled that way — EUR obviously (1000 = €10.00),
// and HUF too, where Stripe additionally requires amounts to be divisible by
// 100 (100000 = 1000 Ft). So a single divide-by-100 is correct for both.
//
// ⚠️ This is the assumption to reopen first if a currency is ever added. A true
// zero-decimal currency (JPY, KRW) is NOT divided by 100 by Stripe, and this
// helper would then report amounts 100× too small — an error that looks like a
// pricing bug, not a formatting one. The guard below makes that loud instead of
// silent.
const MINOR_UNITS_PER_MAJOR = 100;

// Currencies this product actually sells in. Anything else is not a formatting
// edge case, it is a configuration mistake, and it must not be rendered as if
// it were fine.
const SUPPORTED_CURRENCIES = new Set(["EUR", "HUF"]);

// The decimal digits ICU uses per currency, needed only for the fallback path
// where Intl itself is unavailable to tell us.
const FALLBACK_DECIMALS: Record<string, number> = { EUR: 2, HUF: 0 };

export type MoneyInput = {
  // Amount in the currency's minor unit, exactly as Stripe reports it
  // (invoice.amount_paid, invoice.amount_due, …).
  amountMinor: number;
  // ISO 4217, any case — Stripe sends lowercase ("eur"), the API returns upper.
  currency: string;
  locale: NotificationLocale;
};

// Formats a Stripe amount for a customer-facing email.
//
// NEVER THROWS. A formatting failure must not be able to stop a payment-failure
// notification from going out — the message matters more than its typography.
// Every failure path returns something a human can still read and logs loudly,
// because a wrong amount in billing mail is worse than an ugly one.
export function formatMoney({ amountMinor, currency, locale }: MoneyInput): string {
  const code = currency.trim().toUpperCase();

  if (!Number.isFinite(amountMinor)) {
    console.error(`[billingFormat] non-finite amount for ${code}: ${amountMinor}`);
    return `${code} —`;
  }

  const major = amountMinor / MINOR_UNITS_PER_MAJOR;

  if (!SUPPORTED_CURRENCIES.has(code)) {
    // Loud on purpose: reaching this means either a new currency was configured
    // without revisiting MINOR_UNITS_PER_MAJOR, or a bad value reached us. The
    // fallback is deliberately plain so it is obvious in a test inbox.
    console.error(
      `[billingFormat] unsupported currency ${code} — the minor-unit assumption may not hold`
    );
    return `${major.toFixed(FALLBACK_DECIMALS[code] ?? 2)} ${code}`;
  }

  try {
    return new Intl.NumberFormat(intlLocale(locale), {
      style: "currency",
      currency: code,
    }).format(major);
  } catch (error) {
    console.error(`[billingFormat] Intl failed for ${code}/${locale}`, error);
    return `${major.toFixed(FALLBACK_DECIMALS[code] ?? 2)} ${code}`;
  }
}

// ---------------------------------------------------------------------------
// Dates and times
// ---------------------------------------------------------------------------

// The timezone every billing date is rendered in when the company has not set
// one. UTC rather than a European default: an invoice period boundary shown in
// the wrong zone can name the wrong DAY, and being consistently UTC is at least
// explainable. Company.timezone (C1.4) overrides it — see resolveTimeZone.
export const DEFAULT_BILLING_TIME_ZONE = "UTC";

// Company.timezone is tenant-writable free text, so it can be empty, stale, or
// nonsense. An invalid zone makes Intl THROW, which on this path would take
// down a billing notification — so it is validated here, once, rather than
// being trusted at twelve call sites.
export function resolveTimeZone(companyTimeZone?: string | null): string {
  const candidate = companyTimeZone?.trim();
  if (!candidate) return DEFAULT_BILLING_TIME_ZONE;

  try {
    // The only reliable validity check is asking Intl to use it.
    new Intl.DateTimeFormat("en-GB", { timeZone: candidate }).format(new Date(0));
    return candidate;
  } catch {
    console.warn(
      `[billingFormat] invalid Company.timezone ${JSON.stringify(candidate)} — using ${DEFAULT_BILLING_TIME_ZONE}`
    );
    return DEFAULT_BILLING_TIME_ZONE;
  }
}

export type DateInput = {
  // A Date, or Stripe's seconds-since-epoch (period_start, period_end,
  // next_payment_attempt are all UNIX SECONDS, not milliseconds).
  value: Date | number;
  locale: NotificationLocale;
  // Company.timezone, unvalidated — resolveTimeZone handles it.
  timeZone?: string | null;
};

// Stripe timestamps are seconds. Passing one to `new Date()` unconverted yields
// 1970, which is the single most common integration bug with this API — so the
// conversion lives here rather than at each call site.
export function fromStripeTimestamp(seconds: number): Date {
  return new Date(seconds * 1000);
}

function toDate(value: Date | number): Date {
  return value instanceof Date ? value : fromStripeTimestamp(value);
}

// "1 September 2026" / "2026. szeptember 1."
export function formatDate({ value, locale, timeZone }: DateInput): string {
  return formatWith(value, locale, timeZone, { dateStyle: "long" });
}

// "1 September 2026 at 14:30" / "2026. szeptember 1. 14:30"
export function formatDateTime({ value, locale, timeZone }: DateInput): string {
  return formatWith(value, locale, timeZone, { dateStyle: "long", timeStyle: "short" });
}

function formatWith(
  value: Date | number,
  locale: NotificationLocale,
  timeZone: string | null | undefined,
  options: Intl.DateTimeFormatOptions
): string {
  const date = toDate(value);

  if (Number.isNaN(date.getTime())) {
    console.error(`[billingFormat] invalid date input: ${String(value)}`);
    return "—";
  }

  try {
    return new Intl.DateTimeFormat(intlLocale(locale), {
      ...options,
      timeZone: resolveTimeZone(timeZone),
    }).format(date);
  } catch (error) {
    // resolveTimeZone already screened the zone, so reaching here means
    // something deeper. ISO is ugly but unambiguous.
    console.error(`[billingFormat] Intl date formatting failed for ${locale}`, error);
    return date.toISOString().slice(0, 10);
  }
}
