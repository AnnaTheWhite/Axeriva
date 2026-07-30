import Stripe from "stripe";
import prisma from "../../database/prisma";
import { stripe } from "./stripeClient";
import { logAudit } from "../audit/auditLog";
import { AUDIT_ACTIONS } from "../../constants/auditActions";
import { planForPriceId } from "../../config/stripePricing";
import { isManuallyManaged } from "../planAccess";

// Statuses under which a stored Stripe subscription is closed for good — a
// fresh Checkout may create a replacement. Shared by the /checkout duplicate
// guard (hasBlockingSubscription) and the completion-time reconciliation
// below, so the two can never disagree about what "open" means.
export const CLOSED_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set([
  "canceled",
  "incomplete_expired",
]);

// Statuses under which the company KEEPS its paid plan. active/trialing are
// the obvious ones; past_due is the Design C grace state (AC17): a failed
// renewal or upgrade-proration charge starts Stripe's dunning cycle, and
// dropping the plan to "free" the moment the first charge fails would lock
// the whole company read-only over a bounced card. If dunning gives up,
// Stripe emits canceled/unpaid and THOSE drop the plan.
const PLAN_CARRYING_STATUSES = new Set(["active", "trialing", "past_due"]);

// Resolves the plan a subscription represents from the PRICE that was
// purchased (centralized mapping in config/stripePricing.ts), not from a
// hardcoded string. Only plan-carrying statuses resolve a plan; any other
// status means the paid plan is not in effect. Returns null when the plan
// can't be resolved (unknown/misconfigured price) so callers can keep the
// company's current plan rather than guessing.
function planForSubscription(subscription: Stripe.Subscription): string | null {
  if (!PLAN_CARRYING_STATUSES.has(subscription.status)) {
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
    select: { plan: true, pendingPlan: true, trialConsumedAt: true },
  });

  if (company && isManuallyManaged(company.plan)) {
    return;
  }

  // Plan-carrying statuses (active/trialing/past_due) → the plan for the
  // purchased price (falling back to the company's current plan if the price
  // is unrecognized, so we never downgrade on a misconfiguration). Any other
  // status (canceled/unpaid/incomplete…) → "free": the paid plan is gone.
  const resolvedPlan = planForSubscription(subscription);
  const isPlanCarrying = PLAN_CARRYING_STATUSES.has(subscription.status);
  const nextPlan = isPlanCarrying ? resolvedPlan ?? company?.plan ?? "starter" : "free";

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
      // AC1 hardening — the one-time-trial invariant is enforced where a
      // trial actually materializes, not only at registration: if a
      // Stripe-side trial ever starts for a company whose marker is unset
      // (legacy rows, non-register creation paths), it is consumed HERE.
      ...(subscription.status === "trialing" && company && !company.trialConsumedAt
        ? { trialConsumedAt: new Date() }
        : {}),
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

// Design C completion-time duplicate reconciliation (AC3, second layer).
// The /checkout guard blocks duplicate SESSION creation, but Checkout
// sessions stay completable for ~24h: an older open session (second tab,
// abandoned-then-resumed link) can complete AFTER another subscription
// already exists. That is the only moment a duplicate can materialize, so it
// is enforced here: if the company already holds a different not-closed
// subscription, the INCOMING one is canceled immediately (bounding the damage
// to its initial charge, which is flagged for a manual refund via the audit
// log) and the company's state is left on the subscription it already has.
export async function reconcileCheckoutCompletion(
  companyId: number,
  subscription: Stripe.Subscription,
  stripeCustomerId?: string | null
): Promise<"applied" | "duplicate_canceled"> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { stripeSubscriptionId: true, subscriptionStatus: true },
  });

  const holdsAnotherOpenSubscription =
    Boolean(company?.stripeSubscriptionId) &&
    company!.stripeSubscriptionId !== subscription.id &&
    !CLOSED_SUBSCRIPTION_STATUSES.has(company!.subscriptionStatus);

  if (holdsAnotherOpenSubscription) {
    await stripe.subscriptions.cancel(subscription.id);
    console.error(
      `[stripe sync] duplicate subscription ${subscription.id} canceled for company ${companyId} ` +
        `(kept ${company!.stripeSubscriptionId}) — its initial charge needs a MANUAL REFUND`
    );
    logAudit({
      action: AUDIT_ACTIONS.SUBSCRIPTION_CHANGED,
      companyId,
      metadata: {
        duplicateSubscriptionCanceled: subscription.id,
        keptSubscription: company!.stripeSubscriptionId,
        manualRefundRequired: true,
      },
    });
    return "duplicate_canceled";
  }

  await applySubscriptionUpdate(companyId, subscription, stripeCustomerId);
  return "applied";
}

export async function markSubscriptionCanceled(companyId: number, subscription: Stripe.Subscription): Promise<void> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { plan: true, stripeSubscriptionId: true },
  });

  // Never cancel a manually-managed plan (Founder / Enterprise).
  if (company && isManuallyManaged(company.plan)) {
    return;
  }

  // Id-aware guard (Design C, AC15): only the company's CURRENT subscription
  // may cancel it. A late customer.subscription.deleted for an OLD
  // subscription (e.g. the one the customer already replaced through a new
  // Checkout) must not drop a live company to free/canceled.
  if (company?.stripeSubscriptionId && company.stripeSubscriptionId !== subscription.id) {
    console.warn(
      `[stripe sync] ignoring subscription.deleted for stale subscription ${subscription.id} ` +
        `(company ${companyId} is on ${company.stripeSubscriptionId})`
    );
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
