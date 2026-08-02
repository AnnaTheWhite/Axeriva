import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import Stripe from "stripe";
import app from "../app";
import prisma from "../database/prisma";
import { startQueue, stopQueue } from "../services/queue";
import { dispatchEvent } from "../services/notifications/dispatcher";
import { deliverEmail } from "../services/notifications/channels/email.channel";
import { emailService } from "../services/email";
import type { SubscriptionRenewedEmailPayload } from "../services/email/EmailService";
import { subscriptionRenewedEmailTemplate } from "../emails/templates/billing/SubscriptionRenewedEmail";
import { registerNotificationWorkers } from "../services/notifications/workers";
import { createCompany, createUser } from "./helpers/factories";
import { ROLES } from "../constants/roles";

// N1.8 Slice 1 — billing.subscription_renewed, end to end.
//
// THE POINT OF THIS FILE: every N1.x defect that reached "done" did so because
// a test validated a mocked path while the production path was broken —
// providerMessageId was read by a webhook test that hand-seeded it, and the
// write side simply did not exist. So at least one billing notification must be
// proved through the WHOLE path, with nothing stubbed between the signed Stripe
// payload and the sent email:
//
//   signed Stripe payload
//     -> the real /subscription/webhook route (real signature verification)
//       -> HANDLED_EVENTS replay protection
//         -> notify() outbox row
//           -> dispatchEvent fan-out
//             -> the real email channel and template render
//               -> dedupe verification on redelivery
//
// Nothing here mocks Stripe's verification, the notification pipeline, or the
// template. The only thing that is not real is the transport (MockEmailService,
// selected by RESEND_API_KEY="" in vitest.config.ts), which still returns a
// message id so the correlation column is exercised.

const WEBHOOK_SECRET = "whsec_axeriva_integration_suite";
const signer = new Stripe("sk_test_axeriva_integration_suite");

// THE INVOICE-LEVEL WINDOW — the cycle that just CLOSED. Stripe documents
// period_start/period_end as "the earliest/latest timestamp at which invoice
// items can be associated with this invoice", NOT the service period.
const ASSOCIATION_START = Math.floor(new Date("2026-09-01T00:00:00Z").getTime() / 1000);
const ASSOCIATION_END = Math.floor(new Date("2026-10-01T00:00:00Z").getTime() / 1000);

// THE SERVICE PERIOD — what the customer actually paid for, and what the
// receipt must show. Deliberately a DIFFERENT month from the association
// window: the first version of this fixture set the two to the same range, so
// a receipt built from the wrong field was indistinguishable from a correct
// one and the test asserted the developer's assumption rather than Stripe's
// semantics. One month apart is what makes the two fields tell them apart.
const SERVICE_START = Math.floor(new Date("2026-10-01T00:00:00Z").getTime() / 1000);
const SERVICE_END = Math.floor(new Date("2026-11-01T00:00:00Z").getTime() / 1000);

function invoiceFixture(overrides: Record<string, unknown> = {}) {
  // Shaped from the installed SDK's Invoice type, not from memory. Amounts are
  // MINOR UNITS exactly as Stripe sends them: 2500 = €25.00.
  return {
    id: "in_test_renewal_1",
    object: "invoice",
    customer: "cus_test_renewal",
    billing_reason: "subscription_cycle",
    amount_paid: 2500,
    currency: "eur",
    period_start: ASSOCIATION_START,
    period_end: ASSOCIATION_END,
    // Stripe puts the service period on the LINE ITEM. Omitting `lines` (as the
    // original fixture did) makes a handler reading the wrong field look
    // correct, because there is nothing to disagree with.
    lines: {
      object: "list",
      data: [
        {
          id: "il_test_1",
          object: "line_item",
          period: { start: SERVICE_START, end: SERVICE_END },
        },
      ],
    },
    hosted_invoice_url: "https://invoice.stripe.com/i/test",
    invoice_pdf: "https://invoice.stripe.com/i/test.pdf",
    ...overrides,
  };
}

function stripeEvent(type: string, object: Record<string, unknown>, id?: string) {
  return {
    id: id ?? `evt_${type}_1`,
    object: "event",
    type,
    data: { object },
  };
}

function postWebhook(event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  const header = signer.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });

  return request(app)
    .post("/subscription/webhook")
    .set("stripe-signature", header)
    .set("Content-Type", "application/json")
    .send(payload);
}

