import { Router } from "express";
import Stripe from "stripe";
import prisma from "../database/prisma";
import { Prisma } from "@prisma/client";
import { stripe } from "../services/stripe/stripeClient";
import {
  applySubscriptionUpdate,
  markSubscriptionCanceled,
  reconcileCheckoutCompletion,
} from "../services/stripe/syncSubscription";
import { notify } from "../services/notifications/notify";
import type { NotificationTypeKey } from "../services/notifications/registry";
import { planDisplayName } from "../constants/plans";
import { planForPriceId } from "../config/stripePricing";
import { ACTIVE_SUBSCRIPTION_STATUSES } from "../constants/subscriptionStatuses";
import { config } from "../config";

const router = Router();

async function resolveCompanyId(
  metadataCompanyId: string | null | undefined,
  stripeCustomerId: string | null
): Promise<number | null> {
  if (metadataCompanyId) {
    return Number(metadataCompanyId);
  }

  if (!stripeCustomerId) {
    return null;
  }

  const company = await prisma.company.findFirst({
    where: { stripeCustomerId },
  });

  return company?.id ?? null;
}

// Design C idempotency ledger (AC16). Only the handled event types are
// recorded — unhandled ones are pure acks, nothing to protect.
// Membership here is what turns on replay protection: the wasEventProcessed
// gate below only runs for types in this Set. Adding a `case` without adding
// the type here produces a handler with NO idempotency at all — silently. So
// the Set is extended in the same commit as the handler, never after it.
const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  // N1.8 Slices 1-2. ONE entry for both: Slice 2 routes a different
  // billing_reason of the SAME Stripe event, so it needs no new Dashboard
  // subscription — unlike every slice that adds an event type here, which
  // does (docs/notification-rollout.md §1a-bis).
  "invoice.paid",
]);

// N1.8 K1 — `invoice.paid` produces AT MOST ONE customer-facing notification,
// and `billing_reason` is what decides which. One payment, one email.
//
//   subscription_cycle  → the periodic renewal receipt (Slice 1).
//
//   subscription_update → the mid-cycle plan-change receipt (Slice 2). In this
//       product that means an upgrade the customer approved on Stripe's hosted
//       confirmation page: that portal configuration sets proration_behavior
//       "always_invoice" (scripts/stripeSetup.ts:107), so Stripe invoices and
//       charges the proration immediately. Worth knowing before concluding
//       this handler is dead — under the default proration_behavior the
//       proration would instead ride the NEXT cycle invoice and this reason
//       would never arrive at all.
//
//   subscription_create → NOTHING, deliberately. It is the FIRST payment,
//       which checkout.session.completed already acknowledged; sending here
//       as well would give the customer both "welcome" and a receipt for a
//       single charge.
//
//   everything else (manual, subscription_threshold, quote_accept, …) →
//       nothing in N1.8.
//
// A reason with no entry is still recorded in the ledger before the handler
// breaks, so a redelivery is never re-evaluated.
// Keyed off the FIELD's own type rather than a hand-written string union: an
// SDK upgrade that renames or removes a billing_reason then fails to compile
// here instead of silently routing nothing.
const INVOICE_PAID_NOTIFICATION: Partial<
  Record<NonNullable<Stripe.Invoice["billing_reason"]>, NotificationTypeKey>
> = {
  subscription_cycle: "billing.subscription_renewed",
  subscription_update: "billing.invoice_paid",
};

