import { useEffect, useState } from "react";
import PageHeader from "../../components/PageHeader";
import StatCard from "../../components/StatCard";
import MiniLineChart from "../../components/MiniLineChart";
import {
  getAnalyticsOverview,
  getAnalyticsCharts,
  getAnalyticsStorage,
} from "../../services/adminAnalytics.service";
import type {
  AnalyticsOverview,
  AnalyticsCharts,
  AnalyticsStorage,
} from "../../services/adminAnalytics.service";
import { useTranslation } from "../../i18n";

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

const sectionClass = "mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400";
const cardClass = "rounded-3xl border border-white/10 bg-white/5 p-6";

// Horizontal bar chart for the top-10 storage companies.
function StorageBar({ name, bytes, max }: { name: string; bytes: number; max: number }) {
  const pct = max > 0 ? (bytes / max) * 100 : 0;
  return (
    <div className="py-1.5">
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-slate-300">{name}</span>
        <span className="shrink-0 text-slate-400">{formatBytes(bytes)}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-indigo-500/70"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function PlatformDashboardPage() {
  const { t } = useTranslation();
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [charts, setCharts] = useState<AnalyticsCharts | null>(null);
  const [storage, setStorage] = useState<AnalyticsStorage | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([getAnalyticsOverview(), getAnalyticsCharts(), getAnalyticsStorage()])
      .then(([ov, ch, st]) => {
        setOverview(ov);
        setCharts(ch);
        setStorage(st);
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading || !overview || !charts || !storage) {
    return (
      <div className="p-8">
        <PageHeader title={t("admin.dashboard.title")} subtitle={t("admin.dashboard.subtitle")} />
      </div>
    );
  }

  const maxStorage = storage.topCompanies[0]?.totalBytes ?? 0;

  return (
    <div className="p-8">
      <PageHeader title={t("admin.dashboard.title")} subtitle={t("admin.dashboard.subtitle")} />

      {/* Users */}
      <h2 className={sectionClass}>{t("admin.analytics.usersSection")}</h2>
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title={t("admin.analytics.totalUsers")} value={overview.totalUsers} />
        <StatCard title={t("admin.analytics.activeToday")} value={overview.activeUsers.today} />
        <StatCard title={t("admin.analytics.active7Days")} value={overview.activeUsers.sevenDays} />
        <StatCard title={t("admin.analytics.active30Days")} value={overview.activeUsers.thirtyDays} />
        <StatCard title={t("admin.analytics.newRegistrations")} value={overview.newRegistrations} />
        <StatCard title={t("admin.analytics.newRegistrationsToday")} value={overview.newRegistrationsToday} />
      </div>

      {/* Tenants & resources */}
      <h2 className={sectionClass}>{t("admin.analytics.resourcesSection")}</h2>
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title={t("nav.companies")} value={overview.companies} />
        <StatCard title={t("admin.analytics.newCompaniesToday")} value={overview.newCompaniesToday} />
        <StatCard title={t("admin.analytics.newCompanies30Days")} value={overview.newCompanies30Days} />
        <StatCard title={t("admin.analytics.platformProjects")} value={overview.projects} />
        <StatCard title={t("admin.analytics.newProjectsToday")} value={overview.newProjectsToday} />
        <StatCard title={t("admin.analytics.newProjects30Days")} value={overview.newProjects30Days} />
        <StatCard title={t("admin.analytics.platformEmployees")} value={overview.employees} />
        <StatCard title={t("admin.analytics.newEmployees30Days")} value={overview.newEmployees30Days} />
        <StatCard title={t("admin.analytics.platformCustomers")} value={overview.customers} />
        <StatCard title={t("admin.analytics.newCustomers30Days")} value={overview.newCustomers30Days} />
      </div>

      {/* Growth charts */}
      <h2 className={sectionClass}>{t("admin.analytics.growthSection")}</h2>
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MiniLineChart
          data={charts.userRegistrations}
          label={t("admin.analytics.chartUserRegistrations")}
          color="#818cf8"
        />
        <MiniLineChart
          data={charts.companyGrowth}
          label={t("admin.analytics.chartCompanyGrowth")}
          color="#34d399"
        />
        <MiniLineChart
          data={charts.projectCreations}
          label={t("admin.analytics.chartProjectCreations")}
          color="#fb923c"
        />
        <MiniLineChart
          data={charts.activeUsers}
          label={t("admin.analytics.chartActiveUsers")}
          color="#f472b6"
        />
      </div>

      {/* Subscriptions */}
      <h2 className={sectionClass}>{t("admin.analytics.subscriptionsSection")}</h2>
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t("admin.dashboard.activeSubscriptions")}
          value={overview.activeSubscriptions}
        />
        {overview.planBreakdown.map(({ plan, count }) => {
          const key = `admin.analytics.plan.${plan}`;
          const label = t(key);
          // t() returns the key itself when no translation exists — fall back
          // to the raw plan name so new/unknown plans still render legibly.
          return (
            <StatCard key={plan} title={label === key ? plan : label} value={count} />
          );
        })}
      </div>

      {/* Storage analytics */}
      <h2 className={sectionClass}>{t("admin.analytics.storageSection")}</h2>
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard title={t("admin.analytics.totalStorage")} value={formatBytes(storage.totalBytes)} />
        <StatCard
          title={t("admin.analytics.avgStorage")}
          value={formatBytes(storage.avgBytesPerCompany)}
        />
      </div>
      {storage.topCompanies.length > 0 && (
        <div className={cardClass}>
          <h3 className="mb-4 text-sm font-semibold">{t("admin.analytics.topStorage")}</h3>
          {storage.topCompanies.map((c) => (
            <StorageBar key={c.companyId} name={c.companyName} bytes={c.totalBytes} max={maxStorage} />
          ))}
        </div>
      )}
    </div>
  );
}
