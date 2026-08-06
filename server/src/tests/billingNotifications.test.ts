import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import Stripe from "stripe";
import app from "../app";
import prisma from "../database/prisma";
import { startQueue, stopQueue } from "../services/queue";
import { dispatchEvent } from "../services/notifications/dispatcher";
import { deliverEmail } from "../services/notifications/channels/email.channel";
import { emailService } from "../services/email";
import type {
  InvoiceReceiptEmailPayload,
  PaymentFailureEmailPayload,
  UpcomingRenewalEmailPayload,
} from "../services/email/EmailService";
import { subscriptionRenewedEmailTemplate } from "../emails/templates/billing/SubscriptionRenewedEmail";
import { invoicePaidEmailTemplate } from "../emails/templates/billing/InvoicePaidEmail";
import { invoiceFailedEmailTemplate } from "../emails/templates/billing/InvoiceFailedEmail";
import { registerNotificationWorkers } from "../services/notifications/workers";
import { createCompany, createUser } from "./helpers/factories";
import { priceIdFor } from "../config/stripePricing";
import { ROLES } from "../constants/roles";

// N1.8 Slices 1-2 — the two invoice receipts, end to end.
//
//   billing.subscription_renewed  ← invoice.paid, subscription_cycle
//   billing.invoice_paid          ← invoice.paid, subscription_update
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
//             -> the real email channel (recipient locale, formatting)
//               -> dedupe verification on redelivery
//
// Nothing here mocks Stripe's verification or the notification pipeline. The
// one thing that is not real is the TRANSPORT (MockEmailService, selected by
// RESEND_API_KEY="" in vitest.config.ts), which still returns a message id so
// the correlation column is exercised.
//
// ⚠️ WHAT THAT COSTS, stated because an earlier version of this comment claimed
// the chain rendered "the real template" and it does not: MockEmailService is a
// logger and renders nothing, so the leg from a transport method to the template
// it calls is NOT exercised here. Tests below render the templates directly to
// check their output, and emailTemplates.test.ts pins the method → template
// binding on the real ResendEmailService. Slice 2 made that binding worth
// pinning: unifying the two receipts onto one payload type removed the
// type-level protection that used to make a wrong-template call fail to compile.

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

// A ONE-OFF LINE the support team added mid-cycle — a routine Dashboard
// action. Stripe sorts pending invoice items BEFORE subscription items
// (Invoices.d.ts:322), so this line is index 0 on the real payload, and its
// period is a different, narrower window than the service period.
//
// ⚠️ It is a CHARGE with a LARGER amount than the subscription line, and both
// halves of that are load-bearing. Slice 2 selects among subscription lines by
// amount, so a rival line with no amount at all (undefined loses every
// comparison) or with a smaller one cannot win even if the code stopped
// filtering by line TYPE — which is exactly what happened: the
// "type filter removed" mutation SURVIVED a full run against fixtures whose
// support line had no amount, and the filter looked redundant when it is not.
// A real onboarding fee or extra-seat charge does have an amount, and it can
// exceed a part-month proration.
const SUPPORT_CHARGE_MINOR = 5000;
const CREDIT_START = Math.floor(new Date("2026-09-14T00:00:00Z").getTime() / 1000);
const CREDIT_END = Math.floor(new Date("2026-09-15T00:00:00Z").getTime() / 1000);

// N1.8 Slice 2 — THE PRORATION WINDOW: from the moment of a mid-cycle plan
// change to the end of the CURRENT cycle. A part month, and deliberately equal
// to none of the three windows above: a plan-change receipt that reported the
// association window (September), the support charge's window (14-15
// September) or a whole cycle (1 October - 1 November) is then a test failure
// rather than a plausible-looking date nobody checks.
const PRORATION_START = Math.floor(new Date("2026-10-15T00:00:00Z").getTime() / 1000);
const PRORATION_END = Math.floor(new Date("2026-11-01T00:00:00Z").getTime() / 1000);

function invoiceFixture(overrides: Record<string, unknown> = {}) {
  // Shaped from the installed SDK's Invoice type, not from memory. Amounts are
  // MINOR UNITS exactly as Stripe sends them: 2500 = €25.00.
  return {
    id: "in_test_renewal_1",
    object: "invoice",
    customer: "cus_test_billing",
    billing_reason: "subscription_cycle",
    amount_paid: 2500,
    currency: "eur",
    period_start: ASSOCIATION_START,
    period_end: ASSOCIATION_END,
    // Stripe puts the service period on the LINE ITEM, and the SUBSCRIPTION
    // line is deliberately NOT index 0 here.
    //
    // Two earlier versions of this fixture could not detect a wrong
    // implementation. The first omitted `lines` entirely, so reading
    // invoice.period_start looked correct. The second had a single line, so
    // "the first line" and "the subscription line" were the same thing and a
    // handler taking data[0] passed. Stripe sorts pending invoice items ahead
    // of subscription items (Invoices.d.ts:322), so a real invoice with a
    // support charge on it looks like this — and only this shape makes the
    // distinction observable.
    lines: {
      object: "list",
      data: [
        {
          id: "il_test_support_charge",
          object: "line_item",
          amount: SUPPORT_CHARGE_MINOR,
          period: { start: CREDIT_START, end: CREDIT_END },
          parent: { type: "invoice_item_details", invoice_item_details: {} },
        },
        // Carries a real PRICE, because Slice 2 made the plan name come from
        // this line rather than from Company.plan — for the renewal receipt
        // too. Without pricing here, invoicePlanId() returns null on every
        // renewal, the `?? company.plan` fallback answers instead, and the new
        // path would be shipped for Slice 1 completely unexercised.
        {
          id: "il_test_subscription",
          object: "line_item",
          amount: 2500,
          period: { start: SERVICE_START, end: SERVICE_END },
          pricing: {
            type: "price_details",
            price_details: {
              price: priceIdFor("professional", "eur"),
              product: "prod_professional",
            },
          },
          parent: {
            type: "subscription_item_details",
            subscription_item_details: { proration: false, subscription_item: "si_test" },
          },
        },
      ],
    },
    hosted_invoice_url: "https://invoice.stripe.com/i/test",
    invoice_pdf: "https://invoice.stripe.com/i/test.pdf",
    ...overrides,
  };
}

// N1.8 Slice 2 — a real subscription_update invoice, built ON TOP of the
// renewal fixture so the two cannot drift in anything but what actually
// differs.
//
// The customer approved an upgrade on Stripe's hosted confirmation page, whose
// portal configuration prorates with always_invoice. Stripe then issues TWO
// proration lines — a credit for the unused time on the old plan and a charge
// for the new plan's remaining time — and BOTH are subscription lines, so this
// invoice has no non-proration line at all. That is the shape that makes the
// trigger take the fallback branch of its line selection, which is why the
// support charge is left sitting at index 0: Stripe's ordering does not change
// with billing_reason, and a handler reaching for data[0] would report 14-15
// September on an October plan change.
//
// The invoice-level period_start/period_end stay at the ASSOCIATION window
// inherited from the renewal fixture, so a handler reading those instead of the
// line period is caught too.
function planChangeInvoiceFixture(overrides: Record<string, unknown> = {}) {
  return invoiceFixture({
    id: "in_test_planchange_1",
    billing_reason: "subscription_update",
    // A part-cycle proration, not a full month's price — and not a round
    // number of euro, so a missing divide-by-100 cannot coincidentally read
    // like a plausible amount.
    amount_paid: 1250,
    lines: {
      object: "list",
      data: [
        // Larger than the plan-change charge below, so it WINS any selection
        // that stops filtering by line type. See SUPPORT_CHARGE_MINOR.
        {
          id: "il_test_support_charge",
          object: "line_item",
          amount: SUPPORT_CHARGE_MINOR,
          period: { start: CREDIT_START, end: CREDIT_END },
          parent: { type: "invoice_item_details", invoice_item_details: {} },
        },
        // The credit for the unused time on the OLD plan. Negative amount, old
        // price — and listed FIRST, because Stripe's ordering between two
        // prorations created in the same instant is not something to rely on
        // and a handler taking the first one must fail here.
        {
          id: "il_test_old_plan_credit",
          object: "line_item",
          amount: -1500,
          period: { start: PRORATION_START, end: PRORATION_END },
          pricing: {
            type: "price_details",
            price_details: { price: priceIdFor("starter", "eur"), product: "prod_starter" },
          },
          parent: {
            type: "subscription_item_details",
            subscription_item_details: { proration: true, subscription_item: "si_test" },
          },
        },
        // The charge for the remaining time on the NEW plan. This is the line
        // the receipt is about: its price names the plan the customer is now
        // on, and its amount is what they were charged.
        {
          id: "il_test_new_plan_charge",
          object: "line_item",
          amount: 2750,
          period: { start: PRORATION_START, end: PRORATION_END },
          pricing: {
            type: "price_details",
            price_details: {
              price: priceIdFor("professional", "eur"),
              product: "prod_professional",
            },
          },
          parent: {
            type: "subscription_item_details",
            subscription_item_details: { proration: true, subscription_item: "si_test" },
          },
        },
      ],
    },
    ...overrides,
  });
}

