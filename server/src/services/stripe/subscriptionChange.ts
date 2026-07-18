import Stripe from "stripe";
import prisma from "../../database/prisma";
import { stripe } from "./stripeClient";
import { applySubscriptionUpdate } from "./syncSubscription";
import {
  isPurchasablePlan,
  normalizeCurrency,
  priceIdFor,
  type StripeCurrency,
} from "../../config/stripePricing";
import { canUpgrade, canDowngrade, isManuallyManaged, getEffectivePlan } from "../planAccess";

// S2.6 — the ONE place plan-change (upgrade / downgrade / cancel / resume)
// business logic lives. Routes are thin wrappers; the frontend only renders
// what this returns. All plan comparisons resolve through the S2.2
// plan-access service (canUpgrade/canDowngrade — legacy "pro"/"free" aware),
// all price lookups through the S2.3 centralized Stripe pricing config, and
// every state write funnels through applySubscriptionUpdate, so no mapping
// or tier rule is duplicated here.
//
// Stripe mechanics:
//   - Upgrade: immediate. The existing subscription's single item is updated
//     to the target price with proration. Stripe then reports the new price,
//     and the shared sync layer maps price → plan as it always has.
//   - Downgrade: never immediate. A Subscription Schedule keeps the current
//     price until the end of the current billing period, then switches to the
//     target price. When Stripe flips the phase it emits
//     customer.subscription.updated with the new price and the SAME sync
//     layer applies it — no period-end cron, no duplicate mapping.
//   - Cancel / resume: Stripe's own cancel_at_period_end flag. The
//     subscription is never deleted here and access continues until the
//     period ends (Stripe fires customer.subscription.deleted at that point,
//     which the existing webhook already handles).

export type PlanChangeResult =
  | { ok: true; kind: "upgraded"; plan: string }
  | { ok: true; kind: "downgrade_scheduled"; pendingPlan: string; effectiveAt: Date | null }
  | { ok: true; kind: "downgrade_cancelled" }
  | { ok: true; kind: "requires_checkout" }
  | { ok: false; status: number; error: string };

export type CancellationResult =
  | { ok: true; cancelAtPeriodEnd: boolean }
  | { ok: false; status: number; error: string };

type CompanyBilling = {
  id: number;
  plan: string;
  pendingPlan: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string;
};

async function loadCompany(companyId: number): Promise<CompanyBilling | null> {
  return prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      plan: true,
      pendingPlan: true,
      stripeSubscriptionId: true,
      subscriptionStatus: true,
    },
  });
}

// A subscription we can modify in place: it exists in Stripe and is still
// running (active or trialing). Anything else (canceled, incomplete, local
// trial with no Stripe subscription) goes through Checkout instead.
function hasLiveSubscription(company: CompanyBilling): boolean {
  return (
    Boolean(company.stripeSubscriptionId) &&
    (company.subscriptionStatus === "active" || company.subscriptionStatus === "trialing")
  );
}

// Releases the pending-downgrade schedule (if any) so the subscription
// returns to normal, un-scheduled operation. Safe to call when none exists.
async function releaseScheduleIfAny(subscription: Stripe.Subscription): Promise<void> {
  const scheduleId =
    typeof subscription.schedule === "string" ? subscription.schedule : subscription.schedule?.id;
  if (scheduleId) {
    await stripe.subscriptionSchedules.release(scheduleId);
  }
}

