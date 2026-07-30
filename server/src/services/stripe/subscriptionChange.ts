import Stripe from "stripe";
import prisma from "../../database/prisma";
import { stripe } from "./stripeClient";
import { applySubscriptionUpdate, CLOSED_SUBSCRIPTION_STATUSES } from "./syncSubscription";
import {
  isPurchasablePlan,
  isStripeCurrency,
  normalizeCurrency,
  priceIdFor,
  type PurchasablePlan,
  type StripeCurrency,
} from "../../config/stripePricing";
import { canUpgrade, canDowngrade, isManuallyManaged, getEffectivePlan } from "../planAccess";
import { hasActiveSubscription } from "../readOnly";
import { config } from "../../config";

// S2.6 — the ONE place plan-change (upgrade / downgrade / cancel / resume)
// business logic lives. Routes are thin wrappers; the frontend only renders
// what this returns. All plan comparisons resolve through the S2.2
// plan-access service (canUpgrade/canDowngrade — legacy "pro"/"free" aware),
// all price lookups through the S2.3 centralized Stripe pricing config, and
// every state write funnels through applySubscriptionUpdate, so no mapping
// or tier rule is duplicated here.
//
// Stripe mechanics (Design C, docs/checkout-only-upgrades-ux.md):
//   - Upgrade: NEVER a silent subscriptions.update. With a live subscription
//     the customer is sent to Stripe's hosted confirmation page (Billing
//     Portal `subscription_update_confirm` flow, dedicated configuration with
//     always_invoice): they see the exact prorated amount there and approve
//     it themselves. Stripe then performs the update and emits
//     customer.subscription.updated, which the shared sync layer applies —
//     plus the return-sync endpoint applies it immediately on return.
//     Without a live subscription the existing Checkout flow takes over.
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
  | { ok: true; kind: "requires_upgrade_confirmation"; url: string; plan: string }
  | { ok: true; kind: "downgrade_scheduled"; pendingPlan: string; effectiveAt: Date | null }
  | { ok: true; kind: "downgrade_cancelled" }
  | { ok: true; kind: "requires_checkout" }
  | { ok: false; status: number; error: string };

// Locales the hosted Stripe pages are asked to render in — mirrors the app's
// two UI languages. Anything else falls back to Stripe's auto-detection.
const PORTAL_LOCALES = ["hu", "en"] as const;
export type PortalLocale = (typeof PORTAL_LOCALES)[number];

export function normalizePortalLocale(value: unknown): PortalLocale | undefined {
  return typeof value === "string" && (PORTAL_LOCALES as readonly string[]).includes(value)
    ? (value as PortalLocale)
    : undefined;
}

export type CancellationResult =
  | { ok: true; cancelAtPeriodEnd: boolean }
  | { ok: false; status: number; error: string };

