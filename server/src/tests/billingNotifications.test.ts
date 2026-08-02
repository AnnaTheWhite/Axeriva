import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import Stripe from "stripe";
import app from "../app";
import prisma from "../database/prisma";
import { startQueue, stopQueue } from "../services/queue";
import { dispatchEvent } from "../services/notifications/dispatcher";
import { deliverEmail } from "../services/notifications/channels/email.channel";
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

const PERIOD_START = Math.floor(new Date("2026-09-01T00:00:00Z").getTime() / 1000);
const PERIOD_END = Math.floor(new Date("2026-10-01T00:00:00Z").getTime() / 1000);

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
    period_start: PERIOD_START,
    period_end: PERIOD_END,
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

describe("Slice 1 — formatting reaches the customer correctly", () => {
  it("formats the amount from Stripe minor units, in the company's language", async () => {
    await renewalTenant({ language: "hu" });

    await postWebhook(stripeEvent("invoice.paid", invoiceFixture()));

    const event = await prisma.notificationEvent.findFirst({
      where: { type: "billing.subscription_renewed" },
    });
    const context = JSON.parse(event!.context!);

    // 2500 minor units = 25,00 EUR — not 2500. The NBSP is what ICU emits.
    expect(context.amountFormatted).toBe("25,00 EUR");
    expect(context.planName).toBe("Professional");
    expect(context.periodStartFormatted).toBe("2026. szeptember 1.");
  });

  it("renders dates in the company's timezone, which can change the DAY", async () => {
    // period_end is 2026-10-01T00:00:00Z — which is already 02:00 on 1 October
    // in Budapest, but 31 August/September boundaries are where this bites. Use
    // a zone behind UTC so the date moves backwards.
    await renewalTenant({ language: "en", timezone: "America/New_York" });

    await postWebhook(stripeEvent("invoice.paid", invoiceFixture()));

    const event = await prisma.notificationEvent.findFirst({
      where: { type: "billing.subscription_renewed" },
    });
    const context = JSON.parse(event!.context!);

    // Midnight UTC on 1 October is 20:00 on 30 September in New York.
    expect(context.periodEndFormatted).toBe("30 September 2026");
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
