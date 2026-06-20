import dotenv from "dotenv";
import Stripe from "stripe";

// Imported before index.ts's own dotenv.config() call runs (ES module
// imports execute before the importing module's top-level code), so this
// file loads its own env vars to be safe regardless of import order.
dotenv.config();

const secretKey = process.env.STRIPE_SECRET_KEY;

if (!secretKey) {
  console.warn(
    "[stripe] STRIPE_SECRET_KEY is not set — subscription checkout/portal/webhook routes will fail until it's added to server/.env"
  );
}

export const stripe = new Stripe(secretKey || "sk_test_placeholder");
