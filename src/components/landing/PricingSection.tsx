import { Link } from "react-router-dom";
import { useTranslation } from "../../i18n";
import PricingCards from "../pricing/PricingCards";

// Landing-page pricing block: the four public plan cards plus the per-company
// value line and a link to the full /pricing page (comparison table + FAQ).
export default function PricingSection() {
  const { t } = useTranslation();
  return (
    <section id="pricing" className="px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            {t("pricing.title")}
          </h2>
          <p className="mt-3 text-slate-400">{t("pricing.subtitle")}</p>
          <p className="mt-2 text-sm font-medium text-orange-300">
            {t("pricing.perCompanyTagline")}
          </p>
        </div>

        <div className="mt-12">
          <PricingCards />
        </div>

        <div className="mt-10 text-center">
          <Link
            to="/pricing"
            className="inline-block rounded-xl border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            {t("pricing.compareAll")}
          </Link>
        </div>
      </div>
    </section>
  );
}
