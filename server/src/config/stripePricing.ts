// Centralized Stripe pricing configuration (S2.3) — the single source of
// truth for the Stripe plan/price model: which plans are purchasable, their
// currencies, stable lookup keys, trial terms, list amounts, and the
// Stripe-Price-ID <-> plan mapping used by checkout and the webhook.
//
// No Stripe Price/Product IDs are hardcoded anywhere else: the actual IDs live
// in environment variables (config.stripe.prices, resolved per deploy so Test
// and Live each point at their own Stripe objects), and everything else
// derives from this module.
//
// Founder is intentionally absent (internal-only, never purchasable).
// Enterprise is present as a plan but has no self-serve price (Contact Sales).

import { config } from "../config";
import type { PlanId } from "../constants/plans";

// Stripe currency codes (lowercase, as Stripe expects). Two independent price
// lists — amounts are never converted between them.
export const STRIPE_CURRENCIES = ["eur", "huf"] as const;
export type StripeCurrency = (typeof STRIPE_CURRENCIES)[number];

export function isStripeCurrency(value: unknown): value is StripeCurrency {
  return typeof value === "string" && (STRIPE_CURRENCIES as readonly string[]).includes(value);
}

// Plans that can be bought self-serve via Checkout. Enterprise (contact sales)
// and Founder (internal) are deliberately excluded.
export const PURCHASABLE_PLANS = ["starter", "professional", "business"] as const;
export type PurchasablePlan = (typeof PURCHASABLE_PLANS)[number];

export function isPurchasablePlan(value: unknown): value is PurchasablePlan {
  return typeof value === "string" && (PURCHASABLE_PLANS as readonly string[]).includes(value);
}

// Billing interval — monthly across all plans in S2.3.
export const BILLING_INTERVAL = "month" as const;

// Trial terms, Stripe-side only (no trial *business* logic here). Only Starter
// has a trial; applied as trial_period_days on the Checkout Session.
export const PLAN_TRIAL_DAYS: Readonly<Record<PurchasablePlan, number>> = Object.freeze({
  starter: 14,
  professional: 0,
  business: 0,
});

// Stable, environment-independent lookup keys. Derived from a single template
// so they are never duplicated as literals. The plan-level base is mirrored in
// the frontend pricing config's `stripeLookupKey`; the per-currency Stripe
// lookup key appends the currency + interval.
export function lookupKeyBase(plan: PurchasablePlan): string {
  return `axeriva_${plan}`;
}

export function lookupKey(plan: PurchasablePlan, currency: StripeCurrency): string {
  return `${lookupKeyBase(plan)}_${currency}_${BILLING_INTERVAL}ly`; // e.g. axeriva_starter_eur_monthly
}

// List prices in MAJOR units (Ft / EUR). MUST match the display values in the
// frontend `src/config/pricing.ts` (independent price lists, not conversions).
// Used only by the setup script to create the Stripe Prices; runtime resolves
// plans by Price ID, never re-derives amounts.
export const PLAN_PRICE_CATALOG: Readonly<
  Record<PurchasablePlan, Readonly<Record<StripeCurrency, number>>>
> = Object.freeze({
  starter: Object.freeze({ eur: 29.99, huf: 7990 }),
  professional: Object.freeze({ eur: 59.99, huf: 16990 }),
  business: Object.freeze({ eur: 119.99, huf: 34990 }),
});

// Converts a major-unit amount to Stripe's smallest unit. EUR uses cents
// (x100). HUF must also be x100 and a multiple of 100 (Stripe's special rule
// for HUF); whole-forint amounts satisfy that automatically.
export function toStripeUnitAmount(majorAmount: number): number {
  return Math.round(majorAmount * 100);
}

// The configured Stripe Price ID for a plan+currency (from env), or null when
// not configured (e.g. locally, or a currency not yet set up).
export function priceIdFor(plan: PurchasablePlan, currency: StripeCurrency): string | null {
  return config.stripe.prices[plan]?.[currency] ?? null;
}

// --- Stripe Price ID -> plan reverse mapping ------------------------------
// One centralized mapping, built once from the configured price IDs plus the
// legacy single price. Used by the webhook to resolve a subscription's plan
// from the price that was purchased.

function buildPriceIdToPlan(): ReadonlyMap<string, PlanId> {
  const map = new Map<string, PlanId>();
  for (const plan of PURCHASABLE_PLANS) {
    for (const currency of STRIPE_CURRENCIES) {
      const id = priceIdFor(plan, currency);
      if (id) map.set(id, plan);
    }
  }
  // Legacy single price ("Axeriva Pro") maps to the legacy "pro" plan so
  // existing subscriptions keep their (S2.2-preserved, unlimited) plan.
  if (config.stripe.priceId) {
    map.set(config.stripe.priceId, "pro" as PlanId);
  }
  return map;
}

const PRICE_ID_TO_PLAN = buildPriceIdToPlan();

// Resolve a Stripe Price ID to its canonical plan, or null if unknown. The
// legacy "pro" value is returned as-is (it is not in PLAN_IDS but is a valid
// stored plan preserved for backward compatibility).
export function planForPriceId(priceId: string | null | undefined): PlanId | "pro" | null {
  if (!priceId) return null;
  return (PRICE_ID_TO_PLAN.get(priceId) as PlanId | "pro" | undefined) ?? null;
}

// --- Checkout price resolution --------------------------------------------
// Centralized so the checkout route never maps plans -> prices itself.

export type CheckoutPriceResolution =
  | { ok: true; priceId: string; trialDays: number }
  | { ok: false; status: number; error: string };

// Resolves the Stripe Price for a checkout request.
//   - No plan given  -> legacy single-price flow (backward compatible).
//   - starter/professional/business -> that plan's price for the currency.
//   - enterprise / founder / unknown -> rejected (not self-serve purchasable).
export function resolveCheckoutPrice(
  plan: unknown,
  currency: unknown,
): CheckoutPriceResolution {
  // Legacy flow: no plan specified -> use the single configured price.
  if (plan === undefined || plan === null || plan === "") {
    if (!config.stripe.priceId) {
      return { ok: false, status: 500, error: "Stripe is not configured (missing STRIPE_PRICE_ID)." };
    }
    return { ok: true, priceId: config.stripe.priceId, trialDays: 0 };
  }

  if (!isPurchasablePlan(plan)) {
    return {
      ok: false,
      status: 400,
      error:
        plan === "enterprise"
          ? "Enterprise is sales-led and cannot be purchased through checkout."
          : "Unknown or non-purchasable plan.",
    };
  }

  const resolvedCurrency: StripeCurrency = isStripeCurrency(currency) ? currency : "eur";
  const priceId = priceIdFor(plan, resolvedCurrency);
  if (!priceId) {
    return {
      ok: false,
      status: 500,
      error: `No Stripe price configured for ${plan} (${resolvedCurrency.toUpperCase()}).`,
    };
  }

  return { ok: true, priceId, trialDays: PLAN_TRIAL_DAYS[plan] };
}
