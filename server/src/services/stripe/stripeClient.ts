import Stripe from "stripe";
import { config } from "../../config";

// In production a missing STRIPE_SECRET_KEY is a startup error (see
// config.ts), so `client` is always real there. In development the key may
// legitimately be absent — but instead of silently constructing a client
// with a fake placeholder key (the old behaviour), any actual use of the
// client now fails loudly with a message naming the missing variable.
//
// B4.3 — apiVersion pinned to the version the installed SDK ships with
// (node_modules/stripe/cjs/apiVersion.js). Without the pin the client uses
// the Stripe ACCOUNT's default version, which can differ between the test
// and live accounts — and syncSubscription.ts depends on the NEWER shape
// (current_period_end lives on the line item, not the subscription).
// NEVER pin to an older version: that would break syncSubscription.ts.
// Bump this string together with every `stripe` package upgrade.
const client = config.stripe.secretKey
  ? new Stripe(config.stripe.secretKey, { apiVersion: "2026-05-27.dahlia" })
  : null;

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
