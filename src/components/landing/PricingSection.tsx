import { Link } from "react-router-dom";
import { useTranslation } from "../../i18n";

const INCLUDED_IDS = [
  "unlimitedEmployees",
  "unlimitedProjects",
  "customerManagement",
  "shiftScheduling",
  "timeTracking",
  "futureAi",
] as const;

export default function PricingSection() {
  const { t } = useTranslation();
  return (
    <section id="pricing" className="px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            {t("landing.pricing.title")}
          </h2>
          <p className="mt-3 text-slate-400">
            {t("landing.pricing.subtitle")}
          </p>
        </div>

        <div className="mx-auto mt-12 max-w-md rounded-3xl border border-orange-500/30 bg-white/5 p-10 text-center backdrop-blur-xl">
          <h3 className="text-xl font-semibold text-white">{t("landing.pricing.planName")}</h3>

          <p className="mt-4">
            <span className="text-5xl font-bold text-white">€30</span>
            <span className="text-slate-400"> {t("landing.pricing.perMonth")}</span>
          </p>

          <ul className="mt-8 space-y-3 text-left">
            {INCLUDED_IDS.map((id) => (
              <li
                key={id}
                className="flex items-center gap-3 text-sm text-slate-300"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-500/20 text-orange-400">
                  ✓
                </span>
                {t(`landing.pricing.included.${id}`)}
              </li>
            ))}
          </ul>

          <Link
            to="/register"
            className="mt-10 block w-full rounded-xl bg-orange-500 px-6 py-3 text-base font-semibold text-white transition hover:bg-orange-600"
          >
            {t("landing.pricing.subscribe")}
          </Link>
        </div>
      </div>
    </section>
  );
}
