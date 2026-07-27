import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import app from "../app";
import prisma from "../database/prisma";
import { stripe } from "../services/stripe/stripeClient";
import { authHeader, createTenant } from "./helpers/factories";

// POST /subscription/change-plan.
//
// The bug these tests pin: Stripe fixes a subscription's currency at
// creation, so updating an item to a price in a DIFFERENT currency is
// rejected with a bare 400 — which the error mapper can only surface as a
// generic 502 "Billing request failed". The requested currency comes from the
// UI LANGUAGE (currencyForLanguage() on the frontend), so a customer who
// subscribed in HUF and then switched the interface to English sent "EUR" and
// hit exactly that wall. The subscription's own currency must win.

afterEach(() => {
  vi.restoreAllMocks();
});

// A tenant with a live Stripe subscription the change-plan paths will modify.
async function subscribedTenant(plan: string, subscriptionStatus = "active") {
  const t = await createTenant({ plan, subscriptionStatus });
  await prisma.company.update({
    where: { id: t.company.id },
    data: {
      stripeCustomerId: "cus_test_123",
      stripeSubscriptionId: "sub_test_123",
      subscriptionEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  return t;
}

// Minimal Stripe subscription shape the service reads: one item, its price
// (id + CURRENCY) and the period end used for downgrade scheduling.
function subscriptionFixture(currency: string, priceId: string) {
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
          price: { id: priceId, currency },
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        },
      ],
    },
  };
}

describe("change-plan currency matching", () => {
  it("upgrades using the SUBSCRIPTION's currency, not the requested one", async () => {
    // The regression case: subscribed in HUF, UI later switched to English so
    // the frontend sends EUR. Sending the EUR price to Stripe would 400.
    const t = await subscribedTenant("starter");

    vi.spyOn(stripe.subscriptions, "retrieve").mockResolvedValue(
      subscriptionFixture("huf", "price_test_starter_huf") as never
    );
    const update = vi
      .spyOn(stripe.subscriptions, "update")
      .mockResolvedValue(
        subscriptionFixture("huf", "price_test_professional_huf") as never
      );

    const res = await request(app)
      .post("/subscription/change-plan")
      .set(authHeader(t.token))
      .send({ plan: "professional", currency: "EUR" });

    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("upgraded");

    // The assertion that matters: the HUF price, matching the subscription.
    expect(update).toHaveBeenCalledWith(
      "sub_test_123",
      expect.objectContaining({
        items: [{ id: "si_test_123", price: "price_test_professional_huf" }],
      })
    );
  });

  it("upgrades in EUR when the subscription itself is EUR", async () => {
    const t = await subscribedTenant("starter");

    vi.spyOn(stripe.subscriptions, "retrieve").mockResolvedValue(
      subscriptionFixture("eur", "price_test_starter_eur") as never
    );
    const update = vi
      .spyOn(stripe.subscriptions, "update")
      .mockResolvedValue(
        subscriptionFixture("eur", "price_test_professional_eur") as never
      );

    const res = await request(app)
      .post("/subscription/change-plan")
      .set(authHeader(t.token))
      .send({ plan: "professional", currency: "EUR" });

    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      "sub_test_123",
      expect.objectContaining({
        items: [{ id: "si_test_123", price: "price_test_professional_eur" }],
      })
    );
  });

  it("ignores a mismatched requested currency on DOWNGRADE scheduling too", async () => {
    // Both schedule phases must share a currency: phase 1 reuses the
    // subscription's existing price, so phase 2 has to match it.
    const t = await subscribedTenant("business");

    vi.spyOn(stripe.subscriptions, "retrieve").mockResolvedValue(
      subscriptionFixture("huf", "price_test_business_huf") as never
    );
    vi.spyOn(stripe.subscriptionSchedules, "create").mockResolvedValue({
      id: "sub_sched_test",
      phases: [{ start_date: Math.floor(Date.now() / 1000) }],
    } as never);
    const scheduleUpdate = vi
      .spyOn(stripe.subscriptionSchedules, "update")
      .mockResolvedValue({ id: "sub_sched_test" } as never);

    const res = await request(app)
      .post("/subscription/change-plan")
      .set(authHeader(t.token))
      .send({ plan: "professional", currency: "EUR" });

    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("downgrade_scheduled");

    const phases = scheduleUpdate.mock.calls[0][1].phases;
    expect(phases[0].items[0].price).toBe("price_test_business_huf");
    expect(phases[1].items[0].price).toBe("price_test_professional_huf");
  });
});

describe("change-plan guards", () => {
  it("hands off to Checkout when there is no live subscription", async () => {
    // Registration trial or a cancelled subscription: nothing to modify, and
    // we must never create a duplicate subscription here.
    const t = await createTenant({ plan: "free", subscriptionStatus: "canceled" });

    const retrieve = vi.spyOn(stripe.subscriptions, "retrieve");

    const res = await request(app)
      .post("/subscription/change-plan")
      .set(authHeader(t.token))
      .send({ plan: "professional", currency: "EUR" });

    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("requires_checkout");
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("rejects a non-purchasable plan without touching Stripe", async () => {
    const t = await subscribedTenant("starter");
    const retrieve = vi.spyOn(stripe.subscriptions, "retrieve");

    const res = await request(app)
      .post("/subscription/change-plan")
      .set(authHeader(t.token))
      .send({ plan: "enterprise", currency: "EUR" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sales/i);
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("refuses an EMPLOYEE caller", async () => {
    const t = await subscribedTenant("starter");
    const { createEmployeeUser } = await import("./helpers/factories");
    const { token } = await createEmployeeUser(t.company.id, t.employee.id);

    const res = await request(app)
      .post("/subscription/change-plan")
      .set(authHeader(token))
      .send({ plan: "professional", currency: "EUR" });

    expect(res.status).toBe(403);
  });
});