export async function changePlan(
  companyId: number,
  targetPlan: unknown,
  currency: unknown
): Promise<PlanChangeResult> {
  if (!isPurchasablePlan(targetPlan)) {
    return {
      ok: false,
      status: 400,
      error:
        targetPlan === "enterprise"
          ? "Enterprise is sales-led — contact sales to change to it."
          : "Unknown or non-purchasable plan.",
    };
  }

  const company = await loadCompany(companyId);
  if (!company) return { ok: false, status: 404, error: "Company not found" };

  // Founder / Enterprise are operator-managed; self-serve changes are blocked
  // exactly like the webhook guard blocks overwrites.
  if (isManuallyManaged(company.plan)) {
    return { ok: false, status: 400, error: "This plan is managed manually — contact support." };
  }

  const currentEffective = getEffectivePlan(company.plan);

  // Re-selecting the current plan: meaningful only as "cancel my pending
  // downgrade"; otherwise there is nothing to do. Checked before price
  // resolution — neither outcome needs a configured price.
  if (targetPlan === currentEffective) {
    if (company.pendingPlan && company.stripeSubscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(company.stripeSubscriptionId);
      await releaseScheduleIfAny(subscription);
      await prisma.company.update({
        where: { id: company.id },
        data: { pendingPlan: null },
      });
      return { ok: true, kind: "downgrade_cancelled" };
    }
    return { ok: false, status: 400, error: "This is already the current plan." };
  }

  const resolvedCurrency: StripeCurrency = normalizeCurrency(currency);
  const targetPriceId = priceIdFor(targetPlan, resolvedCurrency);
  if (!targetPriceId) {
    return {
      ok: false,
      status: 500,
      error: `No Stripe price configured for ${targetPlan} (${resolvedCurrency.toUpperCase()}).`,
    };
  }

  // --- Upgrade: immediate, prorated, on the existing subscription ---------
  if (canUpgrade(company.plan, targetPlan)) {
    if (!hasLiveSubscription(company)) {
      // No live Stripe subscription to modify (e.g. registration trial or a
      // canceled subscription) — the existing Checkout flow creates a fresh
      // one; never create a duplicate subscription here.
      return { ok: true, kind: "requires_checkout" };
    }

    const subscription = await stripe.subscriptions.retrieve(company.stripeSubscriptionId!);

    // An upgrade supersedes any pending downgrade — release its schedule
    // first so the item update below applies to a plain subscription.
    await releaseScheduleIfAny(subscription);

    const itemId = subscription.items.data[0]?.id;
    if (!itemId) {
      return { ok: false, status: 500, error: "Subscription has no billable item." };
    }

    const updated = await stripe.subscriptions.update(company.stripeSubscriptionId!, {
      items: [{ id: itemId, price: targetPriceId }],
      proration_behavior: "create_prorations",
      // Upgrading is an explicit recommitment — clear a pending cancellation.
      cancel_at_period_end: false,
    });

    await prisma.company.update({ where: { id: company.id }, data: { pendingPlan: null } });
    await applySubscriptionUpdate(company.id, updated);

    return { ok: true, kind: "upgraded", plan: targetPlan };
  }

  // --- Downgrade: scheduled at period end via a Subscription Schedule -----
  if (canDowngrade(company.plan, targetPlan)) {
    if (!hasLiveSubscription(company)) {
      return {
        ok: false,
        status: 400,
        error: "No active subscription to downgrade — there is nothing to schedule.",
      };
    }

    const subscription = await stripe.subscriptions.retrieve(company.stripeSubscriptionId!);
    const item = subscription.items.data[0];
    if (!item) {
      return { ok: false, status: 500, error: "Subscription has no billable item." };
    }

    // Re-scheduling to a different downgrade target: drop the old schedule
    // first (exactly one schedule per subscription).
    await releaseScheduleIfAny(subscription);

    const schedule = await stripe.subscriptionSchedules.create({
      from_subscription: subscription.id,
    });

    const currentPhase = schedule.phases[0];
    await stripe.subscriptionSchedules.update(schedule.id, {
      // Phase 1: today's price until the end of the already-paid period.
      // Phase 2: the target price from then on. `release` detaches the
      // schedule afterwards so the subscription keeps renewing normally.
      end_behavior: "release",
      phases: [
        {
          items: [{ price: item.price.id, quantity: 1 }],
          start_date: currentPhase.start_date,
          end_date: item.current_period_end,
        },
        {
          items: [{ price: targetPriceId, quantity: 1 }],
        },
      ],
    });

    await prisma.company.update({
      where: { id: company.id },
      data: { pendingPlan: targetPlan },
    });

    return {
      ok: true,
      kind: "downgrade_scheduled",
      pendingPlan: targetPlan,
      effectiveAt: item.current_period_end ? new Date(item.current_period_end * 1000) : null,
    };
  }

  return { ok: false, status: 400, error: "Unsupported plan change." };
}

export async function setCancelAtPeriodEnd(
  companyId: number,
  cancel: boolean
): Promise<CancellationResult> {
  const company = await loadCompany(companyId);
  if (!company) return { ok: false, status: 404, error: "Company not found" };

  if (isManuallyManaged(company.plan)) {
    return { ok: false, status: 400, error: "This plan is managed manually — contact support." };
  }

  if (!hasLiveSubscription(company)) {
    return {
      ok: false,
      status: 400,
      error: cancel
        ? "No active subscription to cancel."
        : "No active subscription to resume.",
    };
  }

  // Cancelling also abandons a pending downgrade — a subscription that ends
  // at period end has no next phase to downgrade into.
  if (cancel && company.pendingPlan) {
    const subscription = await stripe.subscriptions.retrieve(company.stripeSubscriptionId!);
    await releaseScheduleIfAny(subscription);
    await prisma.company.update({ where: { id: company.id }, data: { pendingPlan: null } });
  }

  const updated = await stripe.subscriptions.update(company.stripeSubscriptionId!, {
    cancel_at_period_end: cancel,
  });

  await applySubscriptionUpdate(company.id, updated);

  return { ok: true, cancelAtPeriodEnd: updated.cancel_at_period_end };
}
