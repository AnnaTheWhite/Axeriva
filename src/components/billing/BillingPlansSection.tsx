import { useState } from "react";
import BillingPlanCard, { type BillingPlanAction } from "./BillingPlanCard";
import { PLAN_LIST, currencyForLanguage, type PlanId } from "../../config/pricing";
import { displayPlanTier } from "./planDisplay";
import { startCheckout } from "../../services/subscription.service";
import { redirectTo } from "../../services/api";
import { useTranslation } from "../../i18n";

type BillingPlansSectionProps = {
  // Server-resolved effective plan (SubscriptionStatus.effectivePlan) — legacy
  // "free"/"pro" already normalized by the backend's S2.2 plan-access
  // service, so this component never re-derives that mapping itself.
  currentPlan: PlanId | "founder";
  onCheckoutError: (message: string) => void;
};

// Available Plans (S2.4). Reads every plan from the S2.1 centralized pricing
// config (no duplicated pricing) and derives each card's action
// (Current / Upgrade / Downgrade / Contact Sales) from a simple tier
// comparison — no upgrade/downgrade business logic is implemented here; the
// button only calls the existing S2.3 checkout endpoint, exactly like the
// public pricing page's "Start free trial" button does.
export default function BillingPlansSection({ currentPlan, onCheckoutError }: BillingPlansSectionProps) {
  const { language } = useTranslation();
  const [checkingOutPlan, setCheckingOutPlan] = useState<string | null>(null);

  const currentTier = displayPlanTier(currentPlan);

  async function handleCheckout(planId: (typeof PLAN_LIST)[number]["id"]) {
    setCheckingOutPlan(planId);
    try {
      const url = await startCheckout(planId, currencyForLanguage(language));
      redirectTo(url);
    } catch (error) {
      onCheckoutError(error instanceof Error ? error.message : "Failed to start checkout");
      setCheckingOutPlan(null);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
      {PLAN_LIST.map((plan) => {
        const isCurrent = plan.id === currentPlan;
        let action: BillingPlanAction;
        if (plan.ctaType === "contact-sales") {
          action = "contact";
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
            onCheckout={() => handleCheckout(plan.id)}
            isCheckingOut={checkingOutPlan === plan.id}
          />
        );
      })}
    </div>
  );
}
