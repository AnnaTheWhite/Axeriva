import { useTranslation } from "../../i18n";

// Trial banner (S2.4) — shown only while the company's subscription is
// "trialing". This is a placeholder notice only: no trial countdown, no
// expiry/read-only logic. Real trial business logic (day counters, expiry
// handling) lands in S2.5; this banner just reflects the Stripe status that
// already exists today.
export default function TrialBanner({ subscriptionStatus }: { subscriptionStatus: string }) {
  const { t } = useTranslation();

  if (subscriptionStatus !== "trialing") return null;

  return (
    <div
      role="status"
      className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-orange-500/30 bg-orange-500/10 px-5 py-3 text-sm"
    >
      <span className="text-orange-300">{t("subscription.trial.bannerMessage")}</span>
    </div>
  );
}
