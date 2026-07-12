import { useTranslation } from "../../i18n";

// Competitive-advantage banner: Axeriva is billed per company, never per user.
// Reused at the top of the pricing page (and available for other surfaces).

const POINT_IDS = ["oneSubscription", "noPerUser", "growFreely"] as const;

export default function PricingMarketing() {
  const { t } = useTranslation();
  return (
    <section
      className="rounded-3xl border border-orange-500/20 bg-orange-500/5 p-6 backdrop-blur-xl sm:p-8"
      aria-label={t("pricing.marketing.title")}
    >
      <h2 className="text-center text-xl font-bold text-white sm:text-2xl">
        {t("pricing.marketing.title")}
      </h2>
      <p className="mx-auto mt-2 max-w-2xl text-center text-sm text-slate-300">
        {t("pricing.marketing.subtitle")}
      </p>
      <ul className="mx-auto mt-6 grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-3">
        {POINT_IDS.map((id) => (
          <li
            key={id}
            className="flex items-start gap-2 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200"
          >
            <span aria-hidden="true" className="text-orange-400">✓</span>
            {t(`pricing.marketing.points.${id}`)}
          </li>
        ))}
      </ul>
    </section>
  );
}
