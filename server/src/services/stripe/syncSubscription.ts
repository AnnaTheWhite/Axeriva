import Stripe from "stripe";
import prisma from "../../database/prisma";
import { logAudit } from "../audit/auditLog";
import { AUDIT_ACTIONS } from "../../constants/auditActions";

function planForStatus(status: string): string {
  return status === "active" || status === "trialing" ? "pro" : "free";
}

// The current API version moved `current_period_end` from the subscription
// itself onto its line items (subscriptions can now have multiple items
// with different billing periods). Axeriva Pro is always a single item.
function currentPeriodEnd(subscription: Stripe.Subscription): Date | null {
  const item = subscription.items.data[0];
  return item ? new Date(item.current_period_end * 1000) : null;
}

// Writes a Stripe subscription's state onto the matching Company. Shared by
// the webhook handler (server push from Stripe) and the checkout-return
// sync endpoint (client-initiated pull) so both paths can never disagree
// about what "up to date" means.
export async function applySubscriptionUpdate(
  companyId: number,
  subscription: Stripe.Subscription,
  stripeCustomerId?: string | null
): Promise<void> {
  await prisma.company.update({
    where: { id: companyId },
    data: {
      ...(stripeCustomerId ? { stripeCustomerId } : {}),
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      plan: planForStatus(subscription.status),
      subscriptionEndsAt: currentPeriodEnd(subscription),
    },
  });

  logAudit({
    action: AUDIT_ACTIONS.SUBSCRIPTION_CHANGED,
    companyId,
    metadata: {
      status: subscription.status,
      plan: planForStatus(subscription.status),
    },
  });
}

export async function markSubscriptionCanceled(companyId: number, subscription: Stripe.Subscription): Promise<void> {
  await prisma.company.update({
    where: { id: companyId },
    data: {
      subscriptionStatus: "canceled",
      plan: "free",
      subscriptionEndsAt: currentPeriodEnd(subscription),
    },
  });
}
