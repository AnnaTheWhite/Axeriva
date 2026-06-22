import { useTranslation } from "../../i18n";

const FEATURE_IDS = [
  "employees",
  "projects",
  "scheduling",
  "timeTracking",
  "customers",
  "reports",
] as const;

export default function FeaturesSection() {
  const { t } = useTranslation();
  return (
    <section id="features" className="px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            {t("landing.features.title")}
          </h2>
          <p className="mt-3 text-slate-400">
            {t("landing.features.subtitle")}
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURE_IDS.map((id) => (
            <div
              key={id}
              className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-500/10">
                <div className="h-3 w-3 rounded-full bg-orange-500" />
              </div>

              <h3 className="mt-5 text-lg font-semibold text-white">
                {t(`landing.features.items.${id}.title`)}
              </h3>
              <p className="mt-2 text-sm text-slate-400">
                {t(`landing.features.items.${id}.description`)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
