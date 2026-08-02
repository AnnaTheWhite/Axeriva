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
import { planDisplayName } from "../constants/plans";
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
  // N1.8 Slice 1.
  "invoice.paid",
]);

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
// window rather than the cycle — that matters from Slice 2 on, when this branch
// widens beyond billing_reason "subscription_cycle".
function invoiceServicePeriod(invoice: Stripe.Invoice): {
  periodStartAt: number;
  periodEndAt: number;
} {
  const lines = invoice.lines?.data ?? [];
  const subscriptionLines = lines.filter(
    (item) => item.parent?.type === "subscription_item_details"
  );

  const line =
    subscriptionLines.find(
      (item) => item.parent?.subscription_item_details?.proration === false
    ) ?? subscriptionLines[0];

  // The invoice-level window only when there is no subscription line at all.
  // It is the association window rather than the service period, so it is a
  // last resort — but a coarse period beats a receipt that cannot render.
  return {
    periodStartAt: line?.period?.start ?? invoice.period_start,
    periodEndAt: line?.period?.end ?? invoice.period_end,
  };
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

    // N1.8 Slice 1 — the renewal receipt.
    //
    // NO STALE GUARD in the subscription sense: the guard on
    // customer.subscription.updated re-fetches state because a late snapshot
    // could overwrite newer state, and an invoice event overwrites nothing.
    // But "does not overwrite state" is NOT the same as "is always true to
    // send", which is what the first version of this comment got wrong. The
    // payload's fact is "this invoice was paid" — not "the subscription
    // renewed", and the plan name is not in the payload at all. Hence the
    // liveness check below.
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;

      // K1 — billing_reason is what stops one payment producing two emails.
      // `subscription_create` is the FIRST payment, which checkout.session
      // .completed already acknowledged above; sending here as well would mean
      // a customer gets both "welcome" and "renewed" for the same charge.
      // Other reasons (manual, subscription_update, …) are Slice 2's.
      if (invoice.billing_reason !== "subscription_cycle") {
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
      if (company && !ACTIVE_SUBSCRIPTION_STATUSES.includes(company.subscriptionStatus)) {
        console.warn(
          `[stripe webhook] invoice.paid for company ${companyId} whose subscription is ` +
            `${company.subscriptionStatus} — not sending a renewal notice for ${invoice.id}`
        );
        break;
      }

      if (company) {
        await notify({
          type: "billing.subscription_renewed",
          companyId,
          // K1/decision 1: keyed on the INVOICE id. A Stripe redelivery of this
          // event collides and is suppressed; next month's invoice is a
          // different id and sends. Deliberately not the event id, which would
          // let two different events about the SAME invoice both send.
          dedupeKey: `billing.subscription_renewed/${invoice.id}`,
          // RAW values only — no formatted text. The recipient's locale is not
          // known here (User.language overrides Company.language and is
          // resolved per recipient during fan-out), so formatting happens in
          // the email channel. See emails/billingTypes.ts.
          context: {
            companyName: company.name,
            planName: planDisplayName(company.plan),
            amountMinor: invoice.amount_paid,
            currency: invoice.currency,
            ...invoiceServicePeriod(invoice),
            ...(company.timezone ? { timeZone: company.timezone } : {}),
            ...(invoice.hosted_invoice_url ? { invoiceUrl: invoice.hosted_invoice_url } : {}),
          },
        });
      }

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
