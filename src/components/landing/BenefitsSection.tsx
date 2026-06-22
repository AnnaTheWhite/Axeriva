import { useTranslation } from "../../i18n";

const BENEFIT_IDS = [
  "shiftScheduling",
  "employeeManagement",
  "projectTracking",
  "customerManagement",
  "timeTracking",
  "multiSite",
  "mobileFriendly",
] as const;

export default function BenefitsSection() {
  const { t } = useTranslation();
  return (
    <section id="benefits" className="px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            {t("landing.benefits.title")}
          </h2>
          <p className="mt-3 text-slate-400">
            {t("landing.benefits.subtitle")}
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {BENEFIT_IDS.map((id) => (
            <div
              key={id}
              className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl transition hover:border-orange-500/40"
            >
              <h3 className="font-semibold text-white">
                {t(`landing.benefits.items.${id}.title`)}
              </h3>
              <p className="mt-2 text-sm text-slate-400">
                {t(`landing.benefits.items.${id}.description`)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