// N1.8 Slice 3 — a FAILED subscription payment.
//
// Shaped to be droppable in every way the handler must drop, so each guard has
// a fixture that can prove it: `parent.type` and `collection_method` are the
// scope filter's two halves, `amount_remaining` is the zero refusal's, and
// `next_payment_attempt` is the branch that decides how urgent the copy is.
//
// amount_due and amount_remaining DELIBERATELY DIFFER. Slice 3 reports what is
// still outstanding, not what was billed; with the two equal, a handler reading
// either field would look correct.
// Early in the UTC day ON PURPOSE: 03:00Z on 18 October is still 17 October in
// Los Angeles (UTC-7 in October), which is what lets the timezone test below
// prove the zone reaches the formatter. At 09:00Z both zones say the 18th and
// that test would pass against code that ignored Company.timezone entirely.
const NEXT_ATTEMPT_AT = Math.floor(new Date("2026-10-18T03:00:00Z").getTime() / 1000);

function failedInvoiceFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "in_test_failed_1",
    object: "invoice",
    customer: "cus_test_billing",
    billing_reason: "subscription_cycle",
    collection_method: "charge_automatically",
    currency: "eur",
    // 5999 due, 1000 already settled -> 4999 is the money that failed. The
    // three MUST satisfy Stripe's own invariant (amount_remaining = amount_due
    // - amount_paid, Invoices.d.ts:163-166): an impossible fixture is a licence
    // for the handler to be wrong in a way no real payload would reveal.
    amount_due: 5999,
    amount_paid: 1000,
    amount_remaining: 4999,
    attempt_count: 1,
    next_payment_attempt: NEXT_ATTEMPT_AT,
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: "sub_test_billing" },
    },
    ...overrides,
  };
}

// N1.8 Slice 4 — an UPCOMING invoice preview.
//
// TIMESTAMPS ARE DERIVED FROM THE CLOCK, not hardcoded like every fixture above.
// Slice 4 refuses to announce a renewal that has already passed, so a fixed 2026
// date would turn this whole block green-then-red the moment real time crossed
// it — a time bomb, and the staleness gate would stop being tested long before
// anyone noticed.
const DAY_SECONDS = 24 * 60 * 60;
const nowSeconds = () => Math.floor(Date.now() / 1000);

// FOUR MUTUALLY DISTINCT INSTANTS, because there are four plausible fields a
// handler could read and only one is right. Slice 1's constants are deliberately
// NOT reused: there ASSOCIATION_END equals SERVICE_START, which would make the
// invoice-level window and the cycle line's start indistinguishable — exactly
// the coincidence that let Slice 1's off-by-one-cycle bug ship.
const RENEWS_AT = nowSeconds() + 7 * DAY_SECONDS; // the ONE right answer
const CYCLE_END = RENEWS_AT + 30 * DAY_SECONDS; // one whole cycle late
const ASSOC_START = RENEWS_AT - 30 * DAY_SECONDS; // a date already past
const ASSOC_END = RENEWS_AT - DAY_SECONDS; // the Slice 1 trap, near but wrong
// Mid-cycle and GENUINELY IN THE PAST. RENEWS_AT is only 7 days out, so
// "RENEWS_AT - 3 days" would have been 4 days in the FUTURE — which still
// satisfies the staleness gate, so a handler that wrongly picked the proration
// line would have produced a plausible future date and sailed through. Anchored
// to the clock instead of to RENEWS_AT so it cannot drift back into the future.
const UPCOMING_PRORATION_START = nowSeconds() - 10 * DAY_SECONDS;

function upcomingInvoiceFixture(overrides: Record<string, unknown> = {}) {
  return {
    // NO `id`. Stripe does not send one for this event (Events.d.ts:1554) even
    // though the SDK types it as required, so the fixture omits it: any handler
    // or log line that reads invoice.id here must produce "undefined" and be
    // caught rather than quietly working against a fixture that was kinder than
    // production.
    object: "invoice",
    customer: "cus_test_billing",
    billing_reason: "upcoming",
    collection_method: "charge_automatically",
    currency: "eur",
    // All three differ, so a handler reading the wrong one is visible.
    subtotal: 6000,
    total: 5500,
    amount_due: 4500,
    period_start: ASSOC_START,
    period_end: ASSOC_END,
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: "sub_test_billing" },
    },
    lines: {
      object: "list",
      data: [
        // A one-off support charge, sorted first by Stripe and carrying the
        // largest amount — so any largest-amount or data[0] selection loses.
        {
          id: "il_upcoming_support_charge",
          object: "line_item",
          amount: 9000,
          period: { start: UPCOMING_PRORATION_START, end: RENEWS_AT },
          parent: { type: "invoice_item_details", invoice_item_details: {} },
        },
        // A PRORATION subscription line, also larger than the cycle line. This
        // is the one subscriptionInvoiceLine()'s fallback would pick, and its
        // period.start is already in the past.
        {
          id: "il_upcoming_proration",
          object: "line_item",
          amount: 7000,
          period: { start: UPCOMING_PRORATION_START, end: RENEWS_AT },
          parent: {
            type: "subscription_item_details",
            subscription_item_details: { proration: true, subscription_item: "si_test" },
          },
        },
        // THE CYCLE LINE. Smallest amount, last in the list — the right answer
        // is reachable only by asking what the line IS.
        {
          id: "il_upcoming_cycle",
          object: "line_item",
          amount: 2500,
          period: { start: RENEWS_AT, end: CYCLE_END },
          parent: {
            type: "subscription_item_details",
            subscription_item_details: { proration: false, subscription_item: "si_test" },
          },
        },
      ],
    },
    ...overrides,
  };
}

