import { Router } from "express";
import Stripe from "stripe";
import prisma from "../database/prisma";
import { stripe } from "../services/stripe/stripeClient";

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

function planForStatus(status: string): string {
  return status === "active" || status === "trialing" ? "pro" : "free";
}

// The current API version moved `current_period_end` from the subscription
// itself onto its line items (subscriptions can now have multiple items
// with different billing periods). CrewFlow Pro is always a single item.
function currentPeriodEnd(subscription: Stripe.Subscription): Date | null {
  const item = subscription.items.data[0];
  return item ? new Date(item.current_period_end * 1000) : null;
}

router.post("/", async (req, res) => {
  const signature = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

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

        await prisma.company.update({
          where: { id: companyId },
          data: {
            stripeCustomerId:
              typeof session.customer === "string" ? session.customer : undefined,
            stripeSubscriptionId: subscription.id,
            subscriptionStatus: subscription.status,
            plan: planForStatus(subscription.status),
            subscriptionEndsAt: currentPeriodEnd(subscription),
          },
        });
      }

      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const companyId = await resolveCompanyId(
        subscription.metadata?.companyId,
        typeof subscription.customer === "string" ? subscription.customer : null
      );

      if (companyId) {
        await prisma.company.update({
          where: { id: companyId },
          data: {
            stripeSubscriptionId: subscription.id,
            subscriptionStatus: subscription.status,
            plan: planForStatus(subscription.status),
            subscriptionEndsAt: currentPeriodEnd(subscription),
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
        await prisma.company.update({
          where: { id: companyId },
          data: {
            subscriptionStatus: "canceled",
            plan: "free",
            subscriptionEndsAt: currentPeriodEnd(subscription),
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

export default router;
