import LandingNavbar from "../components/landing/LandingNavbar";
import LandingFooter from "../components/landing/LandingFooter";
import PricingCards from "../components/pricing/PricingCards";
import PricingMarketing from "../components/pricing/PricingMarketing";
import PlanComparisonTable from "../components/pricing/PlanComparisonTable";
import PricingFAQ from "../components/pricing/PricingFAQ";
import { PLAN_LIST, PLAN_TRIAL, hasTrial } from "../config/pricing";
import { useTranslation } from "../i18n";

// Public /pricing page: marketing hero + per-company advantage banner + four
// plan cards + full feature-comparison table + FAQ. Reuses the landing nav
// and footer and the shared pricing components.
export default function PricingPage() {
  const { t } = useTranslation();

  // Only one plan currently has a trial (Starter) — resolved from the
  // centralized config rather than hardcoded here, so the hero banner can
  // never drift out of sync with what the plan cards / checkout actually do.
  const trialPlan = PLAN_LIST.find((plan) => hasTrial(plan.id));
  const trialLabel = trialPlan
    ? t("pricing.heroTrialBadge", {
        plan: t(`pricing.plans.${trialPlan.id}.name`),
        days: PLAN_TRIAL[trialPlan.id].trialDays,
      }) + (PLAN_TRIAL[trialPlan.id].requiresCreditCard ? "" : ` · ${t("pricing.noCreditCard")}`)
    : null;

  return (
    <div className="min-h-screen bg-[#0f172a]">
      <LandingNavbar />

      <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        {/* Hero */}
        <header className="mx-auto max-w-2xl text-center">
          <h1 className="text-3xl font-bold text-white sm:text-4xl lg:text-5xl">
            {t("pricing.title")}
          </h1>
          <p className="mt-4 text-slate-400">{t("pricing.subtitle")}</p>
          {trialLabel && (
            <p className="mt-3 inline-flex rounded-full bg-orange-500/10 px-4 py-1.5 text-sm font-medium text-orange-300">
              {trialLabel}
            </p>
          )}
        </header>

        {/* Per-company competitive advantage */}
        <div className="mt-12">
          <PricingMarketing />
        </div>

        {/* Plan cards */}
        <div className="mt-12">
          <PricingCards />
        </div>

        {/* Feature comparison */}
        <section className="mt-20" aria-labelledby="compare-heading">
          <h2
            id="compare-heading"
            className="mb-8 text-center text-2xl font-bold text-white sm:text-3xl"
          >
            {t("pricing.compare.title")}
          </h2>
          <PlanComparisonTable />
        </section>

        {/* FAQ */}
        <div className="mt-20">
          <PricingFAQ />
        </div>
      </main>

      <LandingFooter />
    </div>
  );
}
