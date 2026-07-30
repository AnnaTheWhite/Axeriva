import { stripe } from "../services/stripe/stripeClient";
import { config } from "../config";
import {
  PURCHASABLE_PLANS,
  STRIPE_CURRENCIES,
  PLAN_PRICE_CATALOG,
  PLAN_TRIAL_DAYS,
  BILLING_INTERVAL,
  lookupKey,
  toStripeUnitAmount,
  type PurchasablePlan,
  type StripeCurrency,
} from "../config/stripePricing";

// Idempotent Stripe bootstrap for the commercial plans (S2.3).
//
// Creates (or reuses) one Product per SELF-SERVE plan and one recurring Price
// per currency for each purchasable plan, driven entirely by the centralized
// pricing config. Prices carry stable lookup keys so they can be found again.
//
// Enterprise is intentionally OUT of the Stripe catalog entirely — it is a
// Contact Sales plan with no self-serve purchase path, so it gets no Stripe
// Product and no Stripe Price. Founder is never created (internal-only).
//
// Run against a Test or Live account by pointing STRIPE_SECRET_KEY at it:
//   npm run stripe:setup

const PRODUCT_NAME: Record<PurchasablePlan, string> = {
  starter: "Axeriva Starter",
  professional: "Axeriva Professional",
  business: "Axeriva Business",
};

const ENV_VAR: Record<PurchasablePlan, Record<StripeCurrency, string>> = {
  starter: { eur: "STRIPE_PRICE_STARTER_EUR", huf: "STRIPE_PRICE_STARTER_HUF" },
  professional: { eur: "STRIPE_PRICE_PROFESSIONAL_EUR", huf: "STRIPE_PRICE_PROFESSIONAL_HUF" },
  business: { eur: "STRIPE_PRICE_BUSINESS_EUR", huf: "STRIPE_PRICE_BUSINESS_HUF" },
};

async function findOrCreateProduct(name: string): Promise<string> {
  const products = await stripe.products.list({ limit: 100, active: true });
  const existing = products.data.find((p) => p.name === name);
  if (existing) {
    console.log(`Using existing product ${existing.id} (${name})`);
    return existing.id;
  }
  const created = await stripe.products.create({ name });
  console.log(`Created product ${created.id} (${name})`);
  return created.id;
}

async function findOrCreatePrice(
  productId: string,
  plan: PurchasablePlan,
  currency: StripeCurrency,
): Promise<string> {
  const key = lookupKey(plan, currency);

  // Prefer resolving by lookup key (stable across runs).
  const byKey = await stripe.prices.list({ lookup_keys: [key], active: true, limit: 1 });
  if (byKey.data[0]) {
    const existing = byKey.data[0];
    console.log(`Using existing price ${existing.id} (${key})`);
    // Design C precondition (AC19): the Billing Portal refuses subscription
    // modifications on prices whose tax_behavior is unspecified — which
    // would silently break the entire hosted upgrade-confirmation flow.
    // "inclusive" keeps every charged amount exactly as displayed (7 990 Ft
    // stays 7 990 Ft; VAT handling stays inside the price), and Stripe only
    // allows this update while the value is still unspecified (one-way).
    if (existing.tax_behavior === "unspecified" || !existing.tax_behavior) {
      await stripe.prices.update(existing.id, { tax_behavior: "inclusive" });
      console.log(`  set tax_behavior=inclusive on ${existing.id}`);
    }
    return existing.id;
  }

  const unitAmount = toStripeUnitAmount(PLAN_PRICE_CATALOG[plan][currency]);
  const price = await stripe.prices.create({
    product: productId,
    unit_amount: unitAmount,
    currency,
    recurring: { interval: BILLING_INTERVAL },
    lookup_key: key,
    // See tax_behavior note above (AC19).
    tax_behavior: "inclusive",
  });
  console.log(`Created price ${price.id} (${key}, ${unitAmount} ${currency})`);
  return price.id;
}

// Design C — the DEDICATED portal configuration used only by the hosted
// upgrade-confirmation flow (subscription_update_confirm sessions created in
// services/stripe/subscriptionChange.ts). The account's DEFAULT portal
// configuration is separate and must keep plan changes disabled (payment
// method / invoices / cancel / resume only) — that one is managed in the
// Stripe Dashboard, see docs/checkout-only-upgrades-ux.md §5 and AC18.
const FLOW_CONFIG_MARKER = { axeriva: "upgrade-flow" } as const;