// P1 — the SERVICE period, which is not what invoice.period_start/period_end
// mean.
//
// The installed SDK documents those two fields verbatim as "The earliest/latest
// timestamp at which invoice items can be associated with this invoice. Use the
// line item period to get the service period for each price."
// (Invoices.d.ts:355-361). For a subscription_cycle invoice that window is the
// cycle that just CLOSED — so a receipt built from them told a customer billed
// on 1 October for October that their billing period was 1 September to 1
// October: one whole cycle stale, on the document they keep for accounting. On
// an annual plan, off by a year.
//
// This repo already knew the shape of this: syncSubscription.ts:40-46 notes
// that the current API version moved `current_period_end` from the subscription
// onto its line items, and reads items.data[0]. The same move happened on
// invoices; Slice 1 simply did not apply it here.
//
// SELECTING THE RIGHT LINE MATTERS AS MUCH AS USING LINES AT ALL. The first
// attempt at this filtered on `item.period`, which is a REQUIRED, non-nullable
// field on every line item (InvoiceLineItems.d.ts:55) — so the predicate was
// always true and the code was exactly `data[0]`, while the comment claimed a
// selection it never performed.
//
// `data[0]` is the WRONG line whenever the invoice carries anything besides the
// subscription. Stripe documents the ordering (Invoices.d.ts:322): "(1) pending
// invoice items (including prorations) in reverse chronological order, (2)
// subscription items ...". A support operator issuing a one-off credit or
// charge from the Dashboard creates a pending invoice item that sorts AHEAD of
// the subscription line, and the receipt would then state that credit's period
// — a mid-cycle window, or a degenerate start == end instant.
//
// So select on what the line IS, using the discriminator the SDK provides:
// parent.type === "subscription_item_details" (InvoiceLineItems.d.ts:211).
// Prefer the non-proration line, because a subscription_update invoice carries
// proration lines that are also subscription lines but describe a partial
// window rather than the cycle.
//
// Slice 2 is where that preference starts paying: a subscription_update invoice
// is USUALLY all-proration (the credit for the old plan's unused time, the
// charge for the new plan's remaining time), so it takes the fallback below and
// reports the remainder of the cycle — which is exactly the window that charge
// covers. When such an invoice also carries a full-cycle subscription line, that
// line is the one describing a period the customer was actually billed a cycle
// for, and it wins.
function subscriptionInvoiceLine(invoice: Stripe.Invoice): Stripe.InvoiceLineItem | undefined {
  const subscriptionLines = (invoice.lines?.data ?? []).filter(
    (item) => item.parent?.type === "subscription_item_details"
  );

  const fullCycle = subscriptionLines.find(
    (item) => item.parent?.subscription_item_details?.proration === false
  );
  if (fullCycle) return fullCycle;

  // ALL-PRORATION INVOICE — the normal shape of a subscription_update invoice,
  // and where Slice 2 lives. Stripe puts TWO subscription lines on it and both
  // describe the same instant: a NEGATIVE credit for the unused time on the OLD
  // price, and a POSITIVE charge for the remaining time on the NEW one.
  //
  // Their order is not something to rely on — Stripe documents prorations as
  // sorted in reverse chronological order, and these two are created at the
  // same moment. Taking whichever came first therefore picked the old plan's
  // line about half the time, which matters because this line now names the
  // plan the receipt states. The line the customer is PAYING for is the one
  // with the larger amount; the credit is negative by construction.
  return subscriptionLines.reduce<Stripe.InvoiceLineItem | undefined>(
    (best, item) => (best && best.amount >= item.amount ? best : item),
    undefined
  );
}

function invoiceServicePeriod(invoice: Stripe.Invoice): {
  periodStartAt: number;
  periodEndAt: number;
} {
  const line = subscriptionInvoiceLine(invoice);

  // The invoice-level window only when there is no subscription line at all.
  // It is the association window rather than the service period, so it is a
  // last resort — but a coarse period beats a receipt that cannot render.
  return {
    periodStartAt: line?.period?.start ?? invoice.period_start,
    periodEndAt: line?.period?.end ?? invoice.period_end,
  };
}

// The plan the invoice actually BILLED, resolved from the price on that same
// line — not from Company.plan.
//
// Company.plan is a copy, and for a plan-change receipt it is a copy that may
// not have caught up yet. Stripe emits `customer.subscription.updated` and
// `invoice.paid` for one hosted upgrade with NO ordering guarantee between
// them, and applySubscriptionUpdate runs on the former. Reached in the order
// Stripe happens to deliver, this handler can therefore read the plan the
// customer just LEFT and tell them "you are now on the Starter plan" moments
// after they paid to leave it. The customer-return sync endpoint closes the
// window only for a customer who actually returns to the app.
//
// The invoice does not have that problem: it is a finished document about a
// payment that already happened, and the price on it is the price that was
// charged. Same principle the repo already applies in syncSubscription.ts —
// resolve the plan from the PRICE that was purchased, never from a string.
//
// Falls back to null (caller keeps Company.plan) rather than guessing when the
// price is unrecognised — a legacy or misconfigured price must not blank out a
// receipt's plan name.
function invoicePlanId(invoice: Stripe.Invoice): string | null {
  const price = subscriptionInvoiceLine(invoice)?.pricing?.price_details?.price;
  return planForPriceId(typeof price === "string" ? price : price?.id);
}

