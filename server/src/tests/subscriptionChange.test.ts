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

// The hosted-confirmation session the upgrade path creates (Design C).
function flowSessionFixture() {
  return { id: "bps_test_123", url: "https://billing.stripe.com/session/test" };
}

describe("change-plan currency matching", () => {
  it("offers the Stripe-hosted confirmation in the SUBSCRIPTION's currency, not the requested one", async () => {
    // The regression case: subscribed in HUF, UI later switched to English so
    // the frontend sends EUR. Sending the EUR price to Stripe would 400.
    const t = await subscribedTenant("starter");

    vi.spyOn(stripe.subscriptions, "retrieve").mockResolvedValue(
      subscriptionFixture("huf", "price_test_starter_huf") as never
    );
    const update = vi.spyOn(stripe.subscriptions, "update");
    const flowCreate = vi
      .spyOn(stripe.billingPortal.sessions, "create")
      .mockResolvedValue(flowSessionFixture() as never);

    const res = await request(app)
      .post("/subscription/change-plan")
      .set(authHeader(t.token))
      .send({ plan: "professional", currency: "EUR" });

    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("requires_upgrade_confirmation");
    expect(res.body.url).toBe("https://billing.stripe.com/session/test");

    // Design C: the plan change itself must NEVER happen here — the customer
    // approves it on Stripe's hosted page.
    expect(update).not.toHaveBeenCalled();

    // The assertion that matters: the HUF price, matching the subscription.
    const params = flowCreate.mock.calls[0][0]!;
    expect(params.configuration).toBe("bpc_test_upgrade_flow");
    expect(params.flow_data).toMatchObject({
      type: "subscription_update_confirm",
      subscription_update_confirm: {
        subscription: "sub_test_123",
        items: [{ id: "si_test_123", price: "price_test_professional_huf", quantity: 1 }],
      },
    });
  });

  it("offers the confirmation in EUR when the subscription itself is EUR", async () => {
    const t = await subscribedTenant("starter");

    vi.spyOn(stripe.subscriptions, "retrieve").mockResolvedValue(
      subscriptionFixture("eur", "price_test_starter_eur") as never
    );
    const flowCreate = vi
      .spyOn(stripe.billingPortal.sessions, "create")
      .mockResolvedValue(flowSessionFixture() as never);

    const res = await request(app)
      .post("/subscription/change-plan")
      .set(authHeader(t.token))
      .send({ plan: "professional", currency: "EUR" });

    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("requires_upgrade_confirmation");
    const params = flowCreate.mock.calls[0][0]!;
    expect(params.flow_data).toMatchObject({
      subscription_update_confirm: {
        items: [{ id: "si_test_123", price: "price_test_professional_eur", quantity: 1 }],
      },
    });
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

  it("answers requires_checkout when the registration trial re-selects its own plan (AC2)", async () => {
    // Live DB-only trial: plan starter, status trialing, NO Stripe objects.
    // Design C lets the owner pay for Starter while the trial still runs —
    // before, this was a 400 "already the current plan".
    const t = await createTenant({ plan: "starter", subscriptionStatus: "trialing" });

    const res = await request(app)
      .post("/subscription/change-plan")
      .set(authHeader(t.token))
      .send({ plan: "starter", currency: "HUF" });

    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("requires_checkout");
  });

  it("blocks an upgrade while a cancellation is pending (AC11, two-step UX)", async () => {
    const t = await subscribedTenant("starter");
    await prisma.company.update({
      where: { id: t.company.id },
      data: { cancelAtPeriodEnd: true },
    });
    const flowCreate = vi.spyOn(stripe.billingPortal.sessions, "create");

    const res = await request(app)
      .post("/subscription/change-plan")
      .set(authHeader(t.token))
      .send({ plan: "professional", currency: "EUR" });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/resume/i);
    expect(flowCreate).not.toHaveBeenCalled();
  });

  it("blocks an upgrade while the subscription is past_due (AC12)", async () => {
    const t = await subscribedTenant("starter", "past_due");
    const flowCreate = vi.spyOn(stripe.billingPortal.sessions, "create");

    const res = await request(app)
      .post("/subscription/change-plan")
      .set(authHeader(t.token))
      .send({ plan: "professional", currency: "EUR" });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/overdue/i);
    expect(flowCreate).not.toHaveBeenCalled();
  });

  it("blocks a DOWNGRADE while the subscription is past_due (AC12)", async () => {
    const t = await subscribedTenant("business", "past_due");
    const retrieve = vi.spyOn(stripe.subscriptions, "retrieve");

    const res = await request(app)
      .post("/subscription/change-plan")
      .set(authHeader(t.token))
      .send({ plan: "professional", currency: "HUF" });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/overdue/i);
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("blocks a downgrade while a cancellation is pending (AC11 symmetry)", async () => {
    const t = await subscribedTenant("business");
    await prisma.company.update({
      where: { id: t.company.id },
      data: { cancelAtPeriodEnd: true },
    });
    const scheduleCreate = vi.spyOn(stripe.subscriptionSchedules, "create");

    const res = await request(app)
      .post("/subscription/change-plan")
      .set(authHeader(t.token))
      .send({ plan: "professional", currency: "HUF" });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/resume/i);
    expect(scheduleCreate).not.toHaveBeenCalled();
  });

  it("answers 409 (not requires_checkout) when the assigned plan is re-selected over an unpaid subscription", async () => {
    // The dead-end-loop fix: unpaid drops plan to "free" (effective starter),
    // the Starter card shows Subscribe, but /checkout would 409 on the kept
    // subscription id — change-plan must give the blocked-state answer
    // directly instead of bouncing the client to a refusing endpoint.
    const t = await subscribedTenant("free", "unpaid");

    const res = await request(app)
      .post("/subscription/change-plan")
      .set(authHeader(t.token))
      .send({ plan: "starter", currency: "HUF" });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/overdue/i);
  });

  it("RESTORES the released downgrade schedule when the flow-session creation fails", async () => {
    // Compensation path: the customer never reached the Stripe page, so a
    // failed upgrade ATTEMPT must not silently cancel their scheduled
    // downgrade.
    const t = await subscribedTenant("professional");
    await prisma.company.update({
      where: { id: t.company.id },
      data: { pendingPlan: "starter" },
    });

    vi.spyOn(stripe.subscriptions, "retrieve").mockResolvedValue({
      ...subscriptionFixture("huf", "price_test_professional_huf"),
      schedule: "sub_sched_pending",
    } as never);
    vi.spyOn(stripe.subscriptionSchedules, "release").mockResolvedValue({
      id: "sub_sched_pending",
    } as never);
    vi.spyOn(stripe.billingPortal.sessions, "create").mockRejectedValue(
      new Error("stripe is down")
    );
    const scheduleCreate = vi
      .spyOn(stripe.subscriptionSchedules, "create")
      .mockResolvedValue({
        id: "sub_sched_restored",
        phases: [{ start_date: Math.floor(Date.now() / 1000) }],
      } as never);
    const scheduleUpdate = vi
      .spyOn(stripe.subscriptionSchedules, "update")
      .mockResolvedValue({ id: "sub_sched_restored" } as never);

    const res = await request(app)
      .post("/subscription/change-plan")
      .set(authHeader(t.token))
      .send({ plan: "business", currency: "HUF" });

    // The original failure still surfaces as an error…
    expect(res.status).toBeGreaterThanOrEqual(500);

    // …but the downgrade schedule was re-created with the original target
    // price and the pendingPlan marker survived.
    expect(scheduleCreate).toHaveBeenCalledWith({ from_subscription: "sub_test_123" });
    const phases = scheduleUpdate.mock.calls[0][1]!.phases!;
    expect(phases[1].items![0].price).toBe("price_test_starter_huf");

    const after = await prisma.company.findUnique({ where: { id: t.company.id } });
    expect(after!.pendingPlan).toBe("starter");
  });

  it("releases a pending downgrade schedule BEFORE creating the flow session (AC13)", async () => {
    const t = await subscribedTenant("starter");
    await prisma.company.update({
      where: { id: t.company.id },
      data: { pendingPlan: "starter" },
    });

    vi.spyOn(stripe.subscriptions, "retrieve").mockResolvedValue({
      ...subscriptionFixture("huf", "price_test_starter_huf"),
      schedule: "sub_sched_pending",
    } as never);
    const release = vi
      .spyOn(stripe.subscriptionSchedules, "release")
      .mockResolvedValue({ id: "sub_sched_pending" } as never);
    const flowCreate = vi
      .spyOn(stripe.billingPortal.sessions, "create")
      .mockResolvedValue(flowSessionFixture() as never);

    const res = await request(app)
      .post("/subscription/change-plan")
      .set(authHeader(t.token))
      .send({ plan: "professional", currency: "HUF" });

    expect(res.status).toBe(200);
    expect(release).toHaveBeenCalledWith("sub_sched_pending");
    // Schedule released and marker cleared before the hosted page opens —
    // abandoning that page leaves the downgrade cancelled, never half-alive.
    expect(release.mock.invocationCallOrder[0]).toBeLessThan(
      flowCreate.mock.invocationCallOrder[0]
    );
    const after = await prisma.company.findUnique({ where: { id: t.company.id } });
    expect(after!.pendingPlan).toBeNull();
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