async function renewalTenant(overrides: { language?: string | null; timezone?: string | null } = {}) {
  const company = await createCompany();
  await prisma.company.update({
    where: { id: company.id },
    data: {
      stripeCustomerId: "cus_test_renewal",
      plan: "professional",
      language: overrides.language ?? "en",
      timezone: overrides.timezone ?? null,
    },
  });
  const owner = await createUser({ companyId: company.id, role: ROLES.BUSINESS_OWNER });
  // A second, NON-owner user in the same company. Without them, OWNER and
  // COMPANY_USERS resolve to the same single recipient and no assertion here
  // can tell the two apart — a mutation run proved exactly that: switching the
  // registry to COMPANY_USERS left the whole suite green. Q5 makes every
  // billing.* owner-only, so this employee existing is what gives that rule
  // teeth.
  const employee = await createUser({ companyId: company.id, role: ROLES.EMPLOYEE });
  return { company, owner, employee };
}

beforeAll(async () => {
  await startQueue();
  await registerNotificationWorkers();
}, 60_000);

afterAll(async () => {
  await stopQueue();
});

describe("Slice 1 — the complete path, nothing stubbed", () => {
  it("turns a signed invoice.paid into a sent renewal email", async () => {
    const { company, owner, employee } = await renewalTenant();

    const res = await postWebhook(stripeEvent("invoice.paid", invoiceFixture()));
    expect(res.status).toBe(200);

    // 1. The outbox row exists, with the invoice-keyed dedupeKey.
    const event = await prisma.notificationEvent.findFirst({
      where: { type: "billing.subscription_renewed" },
    });
    expect(event).not.toBeNull();
    expect(event!.dedupeKey).toBe("billing.subscription_renewed/in_test_renewal_1");
    expect(event!.companyId).toBe(company.id);

    // 2. Fan-out reaches the OWNER, on EMAIL only (a monthly receipt in the
    //    bell would be noise — the registry says EMAIL, and this proves it).
    await dispatchEvent(event!.id);
    const deliveries = await prisma.notificationDelivery.findMany({
      where: { eventId: event!.id },
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].channel).toBe("EMAIL");
    expect(deliveries[0].recipientAddress).toBe(owner.email);
    // Q5 — every billing.* is OWNER-ONLY. The company has an EMPLOYEE too, and
    // they must not appear anywhere in the fan-out: an employee learning what
    // the company pays is a data-exposure bug, not a preference.
    const addresses = deliveries.map((d) => d.recipientAddress);
    expect(addresses).not.toContain(employee.email);

    // 3. The real channel renders the real template and "sends".
    await deliverEmail(deliveries[0].id);
    const sent = await prisma.notificationDelivery.findUnique({
      where: { id: deliveries[0].id },
    });
    expect(sent!.status).toBe("sent");
    // The N1.6 correlation column, written by the production path rather than
    // seeded by this test — the exact thing that was broken for two milestones.
    expect(sent!.providerMessageId).toMatch(/^mock_/);
  });

  it("suppresses a Stripe redelivery at BOTH layers", async () => {
    await renewalTenant();

    const event = stripeEvent("invoice.paid", invoiceFixture());
    const first = await postWebhook(event);
    expect(first.status).toBe(200);
    expect(first.body.duplicate).toBeUndefined();

    // Layer 1 — HANDLED_EVENTS replay protection. invoice.paid is in the Set,
    // so the ledger short-circuits the redelivery before any handler runs.
    const second = await postWebhook(event);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);

    expect(
      await prisma.notificationEvent.count({ where: { type: "billing.subscription_renewed" } })
    ).toBe(1);
  });

  it("suppresses a DIFFERENT event about the same invoice — the dedupeKey layer", async () => {
    // Layer 2, and the reason the key is the INVOICE id rather than the event
    // id. Stripe can emit more than one event id for one invoice; keyed on the
    // event id, each would send its own receipt for a single payment.
    await renewalTenant();

    await postWebhook(stripeEvent("invoice.paid", invoiceFixture(), "evt_first"));
    await postWebhook(stripeEvent("invoice.paid", invoiceFixture(), "evt_second"));

    // Two distinct Stripe events, both got past the ledger...
    expect(await prisma.processedStripeEvent.count()).toBe(2);
    // ...and exactly one notification, because the invoice is the same.
    expect(
      await prisma.notificationEvent.count({ where: { type: "billing.subscription_renewed" } })
    ).toBe(1);
  });

  it("sends again for the NEXT invoice", async () => {
    // The other half of the dedupe contract: a genuinely new billing period
    // must not be suppressed.
    await renewalTenant();

    await postWebhook(stripeEvent("invoice.paid", invoiceFixture(), "evt_month_1"));
    await postWebhook(
      stripeEvent("invoice.paid", invoiceFixture({ id: "in_test_renewal_2" }), "evt_month_2")
    );

    expect(
      await prisma.notificationEvent.count({ where: { type: "billing.subscription_renewed" } })
    ).toBe(2);
  });
});

