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
  // Pending period-end downgrade target (SubscriptionStatus.pendingPlan).
  pendingPlan: PlanId | null;
  // Founder/Enterprise are operator-managed — self-serve changes disabled.
  isManaged: boolean;
  // Another billing action (cancel/resume) is running — disable everything.
  disabled: boolean;
  onCheckoutError: (message: string) => void;
  // Called after a server-side change so the page can refetch state and show
  // the matching feedback message.
  onChanged: (kind: "upgraded" | "downgrade_scheduled" | "downgrade_cancelled") => void;
  // Lets the page disable its own cancel/resume actions while a plan change
  // is in flight (mutual exclusion across all billing actions).
  onProcessingChange: (processing: boolean) => void;
};

// Available Plans (S2.4 + S2.6). Plans come from the S2.1 centralized pricing
// config; each card's action derives from the S2.2 tier order. Buttons call
// the S2.6 change-plan endpoint — upgrades apply immediately, downgrades are
// confirmed first and scheduled at period end, and when the backend answers
// `requires_checkout` (no live subscription) the existing checkout flow takes
// over. No pricing/tier business rules live here.
export default function BillingPlansSection({
  currentPlan,
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

  const currentTier = displayPlanTier(currentPlan);
  const isProcessing = processingPlan !== null || disabled;

  async function performChange(planId: PlanId) {
    setProcessingPlan(planId);
    onProcessingChange(true);
    try {
      const result = await changePlan(planId, currencyForLanguage(language));
      if (result.kind === "requires_checkout") {
        // No live subscription to modify — fall back to the existing
        // Checkout flow (same endpoint the pricing page uses).
        const url = await startCheckout(planId, currencyForLanguage(language));
        redirectTo(url);
        return; // leaving the page; keep the button in its processing state
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
    if (action === "downgrade") {
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

  return (
    <>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {PLAN_LIST.map((plan) => {
          const isCurrent = plan.id === currentPlan;
          let action: BillingPlanAction;
          if (plan.ctaType === "contact-sales") {
            action = "contact";
          } else if (isManaged) {
            // Operator-managed company: show the catalog, allow no self-serve
            // changes (the backend rejects them anyway).
            action = "managed";
          } else if (isCurrent) {
            action = "current";
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
    </>
  );
}
