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
import { canUpgrade, isManuallyManaged } from "../services/planAccess";
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
  // N1.8 Slice 3. A NEW event type, so it DOES need the Stripe Dashboard step:
  // an endpoint not subscribed to invoice.payment_failed simply never receives
  // it, the case never runs, not one dunning warning is ever sent — and the
  // suite stays green, because the tests POST signed payloads straight at this
  // route and cannot observe endpoint subscription at all.
  "invoice.payment_failed",
  // N1.8 Slice 4. Another NEW event type, so another Dashboard subscription —
  // and this one has a SECOND Dashboard dependency behind it: how many days
  // ahead Stripe emits invoice.upcoming is an account-level setting with no
  // representation in this repository at all (Events.d.ts:1554). If it is off,
  // this slice ships complete, fully green, and never sends one email. See
  // docs/notification-rollout.md.
  "invoice.upcoming",
  // N1.8 Slice 5. The last new event type Phase 1 adds, so the last Dashboard
  // subscription it needs. Unlike the four above it is NOT an invoice event: it
  // fires on the CUSTOMER, which is why the handler resolves the company from
  // paymentMethod.customer and has no invoice, no amount and no period to read.
  "payment_method.attached",
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

// N1.8 Slice 4 — the line that describes the CYCLE ABOUT TO BEGIN.
//
// A separate selector from subscriptionInvoiceLine above, and the difference is
// the whole point rather than duplication. That one is built to always return
// something: its fallback takes the largest-amount proration, which is right for
// a receipt about money already taken. Here that fallback would be a defect —
// a proration's period.start is a mid-cycle instant already in the PAST, and
// this message's only content is a future date. A plausible wrong date fails
// silently; refusing does not.
//
// So: the non-proration subscription line, or nothing.
function upcomingRenewalLine(invoice: Stripe.Invoice): Stripe.InvoiceLineItem | undefined {
  return (invoice.lines?.data ?? []).find(
    (item) =>
      item.parent?.type === "subscription_item_details" &&
      item.parent.subscription_item_details?.proration === false
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

    // N1.8 Slice 6 builds into this branch — see the block after
    // applySubscriptionUpdate below, and the notify() after the ledger write.
    case "customer.subscription.updated": {
      const eventSubscription = event.data.object as Stripe.Subscription;
      const companyId = await resolveCompanyId(
        eventSubscription.metadata?.companyId,
        typeof eventSubscription.customer === "string" ? eventSubscription.customer : null
      );

      // N1.8 Slice 6 — captured inside the block below, consumed after the
      // ledger write. It has to be hoisted here because the plan §3 requires
      // notify() to run AFTER markEventProcessed, while the only place the
      // before/after plans both exist is inside the update block.
      let upgrade: {
        companyName: string;
        fromPlan: string;
        toPlan: string;
        timezone: string | null;
      } | null = null;

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
        // N1.8 Slice 6 widened this select. `plan` is the load-bearing
        // addition: applySubscriptionUpdate below OVERWRITES Company.plan
        // (syncSubscription.ts), so this read is the ONLY moment the plan the
        // customer is leaving still exists. Read it after the update and the
        // "from" and the "to" are the same string, every time, silently.
        const company = await prisma.company.findUnique({
          where: { id: companyId },
          select: { name: true, plan: true, timezone: true, stripeSubscriptionId: true },
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

          // N1.8 Slice 6 — did that write move the company UP a tier?
          //
          // THE PLAN IS RE-READ RATHER THAN RE-DERIVED, and the reason is not
          // laziness. applySubscriptionUpdate decides the next plan through
          // logic worth several branches — plan-carrying statuses, a fallback
          // to the stored plan when the price is unrecognised, an early return
          // for manually managed plans, pendingPlan self-healing. Recomputing
          // any of that here would create a second, drift-capable answer to
          // "what plan is this company on", and it would drift in exactly the
          // cases that matter: an unknown price, a Founder company, a
          // non-plan-carrying status. Reading the row back measures what
          // ACTUALLY happened, for the cost of one query.
          //
          // It also makes three of this slice's gates disappear rather than be
          // written: a manually managed plan returns early above, so before ==
          // after; an unrecognised price falls back to the stored plan, so
          // before == after; a cancelled subscription writes "free", which is a
          // tier DOWN and fails canUpgrade. None needs its own condition.
          const updated = await prisma.company.findUnique({
            where: { id: companyId },
            select: { plan: true },
          });

          // THE SCOPE GATE, and it is the one thing here that is not implied by
          // the tier comparison.
          //
          // `customer.subscription.updated` also fires while a BRAND NEW
          // subscription is being set up, and Stripe guarantees no ordering
          // against checkout.session.completed. Reached first, this branch sees
          // a company whose stored plan is still the registration trial's
          // "starter" (auth.routes.ts) or "free", writes "professional", and
          // the tier comparison alone would happily announce "upgraded from
          // Starter to Professional" for what is a FIRST subscription —
          // something billing.subscription_created already announces. Slice 5
          // met the same collision on payment_method.attached.
          //
          // An upgrade presupposes the company was ALREADY on this
          // subscription. That is exactly what the stored id says, it is read
          // BEFORE the update like the plan is, and it costs nothing extra.
          const wasAlreadyOnThisSubscription =
            company?.stripeSubscriptionId === subscription.id;

          if (
            company &&
            updated &&
            wasAlreadyOnThisSubscription &&
            canUpgrade(company.plan, updated.plan)
          ) {
            upgrade = {
              companyName: company.name,
              // DISPLAY names, resolved here — the contract in
              // emails/billingTypes.ts states them as such, and they are
              // locale-independent proper nouns, so resolving them at the
              // trigger does not reintroduce the locale split-brain that moved
              // money and date formatting into the channel.
              fromPlan: planDisplayName(company.plan),
              toPlan: planDisplayName(updated.plan),
              timezone: company.timezone,
            };
          } else if (company && updated && company.plan !== updated.plan) {
            // Every OTHER plan movement, logged rather than silently dropped.
            // Downgrades and phase flips are Slice 7's, and a subscription
            // arriving for the first time is the checkout case above — but an
            // unexplained plan change reaching here with no email is worth
            // being able to see in a log while Phase 2 is only half built.
            console.warn(
              `[stripe webhook] company ${companyId} moved ${company.plan} -> ${updated.plan} ` +
                `on ${subscription.id} (stored ${company.stripeSubscriptionId ?? "none"}) — ` +
                "not an upgrade of an existing subscription, no plan_upgraded sent"
            );
          }
        }
      }

      await markEventProcessed(event.id, event.type);

      // N1.8 Slice 6 — AFTER the ledger write, per the plan's §3 Fázis 2, and
      // the checkout branch's precedent. The at-most-once property does not
      // depend on that ordering: the dedupeKey carries the Stripe event id, so
      // a redelivery collides on the unique index even if the ledger write and
      // this call ever drift apart. The ledger simply short-circuits it first.
      if (companyId && upgrade) {
        await notify({
          type: "billing.plan_upgraded",
          companyId,
          dedupeKey: `billing.plan_upgraded/${event.id}`,
          context: {
            companyName: upgrade.companyName,
            fromPlanName: upgrade.fromPlan,
            toPlanName: upgrade.toPlan,
            // The EVENT's own timestamp, carried raw. Not the subscription's
            // period start, which names the cycle rather than the change, and
            // not the send time, which would drift by however long the job sat
            // in the queue. UNIX seconds; the channel formats it.
            effectiveAt: event.created,
            ...(upgrade.timezone ? { timeZone: upgrade.timezone } : {}),
          },
        });
      }

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

    // N1.8 Slice 3 — the failed-payment notice.
    //
    // K2: the dedupeKey is the EVENT id, which is the opposite of the two
    // receipts and is the whole point. Every automatic dunning retry is a
    // separate failure the customer needs to hear about, so a key on the
    // invoice id would announce the first failure and silently swallow every
    // one after it. `invoice.id + attempt_count` was considered and rejected:
    // Stripe documents that a MANUAL retry in the Portal does not increment
    // attempt_count (Invoices.d.ts:176), so that key collides exactly when a
    // customer has tried to fix the problem themselves and failed again.
    //
    // Redelivery of the SAME event is still suppressed twice over — the
    // HANDLED_EVENTS ledger short-circuits it before this case runs, and the
    // event-keyed dedupeKey collides underneath.
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;

      // SCOPE — this message is only correct for money Stripe is
      // AUTO-COLLECTING for a SUBSCRIPTION, and both halves of that matter.
      //
      // Keyed on the invoice's STRUCTURE, not on billing_reason. The reason
      // field answers "why was this invoice raised", which is what Slices 1-2
      // needed because it chose between two receipts; here there is one
      // destination and the question is different — "is /subscription where the
      // customer fixes this". billing_reason is also nullable
      // (Invoices.d.ts:203), so a reason allowlist would silently drop a
      // genuine subscription failure whose reason is null or legacy
      // "subscription", both of which are real dunning failures.
      //
      //   parent.type === "subscription_details" — a manual invoice raised from
      //     the Dashboard has parent: null (there is no "manual" member of
      //     Parent.Type, Invoices.d.ts:862). For such an invoice the entire
      //     instruction this email gives is wrong: the Customer Portal manages
      //     the SUBSCRIPTION's payment method and cannot settle a one-off.
      //
      //   collection_method === "charge_automatically" — a send_invoice invoice
      //     has next_payment_attempt null BY DEFINITION (Invoices.d.ts:334-336),
      //     not because dunning has given up. Without this half, every such
      //     invoice would take the most urgent branch this message has — "no
      //     further automatic attempt is scheduled" — for an invoice that was
      //     never going to be auto-charged and that Stripe itself is emailing
      //     with payment instructions.
      if (
        invoice.parent?.type !== "subscription_details" ||
        invoice.collection_method !== "charge_automatically"
      ) {
        console.warn(
          `[stripe webhook] invoice.payment_failed for ${invoice.id} is not an ` +
            `auto-collected subscription invoice (parent ${invoice.parent?.type ?? "none"}, ` +
            `collection ${invoice.collection_method}) — acknowledged, not notified`
        );
        await markEventProcessed(event.id, event.type);
        break;
      }

      const companyId = await resolveCompanyId(
        undefined,
        typeof invoice.customer === "string" ? invoice.customer : null
      );

      if (!companyId) {
        console.warn(
          `[stripe webhook] invoice.payment_failed for unknown customer, dropping ${invoice.id}`
        );
        await markEventProcessed(event.id, event.type);
        break;
      }

      const company = await prisma.company.findUnique({ where: { id: companyId } });

      await markEventProcessed(event.id, event.type);

      if (!company) break;

      // NO LIVENESS GATE HERE, and that is a decision rather than an omission —
      // the opposite of the one Slices 1-2 make three cases up.
      //
      // Their gate exists because "you are on the X plan for another billing
      // period" is a COVERAGE claim read out of the Company row, and it is
      // false for a dead subscription. This message makes no such claim: "we
      // could not collect X" comes from the invoice and stays true in every
      // subscription status.
      //
      // Copying the gate here would do nothing in the states where it is
      // harmless (at the first failure the stored status is active or past_due,
      // both of which pass) and would bite in exactly one place — the FINAL
      // dunning failure, once customer.subscription.deleted has already landed
      // and written canceled. That is the most important message in the whole
      // sequence, and Stripe guarantees no ordering between the two events, so
      // the gate would drop it nondeterministically and silently.
      //
      // What pays for having no gate is the copy: the template may not name a
      // plan and may not state the subscription's current status, because
      // nothing here has verified either. See InvoiceFailedEmail.tsx.
      //
      // ...WITH ONE EXCEPTION, on a different axis from liveness: the invoice
      // may belong to a subscription the company has already REPLACED.
      //
      // The status gate asks "is the subscription dead", and dropping it is
      // right. This asks "is this invoice even about the subscription they are
      // on", and the answer changes what the message means. Terminal dunning
      // cancels the old subscription, which unblocks a fresh Checkout
      // (CLOSED_SUBSCRIPTION_STATUSES) — the intended recovery path — and
      // reconcileCheckoutCompletion then rewrites Company.stripeSubscriptionId.
      // Stripe meanwhile retries a non-2xx delivery for days, so the OLD
      // invoice's final payment_failed can land after that flip.
      //
      // At that point two of this email's four claims are false: "to keep your
      // subscription running, update your payment details" (theirs is running,
      // and this invoice has nothing to do with it) and "if the payment isn't
      // completed the subscription ends and Axeriva switches to read-only"
      // (it already ended, and they are not read-only). The customer has just
      // paid, and is told their payment failed and access is at risk. Being
      // mandatory, they cannot switch it off.
      //
      // Same shape as the isForeign guard the customer.subscription.updated
      // case already applies, and it is deliberately narrow: it fires ONLY when
      // the company is on a DIFFERENT subscription that is itself live. During
      // the checkout race this guard has to survive — a new subscription's
      // events arriving before the checkout handler has written its id —
      // Company.stripeSubscriptionId is still the OLD one, so the ids MATCH and
      // nothing is suppressed. If the replacement is not live either, the
      // warning still goes out: we only stay silent when we can see the
      // customer's billing is actually fine.
      const invoiceSubscriptionId =
        typeof invoice.parent.subscription_details?.subscription === "string"
          ? invoice.parent.subscription_details.subscription
          : (invoice.parent.subscription_details?.subscription?.id ?? null);

      if (
        company.stripeSubscriptionId &&
        invoiceSubscriptionId &&
        company.stripeSubscriptionId !== invoiceSubscriptionId &&
        ACTIVE_SUBSCRIPTION_STATUSES.includes(company.subscriptionStatus)
      ) {
        console.warn(
          `[stripe webhook] invoice.payment_failed for ${invoice.id} belongs to ` +
            `${invoiceSubscriptionId}, but company ${companyId} is on ` +
            `${company.stripeSubscriptionId} (${company.subscriptionStatus}) — superseded, not notifying`
        );
        break;
      }

      // Nothing was outstanding, so there is no failure to report. The same
      // refusal Slice 2 makes for a zero-amount receipt, for the same reason:
      // "we couldn't collect €0.00" names nothing the customer can act on.
      // Reaching this contradicts our model of dunning, hence error not warn.
      if (invoice.amount_remaining <= 0) {
        console.error(
          `[stripe webhook] invoice.payment_failed for ${invoice.id} with ` +
            `amount_remaining ${invoice.amount_remaining} — nothing outstanding, not notifying`
        );
        break;
      }

      await notify({
        type: "billing.invoice_failed",
        companyId,
        dedupeKey: `billing.invoice_failed/${event.id}`,
        context: {
          companyName: company.name,
          // amount_REMAINING, not amount_due and emphatically not amount_paid.
          //
          // amount_remaining is defined as amount_due minus amount_paid
          // (Invoices.d.ts:163-166), so it inherits amount_due's credit-balance
          // handling and additionally excludes anything already collected. On a
          // part-settled invoice, amount_due names money the customer has
          // already handed over — on the one number this email exists to
          // communicate. In ordinary dunning nothing is paid and the two are
          // identical, so this costs nothing and is strictly safer.
          //
          // (This narrows docs/notification-n18-plan.md §3, which names
          // amount_due; the doc is amended in the same commit.)
          amountMinor: invoice.amount_remaining,
          currency: invoice.currency,
          attemptNumber: invoice.attempt_count,
          // number | null, passed through UNCHANGED. null is the meaning
          // "Stripe has scheduled no further automatic attempt", which selects
          // a different message downstream — it must never be coerced to 0,
          // which formats as 1 January 1970 rather than failing.
          nextAttemptAt: invoice.next_payment_attempt,
          ...(company.timezone ? { timeZone: company.timezone } : {}),
        },
      });

      break;
    }

    // N1.8 Slice 4 — the advance notice for the next charge.
    //
    // THIS EVENT'S PAYLOAD IS A PREVIEW, NOT AN INVOICE, and two things follow.
    // It has no id — Events.d.ts:1554 says so outright ("will not have an
    // invoice ID") even though Invoices.d.ts:130 types `id` as a required
    // string, so the type demonstrably lies for this event and `invoice.id`
    // must never be read here, not even in a log line. And it is the ONLY
    // billing message that asserts something about the FUTURE, so the gates
    // below are what make the sentence true rather than defensive padding.
    case "invoice.upcoming": {
      const invoice = event.data.object as Stripe.Invoice;

      // Scope, identical in shape to Slice 3's and for the same reasons: a
      // Dashboard-raised invoice has parent: null, and on a send_invoice
      // invoice Stripe emails its own payment instructions and charges no card,
      // so "we'll charge you on X" would be false in its central claim.
      if (
        invoice.parent?.type !== "subscription_details" ||
        invoice.collection_method !== "charge_automatically"
      ) {
        console.warn(
          `[stripe webhook] invoice.upcoming is not an auto-collected subscription ` +
            `preview (parent ${invoice.parent?.type ?? "none"}, ` +
            `collection ${invoice.collection_method}) — acknowledged, not notified`
        );
        await markEventProcessed(event.id, event.type);
        break;
      }

      // The subscription id is HALF THE DEDUPEKEY, so its absence is not
      // something to work around — without it there is no at-most-once
      // protection at all and the customer could be told about one renewal
      // repeatedly. The SDK types it non-nullable (Invoices.d.ts:856), but the
      // same interface types `id` as required and that is already proven false
      // for this event, so it is checked rather than trusted. ERROR, not warn:
      // reaching it means the payload shape is not what this handler was built
      // against.
      const subscriptionId =
        typeof invoice.parent.subscription_details?.subscription === "string"
          ? invoice.parent.subscription_details.subscription
          : (invoice.parent.subscription_details?.subscription?.id ?? null);

      if (!subscriptionId) {
        console.error(
          "[stripe webhook] invoice.upcoming with no subscription id in " +
            "parent.subscription_details — cannot key or verify it, not notifying"
        );
        await markEventProcessed(event.id, event.type);
        break;
      }

      // THE RENEWAL INSTANT. The non-proration subscription line's period
      // START, which is when the cycle being previewed BEGINS.
      //
      // Every other candidate is wrong in a way that still renders as a
      // plausible date. invoice.period_start/period_end is the invoice-item
      // ASSOCIATION window (Invoices.d.ts:354-361) — the field that produced
      // this repo's shipped Slice 1 bug, one cycle stale. line.period.END is a
      // full cycle late, which on an annual plan is a year. A proration line's
      // period.start is already in the past.
      const renewalLine = upcomingRenewalLine(invoice);
      const renewsAt = renewalLine?.period?.start;

      if (!renewsAt) {
        console.error(
          `[stripe webhook] invoice.upcoming for ${subscriptionId} has no non-proration ` +
            "subscription line — cannot state a renewal date, not notifying"
        );
        await markEventProcessed(event.id, event.type);
        break;
      }

      const companyId = await resolveCompanyId(
        undefined,
        typeof invoice.customer === "string" ? invoice.customer : null
      );

      if (!companyId) {
        console.warn(
          `[stripe webhook] invoice.upcoming for unknown customer, dropping ${subscriptionId}`
        );
        await markEventProcessed(event.id, event.type);
        break;
      }

      const company = await prisma.company.findUnique({ where: { id: companyId } });

      await markEventProcessed(event.id, event.type);

      if (!company) break;

      // THE GATES. Unlike the receipts, which report something that already
      // happened, this predicts a charge — so every one of these exists because
      // without it the sentence is false for a reachable customer. All of them
      // read the Company row; none calls Stripe, because a retrieve placed
      // after the ledger write would, on a transient failure, throw → non-2xx →
      // redelivery → short-circuited by the ledger and silently lost.
      //
      //  - manually managed (Founder/Enterprise): applySubscriptionUpdate
      //    refuses to write Company for these, so every field below is frozen
      //    and nothing here can be trusted.
      //  - a DIFFERENT subscription: strict equality, deliberately stricter
      //    than Slice 3's guard. That one errs toward sending because its
      //    message is mandatory and losing it is the greater harm; here sending
      //    a charge warning about a subscription the company has left is pure
      //    harm. A null stored id is also refused — we cannot confirm the
      //    preview is theirs.
      //  - status: {active, trialing} and NOT ACTIVE_SUBSCRIPTION_STATUSES,
      //    which includes past_due. A past_due customer is already receiving
      //    the MANDATORY dunning warning saying the subscription is about to
      //    end; adding an optional "we'll charge you on the 1st" would have
      //    Axeriva assert both at once, and they can only switch off the
      //    correct one. Written as its own predicate, not the shared constant,
      //    precisely so this divergence is visible.
      //  - cancelAtPeriodEnd: they have already cancelled. Telling them a
      //    charge is coming is how you cause the chargeback this message exists
      //    to prevent.
      //  - amount: a heads-up about being charged nothing warns of nothing.
      //  - already elapsed: the only claim in this milestone that decays purely
      //    by arriving late — a redelivery days later would announce a renewal
      //    that has already happened.
      if (isManuallyManaged(company.plan)) {
        console.warn(
          `[stripe webhook] invoice.upcoming for company ${companyId} on manually managed ` +
            `plan ${company.plan} — not notifying`
        );
        break;
      }

      if (company.stripeSubscriptionId !== subscriptionId) {
        console.warn(
          `[stripe webhook] invoice.upcoming for ${subscriptionId}, but company ${companyId} ` +
            `is on ${company.stripeSubscriptionId ?? "no subscription"} — not notifying`
        );
        break;
      }

      if (company.subscriptionStatus !== "active" && company.subscriptionStatus !== "trialing") {
        console.warn(
          `[stripe webhook] invoice.upcoming for company ${companyId} whose subscription is ` +
            `${company.subscriptionStatus} — not notifying`
        );
        break;
      }

      if (company.cancelAtPeriodEnd) {
        console.warn(
          `[stripe webhook] invoice.upcoming for company ${companyId}, which has already ` +
            "cancelled at period end — not notifying"
        );
        break;
      }

      if (invoice.amount_due <= 0) {
        console.warn(
          `[stripe webhook] invoice.upcoming for ${subscriptionId} previews ` +
            `${invoice.amount_due} — nothing to warn about, not notifying`
        );
        break;
      }

      if (renewsAt * 1000 <= Date.now()) {
        console.warn(
          `[stripe webhook] invoice.upcoming for ${subscriptionId} renews at ${renewsAt}, ` +
            "which has already passed — not notifying"
        );
        break;
      }

      await notify({
        type: "billing.renewal_upcoming",
        companyId,
        // K3 — the subscription plus the instant it renews. There is no invoice
        // id to key on, and `event.id` would be wrong in the other direction:
        // two Stripe deliveries for ONE renewal are two event ids, so the
        // ledger would not catch them and the customer would be warned twice
        // about one charge. Keyed on the very value the email states, so the
        // key and the claim cannot drift apart.
        dedupeKey: `billing.renewal_upcoming/${subscriptionId}/${renewsAt}`,
        context: {
          companyName: company.name,
          // The whole invoice total, which is what Stripe will actually take —
          // amount_due alone accounts for account credit and starting_balance
          // (Invoices.d.ts:147-150). It can include a pending invoice item, so
          // the copy says "we'll charge X", never "your plan costs X".
          amountMinor: invoice.amount_due,
          currency: invoice.currency,
          renewsAt,
          ...(company.timezone ? { timeZone: company.timezone } : {}),
        },
      });

      break;
    }

    // N1.8 Slice 5 — the card on file changed.
    //
    // THE FIRST HANDLER IN THIS FILE THAT IS NOT ABOUT A SUBSCRIPTION OR AN
    // INVOICE. `payment_method.attached` fires on the CUSTOMER, so there is no
    // subscription id in the payload, no amount, no period and no billing_reason
    // to route on — the company is resolved from paymentMethod.customer and
    // every editorial decision below has to be made against the Company row
    // instead of against the event.
    //
    // NO STALE GUARD, for the same reason the invoice branches have none: the
    // payload states a fact about a moment ("this method was attached") and
    // overwrites nothing. It does not decay either — unlike Slice 4's renewal
    // date, "your card was changed to •••• 4242" stays true however late it
    // arrives, so there is no elapsed-time refusal here.
    case "payment_method.attached": {
      const paymentMethod = event.data.object as Stripe.PaymentMethod;

      // CARD ONLY, and this is a scope decision rather than a defensive check.
      // PaymentMethod.type spans 55 values in the installed SDK
      // (PaymentMethods.d.ts:673) and `card` is OPTIONAL, present only for the
      // card type. The approved payload is brand + last4 and the copy names a
      // card outright, so a SEPA mandate or a Link account has nothing honest to
      // put in either — the generic-brand fallback would render "Card ••••" over
      // an IBAN's last four, which reads as a card the customer does not have.
      // Acknowledged and dropped; `billing.payment_method_updated` is a
      // card-shaped message and N1.8 does not widen it.
      if (paymentMethod.type !== "card" || !paymentMethod.card) {
        // The two halves are reported separately on purpose: "is a card, not a
        // card" is what one shared message produces for the second case, and an
        // operator reading it learns nothing about which check refused.
        console.warn(
          `[stripe webhook] payment_method.attached for ${paymentMethod.id} — ` +
            (paymentMethod.type !== "card"
              ? `type is ${paymentMethod.type}, not card`
              : "typed card but carries no card hash") +
            ", acknowledged, not notified"
        );
        await markEventProcessed(event.id, event.type);
        break;
      }

      // The customer is the ONLY route to a company here — there is no
      // metadata.companyId on a PaymentMethod, and nothing else in the payload
      // identifies a tenant. The SDK types this nullable because a PaymentMethod
      // need not be saved to a customer at all ("This will not be set when the
      // PaymentMethod has not been saved to a Customer", PaymentMethods.d.ts:84);
      // for THIS event it should always be set, and it is still checked, because
      // without it there is no tenant and the alternative is a crash inside a
      // webhook that owes Stripe a 2xx.
      const paymentMethodCustomerId =
        typeof paymentMethod.customer === "string"
          ? paymentMethod.customer
          : (paymentMethod.customer?.id ?? null);

      const companyId = await resolveCompanyId(undefined, paymentMethodCustomerId);

      // Not ours — acknowledged and dropped, as the invoice branches do.
      if (!companyId) {
        console.warn(
          `[stripe webhook] payment_method.attached for unknown customer ` +
            `${paymentMethodCustomerId ?? "none"}, dropping ${paymentMethod.id}`
        );
        await markEventProcessed(event.id, event.type);
        break;
      }

      const company = await prisma.company.findUnique({ where: { id: companyId } });

      await markEventProcessed(event.id, event.type);

      if (!company) break;

      // Manually managed (Founder/Enterprise): applySubscriptionUpdate refuses
      // to write Company for these, so the two fields the gate below reads are
      // frozen at whatever they last were and cannot answer the question it
      // asks. Same reasoning as Slice 4, and it matters more here because that
      // gate is the ONLY thing standing between this type and a duplicate email
      // at every signup.
      if (isManuallyManaged(company.plan)) {
        console.warn(
          `[stripe webhook] payment_method.attached for company ${companyId} on manually ` +
            `managed plan ${company.plan} — not notifying`
        );
        break;
      }

      // ⚠️ THE CHECKOUT COLLISION — the one gate this slice exists around, and
      // the K1 problem in a different costume.
      //
      // Stripe attaches the card DURING Checkout, so a first-ever subscription
      // fires this event too. Un-gated, one signup produces two Axeriva emails
      // about one action: "Your Professional subscription is active"
      // (billing.subscription_created, from checkout.session.completed) and
      // "Your payment method was updated" — for a card the customer has just
      // deliberately entered and does not need telling about. K1 settled
      // that shape for invoice.paid by routing subscription_create to nothing;
      // this is the same decision on the same grounds.
      //
      // Nor is it an edge case: /subscription/checkout only relaxes
      // payment_method_collection to "if_required" when trialDays > 0, and
      // Design C's trialConsumedAt means that is in practice nobody
      // (subscription.routes.ts). Every checkout collects a card.
      //
      // The discriminator is that a card CHANGE presupposes a billing
      // relationship that already exists. So: a stored subscription id AND a
      // live status. Both halves earn their place —
      //
      //   - stripeSubscriptionId is what actually catches signup. The
      //     registration trial writes subscriptionStatus "trialing" with NO
      //     Stripe objects at all (auth.routes.ts), so status alone would pass
      //     for exactly the company that is subscribing for the first time.
      //   - ACTIVE_SUBSCRIPTION_STATUSES, INCLUDING past_due, and that
      //     inclusion is deliberate against Slice 4's narrower predicate. A
      //     customer replacing a dead card mid-dunning is the single most
      //     valuable instance of this message: it is the confirmation that the
      //     fix landed, and it directly contradicts nothing — the mandatory
      //     invoice_failed warning says "we could not collect", which stays
      //     true. Slice 4 excludes past_due because a promised FUTURE charge
      //     would contradict that warning; nothing here promises anything.
      //   - A canceled or unpaid company re-subscribing goes through Checkout
      //     (CLOSED_SUBSCRIPTION_STATUSES unblocks it), so its attach is a
      //     checkout attach and subscription_created covers it. Silence there
      //     is the same decision, not a second one.
      //
      // RESIDUAL, recorded rather than implied away (docs/post-launch-backlog.md
      // N4): this reads state the checkout handler WRITES, so it depends on
      // delivery order. Stripe attaches the method before the session completes,
      // so in the ordinary case the fields are still empty here and signup is
      // correctly silent — but the ordering is not guaranteed, and if
      // checkout.session.completed is processed first the gate passes and the
      // customer gets both emails. Closing it properly needs state this
      // milestone may not add (§5: no schema change), so it is a known bound.
      if (
        !company.stripeSubscriptionId ||
        !ACTIVE_SUBSCRIPTION_STATUSES.includes(company.subscriptionStatus)
      ) {
        console.warn(
          `[stripe webhook] payment_method.attached for company ${companyId} with no live ` +
            `subscription (${company.stripeSubscriptionId ?? "none"}, ` +
            `${company.subscriptionStatus}) — first card at checkout, not notifying`
        );
        break;
      }

      // The two fields the message is made of. The SDK types both as required
      // strings (PaymentMethods.d.ts:72, :100) and there is no evidence here of
      // the kind of lie invoice.upcoming's `id` turned out to be — but they are
      // checked anyway, because the alternative is a notification that dies in
      // the email channel three worker retries later instead of at the trigger
      // where there is a Stripe event id to search for. ERROR, not warn: a card
      // with no brand or no last four contradicts the payload shape this handler
      // was built against.
      const { brand, last4 } = paymentMethod.card;

      if (!brand || !last4) {
        console.error(
          `[stripe webhook] payment_method.attached for ${paymentMethod.id} has ` +
            `brand ${JSON.stringify(brand)} and last4 ${JSON.stringify(last4)} — ` +
            "nothing to name the card with, not notifying"
        );
        break;
      }

      await notify({
        type: "billing.payment_method_updated",
        companyId,
        // Keyed on the PAYMENT METHOD, per the plan's §3 table.
        //
        // A Stripe redelivery carries the same method id and collides; a
        // genuinely new card is a new PaymentMethod object with a new id and
        // sends. Not the event id — two deliveries for one attach are two event
        // ids, and the HANDLED_EVENTS ledger cannot catch a pair it never sees
        // as duplicates. Not the company id either, which would announce the
        // first card change a tenant ever makes and silently swallow every one
        // after it. PaymentMethod ids are globally unique, so no two tenants can
        // collide on this key.
        dedupeKey: `billing.payment_method_updated/${paymentMethod.id}`,
        // RAW brand token, exactly as Stripe reports it. The display name and
        // the •••• masking are the template's job — see
        // PaymentMethodUpdatedEmail, where the fallback for an unrecognised
        // brand is a translated word and therefore needs a locale this handler
        // does not have.
        //
        // Nothing else from the card object. No expiry, no country, no funding,
        // no fingerprint: this context lands in a plain text column that N1.10
        // plans a support viewer over, and brand + last4 are what the customer
        // needs to recognise their own card.
        context: {
          companyName: company.name,
          brand,
          last4,
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