describe("Slice 1 — billing_reason routing (K1)", () => {
  it("does NOT send for the first payment of a new subscription", async () => {
    // subscription_create is the checkout flow's; sending here too would mean
    // the customer gets both "welcome" and "renewed" for one charge.
    await renewalTenant();

    const res = await postWebhook(
      stripeEvent("invoice.paid", invoiceFixture({ billing_reason: "subscription_create" }))
    );

    expect(res.status).toBe(200);
    expect(
      await prisma.notificationEvent.count({ where: { type: "billing.subscription_renewed" } })
    ).toBe(0);
    // Still recorded in the ledger, so a redelivery is not re-evaluated.
    expect(await prisma.processedStripeEvent.count()).toBe(1);
  });

  it("does NOT send for a mid-cycle plan-change invoice (Slice 2's)", async () => {
    await renewalTenant();

    await postWebhook(
      stripeEvent("invoice.paid", invoiceFixture({ billing_reason: "subscription_update" }))
    );

    expect(
      await prisma.notificationEvent.count({ where: { type: "billing.subscription_renewed" } })
    ).toBe(0);
  });
});

// Captures the payload the email channel hands the transport — i.e. what the
// customer would actually read, after per-recipient locale resolution.
async function deliveredPayload(): Promise<SubscriptionRenewedEmailPayload> {
  const event = (await prisma.notificationEvent.findFirst({
    where: { type: "billing.subscription_renewed" },
  }))!;
  await dispatchEvent(event.id);
  const delivery = (await prisma.notificationDelivery.findFirst({
    where: { eventId: event.id, channel: "EMAIL" },
  }))!;

  const spy = vi.spyOn(emailService, "sendSubscriptionRenewedEmail");
  try {
    await deliverEmail(delivery.id);
    expect(spy).toHaveBeenCalledTimes(1);
    return spy.mock.calls[0][1];
  } finally {
    spy.mockRestore();
  }
}

describe("Slice 1 — the receipt states the SERVICE period, not the association window", () => {
  it("takes the billing period from the line item", async () => {
    // P1. Stripe's invoice-level period_start/period_end is the invoice-item
    // ASSOCIATION window — the cycle that just closed. Building the receipt
    // from it told a customer billed in October that their billing period was
    // September: one cycle stale on the document they keep for accounting, and
    // a full year out on an annual plan.
    await renewalTenant({ language: "en" });
    await postWebhook(stripeEvent("invoice.paid", invoiceFixture()));

    const payload = await deliveredPayload();

    // The SERVICE period (October), not the association window (September).
    expect(payload.periodStartFormatted).toBe("1 October 2026");
    expect(payload.periodEndFormatted).toBe("1 November 2026");
  });

  it("falls back to the invoice window when there is no line item", async () => {
    // Defensive, and unreachable for subscription_cycle invoices — but a
    // receipt that cannot render is worse than one with a coarser period.
    await renewalTenant({ language: "en" });
    await postWebhook(
      stripeEvent("invoice.paid", invoiceFixture({ lines: { object: "list", data: [] } }))
    );

    const payload = await deliveredPayload();
    expect(payload.periodStartFormatted).toBe("1 September 2026");
  });
});

