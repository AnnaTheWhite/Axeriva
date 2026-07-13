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
  type SubscriptionStatus,
} from "../services/subscription.service";
import { getCompanySettings, type CompanySettings } from "../services/companySettings.service";

// Billing Settings (S2.4) — replaces the legacy single-plan "Axeriva Pro"
// page. Assembles the S2.1 pricing config, the S2.2 Feature/Limit Registry
// (via the extended /subscription payload) and the S2.3 checkout endpoint
// into a read-only billing overview. No trial engine, no read-only
// enforcement, no upgrade/downgrade business logic, no Stripe Portal/invoice
// sync — those are later stories; buttons here only call the existing S2.3
// checkout endpoint.
export default function SubscriptionPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();

  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

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
        <CurrentSubscriptionCard status={status} />
      </div>

      <div className="mb-8">
        <UsageCard usage={status.usage} limits={status.limits} />
      </div>

      <h2 className="mb-4 text-lg font-semibold text-white">{t("subscription.plans.title")}</h2>
      <div className="mb-8">
        <BillingPlansSection currentPlan={status.effectivePlan} onCheckoutError={setMessage} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <BillingInfoCard settings={settings} hasStripeCustomer={status.hasStripeCustomer} />
        <InvoiceHistoryCard />
      </div>
    </div>
  );
}
