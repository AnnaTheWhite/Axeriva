import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import Stripe from "stripe";
import app from "../app";
import prisma from "../database/prisma";
import { stripe } from "../services/stripe/stripeClient";
import { createCompany, createTenant } from "./helpers/factories";

// The webhook is the only path by which money becomes access, so it gets
// tested against REAL signature verification: the payload is signed with the
// same secret the app is configured with (vitest.config.ts), and
// stripe.webhooks.constructEvent runs unmocked. Nothing here reaches the
// network — the one outbound call the handler makes
// (stripe.subscriptions.retrieve, on checkout.session.completed) is spied.

const WEBHOOK_SECRET = "whsec_axeriva_integration_suite";
const signer = new Stripe("sk_test_axeriva_integration_suite");

const PERIOD_END = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

function subscriptionFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_test_123",
    object: "subscription",
    status: "active",
    customer: "cus_test_123",
    cancel_at_period_end: false,
    schedule: null,
    metadata: {},
    items: {
      object: "list",
      data: [
        {
          id: "si_test_123",
          price: { id: "price_unknown_to_the_catalog" },
          current_period_end: PERIOD_END,
        },
      ],
    },
    ...overrides,
  };
}

// Builds a signed request exactly as Stripe would send it.
function postWebhook(event: Record<string, unknown>, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify(event);
  const header = signer.webhooks.generateTestHeaderString({ payload, secret });

  return request(app)
    .post("/subscription/webhook")
    .set("stripe-signature", header)
    .set("Content-Type", "application/json")
    .send(payload);
}

