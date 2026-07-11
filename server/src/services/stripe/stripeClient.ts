import Stripe from "stripe";
import { config } from "../../config";

// In production a missing STRIPE_SECRET_KEY is a startup error (see
// config.ts), so `client` is always real there. In development the key may
// legitimately be absent — but instead of silently constructing a client
// with a fake placeholder key (the old behaviour), any actual use of the
// client now fails loudly with a message naming the missing variable.
const client = config.stripe.secretKey ? new Stripe(config.stripe.secretKey) : null;

if (!client) {
  console.warn(
    "[stripe] STRIPE_SECRET_KEY is not set — subscription checkout/portal/webhook routes will fail until it's added to server/.env"
  );
}

export const stripe: Stripe = new Proxy({} as Stripe, {
  get(_target, property) {
    if (!client) {
      throw new Error(
        "Stripe is not configured: STRIPE_SECRET_KEY is missing. Set it in server/.env (see docs/environment.md)."
      );
    }

    const value = (client as unknown as Record<string | symbol, unknown>)[property];
    return typeof value === "function" ? (value as Function).bind(client) : value;
  },
});
