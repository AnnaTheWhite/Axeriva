import { useTranslation } from "../../i18n";

// Trial banner (S2.4 + Design C) — shown only while the company's
// subscription is "trialing". Shows the trial's end date when known, and —
// for the DB-only registration trial (no Stripe subscription yet) — a
// "subscribe now" CTA that jumps to the plan cards, where the Starter card
// offers the paid subscription (Design C/AC2). Expiry/read-only enforcement
// stays server-side; this banner only reflects state.
export default function TrialBanner({
  subscriptionStatus,
  subscriptionEndsAt,
  showSubscribeCta,
}: {
  subscriptionStatus: string;
  subscriptionEndsAt: string | null;
  showSubscribeCta: boolean;
}) {
  const { t, language } = useTranslation();

  if (subscriptionStatus !== "trialing") return null;

  const endsAt = subscriptionEndsAt
    ? new Date(subscriptionEndsAt).toLocaleDateString(language === "hu" ? "hu-HU" : "en-GB")
    : null;

  return (
    <div
      role="status"
      className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-orange-500/30 bg-orange-500/10 px-5 py-3 text-sm"
    >
      <span className="text-orange-300">
        {endsAt ? t("subscription.trial.endsOn", { date: endsAt }) : t("subscription.trial.bannerMessage")}
      </span>
      {showSubscribeCta && (
        <a
          href="#plans"
          className="rounded-xl border border-orange-500/40 bg-orange-500/15 px-4 py-1.5 font-semibold text-orange-200 transition hover:bg-orange-500/25"
        >
          {t("subscription.trial.subscribeCta")}
        </a>
      )}
    </div>
  );
}
