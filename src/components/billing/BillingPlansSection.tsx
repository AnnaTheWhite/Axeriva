import { useState } from "react";
import BillingPlanCard, { type BillingPlanAction } from "./BillingPlanCard";
import ConfirmModal from "../ui/ConfirmModal";
import { PLAN_LIST, currencyForLanguage, type PlanId } from "../../config/pricing";
import { displayPlanTier } from "./planDisplay";
import { changePlan, startCheckout } from "../../services/subscription.service";
import { redirectTo } from "../../services/api";
import { useTranslation } from "../../i18n";

type BillingPlansSectionProps = {
  // Server-resolved effective plan (SubscriptionStatus.effectivePlan) — legacy
  // "free"/"pro" already normalized by the backend's S2.2 plan-access
  // service, so this component never re-derives that mapping itself.
  currentPlan: PlanId | "founder";
  // Whether a LIVE subscription/trial is in effect. The assigned plan alone
  // does NOT make a card "current" — a company assigned Starter with an
  // expired trial/subscription must be able to subscribe to Starter again.
  hasActiveSubscription: boolean;
  // Whether a Stripe subscription object exists behind the company. The
  // DB-only registration trial has none — that is what lets the owner pay
  // for their current plan while the trial still runs (Design C/AC2).
  hasStripeSubscription: boolean;
  // Raw Stripe status — past_due blocks every plan action (AC12).
  subscriptionStatus: string;
  // A pending cancellation blocks upgrades (two-step UX, AC11).
  cancelAtPeriodEnd: boolean;
  // Pending period-end downgrade target (SubscriptionStatus.pendingPlan).
  pendingPlan: PlanId | null;
  // Founder/Enterprise are operator-managed — self-serve changes disabled.
  isManaged: boolean;
  // Another billing action (cancel/resume) is running — disable everything.
  disabled: boolean;
  onCheckoutError: (message: string) => void;
  // Called after a server-side change so the page can refetch state and show
  // the matching feedback message. (Upgrades no longer complete here — they
  // finish on Stripe's hosted confirmation page and report back via
  // ?upgrade=confirmed.)
  onChanged: (kind: "downgrade_scheduled" | "downgrade_cancelled") => void;
  // Lets the page disable its own cancel/resume actions while a plan change
  // is in flight (mutual exclusion across all billing actions).
  onProcessingChange: (processing: boolean) => void;
};

