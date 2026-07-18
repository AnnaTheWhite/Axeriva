import Stripe from "stripe";
import prisma from "../../database/prisma";
import { logAudit } from "../audit/auditLog";
import { AUDIT_ACTIONS } from "../../constants/auditActions";
import { planForPriceId } from "../../config/stripePricing";
import { isManuallyManaged } from "../planAccess";

// Resolves the plan a subscription represents from the PRICE that was
// purchased (centralized mapping in config/stripePricing.ts), not from a
// hardcoded string. Only "positive" statuses (active/trialing) carry a plan;
// any other status means the paid plan is not in effect. Returns null when the
// plan can't be resolved (unknown/misconfigured price) so callers can keep the
// company's current plan rather than guessing.
function planForSubscription(subscription: Stripe.Subscription): string | null {
  if (subscription.status !== "active" && subscription.status !== "trialing") {
    return null;
  }
  const priceId = subscription.items.data[0]?.price?.id;
  return planForPriceId(priceId);
}

// The current API version moved `current_period_end` from the subscription
// itself onto its line items (subscriptions can now have multiple items
// with different billing periods). Axeriva plans are always a single item.
function currentPeriodEnd(subscription: Stripe.Subscription): Date | null {
  const item = subscription.items.data[0];
  return item ? new Date(item.current_period_end * 1000) : null;
}

// Writes a Stripe subscription's state onto the matching Company. Shared by
// the webhook handler (server push from Stripe) and the checkout-return
// sync endpoint (client-initiated pull) so both paths can never disagree
// about what "up to date" means.
//
// Guard: manually-managed plans (Founder, Enterprise) are never overwritten by
// Stripe — those are assigned by a DEVELOPER and have no self-serve
// subscription driving them.
export async function applySubscriptionUpdate(
  companyId: number,
  subscription: Stripe.Subscription,
  stripeCustomerId?: string | null
): Promise<void> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { plan: true, pendingPlan: true },
  });

  if (company && isManuallyManaged(company.plan)) {
    return;
  }

  // Active/trialing → the plan for the purchased price (falling back to the
  // company's current plan if the price is unrecognized, so we never downgrade
  // on a misconfiguration). Any other status → "free" (matches prior
  // behavior: canceled/past_due/etc. drop the paid plan).
  const resolvedPlan = planForSubscription(subscription);
  const isPositive =
    subscription.status === "active" || subscription.status === "trialing";
  const nextPlan = isPositive ? resolvedPlan ?? company?.plan ?? "starter" : "free";

  // Pending-downgrade bookkeeping (S2.6). The pendingPlan marker only means
  // anything while a Subscription Schedule is still attached and hasn't
  // switched the price yet. Once the schedule flips the phase (Stripe now
  // reports the downgrade target as the live price) or the schedule is gone
  // (released/cancelled), the marker is cleared — the sync layer self-heals
  // instead of trusting the service to have cleaned up.
  const hasSchedule = Boolean(subscription.schedule);
  const pendingStillApplies =
    hasSchedule && company?.pendingPlan != null && resolvedPlan !== company.pendingPlan;

  await prisma.company.update({
    where: { id: companyId },
    data: {
      ...(stripeCustomerId ? { stripeCustomerId } : {}),
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      plan: nextPlan,
      subscriptionEndsAt: currentPeriodEnd(subscription),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      pendingPlan: pendingStillApplies ? company!.pendingPlan : null,
    },
  });

  logAudit({
    action: AUDIT_ACTIONS.SUBSCRIPTION_CHANGED,
    companyId,
    metadata: {
      status: subscription.status,
      plan: nextPlan,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    },
  });
}

export async function markSubscriptionCanceled(companyId: number, subscription: Stripe.Subscription): Promise<void> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { plan: true },
  });

  // Never cancel a manually-managed plan (Founder / Enterprise).
  if (company && isManuallyManaged(company.plan)) {
    return;
  }

  await prisma.company.update({
    where: { id: companyId },
    data: {
      subscriptionStatus: "canceled",
      plan: "free",
      subscriptionEndsAt: currentPeriodEnd(subscription),
      // A fully-ended subscription has nothing pending and nothing left to
      // cancel — reset the S2.6 flags so the billing UI reads clean.
      cancelAtPeriodEnd: false,
      pendingPlan: null,
    },
  });
}