async function ensurePortalFlowConfiguration(
  productPrices: { productId: string; prices: string[] }[],
): Promise<string> {
  const features: Parameters<typeof stripe.billingPortal.configurations.create>[0]["features"] = {
    subscription_update: {
      enabled: true,
      default_allowed_updates: ["price"],
      // AC7 — the upgrade proration is invoiced and charged immediately.
      proration_behavior: "always_invoice",
      // AC10 — upgrading a (legacy Stripe-side) trialing subscription ends
      // the trial and charges the first invoice immediately.
      trial_update_behavior: "end_trial",
      products: productPrices.map(({ productId, prices }) => ({
        product: productId,
        prices,
      })),
    },
    // Flow sessions only ever render the update-confirmation surface, but the
    // configuration is still a full portal configuration — keep everything
    // else off so this can never serve as a plan-change back door if a plain
    // session were ever created with it by mistake.
    subscription_cancel: { enabled: false },
    payment_method_update: { enabled: false },
    invoice_history: { enabled: false },
  };

  // Prefer the already-configured id (env) — immune to pagination/marker
  // drift. Falls back to the marker scan (ALL pages — accounts accumulate
  // configurations, and missing one past a page boundary would silently
  // create a duplicate with a new id diverging from the deployed env).
  if (config.stripe.portalFlowConfigId) {
    try {
      await stripe.billingPortal.configurations.update(config.stripe.portalFlowConfigId, {
        features,
      });
      console.log(`Updated portal flow configuration ${config.stripe.portalFlowConfigId} (from env)`);
      return config.stripe.portalFlowConfigId;
    } catch {
      console.warn(
        `STRIPE_PORTAL_FLOW_CONFIG_ID=${config.stripe.portalFlowConfigId} was not found in ` +
          "this Stripe account/mode — falling back to the marker lookup. Check that the id " +
          "matches the account STRIPE_SECRET_KEY points at."
      );
    }
  }

  const allConfigurations = await stripe.billingPortal.configurations
    .list({ limit: 100 })
    .autoPagingToArray({ limit: 1000 });
  const found = allConfigurations.find((c) => c.metadata?.axeriva === FLOW_CONFIG_MARKER.axeriva);

  if (found) {
    await stripe.billingPortal.configurations.update(found.id, { features });
    console.log(`Updated portal flow configuration ${found.id}`);
    return found.id;
  }

  const created = await stripe.billingPortal.configurations.create({
    features,
    business_profile: {},
    metadata: { ...FLOW_CONFIG_MARKER },
  });
  console.log(`Created portal flow configuration ${created.id}`);
  return created.id;
}

async function main() {
  if (!config.stripe.secretKey) {
    console.error("STRIPE_SECRET_KEY is not set in server/.env");
    process.exit(1);
  }

  const envLines: string[] = [];
  const productPrices: { productId: string; prices: string[] }[] = [];

  // Purchasable plans: product + one price per currency.
  for (const plan of PURCHASABLE_PLANS) {
    const productId = await findOrCreateProduct(PRODUCT_NAME[plan]);
    const prices: string[] = [];
    for (const currency of STRIPE_CURRENCIES) {
      const priceId = await findOrCreatePrice(productId, plan, currency);
      prices.push(priceId);
      envLines.push(`${ENV_VAR[plan][currency]}="${priceId}"`);
    }
    productPrices.push({ productId, prices });
    if (PLAN_TRIAL_DAYS[plan] > 0) {
      console.log(`  (${plan} has a ${PLAN_TRIAL_DAYS[plan]}-day trial — applied at checkout)`);
    }
  }

  console.log("Enterprise is Contact Sales — intentionally not created in Stripe.");

  // AC19 also covers the legacy single price ("Axeriva Pro") — legacy "pro"
  // subscribers can still upgrade through the hosted flow, and the portal
  // refuses updates on a subscription whose price has unspecified
  // tax_behavior. One-way update, only possible while still unspecified.
  if (config.stripe.priceId) {
    const legacyPrice = await stripe.prices.retrieve(config.stripe.priceId);
    if (legacyPrice.tax_behavior === "unspecified" || !legacyPrice.tax_behavior) {
      await stripe.prices.update(legacyPrice.id, { tax_behavior: "inclusive" });
      console.log(`Set tax_behavior=inclusive on legacy price ${legacyPrice.id}`);
    }
  }

  // Design C — dedicated configuration for the hosted upgrade-confirmation
  // flow (all six prices, always_invoice, end_trial).
  const flowConfigId = await ensurePortalFlowConfiguration(productPrices);
  envLines.push(`STRIPE_PORTAL_FLOW_CONFIG_ID="${flowConfigId}"`);

  console.log(
    "\nReminder (AC18): the DEFAULT Customer Portal configuration is managed in the\n" +
      "Stripe Dashboard — plan changes must stay disabled there (payment method,\n" +
      "invoices, cancel and resume only)."
  );

  console.log("\nAdd these to server/.env:");
  console.log(envLines.join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
