import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import Stripe from "stripe";
import app from "../app";
import prisma from "../database/prisma";
import { stripe } from "../services/stripe/stripeClient";
import { mapStripeError } from "../services/stripe/stripeErrors";
import { authHeader, createTenant } from "./helpers/factories";

// B4.2 — the central Stripe error mapper. Part (A) exercises mapStripeError()
// directly on constructed SDK error instances; part (B) proves the Express
// wiring end-to-end through real routes with the SDK call mocked to reject.
// The Stripe error constructors are publicly typed (constructor(raw?:
// StripeRawError)) — instances built here behave exactly like ones born from
// an API response, except type/rawType, which is precisely what the
// class-name-vs-api-type regression case pins.

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mapStripeError", () => {
  it("passes a card decline through verbatim with 402", () => {
    const mapped = mapStripeError(
      new Stripe.errors.StripeCardError({
        code: "card_declined",
        message: "Your card was declined.",
        statusCode: 402,
      })
    );

    expect(mapped).not.toBeNull();
    expect(mapped!.status).toBe(402);
    expect(mapped!.error).toBe("Your card was declined.");
    expect(mapped!.code).toBe("card_declined");
  });

  it("maps the unconfigured Billing Portal to 503 portal_not_configured", () => {
    const mapped = mapStripeError(
      new Stripe.errors.StripeInvalidRequestError({
        message:
          "No configuration provided and your live mode default configuration has not been created.",
        statusCode: 400,
      })
    );

    expect(mapped!.status).toBe(503);
    expect(mapped!.code).toBe("portal_not_configured");
    expect(mapped!.logHint).toContain("Customer portal");
  });

  it("maps a missing price (test/live mismatch) to 500 price_not_found", () => {
    const mapped = mapStripeError(
      new Stripe.errors.StripeInvalidRequestError({
        code: "resource_missing",
        message: "No such price: 'price_x'",
        statusCode: 404,
      })
    );

    expect(mapped!.status).toBe(500);
    expect(mapped!.code).toBe("price_not_found");
  });

  it("maps a missing checkout session to 404 session_not_found", () => {
    const mapped = mapStripeError(
      new Stripe.errors.StripeInvalidRequestError({
        code: "resource_missing",
        message: "No such checkout.session: 'cs_x'",
        statusCode: 404,
      })
    );

    expect(mapped!.status).toBe(404);
    expect(mapped!.code).toBe("session_not_found");
    expect(mapped!.error).toBe("Checkout session not found.");
  });

  it("maps a missing subscription to 409 subscription_not_found", () => {
    const mapped = mapStripeError(
      new Stripe.errors.StripeInvalidRequestError({
        code: "resource_missing",
        message: "No such subscription: 'sub_x'",
        statusCode: 404,
      })
    );

    expect(mapped!.status).toBe(409);
    expect(mapped!.code).toBe("subscription_not_found");
  });

  it("maps an authentication failure to 503 billing_unavailable", () => {
    const mapped = mapStripeError(
      new Stripe.errors.StripeAuthenticationError({
        message: "Invalid API Key provided",
        statusCode: 401,
      })
    );

    expect(mapped!.status).toBe(503);
    expect(mapped!.code).toBe("billing_unavailable");
  });

  it("maps any other StripeError subclass to 502 billing_error", () => {
    const mapped = mapStripeError(
      new Stripe.errors.StripeIdempotencyError({
        message: "Keys for idempotent requests can only be used once.",
        statusCode: 400,
      })
    );

    expect(mapped!.status).toBe(502);
    expect(mapped!.code).toBe("billing_error");
  });

  it("returns null for a non-Stripe error — those must stay untouched", () => {
    expect(mapStripeError(new Error("boom"))).toBeNull();
    expect(mapStripeError("not even an error")).toBeNull();
    expect(mapStripeError(undefined)).toBeNull();
  });

  it("branches on instanceof, not on error.type (which holds the class name)", () => {
    // stripe-node sets type to the CLASS name, not the API-level string —
    // a mapper matching error.type === "card_error" would silently never
    // fire. This pins that the mapping works despite that.
    const error = new Stripe.errors.StripeCardError({
      code: "card_declined",
      message: "Your card was declined.",
      statusCode: 402,
    });

    expect(error.type).toBe("StripeCardError"); // NOT "card_error"
    expect(mapStripeError(error)!.status).toBe(402);
  });
});

describe("stripeErrorHandler wiring (route level)", () => {
  it("POST /subscription/sync surfaces a mapped 404 with no stack", async () => {
    const t = await createTenant();

    vi.spyOn(stripe.checkout.sessions, "retrieve").mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({
        code: "resource_missing",
        message: "No such checkout.session: 'cs_bogus'",
        statusCode: 404,
      })
    );

    const res = await request(app)
      .post("/subscription/sync")
      .set(authHeader(t.token))
      .send({ sessionId: "cs_bogus" });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Checkout session not found.");
    expect(res.body.code).toBe("session_not_found");
    expect(res.body.stack).toBeUndefined();
  });

  it("POST /subscription/portal maps the unconfigured live portal to 503", async () => {
    // THE most important case in B4: this is the error the first live
    // portal call is guaranteed to throw until the Customer Portal config
    // is saved in the live Dashboard — and since the frontend has no portal
    // button yet, this test is the only place the behaviour is exercised.
    const t = await createTenant();
    await prisma.company.update({
      where: { id: t.company.id },
      data: { stripeCustomerId: "cus_test_123" },
    });

    vi.spyOn(stripe.billingPortal.sessions, "create").mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({
        message:
          "No configuration provided and your live mode default configuration has not been created.",
        statusCode: 400,
      })
    );

    const res = await request(app)
      .post("/subscription/portal")
      .set(authHeader(t.token))
      .send({});

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("portal_not_configured");
    expect(res.body.error).toBe(
      "Billing portal is not configured yet — please contact support."
    );
  });

  it("rejects a malformed sessionId before it ever reaches Stripe", async () => {
    const t = await createTenant();
    const retrieve = vi.spyOn(stripe.checkout.sessions, "retrieve");

    const res = await request(app)
      .post("/subscription/sync")
      .set(authHeader(t.token))
      .send({ sessionId: "not-a-session-id" });

    expect(res.status).toBe(400);
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("leaves non-Stripe errors to the global handler unchanged", async () => {
    // authMiddleware uses prisma.user.findUnique, so mocking company lookups
    // does not break authentication — the failure lands inside the handler.
    const t = await createTenant();

    vi.spyOn(prisma.company, "findUnique").mockRejectedValue(new Error("db down"));

    const res = await request(app)
      .post("/subscription/portal")
      .set(authHeader(t.token))
      .send({});

    // NODE_ENV=test → the global handler's non-production branch returns
    // the message; the point here is the STATUS is 500 (not a mapped Stripe
    // status) proving the mapper called next(error).
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("db down");
  });
});
