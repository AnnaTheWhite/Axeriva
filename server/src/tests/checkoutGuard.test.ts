import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import app from "../app";
import prisma from "../database/prisma";
import { stripe } from "../services/stripe/stripeClient";
import { authHeader, createTenant } from "./helpers/factories";

// POST /subscription/checkout — the Design C guards (docs/checkout-only-
// upgrades-ux.md §6):
//   AC1 — trialConsumedAt suppresses the Starter trial forever after.
//   AC3 — a not-closed Stripe subscription (live OR past_due) blocks Checkout
//         with 409; a canceled one passes (re-subscribe path), even though
//         the stale subscription id is kept on the row.
//   AC4 — a returning customer's Stripe-pinned currency wins over the
//         UI-language currency the frontend sends.

afterEach(() => {
  vi.restoreAllMocks();
});

function checkoutSessionFixture() {
  return { id: "cs_test_new", url: "https://checkout.stripe.com/c/test" };
}

describe("checkout duplicate guard (AC3)", () => {
  it("refuses with 409 while a live subscription exists", async () => {
    const t = await createTenant({ plan: "starter", subscriptionStatus: "active" });
    await prisma.company.update({
      where: { id: t.company.id },
      data: { stripeCustomerId: "cus_test_123", stripeSubscriptionId: "sub_test_123" },
    });
    const create = vi.spyOn(stripe.checkout.sessions, "create");

    const res = await request(app)
      .post("/subscription/checkout")
      .set(authHeader(t.token))
      .send({ plan: "professional", currency: "HUF" });

    expect(res.status).toBe(409);
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses with 409 while the subscription is past_due — the exact leak the plan review flagged", async () => {
    const t = await createTenant({ plan: "starter", subscriptionStatus: "past_due" });
    await prisma.company.update({
      where: { id: t.company.id },
      data: { stripeCustomerId: "cus_test_123", stripeSubscriptionId: "sub_test_123" },
    });
    const create = vi.spyOn(stripe.checkout.sessions, "create");

    const res = await request(app)
      .post("/subscription/checkout")
      .set(authHeader(t.token))
      .send({ plan: "starter", currency: "HUF" });

    expect(res.status).toBe(409);
    expect(create).not.toHaveBeenCalled();
  });

  it("lets a canceled company re-subscribe even though its old subscription id is kept", async () => {
    const t = await createTenant({ plan: "free", subscriptionStatus: "canceled" });
    await prisma.company.update({
      where: { id: t.company.id },
      data: {
        stripeCustomerId: "cus_test_123",
        stripeSubscriptionId: "sub_test_old",
        trialConsumedAt: new Date(),
      },
    });

    vi.spyOn(stripe.customers, "retrieve").mockResolvedValue({
      id: "cus_test_123",
      currency: "huf",
    } as never);
    vi.spyOn(stripe.checkout.sessions, "list").mockResolvedValue({ data: [] } as never);
    const create = vi
      .spyOn(stripe.checkout.sessions, "create")
      .mockResolvedValue(checkoutSessionFixture() as never);

    // AC4: the UI sends EUR (English interface), but the Stripe customer is
    // pinned to HUF — the HUF price must win or Stripe rejects the session.
    const res = await request(app)
      .post("/subscription/checkout")
      .set(authHeader(t.token))
      .send({ plan: "starter", currency: "EUR" });

    expect(res.status).toBe(200);
    const params = create.mock.calls[0][0]!;
    expect(params.line_items).toEqual([{ price: "price_test_starter_huf", quantity: 1 }]);
    // AC1: consumed trial → no second trial, card collected.
    expect(params.subscription_data?.trial_period_days).toBeUndefined();
    expect(params.payment_method_collection).toBeUndefined();
  });

  it("expires still-open Checkout sessions before creating a new one (AC3, first layer)", async () => {
    const t = await createTenant({ plan: "free", subscriptionStatus: "canceled" });
    await prisma.company.update({
      where: { id: t.company.id },
      data: {
        stripeCustomerId: "cus_test_123",
        stripeSubscriptionId: "sub_test_old",
        trialConsumedAt: new Date(),
      },
    });

    vi.spyOn(stripe.customers, "retrieve").mockResolvedValue({
      id: "cus_test_123",
      currency: "huf",
    } as never);
    vi.spyOn(stripe.checkout.sessions, "list").mockResolvedValue({
      data: [{ id: "cs_open_abandoned" }],
    } as never);
    const expire = vi
      .spyOn(stripe.checkout.sessions, "expire")
      .mockResolvedValue({ id: "cs_open_abandoned", status: "expired" } as never);
    const create = vi
      .spyOn(stripe.checkout.sessions, "create")
      .mockResolvedValue(checkoutSessionFixture() as never);

    const res = await request(app)
      .post("/subscription/checkout")
      .set(authHeader(t.token))
      .send({ plan: "starter", currency: "HUF" });

    expect(res.status).toBe(200);
    expect(expire).toHaveBeenCalledWith("cs_open_abandoned");
    // Old session expired BEFORE the new one is created.
    expect(expire.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0]);
  });

  it("recreates the Stripe customer when the stored one was deleted (self-healing)", async () => {
    const t = await createTenant({ plan: "free", subscriptionStatus: "canceled" });
    await prisma.company.update({
      where: { id: t.company.id },
      data: {
        stripeCustomerId: "cus_test_deleted",
        stripeSubscriptionId: "sub_test_old",
        trialConsumedAt: new Date(),
      },
    });

    vi.spyOn(stripe.customers, "retrieve").mockResolvedValue({
      id: "cus_test_deleted",
      object: "customer",
      deleted: true,
    } as never);
    const customerCreate = vi
      .spyOn(stripe.customers, "create")
      .mockResolvedValue({ id: "cus_test_new" } as never);
    const create = vi
      .spyOn(stripe.checkout.sessions, "create")
      .mockResolvedValue(checkoutSessionFixture() as never);

    const res = await request(app)
      .post("/subscription/checkout")
      .set(authHeader(t.token))
      .send({ plan: "starter", currency: "HUF" });

    expect(res.status).toBe(200);
    expect(customerCreate).toHaveBeenCalled();
    const params = create.mock.calls[0][0]!;
    expect(params.customer).toBe("cus_test_new");

    const after = await prisma.company.findUnique({ where: { id: t.company.id } });
    expect(after!.stripeCustomerId).toBe("cus_test_new");
  });
});

