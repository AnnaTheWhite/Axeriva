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
import { resolveLocale } from "../i18n";
import { formatDate, formatMoney } from "../utils/billingFormat";
import { planDisplayName } from "../constants/plans";
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
    // NO STALE GUARD, deliberately. The guard on customer.subscription.updated
    // above is subscription-shaped: it re-fetches current state from Stripe
    // because a late update could otherwise overwrite newer state. An invoice
    // event overwrites nothing — the payload IS the fact, complete in itself,
    // and a late one describes a payment that really did happen. Recording that
    // absence here so it reads as a decision rather than an omission.
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

      if (company) {
        const locale = resolveLocale({ companyLanguage: company.language });
        const timeZone = company.timezone;

        // Formatting happens HERE, not in the template — see
        // utils/billingFormat.ts. The template receives finished strings.
        await notify({
          type: "billing.subscription_renewed",
          companyId,
          // K1/decision 1: keyed on the INVOICE id. A Stripe redelivery of this
          // event collides and is suppressed; next month's invoice is a
          // different id and sends. Deliberately not the event id, which would
          // let two different events about the SAME invoice both send.
          dedupeKey: `billing.subscription_renewed/${invoice.id}`,
          context: {
            companyName: company.name,
            planName: planDisplayName(company.plan),
            amountFormatted: formatMoney({
              amountMinor: invoice.amount_paid,
              currency: invoice.currency,
              locale,
            }),
            periodStartFormatted: formatDate({ value: invoice.period_start, locale, timeZone }),
            periodEndFormatted: formatDate({ value: invoice.period_end, locale, timeZone }),
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
