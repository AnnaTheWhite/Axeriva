import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import { SkeletonBlock, SkeletonCardGrid } from "../components/ui/Skeleton";
import TrialBanner from "../components/billing/TrialBanner";
import CurrentSubscriptionCard from "../components/billing/CurrentSubscriptionCard";
import UsageCard from "../components/billing/UsageCard";
import BillingPlansSection from "../components/billing/BillingPlansSection";
import BillingInfoCard from "../components/billing/BillingInfoCard";
import InvoiceHistoryCard from "../components/billing/InvoiceHistoryCard";
import { useTranslation } from "../i18n";
import {
  getSubscriptionStatus,
  syncCheckoutSession,
  cancelSubscription,
  resumeSubscription,
  type SubscriptionStatus,
} from "../services/subscription.service";
import { getCompanySettings, type CompanySettings } from "../services/companySettings.service";

// Billing Settings (S2.4 + S2.6). Assembles the S2.1 pricing config, the
// S2.2 Feature/Limit Registry (via the extended /subscription payload) and
// the S2.3/S2.6 billing endpoints. Plan-change/cancel/resume business rules
// live server-side in services/stripe/subscriptionChange.ts — this page only
// invokes them and re-fetches state.
export default function SubscriptionPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();

  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [isActionInFlight, setIsActionInFlight] = useState(false);
  const [isPlanChangeInFlight, setIsPlanChangeInFlight] = useState(false);

  const checkoutResult = searchParams.get("checkout");
  const sessionId = searchParams.get("session_id");

  function loadAll() {
    Promise.all([getSubscriptionStatus(), getCompanySettings()])
      .then(([s, c]) => {
        setStatus(s);
        setSettings(c);
      })
      .catch(() => {
        setStatus(null);
        setSettings(null);
      })
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    if (checkoutResult === "success" && sessionId) {
      // Don't rely solely on the webhook having already landed — reconcile
      // directly from the Checkout Session we just returned from (existing
      // S2.3 sync endpoint), then refresh what's shown on screen.
      syncCheckoutSession(sessionId)
        .then(() => {
          setMessage(t("subscription.checkout.success"));
          loadAll();
        })
        .catch(() => setMessage(t("subscription.checkout.syncFailed")));
    } else if (checkoutResult === "cancelled") {
      setMessage(t("subscription.checkout.cancelled"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutResult, sessionId]);

  // Cancel / resume (S2.6): fire the endpoint, surface the outcome, refetch.
  // isActionInFlight also disables the plan-change buttons below so only one
  // billing mutation can run at a time.
  async function runCancellationAction(action: "cancel" | "resume") {
    setMessage(null);
    setIsActionInFlight(true);
    try {
      if (action === "cancel") {
        await cancelSubscription();
        setMessage(t("subscription.cancellation.cancelled"));
      } else {
        await resumeSubscription();
        setMessage(t("subscription.cancellation.resumed"));
      }
      loadAll();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("subscription.loadError"));
    } finally {
      setIsActionInFlight(false);
    }
  }

  if (isLoading) {
    return (
      <div className="p-4 sm:p-8" aria-busy="true">
        <PageHeader title={t("subscription.title")} subtitle={t("subscription.subtitle")} />
        <div className="mb-6">
          <SkeletonBlock className="h-40 w-full rounded-3xl" />
        </div>
        <SkeletonCardGrid count={4} />
      </div>
    );
  }

  if (!status || !settings) {
    return (
      <div className="p-4 sm:p-8">
        <PageHeader title={t("subscription.title")} subtitle={t("subscription.subtitle")} />
        <p className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {t("subscription.loadError")}
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8">
      <PageHeader title={t("subscription.title")} subtitle={t("subscription.subtitle")} />

      <TrialBanner subscriptionStatus={status.subscriptionStatus} />

      {message && (
        <p className="mb-6 rounded-lg bg-orange-500/10 px-4 py-3 text-sm text-orange-300">{message}</p>
      )}

      <div className="mb-8">
        <CurrentSubscriptionCard
          status={status}
          onCancel={() => void runCancellationAction("cancel")}
          onResume={() => void runCancellationAction("resume")}
          isProcessing={isActionInFlight || isPlanChangeInFlight}
        />
      </div>

      <div className="mb-8">
        <UsageCard usage={status.usage} limits={status.limits} />
      </div>

      <h2 className="mb-4 text-lg font-semibold text-white">{t("subscription.plans.title")}</h2>
      <div className="mb-8">
        <BillingPlansSection
          currentPlan={status.effectivePlan}
          hasActiveSubscription={status.hasActiveSubscription}
          pendingPlan={status.pendingPlan}
          isManaged={status.effectivePlan === "founder" || status.effectivePlan === "enterprise"}
          disabled={isActionInFlight}
          onCheckoutError={setMessage}
          onChanged={(kind) => {
            setMessage(
              kind === "upgraded"
                ? t("subscription.currentPlan.upgraded")
                : kind === "downgrade_scheduled"
                  ? t("subscription.downgrade.scheduled")
                  : t("subscription.downgrade.cancelled")
            );
            loadAll();
          }}
          onProcessingChange={setIsPlanChangeInFlight}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <BillingInfoCard settings={settings} hasStripeCustomer={status.hasStripeCustomer} />
        <InvoiceHistoryCard />
      </div>
    </div>
  );
}
