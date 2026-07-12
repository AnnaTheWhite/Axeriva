import { Link } from "react-router-dom";
import { useTranslation } from "../../i18n";
import { getPlanPrice, formatStorageGb, TRIAL, type PlanPricing } from "../../config/pricing";

// A single pricing plan card. Purely presentational — reads prices, trial
// terms, recommended flag and CTA behavior from the centralized pricing config
// (never hardcoded here). Matches the existing Axeriva card language
// (rounded-3xl, white/5 surface, orange accent). The recommended plan is
// visually elevated and, on mobile, ordered first.

// Self-serve checkout target. Placeholder for S2.1 — real trial/checkout flow
// is wired in a later story.
const CTA_CHECKOUT_HREF = "/register";

function CheckIcon() {
  return (
    <span
      aria-hidden="true"
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-500/20 text-xs text-orange-400"
    >
      ✓
    </span>
  );
}

export default function PlanCard({ plan }: { plan: PlanPricing }) {
  const { t, language } = useTranslation();
  const price = getPlanPrice(plan, language);
  const isRecommended = plan.recommended;

  const cardClass = [
    "relative flex flex-col rounded-3xl border bg-white/5 p-6 backdrop-blur-xl transition sm:p-8",
    isRecommended
      ? "border-orange-500/50 shadow-lg shadow-orange-500/5 md:-translate-y-2"
      : "border-white/10 hover:border-orange-500/40",
    // Recommended plan surfaces first on stacked (mobile) layouts.
    isRecommended ? "order-first xl:order-none" : "",
  ].join(" ");

  const ctaClass = isRecommended
    ? "mt-8 block w-full rounded-xl bg-orange-500 px-6 py-3 text-center text-base font-semibold text-white transition hover:bg-orange-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
    : "mt-8 block w-full rounded-xl border border-white/15 bg-white/5 px-6 py-3 text-center text-base font-semibold text-white transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900";

  const isCheckout = plan.ctaType === "checkout";

  // Trial line composed from the central TRIAL config (never hardcoded here):
  // "14-day free trial" plus "· No credit card required" when no card is
  // needed.
  const trialLabel =
    t("pricing.trialBadge", { days: TRIAL.trialDays }) +
    (TRIAL.requiresCreditCard ? "" : ` · ${t("pricing.noCreditCard")}`);

  return (
    <article
      className={cardClass}
      aria-label={t(`pricing.plans.${plan.id}.name`)}
    >
      {isRecommended && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-orange-500 px-3 py-1 text-xs font-semibold text-white shadow">
          ⭐ {t("pricing.recommended")}
        </span>
      )}

      <h3 className="text-lg font-semibold text-white">
        {t(`pricing.plans.${plan.id}.name`)}
      </h3>
      <p className="mt-2 min-h-[2.5rem] text-sm text-slate-400">
        {t(`pricing.plans.${plan.id}.description`)}
      </p>

      {/* Price */}
      <div className="mt-6">
        {price ? (
          <p className="flex items-baseline gap-1">
            <span className="text-4xl font-bold text-white">{price}</span>
            <span className="text-sm text-slate-400">{t("pricing.perMonth")}</span>
          </p>
        ) : (
          <p className="text-3xl font-bold text-white">{t("pricing.contactSales")}</p>
        )}
      </div>

      {/* Trial line (self-serve checkout plans only) */}
      {isCheckout ? (
        <p className="mt-3 rounded-lg bg-white/5 px-3 py-2 text-xs font-medium text-orange-300">
          {trialLabel}
        </p>
      ) : (
        <p className="mt-3 text-xs text-slate-500">{t("pricing.enterpriseTagline")}</p>
      )}

      {/* CTA — rendered according to the plan's configured ctaType. */}
      {isCheckout ? (
        <Link to={CTA_CHECKOUT_HREF} className={ctaClass}>
          {t("pricing.cta.startTrial")}
        </Link>
      ) : (
        // contact-sales: placeholder button (no real target yet). The sales
        // flow is wired in a later story; kept out of S2.1 scope.
        <button type="button" className={ctaClass}>
          {t("pricing.cta.contactSales")}
        </button>
      )}

      {/* Storage + support */}
      <dl className="mt-6 space-y-2 border-t border-white/10 pt-6 text-sm">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-slate-400">{t("pricing.labels.storage")}</dt>
          <dd className="font-medium text-white">
            {plan.storageGb === null ? t("pricing.compare.custom") : formatStorageGb(plan.storageGb)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-slate-400">{t("pricing.labels.support")}</dt>
          <dd className="text-right font-medium text-white">{t(`pricing.support.${plan.support}`)}</dd>
        </div>
      </dl>

      {/* Highlights */}
      <ul className="mt-6 space-y-3 text-sm">
        {plan.highlightIds.map((hid) => (
          <li key={hid} className="flex items-center gap-3 text-slate-300">
            <CheckIcon />
            {t(`pricing.plans.${plan.id}.highlights.${hid}`)}
          </li>
        ))}
      </ul>
    </article>
  );
}
