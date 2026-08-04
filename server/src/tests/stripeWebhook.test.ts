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

// The updated handler re-retrieves the subscription's CURRENT state from
// Stripe instead of trusting the event's snapshot (ordering guard) — every
// updated-event test therefore mocks subscriptions.retrieve with the state
// the test wants Stripe to report "now".
function mockFreshSubscription(fixture: Record<string, unknown>) {
  return vi.spyOn(stripe.subscriptions, "retrieve").mockResolvedValue(fixture as never);
}

describe("customer.subscription.updated", () => {
  it("writes status, period end and Stripe ids onto the company", async () => {
    const company = await createCompany({ plan: "starter", subscriptionStatus: "inactive" });
    const fixture = subscriptionFixture({ metadata: { companyId: String(company.id) } });
    mockFreshSubscription(fixture);

    const res = await postWebhook(event("customer.subscription.updated", fixture));

    expect(res.status).toBe(200);

    const after = await prisma.company.findUnique({ where: { id: company.id } });
    expect(after!.subscriptionStatus).toBe("active");
    expect(after!.stripeSubscriptionId).toBe("sub_test_123");
    expect(after!.subscriptionEndsAt!.getTime()).toBe(PERIOD_END * 1000);
    expect(after!.cancelAtPeriodEnd).toBe(false);
  });

  it("applies the subscription's FRESH state, not the event's snapshot (ordering guard)", async () => {
    // A delayed old-price snapshot must not revert a just-confirmed upgrade:
    // the handler re-retrieves, and what Stripe reports NOW wins.
    const company = await createCompany({ plan: "professional", subscriptionStatus: "active" });
    mockFreshSubscription(
      subscriptionFixture({
        metadata: { companyId: String(company.id) },
        items: {
          object: "list",
          data: [
            {
              id: "si_test_123",
              price: { id: "price_test_professional_huf" },
              current_period_end: PERIOD_END,
            },
          ],
        },
      })
    );

    // Stale snapshot still carrying the old starter price.
    await postWebhook(
      event(
        "customer.subscription.updated",
        subscriptionFixture({
          metadata: { companyId: String(company.id) },
          items: {
            object: "list",
            data: [
              {
                id: "si_test_123",
                price: { id: "price_test_starter_huf" },
                current_period_end: PERIOD_END,
              },
            ],
          },
        })
      )
    );

    const after = await prisma.company.findUnique({ where: { id: company.id } });
    expect(after!.plan).toBe("professional");
  });

  it("resolves the company by stripeCustomerId when metadata carries no id", async () => {
    const company = await createCompany({ subscriptionStatus: "inactive" });
    await prisma.company.update({
      where: { id: company.id },
      data: { stripeCustomerId: "cus_test_123" },
    });
    mockFreshSubscription(subscriptionFixture());

    await postWebhook(event("customer.subscription.updated", subscriptionFixture()));

    const after = await prisma.company.findUnique({ where: { id: company.id } });
    expect(after!.subscriptionStatus).toBe("active");
  });

  it("records trialConsumedAt when a Stripe-side trial materializes (AC1 hardening)", async () => {
    const company = await createCompany({ plan: "starter", subscriptionStatus: "inactive" });
    const fixture = subscriptionFixture({
      status: "trialing",
      metadata: { companyId: String(company.id) },
    });
    mockFreshSubscription(fixture);

    await postWebhook(event("customer.subscription.updated", fixture));

    const after = await prisma.company.findUnique({ where: { id: company.id } });
    expect(after!.subscriptionStatus).toBe("trialing");
    expect(after!.trialConsumedAt).not.toBeNull();
  });

  it("KEEPS the paid plan when the subscription goes past_due (grace, AC17)", async () => {
    // Design C: past_due is Stripe's dunning window — dropping the plan to
    // "free" here would lock the whole company read-only over one bounced
    // charge. The plan (and write access) survive until Stripe gives up
    // (canceled/unpaid).
    const company = await createCompany({ plan: "professional", subscriptionStatus: "active" });
    const fixture = subscriptionFixture({
      status: "past_due",
      metadata: { companyId: String(company.id) },
    });
    mockFreshSubscription(fixture);

    await postWebhook(event("customer.subscription.updated", fixture));

    const after = await prisma.company.findUnique({ where: { id: company.id } });
    expect(after!.subscriptionStatus).toBe("past_due");
    expect(after!.plan).toBe("professional");
  });

  it("still drops the paid plan when the subscription goes unpaid", async () => {
    const company = await createCompany({ plan: "professional", subscriptionStatus: "past_due" });
    const fixture = subscriptionFixture({
      status: "unpaid",
      metadata: { companyId: String(company.id) },
    });
    mockFreshSubscription(fixture);

    await postWebhook(event("customer.subscription.updated", fixture));

    const after = await prisma.company.findUnique({ where: { id: company.id } });
    expect(after!.subscriptionStatus).toBe("unpaid");
    expect(after!.plan).toBe("free");
  });

  it("ignores a dead update for a subscription the company no longer holds (stale-event guard)", async () => {
    // The old subscription's terminal events can arrive AFTER the customer
    // already re-subscribed — they must never overwrite the live one. The
    // re-retrieve confirms the old subscription is dead NOW.
    const company = await createCompany({ plan: "professional", subscriptionStatus: "active" });
    await prisma.company.update({
      where: { id: company.id },
      data: { stripeSubscriptionId: "sub_current_999" },
    });
    const fixture = subscriptionFixture({
      status: "canceled",
      metadata: { companyId: String(company.id) },
    });
    mockFreshSubscription(fixture);

    await postWebhook(event("customer.subscription.updated", fixture));

    const after = await prisma.company.findUnique({ where: { id: company.id } });
    expect(after!.subscriptionStatus).toBe("active");
    expect(after!.plan).toBe("professional");
    expect(after!.stripeSubscriptionId).toBe("sub_current_999");
  });

  it("drops a redelivered snapshot whose subscription Stripe now reports dead — even if the payload says active", async () => {
    // The Scenario-A corruption from the review: a failed-then-redelivered
    // 'active' event for OLD subscription A arriving after the company moved
    // to B. The payload says active; the re-retrieve says canceled → skipped.
    const company = await createCompany({ plan: "professional", subscriptionStatus: "active" });
    await prisma.company.update({
      where: { id: company.id },
      data: { stripeSubscriptionId: "sub_current_999" },
    });
    mockFreshSubscription(
      subscriptionFixture({
        status: "canceled",
        metadata: { companyId: String(company.id) },
      })
    );

    await postWebhook(
      event(
        "customer.subscription.updated",
        subscriptionFixture({
          status: "active",
          metadata: { companyId: String(company.id) },
        })
      )
    );

    const after = await prisma.company.findUnique({ where: { id: company.id } });
    expect(after!.stripeSubscriptionId).toBe("sub_current_999");
    expect(after!.plan).toBe("professional");
  });

  it("skips a redelivered event id entirely (idempotency, AC16)", async () => {
    const company = await createCompany({ plan: "starter", subscriptionStatus: "inactive" });
    const fixture = subscriptionFixture({ metadata: { companyId: String(company.id) } });
    mockFreshSubscription(fixture);
    const original = event("customer.subscription.updated", fixture);

    const first = await postWebhook(original);
    expect(first.status).toBe(200);

    // A redelivery reuses the event id — even if the payload were tampered
    // into something destructive, the ledger skips it before any handler.
    const redelivered = {
      ...original,
      data: {
        object: subscriptionFixture({
          status: "canceled",
          metadata: { companyId: String(company.id) },
        }),
      },
    };
    const second = await postWebhook(redelivered);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);

    const after = await prisma.company.findUnique({ where: { id: company.id } });
    expect(after!.subscriptionStatus).toBe("active");
  });

  it("mirrors cancel_at_period_end", async () => {
    const company = await createCompany();
    const fixture = subscriptionFixture({
      cancel_at_period_end: true,
      metadata: { companyId: String(company.id) },
    });
    mockFreshSubscription(fixture);

    await postWebhook(event("customer.subscription.updated", fixture));

    const after = await prisma.company.findUnique({ where: { id: company.id } });
    expect(after!.cancelAtPeriodEnd).toBe(true);
  });

  it("NEVER overwrites a manually managed plan (founder)", async () => {
    const company = await createCompany({ plan: "founder", subscriptionStatus: "active" });
    const fixture = subscriptionFixture({
      status: "canceled",
      metadata: { companyId: String(company.id) },
    });
    mockFreshSubscription(fixture);

    await postWebhook(event("customer.subscription.updated", fixture));

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

  it("ignores subscription.deleted for a stale subscription id (id-aware, AC15)", async () => {
    // A late deleted event for the OLD subscription (already replaced through
    // a fresh Checkout) must not drop a live company to free/canceled.
    const company = await createCompany({ plan: "professional", subscriptionStatus: "active" });
    await prisma.company.update({
      where: { id: company.id },
      data: { stripeSubscriptionId: "sub_current_999" },
    });

    await postWebhook(
      event(
        "customer.subscription.deleted",
        subscriptionFixture({
          status: "canceled",
          metadata: { companyId: String(company.id) },
        })
      )
    );

    const after = await prisma.company.findUnique({ where: { id: company.id } });
    expect(after!.plan).toBe("professional");
    expect(after!.subscriptionStatus).toBe("active");
    expect(after!.stripeSubscriptionId).toBe("sub_current_999");
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

  it("cancels a duplicate subscription completed NEXT TO an existing open one (AC3, second layer)", async () => {
    // A still-open session completing after another subscription already
    // exists is the only way a duplicate can materialize — reconciliation
    // cancels the incoming one and keeps the company on its current state.
    const tenant = await createTenant({ plan: "professional", subscriptionStatus: "active" });
    await prisma.company.update({
      where: { id: tenant.company.id },
      data: { stripeSubscriptionId: "sub_current_999", stripeCustomerId: "cus_test_123" },
    });

    vi.spyOn(stripe.subscriptions, "retrieve").mockResolvedValue(
      subscriptionFixture({ latest_invoice: "in_test_duplicate" }) as never
    );
    const cancel = vi
      .spyOn(stripe.subscriptions, "cancel")
      .mockResolvedValue(subscriptionFixture({ status: "canceled" }) as never);
    vi.spyOn(stripe.invoices, "retrieve").mockResolvedValue({
      id: "in_test_duplicate",
      object: "invoice",
      payments: {
        object: "list",
        data: [
          {
            id: "inpay_test_1",
            payment: { type: "payment_intent", payment_intent: "pi_test_duplicate" },
          },
        ],
      },
    } as never);

    const res = await postWebhook(
      event("checkout.session.completed", {
        id: "cs_test_duplicate",
        object: "checkout.session",
        customer: "cus_test_123",
        subscription: "sub_test_123",
        metadata: { companyId: String(tenant.company.id) },
      })
    );

    expect(res.status).toBe(200);
    expect(cancel).toHaveBeenCalledWith("sub_test_123");

    const after = await prisma.company.findUnique({ where: { id: tenant.company.id } });
    expect(after!.stripeSubscriptionId).toBe("sub_current_999");
    expect(after!.plan).toBe("professional");
    expect(after!.subscriptionStatus).toBe("active");

    // Refund breadcrumbs: the audit entry carries every id a one-click
    // Dashboard refund needs (no automated refunds.create — deliberate).
    const audit = await prisma.auditLog.findFirst({
      where: { companyId: tenant.company.id },
      orderBy: { id: "desc" },
    });
    const metadata = JSON.parse(audit!.metadata!) as Record<string, unknown>;
    expect(metadata.manualRefundRequired).toBe(true);
    expect(metadata.duplicateSubscriptionCanceled).toBe("sub_test_123");
    expect(metadata.keptSubscription).toBe("sub_current_999");
    expect(metadata.stripeCustomerId).toBe("cus_test_123");
    expect(metadata.invoiceId).toBe("in_test_duplicate");
    expect(metadata.paymentIntentId).toBe("pi_test_duplicate");
  });

  it("answers a Stripe failure with a non-2xx and NO stack in the body (B4)", async () => {
    // The subscriptions.retrieve inside the handler sits outside the
    // signature try/catch, so an SDK failure propagates to the error
    // middleware. Two properties matter: the status must be non-2xx so
    // Stripe retries with backoff (the self-healing path), and the body
    // must never carry a stack — before B4 the dev-mode global handler
    // leaked err.stack into Stripe's webhook delivery log.
    const tenant = await createTenant({ plan: "starter", subscriptionStatus: "inactive" });

    vi.spyOn(stripe.subscriptions, "retrieve").mockRejectedValue(
      new Stripe.errors.StripeAPIError({
        message: "Stripe is down",
        statusCode: 500,
      })
    );

    const res = await postWebhook(
      event("checkout.session.completed", {
        id: "cs_test_123",
        object: "checkout.session",
        customer: "cus_test_123",
        subscription: "sub_test_123",
        metadata: { companyId: String(tenant.company.id) },
      })
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.stack).toBeUndefined();
    expect(res.body.error).not.toContain("at "); // no stack fragments either
  });
});

describe("unhandled events", () => {
  it("acknowledges an event type it does not handle without touching data", async () => {
    // N1.8 Slice 3 repointed this from `invoice.payment_failed`, which is now
    // HANDLED. Left alone it would still have passed — the old fixture has no
    // `parent`, so the new handler's scope filter drops it — while proving
    // nothing about unhandled events and quietly writing a
    // ProcessedStripeEvent row it never asserted on. A test that survives the
    // deletion of the thing it tested is the exact failure class this
    // milestone keeps finding, so it is repointed rather than left green.
    //
    // `charge.refunded` is genuinely unhandled: absent from both the switch
    // and HANDLED_EVENTS, so it takes the `default:` branch.
    const company = await createCompany({ plan: "starter", subscriptionStatus: "trialing" });

    const res = await postWebhook(
      event("charge.refunded", {
        id: "ch_test_123",
        object: "charge",
        customer: "cus_test_123",
        metadata: { companyId: String(company.id) },
      })
    );

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    const after = await prisma.company.findUnique({ where: { id: company.id } });
    expect(after!.plan).toBe("starter");
    expect(after!.subscriptionStatus).toBe("trialing");

    // The property that actually distinguishes "unhandled" from "handled and
    // dropped": only types in HANDLED_EVENTS are ledgered. Without this the
    // test passes for a handled event that merely declines to act, which is
    // precisely how it survived Slice 3 pointing at invoice.payment_failed.
    expect(await prisma.processedStripeEvent.count()).toBe(0);
  });
});