// The company shape Slice 4's gates require: on THIS subscription, active, not
// cancelling. Every gate test starts from here and breaks exactly one thing.
async function renewingTenant(overrides: { language?: string | null; timezone?: string | null } = {}) {
  const tenant = await billingTenant(overrides);
  await prisma.company.update({
    where: { id: tenant.company.id },
    data: {
      stripeSubscriptionId: "sub_test_billing",
      subscriptionStatus: "active",
      cancelAtPeriodEnd: false,
    },
  });
  return tenant;
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

// One company, one owner, one employee — the fixture every billing slice
// needs. Named for billing rather than for renewals because Slice 2 and the ten
// after it use the same shape; a helper named after the first slice that
// happened to need it reads wrong from the second one onwards.
async function billingTenant(overrides: { language?: string | null; timezone?: string | null } = {}) {
  const company = await createCompany();
  await prisma.company.update({
    where: { id: company.id },
    data: {
      stripeCustomerId: "cus_test_billing",
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
    const { company, owner, employee } = await billingTenant();

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

    // 3. The real channel resolves the recipient's locale, formats the raw
    //    context and hands the finished payload to the transport, which
    //    "sends". It does NOT render a template: the transport under test is
    //    MockEmailService, which is a logger by design. Template rendering is
    //    proved separately, below and in emailTemplates.test.ts.
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
    await billingTenant();

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
    await billingTenant();

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
    await billingTenant();

    await postWebhook(stripeEvent("invoice.paid", invoiceFixture(), "evt_month_1"));
    await postWebhook(
      stripeEvent("invoice.paid", invoiceFixture({ id: "in_test_renewal_2" }), "evt_month_2")
    );

    expect(
      await prisma.notificationEvent.count({ where: { type: "billing.subscription_renewed" } })
    ).toBe(2);
  });
});

describe("Slices 1-2 — billing_reason routing (K1)", () => {
  it("does NOT send for the first payment of a new subscription", async () => {
    // subscription_create is the checkout flow's; sending here too would mean
    // the customer gets both "welcome" and "renewed" for one charge.
    await billingTenant();

    const res = await postWebhook(
      stripeEvent("invoice.paid", invoiceFixture({ billing_reason: "subscription_create" }))
    );

    expect(res.status).toBe(200);
    // NO notification of ANY type — asserted on the whole table rather than on
    // billing.subscription_renewed alone, because the routing table now has a
    // second destination and "did not send the renewal" would pass while
    // sending the plan-change receipt instead.
    expect(await prisma.notificationEvent.count()).toBe(0);
    // Still recorded in the ledger, so a redelivery is not re-evaluated.
    expect(await prisma.processedStripeEvent.count()).toBe(1);
  });

  it("does NOT send for a billing_reason the table does not name", async () => {
    // `manual` — an invoice raised by hand in the Dashboard. Four of Stripe's
    // seven reasons route nowhere in N1.8, and the handler must treat an
    // unlisted one as silence rather than as a default.
    await billingTenant();

    const res = await postWebhook(
      stripeEvent("invoice.paid", invoiceFixture({ billing_reason: "manual" }))
    );

    expect(res.status).toBe(200);
    expect(await prisma.notificationEvent.count()).toBe(0);
    expect(await prisma.processedStripeEvent.count()).toBe(1);
  });

  it("routes a mid-cycle plan change to billing.invoice_paid and NOTHING else", async () => {
    // The K1 property itself: one payment, one email. Slice 1 read this same
    // event and had to stay silent for it; Slice 2 is the destination that was
    // missing. If the two branches ever both fire, the customer gets a renewal
    // receipt and a plan-change receipt for a single charge.
    await billingTenant();

    await postWebhook(stripeEvent("invoice.paid", planChangeInvoiceFixture()));

    expect(
      await prisma.notificationEvent.count({ where: { type: "billing.invoice_paid" } })
    ).toBe(1);
    expect(
      await prisma.notificationEvent.count({ where: { type: "billing.subscription_renewed" } })
    ).toBe(0);
    expect(await prisma.notificationEvent.count()).toBe(1);
  });

  it("routes a renewal to billing.subscription_renewed and NOTHING else", async () => {
    // The mirror assertion. Without it, a routing table that pointed BOTH
    // reasons at billing.invoice_paid would still pass every renewal test that
    // only counts its own type.
    await billingTenant();

    await postWebhook(stripeEvent("invoice.paid", invoiceFixture()));

    expect(
      await prisma.notificationEvent.count({ where: { type: "billing.subscription_renewed" } })
    ).toBe(1);
    expect(await prisma.notificationEvent.count()).toBe(1);
  });
});

// The transport method each receipt type MUST reach. Two near-identical
// payloads make "renewed" and "plan change" an easy pair to cross-wire in the
// channel's switch, and no assertion about the payload could ever see it — the
// values are the same either way, only the copy the customer reads differs.
// Spying on the type's own method is what makes that observable.
const RECEIPT_METHOD = {
  "billing.subscription_renewed": "sendSubscriptionRenewedEmail",
  "billing.invoice_paid": "sendInvoicePaidEmail",
  "billing.invoice_failed": "sendInvoiceFailedEmail",
  "billing.renewal_upcoming": "sendRenewalUpcomingEmail",
} as const;

// Captures the payload the email channel hands the transport — i.e. what the
// customer would actually read, after per-recipient locale resolution.
// Slice 3's payload is a different SHAPE, not a variant of the receipt one, so
// the helper resolves the type per notification rather than returning a union
// every call site would have to narrow.
type PayloadFor<T extends keyof typeof RECEIPT_METHOD> = T extends "billing.invoice_failed"
  ? PaymentFailureEmailPayload
  : T extends "billing.renewal_upcoming"
    ? UpcomingRenewalEmailPayload
    : InvoiceReceiptEmailPayload;

async function deliveredPayload<
  T extends keyof typeof RECEIPT_METHOD = "billing.subscription_renewed"
>(type: T = "billing.subscription_renewed" as T): Promise<PayloadFor<T>> {
  const event = (await prisma.notificationEvent.findFirst({ where: { type } }))!;
  await dispatchEvent(event.id);
  const delivery = (await prisma.notificationDelivery.findFirst({
    where: { eventId: event.id, channel: "EMAIL" },
  }))!;

  const spy = vi.spyOn(emailService, RECEIPT_METHOD[type]);
  try {
    await deliverEmail(delivery.id);
    expect(spy).toHaveBeenCalledTimes(1);
    return spy.mock.calls[0][1] as PayloadFor<T>;
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
    await billingTenant({ language: "en" });
    await postWebhook(stripeEvent("invoice.paid", invoiceFixture()));

    const payload = await deliveredPayload();

    // The SERVICE period (October), not the association window (September).
    expect(payload.periodStartFormatted).toBe("1 October 2026");
    expect(payload.periodEndFormatted).toBe("1 November 2026");
  });

  it("ignores a one-off support line that Stripe sorts ahead of the subscription", async () => {
    // The surviving path a re-review found after the first P1 fix. That fix
    // filtered on `item.period`, which is a REQUIRED field on every line item,
    // so the predicate was always true and the code was really `data[0]`.
    // Stripe puts pending invoice items (a support charge, a one-off credit)
    // BEFORE subscription items, so data[0] is the support line and the receipt
    // stated its narrow mid-September window instead of the October cycle.
    await billingTenant({ language: "en" });
    await postWebhook(stripeEvent("invoice.paid", invoiceFixture()));

    const payload = await deliveredPayload();

    // The subscription line's period, not the support line's (14–15 September).
    expect(payload.periodStartFormatted).toBe("1 October 2026");
    expect(payload.periodStartFormatted).not.toContain("September");
  });

  it("prefers the non-proration subscription line", async () => {
    // Matters from Slice 2 on: a subscription_update invoice carries proration
    // lines that ARE subscription lines but describe a partial window.
    await billingTenant({ language: "en" });
    await postWebhook(
      stripeEvent(
        "invoice.paid",
        invoiceFixture({
          lines: {
            object: "list",
            data: [
              {
                id: "il_proration",
                object: "line_item",
                period: { start: CREDIT_START, end: CREDIT_END },
                parent: {
                  type: "subscription_item_details",
                  subscription_item_details: { proration: true, subscription_item: "si_test" },
                },
              },
              {
                id: "il_subscription",
                object: "line_item",
                period: { start: SERVICE_START, end: SERVICE_END },
                parent: {
                  type: "subscription_item_details",
                  subscription_item_details: { proration: false, subscription_item: "si_test" },
                },
              },
            ],
          },
        })
      )
    );

    const payload = await deliveredPayload();
    expect(payload.periodStartFormatted).toBe("1 October 2026");
  });

  it("prefers a PRORATION subscription line over a non-subscription line", async () => {
    // The case that pins the parent.type filter, found by a surviving mutation.
    //
    // When a non-proration subscription line exists, the proration check alone
    // picks it and the type filter is redundant — which is why removing the
    // filter passed every other test. The filter earns its place only on the
    // FALLBACK path: if every subscription line is a proration, the code takes
    // the largest-amount one, and without the filter that is the support charge
    // — which this fixture deliberately makes the biggest line on the invoice.
    // A subscription_update invoice carrying a support charge is exactly that
    // shape, and Slice 2 widens billing_reason to include it.
    //
    // (Slice 2 replaced the old `subscriptionLines[0]` fallback with that
    // largest-amount rule, because an all-proration invoice's two lines arrive
    // in no guaranteed order — see subscriptionInvoiceLine.)
    await billingTenant({ language: "en" });
    await postWebhook(
      stripeEvent(
        "invoice.paid",
        invoiceFixture({
          lines: {
            object: "list",
            data: [
              // The amounts are what make this fixture able to fail. Slice 2
              // selects among subscription lines by amount, so this non-
              // subscription line must be the LARGEST for the type filter to be
              // the only thing keeping it out.
              {
                id: "il_support_charge",
                object: "line_item",
                amount: SUPPORT_CHARGE_MINOR,
                period: { start: CREDIT_START, end: CREDIT_END },
                parent: { type: "invoice_item_details", invoice_item_details: {} },
              },
              {
                id: "il_proration_only",
                object: "line_item",
                amount: 2750,
                period: { start: SERVICE_START, end: SERVICE_END },
                parent: {
                  type: "subscription_item_details",
                  subscription_item_details: { proration: true, subscription_item: "si_test" },
                },
              },
            ],
          },
        })
      )
    );

    const payload = await deliveredPayload();

    // The subscription line's period, even though it is a proration — never the
    // support line's, which is what index 0 would give.
    expect(payload.periodStartFormatted).toBe("1 October 2026");
    expect(payload.periodStartFormatted).not.toContain("September");
  });

  it("falls back to the invoice window when there is no subscription line", async () => {
    // Defensive, and unreachable for subscription_cycle invoices — but a
    // receipt that cannot render is worse than one with a coarser period.
    await billingTenant({ language: "en" });
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
    const { owner } = await billingTenant({ language: "en" });
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
    await billingTenant({ language: "hu" });

    await postWebhook(stripeEvent("invoice.paid", invoiceFixture()));
    const payload = await deliveredPayload();

    expect(payload.amountFormatted).toBe("25,00 EUR");
  });

  it("stores RAW values in the context, never rendered text", async () => {
    // The property that makes one event serve two owners in two languages. If
    // the trigger ever formats again, this fails.
    await billingTenant({ language: "en" });
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
    await billingTenant({ language: "en" });
    await postWebhook(stripeEvent("invoice.paid", invoiceFixture()));

    const payload = await deliveredPayload();
    expect(payload.amountFormatted).toBe("€25.00");
    expect(payload.planName).toBe("Professional");
  });

  it("names the RENEWAL plan from the invoice too, not from Company.plan", async () => {
    // Slice 2 changed Slice 1's behaviour here, so Slice 1 needs the matching
    // coverage: the renewal receipt now also resolves its plan from the price
    // on the invoice's subscription line. Every other renewal test asserts
    // "Professional" while Company.plan is ALSO professional, so all of them
    // pass whichever source is read — the two answers have to be made to
    // disagree before this is a test at all.
    //
    // Business is the stored plan; the invoice was raised for Professional.
    // Only the invoice can produce the right answer.
    const { company } = await billingTenant({ language: "en" });
    await prisma.company.update({ where: { id: company.id }, data: { plan: "business" } });

    await postWebhook(stripeEvent("invoice.paid", invoiceFixture()));
    const payload = await deliveredPayload();

    expect(payload.planName).toBe("Professional");
  });

  it("renders dates in the company's timezone, which can change the DAY", async () => {
    // The service period ends midnight UTC on 1 November — 20:00 on 31 October
    // in New York.
    await billingTenant({ language: "en", timezone: "America/New_York" });

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
    const { company } = await billingTenant();
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
    const { company } = await billingTenant();
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
    await billingTenant({ language: "en" });
    await postWebhook(stripeEvent("invoice.paid", invoiceFixture({ hosted_invoice_url: null })));

    const payload = await deliveredPayload();
    expect(payload.invoiceUrl).toBeNull();

    // And the template survives it — no dead button, no broken markup.
    const rendered = await subscriptionRenewedEmailTemplate({ ...payload, locale: "en" });
    expect(rendered.html).not.toContain('href=""');
    expect(rendered.html).toContain("25.00");
  });

  it("treats an empty-string URL as absent", async () => {
    await billingTenant({ language: "en" });
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

describe("Slice 2 — the complete path, nothing stubbed", () => {
  it("turns a signed subscription_update invoice into a sent plan-change email", async () => {
    const { company, owner, employee } = await billingTenant();

    const res = await postWebhook(stripeEvent("invoice.paid", planChangeInvoiceFixture()));
    expect(res.status).toBe(200);

    // 1. The outbox row, keyed on the INVOICE and prefixed with its own type —
    //    the prefix is what stops the two receipts sharing a key if the routing
    //    table ever stops being disjoint.
    const event = await prisma.notificationEvent.findFirst({
      where: { type: "billing.invoice_paid" },
    });
    expect(event).not.toBeNull();
    expect(event!.dedupeKey).toBe("billing.invoice_paid/in_test_planchange_1");
    expect(event!.companyId).toBe(company.id);

    // 2. Fan-out reaches the OWNER, EMAIL only. Q5 — every billing.* is
    //    owner-only, and the company has an employee who must not appear: what
    //    the company pays is not an employee's business.
    await dispatchEvent(event!.id);
    const deliveries = await prisma.notificationDelivery.findMany({
      where: { eventId: event!.id },
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].channel).toBe("EMAIL");
    expect(deliveries[0].recipientAddress).toBe(owner.email);
    expect(deliveries.map((d) => d.recipientAddress)).not.toContain(employee.email);

    // 3. The real channel resolves the recipient's locale, formats the raw
    //    context and hands the finished payload to the transport, which
    //    "sends". It does NOT render a template: the transport under test is
    //    MockEmailService, which is a logger by design. Template rendering is
    //    proved separately, below and in emailTemplates.test.ts.
    await deliverEmail(deliveries[0].id);
    const sent = await prisma.notificationDelivery.findUnique({
      where: { id: deliveries[0].id },
    });
    expect(sent!.status).toBe("sent");
    expect(sent!.providerMessageId).toMatch(/^mock_/);
  });

  it("reaches the plan-change template, not the renewal one", async () => {
    // The mutation this exists for: the channel's two cases take an identical
    // payload, so routing billing.invoice_paid to sendSubscriptionRenewedEmail
    // produces a perfectly valid email that says the wrong thing — the customer
    // is told their subscription renewed for another billing period when they
    // in fact just paid a mid-cycle difference. No payload assertion can see
    // that; only the method actually called can.
    await billingTenant({ language: "en" });
    await postWebhook(stripeEvent("invoice.paid", planChangeInvoiceFixture()));

    // deliveredPayload() spies on the type's OWN transport method and fails if
    // it was not the one called.
    const payload = await deliveredPayload("billing.invoice_paid");

    // And the rendered copy is the plan-change copy, asserted against the real
    // template rather than against the i18n file — a render that silently fell
    // back to the renewal wording would still pass a key-level check.
    const rendered = await invoicePaidEmailTemplate({ ...payload, locale: "en" });
    expect(rendered.subject).toBe("Payment received for your plan change — €12.50");
    expect(rendered.html).toContain("is now on the Professional plan");
    expect(rendered.html).not.toContain("for another billing period");
  });

  it("suppresses a DIFFERENT event about the same plan-change invoice", async () => {
    // The invoice-keyed layer, proved for the new type's own key rather than
    // inherited from Slice 1: Stripe can emit more than one event id for one
    // invoice, and a per-event key would receipt the same charge twice.
    await billingTenant();

    await postWebhook(stripeEvent("invoice.paid", planChangeInvoiceFixture(), "evt_change_a"));
    await postWebhook(stripeEvent("invoice.paid", planChangeInvoiceFixture(), "evt_change_b"));

    expect(await prisma.processedStripeEvent.count()).toBe(2);
    expect(
      await prisma.notificationEvent.count({ where: { type: "billing.invoice_paid" } })
    ).toBe(1);
  });

  it("sends again for a SECOND plan change", async () => {
    // A customer who upgrades twice in one month gets two receipts. The other
    // half of the dedupe contract — a key that dropped the invoice id would
    // silently swallow this one.
    await billingTenant();

    await postWebhook(stripeEvent("invoice.paid", planChangeInvoiceFixture(), "evt_change_1"));
    await postWebhook(
      stripeEvent(
        "invoice.paid",
        planChangeInvoiceFixture({ id: "in_test_planchange_2" }),
        "evt_change_2"
      )
    );

    expect(
      await prisma.notificationEvent.count({ where: { type: "billing.invoice_paid" } })
    ).toBe(2);
  });
});

describe("Slice 2 — the receipt states the PRORATION window", () => {
  it("takes the period from the proration line, not the invoice window", async () => {
    // A subscription_update invoice is usually ALL proration, so the shared
    // selector takes its fallback branch. Three wrong answers are reachable
    // here and each names a different date: the invoice-level association
    // window (1 September), the support charge sitting at index 0 (14
    // September), and a whole cycle. Only the proration window is right.
    await billingTenant({ language: "en" });
    await postWebhook(stripeEvent("invoice.paid", planChangeInvoiceFixture()));

    const payload = await deliveredPayload("billing.invoice_paid");

    expect(payload.periodStartFormatted).toBe("15 October 2026");
    expect(payload.periodEndFormatted).toBe("1 November 2026");
    // The support charge's window and the association window are both
    // September; neither may reach the customer.
    expect(payload.periodStartFormatted).not.toContain("September");
  });

  it("converts the proration amount from minor units", async () => {
    await billingTenant({ language: "en" });
    await postWebhook(stripeEvent("invoice.paid", planChangeInvoiceFixture()));

    const payload = await deliveredPayload("billing.invoice_paid");
    expect(payload.amountFormatted).toBe("€12.50");
    expect(payload.planName).toBe("Professional");
  });

  it("names the plan from the INVOICE, not from our not-yet-updated copy", async () => {
    // THE RACE. One hosted upgrade makes Stripe emit both
    // customer.subscription.updated and invoice.paid, with no ordering
    // guarantee between them — and only the former runs
    // applySubscriptionUpdate. Delivered in the other order, this handler reads
    // a Company row that still says Starter and the customer is told "is now on
    // the Starter plan" seconds after paying to leave it. The return-sync
    // endpoint closes the window only for a customer who comes back to the app.
    //
    // The company is left on the OLD plan here on purpose: that is the state
    // the racing delivery actually finds.
    const { company } = await billingTenant({ language: "en" });
    await prisma.company.update({ where: { id: company.id }, data: { plan: "starter" } });

    await postWebhook(stripeEvent("invoice.paid", planChangeInvoiceFixture()));
    const payload = await deliveredPayload("billing.invoice_paid");

    // Professional is reachable ONLY from the invoice's charge line. Reading
    // Company.plan gives Starter; reading the credit line — the other proration,
    // deliberately sitting first — also gives Starter. One right answer, two
    // wrong ones that look identical to each other.
    expect(payload.planName).toBe("Professional");
  });

  it("keeps the stored plan when the invoice price is unrecognised", async () => {
    // A legacy or misconfigured price must not blank out the plan name. The
    // fallback is Company.plan, which is what every pre-Slice-2 receipt used.
    await billingTenant({ language: "en" });

    await postWebhook(
      stripeEvent(
        "invoice.paid",
        planChangeInvoiceFixture({
          lines: {
            object: "list",
            data: [
              {
                id: "il_unknown_price",
                object: "line_item",
                amount: 2750,
                period: { start: PRORATION_START, end: PRORATION_END },
                pricing: {
                  type: "price_details",
                  price_details: { price: "price_from_another_account", product: "prod_x" },
                },
                parent: {
                  type: "subscription_item_details",
                  subscription_item_details: { proration: true, subscription_item: "si_test" },
                },
              },
            ],
          },
        })
      )
    );

    const payload = await deliveredPayload("billing.invoice_paid");
    expect(payload.planName).toBe("Professional");
  });

  it("formats in the RECIPIENT's language, not the company's", async () => {
    // Slice 1's P2 property, re-proved through the new case: the channel helper
    // is shared, but the case wiring that hands it `locale` is not.
    const { owner } = await billingTenant({ language: "en" });
    await prisma.user.update({ where: { id: owner.id }, data: { language: "hu" } });

    await postWebhook(stripeEvent("invoice.paid", planChangeInvoiceFixture()));
    const payload = await deliveredPayload("billing.invoice_paid");

    // ICU separates the amount from the currency code with a NON-BREAKING
    // space, and this expectation writes that character as a \u00A0 escape
    // rather than pasting it in. Pasted, it is invisible in the source and a mismatch prints
    // as "expected '12,50 EUR' to be '12,50 EUR'" — which is what Phase 0 hit
    // and wrote down. The two Slice 1 expectations above still carry the
    // literal character; same value, worse to debug.
    expect(payload.amountFormatted).toBe("12,50\u00A0EUR");
    expect(payload.periodStartFormatted).toBe("2026. október 15.");
  });

  it("stores RAW values in the context, never rendered text", async () => {
    await billingTenant({ language: "en" });
    await postWebhook(stripeEvent("invoice.paid", planChangeInvoiceFixture()));

    const event = await prisma.notificationEvent.findFirst({
      where: { type: "billing.invoice_paid" },
    });
    const context = JSON.parse(event!.context!);

    expect(context.amountMinor).toBe(1250);
    expect(context.periodStartAt).toBe(PRORATION_START);
    expect(context).not.toHaveProperty("amountFormatted");
  });
});

describe("Slice 2 — a plan change that took no money", () => {
  it("sends no receipt for a zero-amount invoice", async () => {
    // A mid-cycle DOWNGRADE prorates in the customer's favour: the credit for
    // the old plan's unused time exceeds the new plan's charge, Stripe moves
    // the difference to the customer's credit balance and finalises this
    // invoice at zero — which auto-pays and emits invoice.paid all the same.
    //
    // "Payment received for your plan change — €0.00" is a receipt for a
    // payment that did not happen. The change itself is billing.plan_upgraded /
    // billing.plan_downgraded's message (N1.8 Phase 2); this type reports money
    // taken, and none was.
    await billingTenant();

    const res = await postWebhook(
      stripeEvent("invoice.paid", planChangeInvoiceFixture({ amount_paid: 0 }))
    );

    expect(res.status).toBe(200);
    expect(await prisma.notificationEvent.count()).toBe(0);
    // Still ledgered, so Stripe does not retry it forever.
    expect(await prisma.processedStripeEvent.count()).toBe(1);
  });

  it("STILL sends the renewal receipt at zero — the gate is not shared", async () => {
    // The asymmetry, pinned. "Your subscription renewed" is true at zero: a
    // fully discounted or fully credited cycle still renews the coverage, and
    // the customer should still be told their plan continues. Widening the
    // zero-amount gate to cover both receipts would suppress an accurate
    // message, so the gate names its type and this test is what holds it there.
    await billingTenant();

    await postWebhook(stripeEvent("invoice.paid", invoiceFixture({ amount_paid: 0 })));

    expect(
      await prisma.notificationEvent.count({ where: { type: "billing.subscription_renewed" } })
    ).toBe(1);
  });
});

describe("Slice 2 — no plan-change receipt for a dead subscription", () => {
  it("stays silent when the subscription is no longer active", async () => {
    // Slice 1's P3, which applies here for the same reason: a plan-change
    // invoice can sit open through dunning too, and paying it from the hosted
    // link afterwards resurrects nothing. The receipt names company.plan, which
    // by then is whatever the cancellation path wrote — so the customer would
    // read "is now on the free plan" over a paid-invoice headline.
    const { company } = await billingTenant();
    await prisma.company.update({
      where: { id: company.id },
      data: { subscriptionStatus: "canceled", plan: "free" },
    });

    const res = await postWebhook(stripeEvent("invoice.paid", planChangeInvoiceFixture()));

    expect(res.status).toBe(200);
    expect(await prisma.notificationEvent.count()).toBe(0);
    expect(await prisma.processedStripeEvent.count()).toBe(1);
  });

  it("still sends for past_due — a failed payment is a LIVE subscription", async () => {
    const { company } = await billingTenant();
    await prisma.company.update({
      where: { id: company.id },
      data: { subscriptionStatus: "past_due" },
    });

    await postWebhook(stripeEvent("invoice.paid", planChangeInvoiceFixture()));

    expect(
      await prisma.notificationEvent.count({ where: { type: "billing.invoice_paid" } })
    ).toBe(1);
  });
});

describe("Slice 3 — the failed payment, end to end", () => {
  it("turns a signed invoice.payment_failed into a sent warning", async () => {
    const { company, owner, employee } = await billingTenant();

    const res = await postWebhook(stripeEvent("invoice.payment_failed", failedInvoiceFixture()));
    expect(res.status).toBe(200);

    const event = await prisma.notificationEvent.findFirst({
      where: { type: "billing.invoice_failed" },
    });
    expect(event).not.toBeNull();
    // K2 — the EVENT id, not the invoice id. See the "every retry" test below
    // for what that buys.
    expect(event!.dedupeKey).toBe("billing.invoice_failed/evt_invoice.payment_failed_1");
    expect(event!.companyId).toBe(company.id);

    await dispatchEvent(event!.id);
    const deliveries = await prisma.notificationDelivery.findMany({
      where: { eventId: event!.id },
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].channel).toBe("EMAIL");
    expect(deliveries[0].recipientAddress).toBe(owner.email);
    expect(deliveries.map((d) => d.recipientAddress)).not.toContain(employee.email);

    await deliverEmail(deliveries[0].id);
    const sent = await prisma.notificationDelivery.findUnique({
      where: { id: deliveries[0].id },
    });
    expect(sent!.status).toBe("sent");
    expect(sent!.providerMessageId).toMatch(/^mock_/);
  });

  it("warns about EVERY automatic retry, not just the first", async () => {
    // THE POINT OF K2, and the plan's own sabotage row (event.id -> invoice.id).
    // Stripe retries a failed subscription charge several times over days; each
    // is a separate failure the customer has to hear about. Keyed on the
    // invoice, the customer would be told once and then never again — going
    // quiet precisely as the situation got worse.
    await billingTenant();

    await postWebhook(
      stripeEvent("invoice.payment_failed", failedInvoiceFixture({ attempt_count: 1 }), "evt_try_1")
    );
    await postWebhook(
      stripeEvent("invoice.payment_failed", failedInvoiceFixture({ attempt_count: 2 }), "evt_try_2")
    );

    // SAME invoice id in both, different event ids.
    expect(
      await prisma.notificationEvent.count({ where: { type: "billing.invoice_failed" } })
    ).toBe(2);
  });

  it("still suppresses a redelivery of the SAME event", async () => {
    // The other half: every retry sends, but Stripe resending one retry does
    // not. HANDLED_EVENTS short-circuits it before the handler runs.
    await billingTenant();

    const event = stripeEvent("invoice.payment_failed", failedInvoiceFixture(), "evt_once");
    const first = await postWebhook(event);
    const second = await postWebhook(event);

    expect(first.body.duplicate).toBeUndefined();
    expect(second.body.duplicate).toBe(true);
    expect(
      await prisma.notificationEvent.count({ where: { type: "billing.invoice_failed" } })
    ).toBe(1);
    expect(await prisma.processedStripeEvent.count()).toBe(1);
  });
});

describe("Slice 3 — scope: only auto-collected SUBSCRIPTION invoices", () => {
  it("ignores a one-off invoice raised from the Dashboard", async () => {
    // parent: null is what a manual invoice looks like — there is no "manual"
    // member of Parent.Type. The email's entire instruction ("update your
    // payment details in the Portal") is wrong for one: the Portal manages the
    // SUBSCRIPTION's payment method and cannot settle a standalone invoice.
    await billingTenant();

    const res = await postWebhook(
      stripeEvent("invoice.payment_failed", failedInvoiceFixture({ parent: null }))
    );

    expect(res.status).toBe(200);
    expect(await prisma.notificationEvent.count()).toBe(0);
    // Ledgered anyway, so Stripe does not retry it forever — and so a
    // markEventProcessed that sits AFTER the scope break fails here.
    expect(await prisma.processedStripeEvent.count()).toBe(1);
  });

  it("ignores an invoice generated by a QUOTE", async () => {
    // parent.type has two members (Invoices.d.ts:862) and `parent: null` is a
    // third state. Tested only against null, the filter could be narrowed to
    // `!invoice.parent` and still pass — while admitting quote_details
    // invoices, for which the Portal advice is just as wrong.
    await billingTenant();

    await postWebhook(
      stripeEvent(
        "invoice.payment_failed",
        failedInvoiceFixture({ parent: { type: "quote_details", quote_details: {} } })
      )
    );

    expect(await prisma.notificationEvent.count()).toBe(0);
    expect(await prisma.processedStripeEvent.count()).toBe(1);
  });

  it("ignores a send_invoice subscription invoice", async () => {
    // The subtle half. next_payment_attempt is null for send_invoice invoices
    // BY DEFINITION (Invoices.d.ts:334-336), not because dunning gave up — so
    // without this filter every one of them would take the most urgent branch
    // this message has, for an invoice Stripe was never going to auto-charge
    // and is itself emailing with payment instructions.
    await billingTenant();

    await postWebhook(
      stripeEvent(
        "invoice.payment_failed",
        failedInvoiceFixture({ collection_method: "send_invoice", next_payment_attempt: null })
      )
    );

    expect(await prisma.notificationEvent.count()).toBe(0);
    expect(await prisma.processedStripeEvent.count()).toBe(1);
  });

  it("sends regardless of billing_reason, including null", async () => {
    // Guards against a future reviewer 'restoring symmetry' with Slices 1-2 by
    // re-implementing the scope filter as a billing_reason allowlist.
    // billing_reason is NULLABLE (Invoices.d.ts:203), and a subscription
    // failure whose reason is null or the legacy "subscription" is a real
    // dunning failure where /subscription is exactly the right advice.
    await billingTenant();

    await postWebhook(
      stripeEvent(
        "invoice.payment_failed",
        failedInvoiceFixture({ billing_reason: null }),
        "evt_reason_null"
      )
    );
    await postWebhook(
      stripeEvent(
        "invoice.payment_failed",
        failedInvoiceFixture({ id: "in_thr", billing_reason: "subscription_threshold" }),
        "evt_reason_threshold"
      )
    );

    expect(
      await prisma.notificationEvent.count({ where: { type: "billing.invoice_failed" } })
    ).toBe(2);
  });

  it("does not send when nothing is outstanding", async () => {
    await billingTenant();

    const res = await postWebhook(
      stripeEvent("invoice.payment_failed", failedInvoiceFixture({ amount_remaining: 0 }))
    );

    expect(res.status).toBe(200);
    expect(await prisma.notificationEvent.count()).toBe(0);
    expect(await prisma.processedStripeEvent.count()).toBe(1);
  });
});

describe("Slice 3 — it sends when the receipts would NOT", () => {
  it.each(["canceled", "unpaid"])(
    "still warns when the subscription is already %s",
    async (subscriptionStatus) => {
      // The decision that separates this type from Slices 1-2: NO liveness gate.
      // Copying theirs would do nothing at the first failure (active/past_due
      // both pass) and would bite only at the TERMINAL one — once
      // customer.subscription.deleted has landed and written canceled. That is
      // the most important message in the sequence, and Stripe guarantees no
      // ordering between the two events, so the gate would drop it
      // nondeterministically.
      const { company } = await billingTenant();
      await prisma.company.update({
        where: { id: company.id },
        data: { subscriptionStatus, plan: "free" },
      });

      await postWebhook(stripeEvent("invoice.payment_failed", failedInvoiceFixture()));

      expect(
        await prisma.notificationEvent.count({ where: { type: "billing.invoice_failed" } })
      ).toBe(1);
    }
  );

  it("stays silent when the company has already REPLACED the failing subscription", async () => {
    // The one exception to "no gate", and on a different axis from liveness.
    // Terminal dunning cancels the old subscription, which unblocks a fresh
    // Checkout — the intended recovery — and that rewrites
    // Company.stripeSubscriptionId. Stripe retries a non-2xx delivery for days,
    // so the OLD invoice's final payment_failed can land afterwards. Sending it
    // then tells a customer who has just paid that their payment failed and
    // their access is at risk, and they cannot switch it off.
    const { company } = await billingTenant();
    await prisma.company.update({
      where: { id: company.id },
      data: { stripeSubscriptionId: "sub_test_replacement", subscriptionStatus: "active" },
    });

    const res = await postWebhook(
      stripeEvent("invoice.payment_failed", failedInvoiceFixture())
    );

    expect(res.status).toBe(200);
    expect(await prisma.notificationEvent.count()).toBe(0);
    expect(await prisma.processedStripeEvent.count()).toBe(1);
  });

  it("still warns when the company is on the SAME subscription", async () => {
    // The guard must be about identity, not merely about the column being set.
    // Suppressing whenever stripeSubscriptionId is populated would silence the
    // ordinary case — which is every real dunning failure.
    const { company } = await billingTenant();
    await prisma.company.update({
      where: { id: company.id },
      data: { stripeSubscriptionId: "sub_test_billing", subscriptionStatus: "past_due" },
    });

    await postWebhook(stripeEvent("invoice.payment_failed", failedInvoiceFixture()));

    expect(
      await prisma.notificationEvent.count({ where: { type: "billing.invoice_failed" } })
    ).toBe(1);
  });

  it("still warns when the replacement subscription is ALSO dead", async () => {
    // Silence is only safe when we can see the customer's billing is fine. A
    // different-but-dead subscription is not that, so the warning goes out.
    const { company } = await billingTenant();
    await prisma.company.update({
      where: { id: company.id },
      data: { stripeSubscriptionId: "sub_test_replacement", subscriptionStatus: "canceled" },
    });

    await postWebhook(stripeEvent("invoice.payment_failed", failedInvoiceFixture()));

    expect(
      await prisma.notificationEvent.count({ where: { type: "billing.invoice_failed" } })
    ).toBe(1);
  });

  it("reaches the owner even with the category switched off", async () => {
    // mandatory: true. `billing` is a MANDATORY_CATEGORY, so the preference API
    // refuses to write this row at all — it is inserted directly, which is the
    // only way to prove the GATE ignores it rather than the API refusing it.
    const { company, owner } = await billingTenant();
    await prisma.notificationPreference.create({
      data: {
        companyId: company.id,
        userId: owner.id,
        category: "billing",
        channel: "EMAIL",
        enabled: false,
      },
    });

    await postWebhook(stripeEvent("invoice.payment_failed", failedInvoiceFixture()));

    const event = (await prisma.notificationEvent.findFirst({
      where: { type: "billing.invoice_failed" },
    }))!;
    await dispatchEvent(event.id);

    const delivery = (await prisma.notificationDelivery.findFirst({
      where: { eventId: event.id },
    }))!;
    expect(delivery.status).toBe("pending");
    expect(delivery.suppressionReason).toBeNull();
  });

  it("sends nothing for customer.subscription.updated -> past_due", async () => {
    // K2's second half: one failed payment, ONE letter. Stripe fires both
    // invoice.payment_failed AND customer.subscription.updated(past_due) for a
    // single failure; only the former carries the data this message needs, so
    // the latter must stay a pure state write.
    const { company } = await billingTenant();

    await postWebhook(
      stripeEvent("customer.subscription.updated", {
        id: "sub_test_billing",
        object: "subscription",
        status: "past_due",
        customer: "cus_test_billing",
        metadata: { companyId: String(company.id) },
        items: { object: "list", data: [] },
      })
    );

    expect(await prisma.notificationEvent.count()).toBe(0);
  });
});

describe("Slice 3 — what the customer is actually told", () => {
  it("reports the OUTSTANDING amount, not what was billed", async () => {
    // amount_due 5999, amount_paid 1000 -> 4999 is the money that failed.
    // amount_due would name money the customer already handed over, on the one
    // number this email exists to communicate.
    await billingTenant({ language: "en" });
    await postWebhook(stripeEvent("invoice.payment_failed", failedInvoiceFixture()));

    const payload = await deliveredPayload("billing.invoice_failed");

    expect(payload.amountFormatted).toBe("€49.99");
  });

  it("passes the REAL attempt count through, not a constant", async () => {
    // Every other test uses the fixture's attempt_count of 1, which is also
    // what a hardcoded `attemptNumber: 1` would produce — so none of them can
    // tell the pass-through from a constant. A value that appears nowhere else
    // in the fixture can.
    await billingTenant({ language: "en" });
    await postWebhook(
      stripeEvent("invoice.payment_failed", failedInvoiceFixture({ attempt_count: 3 }))
    );

    const payload = await deliveredPayload("billing.invoice_failed");
    expect(payload.attemptNumber).toBe(3);
  });

  it("renders the next attempt in the company's timezone, which can change the DAY", async () => {
    // The context carries Company.timezone purely for this. Without a test
    // that makes the zone matter, dropping the field entirely would go
    // unnoticed: 09:00 UTC on 18 October is still 17 October in Los Angeles.
    await billingTenant({ language: "en", timezone: "America/Los_Angeles" });
    await postWebhook(stripeEvent("invoice.payment_failed", failedInvoiceFixture()));

    const payload = await deliveredPayload("billing.invoice_failed");
    expect(payload.nextAttemptFormatted).toBe("17 October 2026");
  });

  it("formats the next attempt in the RECIPIENT's language", async () => {
    const { owner } = await billingTenant({ language: "en" });
    await prisma.user.update({ where: { id: owner.id }, data: { language: "hu" } });

    await postWebhook(stripeEvent("invoice.payment_failed", failedInvoiceFixture()));
    const payload = await deliveredPayload("billing.invoice_failed");

    expect(payload.amountFormatted).toBe("49,99\u00A0EUR");
    expect(payload.nextAttemptFormatted).toBe("2026. október 18.");
  });

  it("passes null through as null — never as 1970", async () => {
    // The single worst output this template could produce. formatDate({value:0})
    // does NOT throw and does NOT return the "—" fallback: 0 is a valid Date,
    // so a `?? 0` anywhere on this path renders "1 January 1970" in a critical
    // email. Asserted on the payload AND on the rendered HTML.
    await billingTenant({ language: "en" });
    await postWebhook(
      stripeEvent("invoice.payment_failed", failedInvoiceFixture({ next_payment_attempt: null }))
    );

    const payload = await deliveredPayload("billing.invoice_failed");
    expect(payload.nextAttemptFormatted).toBeNull();

    const rendered = await invoiceFailedEmailTemplate({ ...payload, locale: "en" });
    expect(rendered.html).not.toContain("1970");
    expect(rendered.html).not.toContain("January");
  });

  it("builds the CTA from the app URL, and does not store it in the event", async () => {
    // portalUrl is a property of the DEPLOYMENT, not of the event. A copy
    // frozen into the context would go stale against an APP_URL change while
    // the row sat in the outbox — and it is the only CTA of a critical email.
    await billingTenant({ language: "en" });
    await postWebhook(stripeEvent("invoice.payment_failed", failedInvoiceFixture()));

    const event = (await prisma.notificationEvent.findFirst({
      where: { type: "billing.invoice_failed" },
    }))!;
    const context = JSON.parse(event.context!);
    expect(context).not.toHaveProperty("portalUrl");

    const payload = await deliveredPayload("billing.invoice_failed");

    // Asserted as a LITERAL, not as `${config.frontendUrl}/subscription`. That
    // interpolation is the implementation restated: it holds for
    // config.frontendUrl alone, for a wrong path, for any value at all — a test
    // that cannot fail for the property it names. The suite runs with APP_URL
    // unset, so config.ts's documented fallback is the expected origin here.
    expect(payload.portalUrl).toBe("http://localhost:5173/subscription");
  });

  it("stores RAW values in the context, never rendered text", async () => {
    await billingTenant({ language: "en" });
    await postWebhook(stripeEvent("invoice.payment_failed", failedInvoiceFixture()));

    const event = (await prisma.notificationEvent.findFirst({
      where: { type: "billing.invoice_failed" },
    }))!;
    const context = JSON.parse(event.context!);

    expect(context.amountMinor).toBe(4999);
    expect(context.attemptNumber).toBe(1);
    expect(context.nextAttemptAt).toBe(NEXT_ATTEMPT_AT);
    expect(context).not.toHaveProperty("amountFormatted");
    expect(context).not.toHaveProperty("nextAttemptFormatted");
    // No plan and no status: the trigger has verified neither, and the
    // no-liveness-gate decision depends on the copy never claiming them.
    expect(context).not.toHaveProperty("planName");
  });

  it("renders end to end from a context with no plan or period", async () => {
    // Catches reusing parseInvoiceNotificationContext, which hard-requires
    // planName, periodStartAt and periodEndAt and would throw
    // BillingContractError — killing a mandatory critical email inside the
    // worker rather than at the trigger.
    await billingTenant({ language: "en" });
    await postWebhook(stripeEvent("invoice.payment_failed", failedInvoiceFixture()));

    const payload = await deliveredPayload("billing.invoice_failed");
    const rendered = await invoiceFailedEmailTemplate({ ...payload, locale: "en" });

    expect(rendered.html).toContain("49.99");
    expect(rendered.html).toContain("18 October 2026");
  });
});

describe("Slice 4 — the advance notice, end to end", () => {
  it("turns a signed invoice.upcoming into a sent heads-up", async () => {
    const { company, owner, employee } = await renewingTenant();

    const res = await postWebhook(stripeEvent("invoice.upcoming", upcomingInvoiceFixture()));
    expect(res.status).toBe(200);

    const event = await prisma.notificationEvent.findFirst({
      where: { type: "billing.renewal_upcoming" },
    });
    expect(event).not.toBeNull();
    // K3 — subscription + the renewal instant. There is no invoice id to key on.
    expect(event!.dedupeKey).toBe(`billing.renewal_upcoming/sub_test_billing/${RENEWS_AT}`);
    expect(event!.companyId).toBe(company.id);

    await dispatchEvent(event!.id);
    const deliveries = await prisma.notificationDelivery.findMany({
      where: { eventId: event!.id },
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].recipientAddress).toBe(owner.email);
    expect(deliveries.map((d) => d.recipientAddress)).not.toContain(employee.email);

    await deliverEmail(deliveries[0].id);
    const sent = await prisma.notificationDelivery.findUnique({
      where: { id: deliveries[0].id },
    });
    expect(sent!.status).toBe("sent");
    expect(sent!.providerMessageId).toMatch(/^mock_/);
  });

  it("warns ONCE per cycle, and again the NEXT cycle", async () => {
    // Both halves of K3 in one test. Two Stripe deliveries for one renewal are
    // two DIFFERENT event ids, so the HANDLED_EVENTS ledger cannot suppress the
    // second — only the dedupeKey can, which is why it may not be event-keyed.
    // And the next cycle must get through, which is why the key may not be the
    // subscription alone (the plan's own K3 sabotage row).
    await renewingTenant();

    await postWebhook(stripeEvent("invoice.upcoming", upcomingInvoiceFixture(), "evt_up_a"));
    await postWebhook(stripeEvent("invoice.upcoming", upcomingInvoiceFixture(), "evt_up_b"));
    expect(
      await prisma.notificationEvent.count({ where: { type: "billing.renewal_upcoming" } })
    ).toBe(1);

    const nextCycle = upcomingInvoiceFixture({
      lines: {
        object: "list",
        data: [
          {
            id: "il_next_cycle",
            object: "line_item",
            amount: 2500,
            period: { start: CYCLE_END, end: CYCLE_END + 30 * DAY_SECONDS },
            parent: {
              type: "subscription_item_details",
              subscription_item_details: { proration: false, subscription_item: "si_test" },
            },
          },
        ],
      },
    });
    await postWebhook(stripeEvent("invoice.upcoming", nextCycle, "evt_up_next"));

    expect(
      await prisma.notificationEvent.count({ where: { type: "billing.renewal_upcoming" } })
    ).toBe(2);
  });

  it("keys on the very instant it emails", async () => {
    // If the key were built from invoice.period_end while the email rendered
    // the cycle line's start, the two would agree in the happy path and diverge
    // exactly when a pending invoice item stretches the association window — at
    // which point at-most-once stops tracking the claim being made.
    await renewingTenant();
    await postWebhook(stripeEvent("invoice.upcoming", upcomingInvoiceFixture()));

    const event = (await prisma.notificationEvent.findFirst({
      where: { type: "billing.renewal_upcoming" },
    }))!;
    const context = JSON.parse(event.context!);

    // Both sides asserted against the FIXTURE's known instant, not against each
    // other. Comparing the key to the context alone cannot fail: the handler
    // builds them from one local, so they agree even when that local holds the
    // wrong field entirely. An independent oracle is what makes this a test.
    expect(event.dedupeKey!.split("/").pop()).toBe(String(RENEWS_AT));
    expect(context.renewsAt).toBe(RENEWS_AT);
  });

  it("suppresses a redelivery of the same event", async () => {
    await renewingTenant();
    const event = stripeEvent("invoice.upcoming", upcomingInvoiceFixture(), "evt_up_once");

    const first = await postWebhook(event);
    const second = await postWebhook(event);

    expect(first.body.duplicate).toBeUndefined();
    expect(second.body.duplicate).toBe(true);
    expect(await prisma.processedStripeEvent.count()).toBe(1);
  });
});

describe("Slice 4 — the date is the CYCLE line's start", () => {
  it("states when the next cycle BEGINS", async () => {
    // Four candidates, one right answer. invoice.period_end (a day before) is
    // the Slice 1 trap; line.period.end is a whole cycle late; the proration
    // and support lines start three days ago. Only the cycle line's period
    // .start is the renewal.
    await renewingTenant({ language: "en" });
    await postWebhook(stripeEvent("invoice.upcoming", upcomingInvoiceFixture()));

    const payload = await deliveredPayload("billing.renewal_upcoming");
    const expected = new Intl.DateTimeFormat("en-GB", {
      dateStyle: "long",
      timeZone: "UTC",
    }).format(new Date(RENEWS_AT * 1000));

    expect(payload.renewalDateFormatted).toBe(expected);
  });

  it("stores the cycle line's start in the context, not any neighbour", async () => {
    await renewingTenant();
    await postWebhook(stripeEvent("invoice.upcoming", upcomingInvoiceFixture()));

    const event = (await prisma.notificationEvent.findFirst({
      where: { type: "billing.renewal_upcoming" },
    }))!;
    const context = JSON.parse(event.context!);

    expect(context.renewsAt).toBe(RENEWS_AT);
    // Every wrong answer, named, so a change to the selector says which one it
    // regressed to.
    expect(context.renewsAt).not.toBe(ASSOC_END);
    expect(context.renewsAt).not.toBe(ASSOC_START);
    expect(context.renewsAt).not.toBe(CYCLE_END);
    expect(context.renewsAt).not.toBe(UPCOMING_PRORATION_START);
  });

  it("sends NOTHING when the preview has no full-cycle line", async () => {
    // Deliberately no fallback. subscriptionInvoiceLine()'s largest-amount
    // fallback would return the proration here, whose period.start is already
    // in the past — a plausible-looking date that fails silently. Refusing does
    // not.
    await renewingTenant();
    await postWebhook(
      stripeEvent(
        "invoice.upcoming",
        upcomingInvoiceFixture({
          lines: {
            object: "list",
            data: [
              {
                id: "il_only_proration",
                object: "line_item",
                amount: 7000,
                period: { start: UPCOMING_PRORATION_START, end: RENEWS_AT },
                parent: {
                  type: "subscription_item_details",
                  subscription_item_details: { proration: true, subscription_item: "si_test" },
                },
              },
            ],
          },
        })
      )
    );

    expect(await prisma.notificationEvent.count()).toBe(0);
    expect(await prisma.processedStripeEvent.count()).toBe(1);
  });

  it("renders the date in the company's timezone, which can change the DAY", async () => {
    // For this message the zone is not cosmetic: the whole content is one date.
    const lateNight = RENEWS_AT - (RENEWS_AT % DAY_SECONDS) + 23 * 60 * 60; // 23:00 UTC
    await renewingTenant({ language: "en", timezone: "Pacific/Auckland" });
    await postWebhook(
      stripeEvent(
        "invoice.upcoming",
        upcomingInvoiceFixture({
          lines: {
            object: "list",
            data: [
              {
                id: "il_cycle_late",
                object: "line_item",
                amount: 2500,
                period: { start: lateNight, end: lateNight + 30 * DAY_SECONDS },
                parent: {
                  type: "subscription_item_details",
                  subscription_item_details: { proration: false, subscription_item: "si_test" },
                },
              },
            ],
          },
        })
      )
    );

    const payload = await deliveredPayload("billing.renewal_upcoming");
    const inAuckland = new Intl.DateTimeFormat("en-GB", {
      dateStyle: "long",
      timeZone: "Pacific/Auckland",
    }).format(new Date(lateNight * 1000));
    const inUtc = new Intl.DateTimeFormat("en-GB", {
      dateStyle: "long",
      timeZone: "UTC",
    }).format(new Date(lateNight * 1000));

    // The fixture is chosen so the two genuinely differ — otherwise this test
    // would pass against code that ignored the zone entirely.
    expect(inAuckland).not.toBe(inUtc);
    expect(payload.renewalDateFormatted).toBe(inAuckland);
  });
});

describe("Slice 4 — the amount is what Stripe will actually take", () => {
  it("uses amount_due, not total or subtotal", async () => {
    // 6000 subtotal, 5500 total, 4500 due — the gap is account credit, which
    // only amount_due accounts for. Quoting total would overstate the charge to
    // exactly the customers holding credit from a mid-cycle downgrade.
    await renewingTenant({ language: "en" });
    await postWebhook(stripeEvent("invoice.upcoming", upcomingInvoiceFixture()));

    const payload = await deliveredPayload("billing.renewal_upcoming");
    expect(payload.amountFormatted).toBe("€45.00");
  });

  it("says nothing when nothing will be charged", async () => {
    await renewingTenant();
    await postWebhook(
      stripeEvent("invoice.upcoming", upcomingInvoiceFixture({ amount_due: 0 }))
    );

    expect(await prisma.notificationEvent.count()).toBe(0);
    expect(await prisma.processedStripeEvent.count()).toBe(1);
  });

  it("formats in the RECIPIENT's language", async () => {
    const { owner } = await renewingTenant({ language: "en" });
    await prisma.user.update({ where: { id: owner.id }, data: { language: "hu" } });

    await postWebhook(stripeEvent("invoice.upcoming", upcomingInvoiceFixture()));
    const payload = await deliveredPayload("billing.renewal_upcoming");

    expect(payload.amountFormatted).toBe("45,00\u00A0EUR");
  });
});

describe("Slice 4 — the gates that make the sentence true", () => {
  it("says nothing when the customer has already cancelled", async () => {
    // "We'll charge you on the 1st" to someone who cancelled last week is how
    // you cause the chargeback this message exists to prevent.
    const { company } = await renewingTenant();
    await prisma.company.update({
      where: { id: company.id },
      data: { cancelAtPeriodEnd: true },
    });

    await postWebhook(stripeEvent("invoice.upcoming", upcomingInvoiceFixture()));
    expect(await prisma.notificationEvent.count()).toBe(0);
  });

  it("says nothing in past_due, where the mandatory dunning email contradicts it", async () => {
    // The reason this uses its own predicate rather than
    // ACTIVE_SUBSCRIPTION_STATUSES, which includes past_due: that customer is
    // already receiving billing.invoice_failed saying the subscription is about
    // to end and access is at risk. Two Axeriva emails asserting opposite
    // things, and only the wrong one can be switched off.
    const { company } = await renewingTenant();
    await prisma.company.update({
      where: { id: company.id },
      data: { subscriptionStatus: "past_due" },
    });

    await postWebhook(stripeEvent("invoice.upcoming", upcomingInvoiceFixture()));
    expect(await prisma.notificationEvent.count()).toBe(0);
  });

  it("DOES send while trialing — the first real charge is the point", async () => {
    // The single highest-value instance of this notice: the customer has never
    // been billed, and the card may have been collected only at signup. Guards
    // against over-gating the status predicate down to "active".
    const { company } = await renewingTenant();
    await prisma.company.update({
      where: { id: company.id },
      data: { subscriptionStatus: "trialing" },
    });

    await postWebhook(stripeEvent("invoice.upcoming", upcomingInvoiceFixture()));
    expect(
      await prisma.notificationEvent.count({ where: { type: "billing.renewal_upcoming" } })
    ).toBe(1);
  });

  it.each([
    ["a DIFFERENT subscription", "sub_something_else"],
    ["no stored subscription at all", null],
  ])("says nothing when the company is on %s", async (_label, stripeSubscriptionId) => {
    const { company } = await renewingTenant();
    await prisma.company.update({
      where: { id: company.id },
      data: { stripeSubscriptionId },
    });

    await postWebhook(stripeEvent("invoice.upcoming", upcomingInvoiceFixture()));
    expect(await prisma.notificationEvent.count()).toBe(0);
  });

  it("says nothing for a manually managed plan", async () => {
    // Founder/Enterprise are operator-assigned and applySubscriptionUpdate
    // refuses to write Company for them, so every field the gates read is
    // frozen and none of it can be trusted.
    const { company } = await renewingTenant();
    await prisma.company.update({ where: { id: company.id }, data: { plan: "founder" } });

    await postWebhook(stripeEvent("invoice.upcoming", upcomingInvoiceFixture()));
    expect(await prisma.notificationEvent.count()).toBe(0);
  });

  it("says nothing about a renewal that has already happened", async () => {
    // The only claim in this milestone that decays purely by arriving late. A
    // redelivery days after the fact would announce a charge already taken.
    await renewingTenant();
    const past = nowSeconds() - 2 * DAY_SECONDS;

    await postWebhook(
      stripeEvent(
        "invoice.upcoming",
        upcomingInvoiceFixture({
          lines: {
            object: "list",
            data: [
              {
                id: "il_cycle_past",
                object: "line_item",
                amount: 2500,
                period: { start: past, end: past + 30 * DAY_SECONDS },
                parent: {
                  type: "subscription_item_details",
                  subscription_item_details: { proration: false, subscription_item: "si_test" },
                },
              },
            ],
          },
        })
      )
    );

    expect(await prisma.notificationEvent.count()).toBe(0);
  });
});

describe("Slice 4 — previews this handler must not act on", () => {
  it.each([
    ["a Dashboard one-off invoice", { parent: null }],
    ["a quote-generated invoice", { parent: { type: "quote_details", quote_details: {} } }],
    ["a send_invoice subscription", { collection_method: "send_invoice" }],
  ])("ignores %s", async (_label, override) => {
    await renewingTenant();
    await postWebhook(stripeEvent("invoice.upcoming", upcomingInvoiceFixture(override)));

    expect(await prisma.notificationEvent.count()).toBe(0);
    expect(await prisma.processedStripeEvent.count()).toBe(1);
  });

  it("refuses, and logs usably, when the subscription id is missing", async () => {
    // The SDK types this non-nullable, but the same interface types `id` as
    // required and Stripe demonstrably omits THAT for this event — so it is
    // checked, not trusted. The id is half the dedupeKey: without it there is
    // no at-most-once protection at all.
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await renewingTenant();
      await postWebhook(
        stripeEvent(
          "invoice.upcoming",
          upcomingInvoiceFixture({
            parent: { type: "subscription_details", subscription_details: {} },
          })
        )
      );

      expect(await prisma.notificationEvent.count()).toBe(0);
      expect(await prisma.processedStripeEvent.count()).toBe(1);

      // And the log must not print "undefined" — this event has no invoice id,
      // so copying the sibling branches' `${invoice.id}` logging would leave an
      // operator with nothing to search for.
      const logged = warn.mock.calls.map((c) => String(c[0])).join(" ");
      expect(logged).toContain("no subscription id");
      expect(logged).not.toContain("undefined");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("Slices 1-2 — a receipt is a message the customer may switch off", () => {
  it("suppresses the plan-change receipt when the owner disabled billing_receipts", async () => {
    // The registry's two policy fields are `category: "billing_receipts"` and
    // `mandatory: false`, and neither is observable by reading the entry back —
    // a test that asserted the literals would pass against a registry that the
    // GATE ignores. So it is proved where it takes effect.
    //
    // Q2's line: a "we charged you again" receipt is a courtesy the customer
    // may decline; the messages they cannot decline are the critical ones
    // (payment failed, subscription ended), which live in the mandatory
    // `billing` category. Getting this wrong in either direction is a real
    // defect — `mandatory: true` makes the switch on the preference screen a
    // lie, and `category: "billing"` puts the type in a MANDATORY_CATEGORY the
    // preference API refuses to configure at all.
    const { company, owner } = await billingTenant();
    await prisma.notificationPreference.create({
      data: {
        companyId: company.id,
        userId: owner.id,
        category: "billing_receipts",
        channel: "EMAIL",
        enabled: false,
      },
    });

    await postWebhook(stripeEvent("invoice.paid", planChangeInvoiceFixture()));

    const event = (await prisma.notificationEvent.findFirst({
      where: { type: "billing.invoice_paid" },
    }))!;
    await dispatchEvent(event.id);

    const delivery = (await prisma.notificationDelivery.findFirst({
      where: { eventId: event.id },
    }))!;
    expect(delivery.status).toBe("suppressed");
    expect(delivery.suppressionReason).toBe("user_preference");
  });
});

describe("Slice 2 — the invoice link is optional", () => {
  it("renders the receipt with no CTA when Stripe supplied no hosted URL", async () => {
    await billingTenant({ language: "en" });
    await postWebhook(
      stripeEvent("invoice.paid", planChangeInvoiceFixture({ hosted_invoice_url: null }))
    );

    const payload = await deliveredPayload("billing.invoice_paid");
    expect(payload.invoiceUrl).toBeNull();

    const rendered = await invoicePaidEmailTemplate({ ...payload, locale: "en" });
    expect(rendered.html).not.toContain('href=""');
    expect(rendered.html).toContain("12.50");
  });
});