type CompanyBilling = {
  id: number;
  plan: string;
  pendingPlan: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string;
  subscriptionEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
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
      subscriptionEndsAt: true,
      cancelAtPeriodEnd: true,
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

// Design C duplicate guard (AC3/AC12): true when the company holds a Stripe
// subscription that is NOT closed (CLOSED_SUBSCRIPTION_STATUSES lives in
// syncSubscription.ts, shared with the completion-time reconciliation) —
// i.e. Checkout must be refused. Everything not-closed that still has an id
// is either live (modify via the confirmation flow) or broken-but-open
// (past_due/unpaid/incomplete → the payment must be fixed in the Billing
// Portal; a second subscription must never be created next to it). Note this
// deliberately includes past_due, the exact leak the technical plan's review
// flagged: markSubscriptionCanceled never clears stripeSubscriptionId, so the
// canceled check is on STATUS, not on the id's presence.
export function hasBlockingSubscription(company: {
  stripeSubscriptionId: string | null;
  subscriptionStatus: string;
}): boolean {
  return (
    Boolean(company.stripeSubscriptionId) &&
    !CLOSED_SUBSCRIPTION_STATUSES.has(company.subscriptionStatus)
  );
}

// The error every "broken-but-open subscription" path answers with — the
// frontend shows its localized blocked-state message instead (AC12).
const OVERDUE_RESULT = {
  ok: false as const,
  status: 409,
  error: "Subscription payment is overdue — settle the open invoice first.",
};

// Resolves the target plan's Price for an EXISTING subscription.
//
// Stripe pins a subscription's currency at creation: updating an item to a
// price in a different currency is rejected with a plain 400 ("all prices
// must have the same currency"), which the error mapper can only report as a
// generic "Billing request failed". That is not a hypothetical — the
// requested currency comes from the UI LANGUAGE (currencyForLanguage() in
// the frontend), so a customer who subscribed in HUF and later switched the
// interface to English sends "EUR" and walks straight into it.
//
// So the live subscription's own currency always wins. The requested
// currency is only a fallback for the (unexpected) case where Stripe reports
// a currency we don't sell in; paths with no subscription never reach here —
// they hand off to Checkout, where the requested currency is correct because
// the subscription does not exist yet.
type TargetPrice =
  | { ok: true; priceId: string; currency: StripeCurrency }
  | { ok: false; status: number; error: string };

function resolveTargetPrice(
  targetPlan: PurchasablePlan,
  subscription: Stripe.Subscription,
  requestedCurrency: StripeCurrency
): TargetPrice {
  const existing = subscription.items.data[0]?.price?.currency;
  const currency: StripeCurrency = isStripeCurrency(existing) ? existing : requestedCurrency;

  const priceId = priceIdFor(targetPlan, currency);
  if (!priceId) {
    return {
      ok: false,
      status: 500,
      error: `No Stripe price configured for ${targetPlan} (${currency.toUpperCase()}).`,
    };
  }

  return { ok: true, priceId, currency };
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
  currency: unknown,
  locale?: PortalLocale
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

  // Re-selecting the ASSIGNED plan. Checked before price resolution — none of
  // these outcomes need a configured price.
  if (targetPlan === currentEffective) {
    // (a) Cancel a pending period-end downgrade back to the current plan.
    if (company.pendingPlan && company.stripeSubscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(company.stripeSubscriptionId);
      await releaseScheduleIfAny(subscription);
      await prisma.company.update({
        where: { id: company.id },
        data: { pendingPlan: null },
      });
      return { ok: true, kind: "downgrade_cancelled" };
    }
    // (b) Assigned to this plan but with NO active subscription/trial
    // (expired trial, or a subscription that ended), OR on the DB-only
    // registration trial (active, but with no Stripe subscription behind it —
    // Design C/AC2 lets the owner pay for Starter while the trial still
    // runs). Both mean "subscribe for real" → hand off to Checkout. A company
    // with a live PAID subscription on this plan still gets the 400 below.
    if (!hasActiveSubscription(company) || !company.stripeSubscriptionId) {
      // …unless a broken-but-open subscription (unpaid, elapsed past_due)
      // still exists: /checkout would 409 on it, so answering
      // requires_checkout here would send the client into a dead-end loop.
      // Same 409 as the upgrade branch → same blocked-state UX (AC12).
      if (hasBlockingSubscription(company)) {
        return OVERDUE_RESULT;
      }
      return { ok: true, kind: "requires_checkout" };
    }
    return { ok: false, status: 400, error: "This is already the current plan." };
  }

  // The currency the CALLER asked for. Only used where no live subscription
  // exists — otherwise the subscription's own currency wins (see
  // resolveTargetPrice).
  const resolvedCurrency: StripeCurrency = normalizeCurrency(currency);

  // --- Upgrade: Stripe-hosted confirmation on the existing subscription ----
  if (canUpgrade(company.plan, targetPlan)) {
    if (!hasLiveSubscription(company)) {
      // A broken-but-open subscription (past_due/unpaid/incomplete) must be
      // fixed in the Billing Portal first — neither a duplicate Checkout nor
      // a confirmation flow may run next to it (AC12).
      if (hasBlockingSubscription(company)) {
        return OVERDUE_RESULT;
      }
      // No Stripe subscription at all (registration trial, canceled/expired) —
      // the existing Checkout flow creates a fresh one; never create a
      // duplicate subscription here.
      return { ok: true, kind: "requires_checkout" };
    }

    // The hosted confirmation page cannot withdraw a pending cancellation, so
    // upgrading while one is set would let the customer pay a proration for a
    // subscription that dies at period end. Explicit two-step UX instead
    // (AC11): resume first, then upgrade. The frontend blocks this before
    // calling; this guard makes the rule hold for direct API calls too.
    if (company.cancelAtPeriodEnd) {
      return {
        ok: false,
        status: 409,
        error: "A cancellation is pending — resume the subscription before changing plans.",
      };
    }

    if (!config.stripe.portalFlowConfigId) {
      return {
        ok: false,
        status: 500,
        error: "Stripe is not configured (missing STRIPE_PORTAL_FLOW_CONFIG_ID).",
      };
    }

    const subscription = await stripe.subscriptions.retrieve(company.stripeSubscriptionId!);

    const price = resolveTargetPrice(targetPlan, subscription, resolvedCurrency);
    if (!price.ok) return price;

    const itemId = subscription.items.data[0]?.id;
    if (!itemId) {
      return { ok: false, status: 500, error: "Subscription has no billable item." };
    }

    // An upgrade supersedes any pending downgrade — and Stripe refuses to run
    // the confirmation flow on a schedule-managed subscription, so the
    // schedule must go BEFORE the session is created (AC13). The upgrade
    // dialog told the customer this; if they abandon the hosted page the
    // downgrade stays cancelled, which the UI reflects on the next load.
    await releaseScheduleIfAny(subscription);
    await prisma.company.update({ where: { id: company.id }, data: { pendingPlan: null } });

    // The hosted confirmation page (Design C): Stripe shows the exact
    // prorated amount and the customer approves it THERE — this service never
    // performs the plan change itself. Confirmation triggers
    // customer.subscription.updated (webhook) and the return redirect
    // triggers the return-sync endpoint, so the app updates either way.
    const flowSession = await stripe.billingPortal.sessions.create({
      customer:
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id,
      configuration: config.stripe.portalFlowConfigId,
      ...(locale ? { locale } : {}),
      return_url: `${config.frontendUrl}/subscription`,
      flow_data: {
        type: "subscription_update_confirm",
        subscription_update_confirm: {
          subscription: subscription.id,
          items: [{ id: itemId, price: price.priceId, quantity: 1 }],
        },
        after_completion: {
          type: "redirect",
          redirect: { return_url: `${config.frontendUrl}/subscription?upgrade=confirmed` },
        },
      },
    });

    if (!flowSession.url) {
      return { ok: false, status: 502, error: "Stripe did not return a confirmation URL." };
    }

    return { ok: true, kind: "requires_upgrade_confirmation", url: flowSession.url, plan: targetPlan };
  }

  // --- Downgrade: scheduled at period end via a Subscription Schedule -----
  if (canDowngrade(company.plan, targetPlan)) {
    if (!hasLiveSubscription(company)) {
      // Broken-but-open (past_due/unpaid): same blocked-state answer as the
      // upgrade branch — "no active subscription" would be factually wrong
      // for a live-but-dunning subscription (AC12).
      if (hasBlockingSubscription(company)) {
        return OVERDUE_RESULT;
      }
      return {
        ok: false,
        status: 400,
        error: "No active subscription to downgrade — there is nothing to schedule.",
      };
    }

    // Symmetry with the upgrade branch (AC11): a subscription that dies at
    // period end has no next phase to downgrade into — resume first. (The
    // reverse order is already handled: cancelling abandons a pending
    // downgrade in setCancelAtPeriodEnd.)
    if (company.cancelAtPeriodEnd) {
      return {
        ok: false,
        status: 409,
        error: "A cancellation is pending — resume the subscription before changing plans.",
      };
    }

    const subscription = await stripe.subscriptions.retrieve(company.stripeSubscriptionId!);
    const item = subscription.items.data[0];
    if (!item) {
      return { ok: false, status: 500, error: "Subscription has no billable item." };
    }

    // Both schedule phases must share one currency — phase 1 reuses the
    // subscription's current price, so phase 2 has to match it.
    const price = resolveTargetPrice(targetPlan, subscription, resolvedCurrency);
    if (!price.ok) return price;

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
          items: [{ price: price.priceId, quantity: 1 }],
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
