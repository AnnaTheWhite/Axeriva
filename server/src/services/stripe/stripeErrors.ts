import Stripe from "stripe";
import type { NextFunction, Request, Response } from "express";

// B4.2 — the ONE Stripe-aware error mapper. All 15 previously-unprotected
// SDK calls (subscription.routes.ts, subscriptionChange.ts, the webhook's
// subscriptions.retrieve) are covered here centrally, with ZERO changes at
// the call sites: Express 5 forwards rejected async handlers to error
// middleware automatically, so this layer turns every Stripe throw into a
// meaningful status + user-safe message instead of the generic
// "Internal server error". Non-Stripe errors pass through untouched.
//
// PITFALL (verified against stripe-node): StripeError.type holds the CLASS
// name ("StripeCardError"), not the API-level type ("card_error") — the
// API-level string only appears in rawType, and only for errors born from a
// real API response. Branch on instanceof, never on error.type.

export type MappedStripeError = {
  status: number;
  error: string; // user-safe, shown verbatim by the frontend
  code: string; // additive, machine-readable (future i18n mapping)
  logHint?: string; // server-log only — the operator's next step
};

export function mapStripeError(error: unknown): MappedStripeError | null {
  if (!(error instanceof Stripe.errors.StripeError)) {
    return null;
  }

  // Card declines: Stripe's own message is deliberately user-safe
  // ("Your card was declined.") — pass it through verbatim. 402 is free in
  // this API (the read-only guard uses 403, apiFetch intercepts 401/403
  // only), so the client catch just renders the message.
  if (error instanceof Stripe.errors.StripeCardError) {
    return {
      status: 402,
      error: error.message,
      code: "card_declined",
    };
  }

  if (error instanceof Stripe.errors.StripeInvalidRequestError) {
    const message = error.message ?? "";

    // The error every first live /subscription/portal call throws until the
    // Customer Portal configuration is saved in the live Dashboard.
    if (message.includes("No configuration provided")) {
      return {
        status: 503,
        error: "Billing portal is not configured yet — please contact support.",
        code: "portal_not_configured",
        logHint:
          "Stripe Dashboard → Settings → Billing → Customer portal → Save (live mode)",
      };
    }

    // resource_missing sub-cases are distinguished by message matching —
    // Stripe offers no finer code. If a pattern ever stops matching, we
    // fall through to the generic billing_error below, which still beats
    // "Internal server error".
    if (error.code === "resource_missing") {
      if (message.includes("No such price")) {
        return {
          status: 500,
          error: "This plan cannot be purchased right now — please contact support.",
          code: "price_not_found",
          logHint:
            "likely a test/live key + price ID mismatch — check STRIPE_PRICE_* against the account STRIPE_SECRET_KEY belongs to",
        };
      }

      if (message.includes("No such checkout.session")) {
        return {
          status: 404,
          error: "Checkout session not found.",
          code: "session_not_found",
        };
      }

      if (message.includes("No such subscription") || message.includes("No such customer")) {
        return {
          status: 409,
          error: "Your subscription could not be found in Stripe — please contact support.",
          code: "subscription_not_found",
        };
      }
    }
  }

  // Key rejected / transient Stripe-side trouble — same user story for all:
  // billing is down, try again; nothing the owner can fix themselves.
  if (
    error instanceof Stripe.errors.StripeAuthenticationError ||
    error instanceof Stripe.errors.StripePermissionError
  ) {
    return {
      status: 503,
      error: "Billing is temporarily unavailable.",
      code: "billing_unavailable",
      logHint: "Stripe rejected the API key — check STRIPE_SECRET_KEY on this deploy",
    };
  }

  if (
    error instanceof Stripe.errors.StripeConnectionError ||
    error instanceof Stripe.errors.StripeAPIError ||
    error instanceof Stripe.errors.StripeRateLimitError
  ) {
    return {
      status: 503,
      error: "Billing is temporarily unavailable — please try again in a moment.",
      code: "billing_unavailable",
    };
  }

  // Any other StripeError subclass.
  return {
    status: 502,
    error: "Billing request failed — please try again.",
    code: "billing_error",
  };
}

// 4-arity Express error middleware. Registered in app.ts BETWEEN the 404
// handler and the global error handler: Stripe errors get mapped here,
// everything else falls through via next(error) with bit-identical
// behaviour to before B4.
export function stripeErrorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const mapped = mapStripeError(error);

  if (!mapped) {
    next(error);
    return;
  }

  // Full detail server-side (app.ts:212 pattern); logHint names the
  // operator's next step. The response body carries only the user-safe
  // message + code — never a stack, in any environment (this also keeps
  // dev-mode stacks out of Stripe's webhook delivery log).
  console.error(
    `[stripe error] ${req.method} ${req.originalUrl} -> ${mapped.status} ${mapped.code}` +
      (mapped.logHint ? ` | hint: ${mapped.logHint}` : ""),
    error
  );

  if (res.headersSent) {
    return;
  }

  res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
}
