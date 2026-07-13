// Centralized frontend pricing configuration (S2.1).
//
// This is the single source of truth for the pricing page's plans, prices,
// storage, support, card highlights, and the feature-comparison matrix.
// Prices are NOT hardcoded inside UI components — components read them from
// here. The shape is intentionally accessor-based (getPlanPrice / usePricing-
// friendly helpers) so a later story (S2.2+) can replace the static tables
// with dynamic backend/Stripe pricing without touching any UI component.
//
// Commercial rule: currency is decided ONLY by the website language
// (Hungarian → HUF, English → EUR). These are two independent price lists —
// values are never converted between currencies.

import type { Language } from "../i18n";

// Public plans only. The hidden internal "founder" plan is deliberately not
// represented here, so it can never render on any public surface.
export const PUBLIC_PLAN_IDS = ["starter", "professional", "business", "enterprise"] as const;
export type PlanId = (typeof PUBLIC_PLAN_IDS)[number];

export type Currency = "HUF" | "EUR";

// Currency is a pure function of the active language (never converted).
export function currencyForLanguage(language: Language): Currency {
  return language === "hu" ? "HUF" : "EUR";
}

// Trial terms — the UI reads these instead of hardcoding "14 days" / "no card"
// anywhere. Static in S2.1; a later story can source them from the backend
// without touching any component.
export type TrialConfig = {
  trialDays: number;
  requiresCreditCard: boolean;
};

export const TRIAL: TrialConfig = {
  trialDays: 14,
  requiresCreditCard: false,
};

// How a plan's primary CTA behaves. Kept as data (not branched inside the
// component) so a new CTA behavior is a config change:
//   - "checkout"      → self-serve sign-up / trial (Starter/Professional/Business)
//   - "contact-sales" → sales-led, no self-serve price (Enterprise)
export type CtaType = "checkout" | "contact-sales";

export type PlanPricing = {
  id: PlanId;
  recommended: boolean;
  // Monthly amount per currency. `null` means "no self-serve price" (Enterprise
  // → Contact Sales). Two independent price lists — not FX conversions.
  price: Record<Currency, number | null>;
  // Included storage in GB; `null` = custom (Enterprise).
  storageGb: number | null;
  // Support level id, resolved to a label via i18n (`pricing.support.<id>`).
  support: SupportId;
  // Card highlight bullet ids, resolved via i18n
  // (`pricing.plans.<planId>.highlights.<id>`).
  highlightIds: string[];
  // Which CTA the card renders (data-driven, see CtaType).
  ctaType: CtaType;
  // Stripe lookup-key base for this plan (S2.3). The backend derives the
  // per-currency Stripe lookup keys as `${stripeLookupKey}_<currency>_monthly`
  // (see server/src/config/stripePricing.ts, the authoritative source).
  // Empty string = not self-serve purchasable (Enterprise → Contact Sales).
  stripeLookupKey: string;
};

export type SupportId =
  | "standardEmail"
  | "priorityEmail"
  | "prioritySupport"
  | "dedicatedManager";

// --- Plan table -----------------------------------------------------------
export const PLANS: Record<PlanId, PlanPricing> = {
  starter: {
    id: "starter",
    recommended: false,
    price: { HUF: 7990, EUR: 29.99 },
    storageGb: 5,
    support: "standardEmail",
    highlightIds: ["core", "mobile", "analyticsBasic", "exportCsv"],
    ctaType: "checkout",
    stripeLookupKey: "axeriva_starter",
  },
  professional: {
    id: "professional",
    recommended: true,
    price: { HUF: 16990, EUR: 59.99 },
    storageGb: 25,
    support: "priorityEmail",
    highlightIds: ["everythingStarter", "analyticsAdvanced", "developerApi", "exports", "integrations"],
    ctaType: "checkout",
    stripeLookupKey: "axeriva_professional",
  },
  business: {
    id: "business",
    recommended: false,
    price: { HUF: 34990, EUR: 119.99 },
    storageGb: 100,
    support: "prioritySupport",
    highlightIds: ["everythingPro", "automation", "ai", "multiLocation", "webhooks"],
    ctaType: "checkout",
    stripeLookupKey: "axeriva_business",
  },
  enterprise: {
    id: "enterprise",
    recommended: false,
    price: { HUF: null, EUR: null },
    storageGb: null,
    support: "dedicatedManager",
    highlightIds: ["everythingBusiness", "sso", "scim", "whiteLabel", "dedicatedManager"],
    ctaType: "contact-sales",
    stripeLookupKey: "",
  },
};

