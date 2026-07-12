import { useEffect, useState } from "react";
import PageHeader from "../../components/PageHeader";
import StatCard from "../../components/StatCard";
import { getAnalyticsOverview } from "../../services/adminAnalytics.service";
import type { AnalyticsOverview } from "../../services/adminAnalytics.service";
import { useTranslation } from "../../i18n";

export default function PlatformDashboardPage() {
  const { t } = useTranslation();
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getAnalyticsOverview()
      .then(setOverview)
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading || !overview) {
    return (
      <div className="p-8">
        <PageHeader title={t("admin.dashboard.title")} subtitle={t("admin.dashboard.subtitle")} />
      </div>
    );
  }

  return (
    <div className="p-8">
      <PageHeader title={t("admin.dashboard.title")} subtitle={t("admin.dashboard.subtitle")} />

      {/* Users */}
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
        {t("admin.analytics.usersSection")}
      </h2>
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title={t("admin.analytics.totalUsers")} value={overview.totalUsers} />
        <StatCard title={t("admin.analytics.activeToday")} value={overview.activeUsers.today} />
        <StatCard title={t("admin.analytics.active7Days")} value={overview.activeUsers.sevenDays} />
        <StatCard title={t("admin.analytics.active30Days")} value={overview.activeUsers.thirtyDays} />
        <StatCard title={t("admin.analytics.newRegistrations")} value={overview.newRegistrations} />
      </div>

      {/* Tenants & resources */}
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
        {t("admin.analytics.resourcesSection")}
      </h2>
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title={t("nav.companies")} value={overview.companies} />
        <StatCard title={t("admin.analytics.projects")} value={overview.projects} />
        <StatCard title={t("admin.analytics.employees")} value={overview.employees} />
        <StatCard title={t("admin.analytics.customers")} value={overview.customers} />
      </div>

      {/* Subscriptions */}
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
        {t("admin.analytics.subscriptionsSection")}
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title={t("admin.dashboard.activeSubscriptions")} value={overview.activeSubscriptions} />
        <StatCard title={t("admin.analytics.freePlans")} value={overview.plans.free} />
        <StatCard title={t("admin.analytics.proPlans")} value={overview.plans.pro} />
        <StatCard title={t("admin.analytics.enterprisePlans")} value={overview.plans.enterprise} />
      </div>
    </div>
  );
}