async function wasEventProcessed(eventId: string): Promise<boolean> {
  const seen = await prisma.processedStripeEvent.findUnique({ where: { id: eventId } });
  return Boolean(seen);
}

// Records the event as handled. Returns true only for the FIRST recording —
// a concurrent duplicate delivery loses the unique-id race (Prisma P2002)
// and gets false, which is what keeps the confirmation email at-most-once.
// ONLY the unique violation is absorbed: any other failure (connection blip,
// pool exhaustion) rethrows so the handler returns non-2xx and Stripe
// redelivers — otherwise a transient ledger failure would silently drop the
// email and leave a hole in the ledger.
async function markEventProcessed(eventId: string, type: string): Promise<boolean> {
  try {
    await prisma.processedStripeEvent.create({ data: { id: eventId, type } });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return false;
    }
    throw error;
  }
}

router.post("/", async (req, res) => {
  const signature = req.headers["stripe-signature"];
  const webhookSecret = config.stripe.webhookSecret;

  if (!signature || !webhookSecret) {
    return res.status(400).json({ error: "Webhook not configured" });
  }

  let event: Stripe.Event;

  try {
    // req.body is the raw Buffer here — see index.ts, this route is mounted
    // with express.raw() instead of the global express.json().
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (error) {
    console.error("[stripe webhook] signature verification failed", error);
    return res.status(400).json({ error: "Invalid signature" });
  }

  // Idempotency guard (AC16): a redelivery of an already-handled event is
  // acked without re-processing. State writes are absolute (harmless to
  // repeat); the guard exists so a redelivery can never re-send the
  // confirmation email or re-apply a stale snapshot after newer state landed.
  if (HANDLED_EVENTS.has(event.type) && (await wasEventProcessed(event.id))) {
    return res.json({ received: true, duplicate: true });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const companyId = await resolveCompanyId(
        session.metadata?.companyId,
        typeof session.customer === "string" ? session.customer : null
      );

      if (companyId && session.subscription) {
        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription.id;

        const subscription = await stripe.subscriptions.retrieve(subscriptionId);

        // AC3 second layer: a session completing NEXT TO an already-open
        // subscription is a duplicate — reconciliation cancels the incoming
        // one instead of applying it (and no confirmation email goes out).
        const outcome = await reconcileCheckoutCompletion(
          companyId,
          subscription,
          typeof session.customer === "string" ? session.customer : undefined
        );

        // Recorded only AFTER the state write succeeded, so a failure above
        // still returns non-2xx and Stripe redelivers (self-healing). The
        // return value is no longer read: at-most-once for the notification is
        // now enforced by its dedupeKey (below), which holds even if this
        // ledger write and the notify() ever drift apart.
        await markEventProcessed(event.id, event.type);

        // First-time activation only — customer.subscription.updated also
        // fires on renewals/plan changes, which shouldn't re-send this.
        const company = await prisma.company.findUnique({
          where: { id: companyId },
        });

        if (outcome === "applied" && company) {
          // N1.5 — recipient resolution (the company's owner) now lives in the
          // notification module, so the findFirst that used to be here is gone.
          //
          // The dedupeKey carries the Stripe event id, which makes at-most-once
          // a property of the DATA rather than of this handler's control flow:
          // the previous `firstDelivery` gate only held because the ledger
          // write happened to sit in the same function. A redelivery now
          // collides on the unique index instead.
          //
          // Nothing is rendered or sent here: notify() writes one row and
          // returns, so the 2xx this webhook owes Stripe is never waiting on an
          // email — the constraint stripe-webhook-production-readiness.md
          // spells out.
          await notify({
            type: "billing.subscription_created",
            companyId,
            dedupeKey: `billing.subscription_created/${event.id}`,
            context: {
              companyName: company.name,
              planName: company.plan === "pro" ? "Axeriva Pro" : company.plan,
            },
          });
        }
      }

      break;
    }

    case "customer.subscription.updated": {
      const eventSubscription = event.data.object as Stripe.Subscription;
      const companyId = await resolveCompanyId(
        eventSubscription.metadata?.companyId,
        typeof eventSubscription.customer === "string" ? eventSubscription.customer : null
      );

      if (companyId) {
        // Ordering guard (Design C): the event payload is a SNAPSHOT — Stripe
        // guarantees neither ordering nor single delivery, so applying it
        // as-is lets a delayed/redelivered old snapshot overwrite newer state
        // (e.g. revert a just-confirmed upgrade, or resurrect a dead
        // subscription as "active"). The subscription's CURRENT state is
        // re-retrieved instead — same self-healing pattern the
        // checkout.session.completed handler already uses; a retrieve failure
        // propagates → non-2xx → Stripe redelivers.
        const subscription = await stripe.subscriptions.retrieve(eventSubscription.id);

        // Stale-event guard: an update about a FOREIGN subscription (not the
        // company's current one) that is dead/dying must never overwrite the
        // live one — e.g. the old subscription's final events arriving after
        // the customer already re-subscribed via Checkout. A foreign
        // subscription that IS (freshly verified) live is allowed through:
        // that is the legitimate "new subscription's events arrived before
        // the checkout handler wrote its id" ordering.
        const company = await prisma.company.findUnique({
          where: { id: companyId },
          select: { stripeSubscriptionId: true },
        });
        const isForeign =
          Boolean(company?.stripeSubscriptionId) &&
          company!.stripeSubscriptionId !== subscription.id;
        const isLive =
          subscription.status === "active" || subscription.status === "trialing";

        if (isForeign && !isLive) {
          console.warn(
            `[stripe webhook] ignoring stale ${subscription.status} update for ` +
              `${subscription.id} (company ${companyId} is on ${company!.stripeSubscriptionId})`
          );
        } else {
          await applySubscriptionUpdate(companyId, subscription);
        }
      }

      await markEventProcessed(event.id, event.type);
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const companyId = await resolveCompanyId(
        subscription.metadata?.companyId,
        typeof subscription.customer === "string" ? subscription.customer : null
      );

      if (companyId) {
        // markSubscriptionCanceled is itself id-aware (AC15) — a deleted
        // event for a stale subscription is ignored inside it.
        await markSubscriptionCanceled(companyId, subscription);
      }

      await markEventProcessed(event.id, event.type);
      break;
    }

    // N1.8 Slices 1-2 — the invoice receipts.
    //
    // NO STALE GUARD in the subscription sense: the guard on
    // customer.subscription.updated re-fetches state because a late snapshot
    // could overwrite newer state, and an invoice event overwrites nothing.
    // But "does not overwrite state" is NOT the same as "is always true to
    // send", which is what the first version of this comment got wrong. The
    // payload's fact is "this invoice was paid" — not "the subscription
    // renewed", and the plan name is not in the payload at all. Hence the
    // liveness check below.
    //
    // ONE branch serves both receipts on purpose. Everything after the routing
    // line — company resolution, the ledger write, the liveness gate, the
    // service period, the raw context — is identical for the two, and the only
    // way to keep it identical is to have one copy of it. Slice 2 changed the
    // TYPE that comes out; it changed nothing about how it is decided.
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;

      // K1 routing — see INVOICE_PAID_NOTIFICATION above. The installed SDK
      // declares NINE billing reasons (Invoices.d.ts:474); two are mapped and
      // the other seven produce nothing.
      const notificationType = invoice.billing_reason
        ? INVOICE_PAID_NOTIFICATION[invoice.billing_reason]
        : undefined;

      if (!notificationType) {
        await markEventProcessed(event.id, event.type);
        break;
      }

      const companyId = await resolveCompanyId(
        undefined,
        typeof invoice.customer === "string" ? invoice.customer : null
      );

      // An invoice for a customer we cannot place is not an error — it is not
      // ours. Acknowledged and dropped, as agreed, rather than retried forever.
      if (!companyId) {
        console.warn(`[stripe webhook] invoice.paid for unknown customer, dropping ${invoice.id}`);
        await markEventProcessed(event.id, event.type);
        break;
      }

      const company = await prisma.company.findUnique({ where: { id: companyId } });

      await markEventProcessed(event.id, event.type);

      if (!company) break;

      // P3 — the subscription must still be ALIVE for "renewed" to be true.
      //
      // A dunning-exhausted subscription is cancelled, but its invoice stays
      // open and payable from the hosted invoice link. Paying it later does NOT
      // resurrect the subscription — yet Stripe still emits invoice.paid with
      // billing_reason "subscription_cycle". Without this check the customer
      // received "Acme is on the free plan for another billing period": the
      // renewal claim false, and the plan name the literal string the
      // cancellation path writes (syncSubscription markSubscriptionCanceled
      // sets plan "free"). Someone reading that could reasonably conclude they
      // were still covered and not re-subscribe.
      //
      // ACTIVE_SUBSCRIPTION_STATUSES deliberately includes past_due: a renewal
      // that has just failed is still a live subscription, and this branch only
      // runs for a PAID invoice anyway.
      //
      // Slice 2 inherits the gate unchanged, and needs it for the same reason:
      // a plan-change invoice can sit open through dunning too, and paying it
      // afterwards would otherwise announce "you are now on the — plan", the
      // plan name being whatever the cancellation path left behind.
      if (!ACTIVE_SUBSCRIPTION_STATUSES.includes(company.subscriptionStatus)) {
        console.warn(
          `[stripe webhook] invoice.paid for company ${companyId} whose subscription is ` +
            `${company.subscriptionStatus} — not sending ${notificationType} for ${invoice.id}`
        );
        break;
      }

      // Slice 2 — a plan change that took no money has no receipt to give.
      //
      // A mid-cycle DOWNGRADE prorates in the customer's favour: the credit for
      // unused time on the old plan exceeds the charge for the new one. Stripe
      // does not issue a negative invoice — it moves the difference to the
      // customer's credit balance and finalises this one at zero, which
      // auto-pays and emits invoice.paid all the same. An existing credit
      // balance absorbing the whole charge produces the same shape.
      //
      // "Payment received for your plan change — €0.00" is then simply untrue,
      // and it is the same failure class as P3 above: a receipt making a claim
      // its own payload does not support. The customer is not left uninformed —
      // the change itself belongs to `billing.plan_upgraded` /
      // `billing.plan_downgraded` (N1.8 Phase 2), which are mandatory and
      // report the CHANGE. This type reports MONEY TAKEN, and nothing was.
      //
      // Deliberately NOT applied to the renewal receipt: "your subscription
      // renewed" stays true at zero — a fully discounted cycle still renews the
      // coverage — so gating that one would suppress an accurate message.
      if (notificationType === "billing.invoice_paid" && invoice.amount_paid <= 0) {
        console.warn(
          `[stripe webhook] ${invoice.id} settled ${invoice.amount_paid} for company ` +
            `${companyId} — no payment to receipt, not sending ${notificationType}`
        );
        break;
      }

      await notify({
        type: notificationType,
        companyId,
        // K1/decision 1: keyed on the INVOICE id. A Stripe redelivery of this
        // event collides and is suppressed; next month's invoice is a
        // different id and sends. Deliberately not the event id, which would
        // let two different events about the SAME invoice both send.
        //
        // The type is part of the key, so the two receipts can never collide
        // with each other — they are keyed on disjoint billing_reasons and so
        // cannot both arise from one invoice, but a key that relied on that
        // would be relying on the routing table staying disjoint forever.
        dedupeKey: `${notificationType}/${invoice.id}`,
        // RAW values only — no formatted text. The recipient's locale is not
        // known here (User.language overrides Company.language and is
        // resolved per recipient during fan-out), so formatting happens in
        // the email channel. See emails/billingTypes.ts.
        context: {
          companyName: company.name,
          // The invoice's own plan wins over our stored copy — see
          // invoicePlanId. Company.plan remains the fallback, so a legacy or
          // unrecognised price still produces a named plan rather than a dash.
          planName: planDisplayName(invoicePlanId(invoice) ?? company.plan),
          amountMinor: invoice.amount_paid,
          currency: invoice.currency,
          ...invoiceServicePeriod(invoice),
          ...(company.timezone ? { timeZone: company.timezone } : {}),
          ...(invoice.hosted_invoice_url ? { invoiceUrl: invoice.hosted_invoice_url } : {}),
        },
      });

      break;
    }

    default:
      break;
  }

  return res.json({ received: true });
});

// Stripe only ever sends POST here. Without this, a GET (e.g. someone
// opening the URL in a browser) falls through this router unmatched and
// hits the authenticated /subscription router mounted further down in
// index.ts, returning a confusing "Missing or invalid token" 401 instead of
// a clear 404 for this public endpoint.
router.all("/", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

export default router;