function event(type: string, object: Record<string, unknown>) {
  return {
    id: `evt_${type}`,
    object: "event",
    type,
    data: { object },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("webhook signature verification", () => {
  it("rejects a request with no stripe-signature header", async () => {
    const res = await request(app)
      .post("/subscription/webhook")
      .set("Content-Type", "application/json")
      .send(JSON.stringify(event("customer.subscription.updated", subscriptionFixture())));

    expect(res.status).toBe(400);
  });

  it("rejects a payload signed with the WRONG secret", async () => {
    const res = await postWebhook(
      event("customer.subscription.updated", subscriptionFixture()),
      "whsec_attacker_secret"
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid signature");
  });

  it("rejects a tampered payload that keeps a valid-looking signature", async () => {
    const original = JSON.stringify(event("customer.subscription.updated", subscriptionFixture()));
    const header = signer.webhooks.generateTestHeaderString({
      payload: original,
      secret: WEBHOOK_SECRET,
    });

    const tampered = original.replace("sub_test_123", "sub_attacker_999");

    const res = await request(app)
      .post("/subscription/webhook")
      .set("stripe-signature", header)
      .set("Content-Type", "application/json")
      .send(tampered);

    expect(res.status).toBe(400);
  });

  it("answers a GET with 404 instead of falling through to the authed router", async () => {
    const res = await request(app).get("/subscription/webhook");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Not found");
  });
});

describe("customer.subscription.updated", () => {
  it("writes status, period end and Stripe ids onto the company", async () => {
    const company = await createCompany({ plan: "starter", subscriptionStatus: "inactive" });

    const res = await postWebhook(
      event(
        "customer.subscription.updated",
        subscriptionFixture({ metadata: { companyId: String(company.id) } })
      )
    );

    expect(res.status).toBe(200);

    const after = await prisma.company.findUnique({ where: { id: company.id } });
    expect(after!.subscriptionStatus).toBe("active");
    expect(after!.stripeSubscriptionId).toBe("sub_test_123");
    expect(after!.subscriptionEndsAt!.getTime()).toBe(PERIOD_END * 1000);
    expect(after!.cancelAtPeriodEnd).toBe(false);
  });

  it("resolves the company by stripeCustomerId when metadata carries no id", async () => {
    const company = await createCompany({ subscriptionStatus: "inactive" });
    await prisma.company.update({
      where: { id: company.id },
      data: { stripeCustomerId: "cus_test_123" },
    });

    await postWebhook(event("customer.subscription.updated", subscriptionFixture()));

    const after = await prisma.company.findUnique({ where: { id: company.id } });
    expect(after!.subscriptionStatus).toBe("active");
  });

  it("drops the paid plan when the subscription goes past_due", async () => {
    const company = await createCompany({ plan: "professional", subscriptionStatus: "active" });

    await postWebhook(
      event(
        "customer.subscription.updated",
        subscriptionFixture({
          status: "past_due",
          metadata: { companyId: String(company.id) },
        })
      )
    );

    const after = await prisma.company.findUnique({ where: { id: company.id } });
    expect(after!.subscriptionStatus).toBe("past_due");
    expect(after!.plan).toBe("free");
  });

  it("mirrors cancel_at_period_end", async () => {
    const company = await createCompany();

    await postWebhook(
      event(
        "customer.subscription.updated",
        subscriptionFixture({
          cancel_at_period_end: true,
          metadata: { companyId: String(company.id) },
        })
      )
    );

    const after = await prisma.company.findUnique({ where: { id: company.id } });
    expect(after!.cancelAtPeriodEnd).toBe(true);
  });

  it("NEVER overwrites a manually managed plan (founder)", async () => {
    const company = await createCompany({ plan: "founder", subscriptionStatus: "active" });

    await postWebhook(
      event(
        "customer.subscription.updated",
        subscriptionFixture({
          status: "canceled",
          metadata: { companyId: String(company.id) },
        })
      )
    );

    const after = await prisma.company.findUnique({ where: { id: company.id } });
    expect(after!.plan).toBe("founder");
    expect(after!.subscriptionStatus).toBe("active");
  });
});

describe("customer.subscription.deleted", () => {
  it("marks the company canceled and drops it to free", async () => {
    const company = await createCompany({ plan: "professional", subscriptionStatus: "active" });
    await prisma.company.update({
      where: { id: company.id },
      data: { cancelAtPeriodEnd: true, pendingPlan: "starter" },
    });

    const res = await postWebhook(
      event(
        "customer.subscription.deleted",
        subscriptionFixture({
          status: "canceled",
          metadata: { companyId: String(company.id) },
        })
      )
    );

    expect(res.status).toBe(200);

    const after = await prisma.company.findUnique({ where: { id: company.id } });
    expect(after!.subscriptionStatus).toBe("canceled");
    expect(after!.plan).toBe("free");
    // A fully-ended subscription has nothing pending and nothing to cancel.
    expect(after!.cancelAtPeriodEnd).toBe(false);
    expect(after!.pendingPlan).toBeNull();
  });

  it("NEVER cancels a manually managed plan (enterprise)", async () => {
    const company = await createCompany({ plan: "enterprise", subscriptionStatus: "active" });

    await postWebhook(
      event(
        "customer.subscription.deleted",
        subscriptionFixture({ metadata: { companyId: String(company.id) } })
      )
    );

    const after = await prisma.company.findUnique({ where: { id: company.id } });
    expect(after!.plan).toBe("enterprise");
    expect(after!.subscriptionStatus).toBe("active");
  });
});

describe("checkout.session.completed", () => {
  it("activates the subscription for the company named in the session metadata", async () => {
    const tenant = await createTenant({ plan: "starter", subscriptionStatus: "inactive" });

    const retrieve = vi
      .spyOn(stripe.subscriptions, "retrieve")
      .mockResolvedValue(subscriptionFixture() as never);

    const res = await postWebhook(
      event("checkout.session.completed", {
        id: "cs_test_123",
        object: "checkout.session",
        customer: "cus_test_123",
        subscription: "sub_test_123",
        metadata: { companyId: String(tenant.company.id) },
      })
    );

    expect(res.status).toBe(200);
    expect(retrieve).toHaveBeenCalledWith("sub_test_123");

    const after = await prisma.company.findUnique({ where: { id: tenant.company.id } });
    expect(after!.subscriptionStatus).toBe("active");
    expect(after!.stripeCustomerId).toBe("cus_test_123");
    expect(after!.stripeSubscriptionId).toBe("sub_test_123");
  });
});

describe("unhandled events", () => {
  it("acknowledges an event type it does not handle without touching data", async () => {
    const company = await createCompany({ plan: "starter", subscriptionStatus: "trialing" });

    const res = await postWebhook(
      event("invoice.payment_failed", {
        id: "in_test_123",
        object: "invoice",
        customer: "cus_test_123",
        metadata: { companyId: String(company.id) },
      })
    );

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    const after = await prisma.company.findUnique({ where: { id: company.id } });
    expect(after!.plan).toBe("starter");
    expect(after!.subscriptionStatus).toBe("trialing");
  });
});
