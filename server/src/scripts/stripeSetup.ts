import dotenv from "dotenv";
import { stripe } from "../services/stripe/stripeClient";

dotenv.config();

const PRODUCT_NAME = "CrewFlow Pro";
const UNIT_AMOUNT = 3000; // 30.00 EUR, in cents
const CURRENCY = "eur";

// Idempotent: finds the existing "CrewFlow Pro" product/price (30 EUR/month)
// in the connected Stripe test account, or creates them if missing. Prints
// the price ID to paste into server/.env as STRIPE_PRICE_ID.
async function main() {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error("STRIPE_SECRET_KEY is not set in server/.env");
    process.exit(1);
  }

  const products = await stripe.products.list({ limit: 100, active: true });
  let product = products.data.find((p) => p.name === PRODUCT_NAME);

  if (!product) {
    product = await stripe.products.create({ name: PRODUCT_NAME });
    console.log(`Created product ${product.id}`);
  } else {
    console.log(`Using existing product ${product.id}`);
  }

  const prices = await stripe.prices.list({ product: product.id, active: true });
  let price = prices.data.find(
    (p) =>
      p.unit_amount === UNIT_AMOUNT &&
      p.currency === CURRENCY &&
      p.recurring?.interval === "month"
  );

  if (!price) {
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: UNIT_AMOUNT,
      currency: CURRENCY,
      recurring: { interval: "month" },
    });
    console.log(`Created price ${price.id}`);
  } else {
    console.log(`Using existing price ${price.id}`);
  }

  console.log("\nAdd this to server/.env:");
  console.log(`STRIPE_PRICE_ID="${price.id}"`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