export const PLAN_LIST: PlanPricing[] = PUBLIC_PLAN_IDS.map((id) => PLANS[id]);

// --- Formatting helpers ---------------------------------------------------

// Formats a monthly amount in the given currency, using locale-correct
// grouping/symbols: HUF → "7 990 Ft", EUR → "€29.99". Returns null when the
// plan has no self-serve price (Enterprise).
export function formatPrice(amount: number | null, currency: Currency): string | null {
  if (amount === null) return null;
  if (currency === "HUF") {
    // Group thousands with a space for every amount ("7 990 Ft", "16 990 Ft")
    // — the hu-HU CLDR locale skips grouping for 4-digit numbers, which would
    // render an inconsistent "7990 Ft" next to "16 990 Ft".
    const grouped = Math.round(amount)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return `${grouped} Ft`;
  }
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// Resolves a plan's displayed price for the active language, or null for
// Contact-Sales plans.
export function getPlanPrice(plan: PlanPricing, language: Language): string | null {
  return formatPrice(plan.price[currencyForLanguage(language)], currencyForLanguage(language));
}

export function formatStorageGb(gb: number): string {
  return `${gb} GB`;
}

// --- Feature comparison matrix -------------------------------------------
//
// ⚠️ S2.1 SCOPE: this matrix is INTENTIONALLY STATIC. In S2.2 it will be
// replaced by the centralized Feature Registry (the single source of truth for
// plan→feature mapping described in docs/subscription-system-design.md). At
// that point these hardcoded rows/values go away and the table renders from
// the registry instead. Do NOT build on this shape long-term — treat it as a
// temporary placeholder that S2.2 supersedes. The registry itself is NOT
// implemented here (out of S2.1 scope); this is only prepared for it.
//
// Boolean feature rows grouped by section. Storage/support are rendered as a
// separate "plan" group computed from PLANS (see PlanComparisonTable). Each
// row's `values` are ordered [starter, professional, business, enterprise].
// `future` marks not-yet-shipped commercial modules (shown with a "soon" tag).

export type FeatureRow = {
  id: string; // i18n: pricing.compare.rows.<id>
  future?: boolean;
  values: [boolean, boolean, boolean, boolean];
};

export type FeatureGroup = {
  id: string; // i18n: pricing.compare.groups.<id>
  rows: FeatureRow[];
};

const T: [boolean, boolean, boolean, boolean] = [true, true, true, true];

export const COMPARISON_GROUPS: FeatureGroup[] = [
  {
    id: "core",
    rows: [
      { id: "dashboard", values: T },
      { id: "projects", values: T },
      { id: "customers", values: T },
      { id: "employees", values: T },
      { id: "scheduling", values: T },
      { id: "calendar", values: T },
      { id: "fileUploads", values: T },
      { id: "csvExport", values: T },
    ],
  },
  {
    id: "analytics",
    rows: [
      { id: "advancedAnalytics", values: [false, true, true, true] },
      { id: "advancedReports", values: [false, true, true, true] },
      { id: "excelExport", values: [false, true, true, true] },
    ],
  },
  {
    id: "developer",
    rows: [
      { id: "developerApi", values: [false, true, true, true] },
      { id: "apiKeys", values: [false, true, true, true] },
      { id: "webhooks", values: [false, false, true, true] },
      { id: "automation", values: [false, false, true, true] },
    ],
  },
  {
    id: "integrations",
    rows: [
      { id: "googleCalendar", values: [false, true, true, true] },
      { id: "outlookCalendar", values: [false, true, true, true] },
      { id: "multiLocation", values: [false, false, true, true] },
      { id: "branding", values: [false, false, true, true] },
    ],
  },
  {
    id: "ai",
    rows: [
      { id: "aiAssistant", future: true, values: [false, false, true, true] },
      { id: "aiReports", future: true, values: [false, false, true, true] },
      { id: "aiScheduling", future: true, values: [false, false, true, true] },
    ],
  },
  {
    id: "enterprise",
    rows: [
      { id: "sso", values: [false, false, false, true] },
      { id: "scim", values: [false, false, false, true] },
      { id: "whiteLabel", values: [false, false, false, true] },
      { id: "dedicatedSupport", values: [false, false, false, true] },
      { id: "sla", values: [false, false, false, true] },
    ],
  },
];

// FAQ entry ids — question/answer text lives in i18n (pricing.faq.items.<id>).
export const FAQ_IDS = [
  "creditCard",
  "trial",
  "cancel",
  "upgrade",
  "downgrade",
  "perEmployee",
  "afterTrial",
  "enterprise",
] as const;
