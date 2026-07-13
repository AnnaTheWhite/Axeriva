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
    console.log(`Using existing price ${byKey.data[0].id} (${key})`);
    return byKey.data[0].id;
  }

  const unitAmount = toStripeUnitAmount(PLAN_PRICE_CATALOG[plan][currency]);
  const price = await stripe.prices.create({
    product: productId,
    unit_amount: unitAmount,
    currency,
    recurring: { interval: BILLING_INTERVAL },
    lookup_key: key,
  });
  console.log(`Created price ${price.id} (${key}, ${unitAmount} ${currency})`);
  return price.id;
}

async function main() {
  if (!config.stripe.secretKey) {
    console.error("STRIPE_SECRET_KEY is not set in server/.env");
    process.exit(1);
  }

  const envLines: string[] = [];

  // Purchasable plans: product + one price per currency.
  for (const plan of PURCHASABLE_PLANS) {
    const productId = await findOrCreateProduct(PRODUCT_NAME[plan]);
    for (const currency of STRIPE_CURRENCIES) {
      const priceId = await findOrCreatePrice(productId, plan, currency);
      envLines.push(`${ENV_VAR[plan][currency]}="${priceId}"`);
    }
    if (PLAN_TRIAL_DAYS[plan] > 0) {
      console.log(`  (${plan} has a ${PLAN_TRIAL_DAYS[plan]}-day trial — applied at checkout)`);
    }
  }

  console.log("Enterprise is Contact Sales — intentionally not created in Stripe.");

  console.log("\nAdd these to server/.env:");
  console.log(envLines.join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