describe("Slice 1 — formatting follows the RECIPIENT, not the company", () => {
  it("formats money and dates in the recipient's own language", async () => {
    // P2, the locale split-brain. The owner reads Hungarian; the company is set
    // to English. Formatting used to happen in the trigger, which only knows
    // the COMPANY language — so the body rendered in Hungarian while the
    // amounts and dates stayed English. The context now carries raw values and
    // the channel formats with delivery.locale.
    const { owner } = await renewalTenant({ language: "en" });
    await prisma.user.update({ where: { id: owner.id }, data: { language: "hu" } });

    await postWebhook(stripeEvent("invoice.paid", invoiceFixture()));
    const payload = await deliveredPayload();

    // Hungarian conventions throughout — comma decimal, trailing currency code,
    // Hungarian month name. Under the old design these were "EUR 25.00" and
    // "1 October 2026" inside a Hungarian email.
    expect(payload.amountFormatted).toBe("25,00 EUR");
    expect(payload.periodStartFormatted).toBe("2026. október 1.");
  });

  it("keeps the company language when the recipient has no preference", async () => {
    await renewalTenant({ language: "hu" });

    await postWebhook(stripeEvent("invoice.paid", invoiceFixture()));
    const payload = await deliveredPayload();

    expect(payload.amountFormatted).toBe("25,00 EUR");
  });

  it("stores RAW values in the context, never rendered text", async () => {
    // The property that makes one event serve two owners in two languages. If
    // the trigger ever formats again, this fails.
    await renewalTenant({ language: "en" });
    await postWebhook(stripeEvent("invoice.paid", invoiceFixture()));

    const event = await prisma.notificationEvent.findFirst({
      where: { type: "billing.subscription_renewed" },
    });
    const context = JSON.parse(event!.context!);

    expect(context.amountMinor).toBe(2500);
    expect(context.currency).toBe("eur");
    expect(context.periodStartAt).toBe(SERVICE_START);
    expect(context).not.toHaveProperty("amountFormatted");
    expect(context).not.toHaveProperty("periodStartFormatted");
  });

  it("converts Stripe minor units — 2500 is 25 euro, not 2500", async () => {
    await renewalTenant({ language: "en" });
    await postWebhook(stripeEvent("invoice.paid", invoiceFixture()));

    const payload = await deliveredPayload();
    expect(payload.amountFormatted).toBe("€25.00");
    expect(payload.planName).toBe("Professional");
  });

  it("renders dates in the company's timezone, which can change the DAY", async () => {
    // The service period ends midnight UTC on 1 November — 20:00 on 31 October
    // in New York.
    await renewalTenant({ language: "en", timezone: "America/New_York" });

    await postWebhook(stripeEvent("invoice.paid", invoiceFixture()));
    const payload = await deliveredPayload();

    expect(payload.periodEndFormatted).toBe("31 October 2026");
  });
});

describe("Slice 1 — no renewal notice for a dead subscription", () => {
  it("stays silent when the subscription is no longer active", async () => {
    // P3. A dunning-exhausted subscription is cancelled, but its invoice stays
    // open and payable from the hosted link. Paying it later resurrects
    // nothing — yet Stripe still emits invoice.paid with billing_reason
    // subscription_cycle. Without this check the customer received "Acme is on
    // the free plan for another billing period": the renewal claim false, and
    // the plan name the literal string the cancellation path writes.
    const { company } = await renewalTenant();
    await prisma.company.update({
      where: { id: company.id },
      data: { subscriptionStatus: "canceled", plan: "free" },
    });

    const res = await postWebhook(stripeEvent("invoice.paid", invoiceFixture()));

    expect(res.status).toBe(200);
    expect(
      await prisma.notificationEvent.count({ where: { type: "billing.subscription_renewed" } })
    ).toBe(0);
    // Still ledgered, so Stripe does not retry it forever.
    expect(await prisma.processedStripeEvent.count()).toBe(1);
  });

  it("still sends for past_due — a failed renewal is a LIVE subscription", async () => {
    // ACTIVE_SUBSCRIPTION_STATUSES includes past_due deliberately, and this
    // branch only runs for a PAID invoice: the payment that clears the arrears
    // must still be acknowledged.
    const { company } = await renewalTenant();
    await prisma.company.update({
      where: { id: company.id },
      data: { subscriptionStatus: "past_due" },
    });

    await postWebhook(stripeEvent("invoice.paid", invoiceFixture()));

    expect(
      await prisma.notificationEvent.count({ where: { type: "billing.subscription_renewed" } })
    ).toBe(1);
  });
});

describe("Slice 1 — the invoice link is optional", () => {
  it("renders the receipt with no CTA when Stripe supplied no hosted URL", async () => {
    await renewalTenant({ language: "en" });
    await postWebhook(stripeEvent("invoice.paid", invoiceFixture({ hosted_invoice_url: null })));

    const payload = await deliveredPayload();
    expect(payload.invoiceUrl).toBeNull();

    // And the template survives it — no dead button, no broken markup.
    const rendered = await subscriptionRenewedEmailTemplate({ ...payload, locale: "en" });
    expect(rendered.html).not.toContain('href=""');
    expect(rendered.html).toContain("25.00");
  });

  it("treats an empty-string URL as absent", async () => {
    await renewalTenant({ language: "en" });
    await postWebhook(stripeEvent("invoice.paid", invoiceFixture({ hosted_invoice_url: "" })));

    const payload = await deliveredPayload();
    expect(payload.invoiceUrl).toBeNull();
  });
});


describe("Slice 1 — an invoice we cannot place", () => {
  it("acknowledges and drops an unknown Stripe customer", async () => {
    // No company carries this customer id. Not our invoice; 2xx and drop, so
    // Stripe does not retry forever.
    const res = await postWebhook(
      stripeEvent("invoice.paid", invoiceFixture({ customer: "cus_not_ours" }))
    );

    expect(res.status).toBe(200);
    expect(await prisma.notificationEvent.count()).toBe(0);
  });
});