// Available Plans (S2.4 + S2.6 + Design C). Plans come from the S2.1
// centralized pricing config; each card's action derives from the S2.2 tier
// order. Buttons call the S2.6 change-plan endpoint — paid→paid upgrades are
// confirmed in a dialog and then approved by the customer on Stripe's hosted
// confirmation page (requires_upgrade_confirmation → redirect), downgrades
// are confirmed first and scheduled at period end, and when the backend
// answers `requires_checkout` (no Stripe subscription) the existing checkout
// flow takes over. No pricing/tier business rules live here.
export default function BillingPlansSection({
  currentPlan,
  hasActiveSubscription,
  hasStripeSubscription,
  subscriptionStatus,
  cancelAtPeriodEnd,
  pendingPlan,
  isManaged,
  disabled,
  onCheckoutError,
  onChanged,
  onProcessingChange,
}: BillingPlansSectionProps) {
  const { t, language } = useTranslation();
  const [processingPlan, setProcessingPlan] = useState<string | null>(null);
  const [confirmDowngradePlan, setConfirmDowngradePlan] = useState<PlanId | null>(null);
  const [confirmUpgradePlan, setConfirmUpgradePlan] = useState<PlanId | null>(null);

  const currentTier = displayPlanTier(currentPlan);
  const isProcessing = processingPlan !== null || disabled;
  // A live Stripe subscription means upgrades go through the hosted
  // confirmation flow (with the explanatory dialog first); without one they
  // go to Checkout, where the payment step speaks for itself.
  const hasLiveStripeSubscription = hasStripeSubscription && hasActiveSubscription;
  // AC12 — "broken-but-open" mirror of the server's hasBlockingSubscription:
  // a Stripe subscription that is neither live (active/trialing) nor closed
  // (canceled/incomplete_expired) — i.e. past_due, unpaid, incomplete —
  // blocks EVERY plan action until the payment is settled in the Portal.
  const hasBrokenOpenSubscription =
    hasStripeSubscription &&
    !["active", "trialing", "canceled", "incomplete_expired"].includes(subscriptionStatus);

  async function performChange(planId: PlanId) {
    setProcessingPlan(planId);
    onProcessingChange(true);
    try {
      const result = await changePlan(planId, currencyForLanguage(language), language);
      if (result.kind === "requires_checkout") {
        // No Stripe subscription to modify — fall back to the existing
        // Checkout flow (same endpoint the pricing page uses).
        const url = await startCheckout(planId, currencyForLanguage(language));
        redirectTo(url);
        return; // leaving the page; keep the button in its processing state
      }
      if (result.kind === "requires_upgrade_confirmation") {
        // Design C: the plan change happens on Stripe's hosted confirmation
        // page — the customer sees and approves the prorated amount there.
        redirectTo(result.url);
        return; // leaving the page
      }
      onChanged(result.kind);
    } catch (error) {
      onCheckoutError(error instanceof Error ? error.message : "Failed to change plan");
    } finally {
      setProcessingPlan(null);
      onProcessingChange(false);
    }
  }

  function handleAction(planId: PlanId, action: BillingPlanAction) {
    // AC12 — a broken-but-open subscription (past_due, unpaid, incomplete)
    // blocks EVERY plan action (upgrade, subscribe, downgrade, keep): the
    // payment must be settled in the Stripe portal first. Mirrors the
    // server-side 409s so the user gets the localized message instead of a
    // raw error.
    if (hasBrokenOpenSubscription) {
      onCheckoutError(t("subscription.upgrade.blockedPastDue"));
      return;
    }
    if (action === "upgrade") {
      // AC11 — two-step UX while a cancellation is pending: resume first,
      // then upgrade. (Investigated 2026-07-29; the hosted confirmation flow
      // cannot withdraw a cancellation.)
      if (cancelAtPeriodEnd && hasStripeSubscription) {
        onCheckoutError(t("subscription.upgrade.blockedCancelPending"));
        return;
      }
      if (hasLiveStripeSubscription) {
        // Paid→paid: explain the Stripe-hosted payment step before leaving
        // the app (Design C dialog), then redirect on confirm.
        setConfirmUpgradePlan(planId);
        return;
      }
      // No Stripe subscription (registration trial / expired / canceled):
      // straight to Checkout — the card form there is self-explanatory.
      void performChange(planId);
      return;
    }
    if (action === "downgrade") {
      // AC11 symmetry — a subscription that ends at period end has no next
      // phase to downgrade into; the server would 409, block it here too.
      if (cancelAtPeriodEnd && hasStripeSubscription) {
        onCheckoutError(t("subscription.upgrade.blockedCancelPending"));
        return;
      }
      // Downgrades never apply immediately — confirm the period-end behavior
      // before scheduling anything.
      setConfirmDowngradePlan(planId);
      return;
    }
    void performChange(planId);
  }

  const confirmTargetName = confirmDowngradePlan
    ? t(`pricing.plans.${confirmDowngradePlan}.name`)
    : "";
  const upgradeTargetName = confirmUpgradePlan
    ? t(`pricing.plans.${confirmUpgradePlan}.name`)
    : "";
  // The upgrade dialog spells out that a pending downgrade is cancelled by
  // starting the upgrade (AC13) — the schedule is released server-side BEFORE
  // the Stripe page opens, so abandoning that page leaves the downgrade
  // cancelled.
  const upgradeMessage = pendingPlan
    ? `${t("subscription.upgrade.confirmMessage", { plan: upgradeTargetName })} ${t(
        "subscription.upgrade.pendingDowngradeNote"
      )}`
    : t("subscription.upgrade.confirmMessage", { plan: upgradeTargetName });

  return (
    <>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {PLAN_LIST.map((plan) => {
          const isAssigned = plan.id === currentPlan;
          // "Current" (disabled) only when this is the assigned plan AND a
          // live subscription/trial is actually in effect. Assigned-but-
          // expired falls through to "subscribe" below.
          const isCurrent = isAssigned && hasActiveSubscription;
          let action: BillingPlanAction;
          if (plan.ctaType === "contact-sales") {
            action = "contact";
          } else if (isManaged) {
            // Operator-managed company: show the catalog, allow no self-serve
            // changes (the backend rejects them anyway).
            action = "managed";
          } else if (isCurrent && !hasStripeSubscription) {
            // Design C/AC2 — the DB-only registration trial: the assigned
            // plan is live but unpaid, so the owner can pay for it now
            // (Checkout, card required, no second trial).
            action = "subscribe";
          } else if (isCurrent && pendingPlan) {
            // A period-end downgrade is pending — re-selecting the current
            // plan cancels it ("Maradok a jelenlegi csomagon"). Without this
            // the pending downgrade could not be withdrawn from the UI.
            action = "keep";
          } else if (isCurrent) {
            action = "current";
          } else if (isAssigned) {
            // Assigned this plan but no active subscription/trial → let the
            // owner subscribe again (creates a fresh Checkout session).
            action = "subscribe";
          } else {
            action = displayPlanTier(plan.id) > currentTier ? "upgrade" : "downgrade";
          }

          return (
            <BillingPlanCard
              key={plan.id}
              plan={plan}
              action={action}
              isCurrent={isCurrent}
              isPendingDowngradeTarget={pendingPlan === plan.id}
              onAction={() => handleAction(plan.id, action)}
              isProcessing={processingPlan === plan.id}
              disabled={isProcessing}
            />
          );
        })}
      </div>

      <ConfirmModal
        open={confirmDowngradePlan !== null}
        title={t("subscription.downgrade.confirmTitle", { plan: confirmTargetName })}
        message={t("subscription.downgrade.confirmMessage", { plan: confirmTargetName })}
        confirmText={t("subscription.downgrade.confirmCta")}
        cancelText={t("subscription.downgrade.keepCurrent")}
        onConfirm={() => {
          const target = confirmDowngradePlan;
          setConfirmDowngradePlan(null);
          if (target) void performChange(target);
        }}
        onClose={() => setConfirmDowngradePlan(null)}
      />

      <ConfirmModal
        open={confirmUpgradePlan !== null}
        tone="primary"
        title={t("subscription.upgrade.confirmTitle", { plan: upgradeTargetName })}
        message={upgradeMessage}
        confirmText={t("subscription.upgrade.confirmCta")}
        cancelText={t("common.cancel")}
        onConfirm={() => {
          const target = confirmUpgradePlan;
          setConfirmUpgradePlan(null);
          if (target) void performChange(target);
        }}
        onClose={() => setConfirmUpgradePlan(null)}
      />
    </>
  );
}
