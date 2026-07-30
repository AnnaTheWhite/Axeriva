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
import { emailService } from "../services/email";
import { ROLES } from "../constants/roles";
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
const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
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
        // email is sent only on the FIRST recording — at-most-once even
        // across concurrent duplicate deliveries.
        const firstDelivery = await markEventProcessed(event.id, event.type);

        // First-time activation only — customer.subscription.updated also
        // fires on renewals/plan changes, which shouldn't re-send this.
        const company = await prisma.company.findUnique({
          where: { id: companyId },
        });
        const owner = await prisma.user.findFirst({
          where: { companyId, role: ROLES.BUSINESS_OWNER },
        });

        if (outcome === "applied" && firstDelivery && company && owner) {
          emailService
            .sendSubscriptionConfirmedEmail(
              owner.email,
              company.name,
              company.plan === "pro" ? "Axeriva Pro" : company.plan
            )
            .catch((error) => {
              console.error("[stripe webhook] subscription confirmation email failed", error);
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