describe("trial suppression (AC1)", () => {
  it("omits trial_period_days once trialConsumedAt is set", async () => {
    // Expired registration trial: no Stripe objects at all yet.
    const t = await createTenant({
      plan: "starter",
      subscriptionStatus: "trialing",
      subscriptionEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    await prisma.company.update({
      where: { id: t.company.id },
      data: { trialConsumedAt: new Date() },
    });

    vi.spyOn(stripe.customers, "create").mockResolvedValue({ id: "cus_test_new" } as never);
    const create = vi
      .spyOn(stripe.checkout.sessions, "create")
      .mockResolvedValue(checkoutSessionFixture() as never);

    const res = await request(app)
      .post("/subscription/checkout")
      .set(authHeader(t.token))
      .send({ plan: "starter", currency: "HUF" });

    expect(res.status).toBe(200);
    const params = create.mock.calls[0][0]!;
    expect(params.subscription_data?.trial_period_days).toBeUndefined();
    expect(params.payment_method_collection).toBeUndefined();
  });

  it("still grants the Starter trial while trialConsumedAt is unset (pre-migration behavior)", async () => {
    const t = await createTenant({
      plan: "starter",
      subscriptionStatus: "inactive",
      subscriptionEndsAt: null,
    });

    vi.spyOn(stripe.customers, "create").mockResolvedValue({ id: "cus_test_new" } as never);
    const create = vi
      .spyOn(stripe.checkout.sessions, "create")
      .mockResolvedValue(checkoutSessionFixture() as never);

    const res = await request(app)
      .post("/subscription/checkout")
      .set(authHeader(t.token))
      .send({ plan: "starter", currency: "HUF" });

    expect(res.status).toBe(200);
    const params = create.mock.calls[0][0]!;
    expect(params.subscription_data?.trial_period_days).toBe(14);
    expect(params.payment_method_collection).toBe("if_required");
  });
});
