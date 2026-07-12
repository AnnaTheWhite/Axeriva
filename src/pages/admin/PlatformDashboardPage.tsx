import { useEffect, useMemo, useState } from "react";
import PageHeader from "../../components/PageHeader";
import StatCard from "../../components/StatCard";
import MiniLineChart from "../../components/MiniLineChart";
import EmptyState from "../../components/ui/EmptyState";
import { InfoTooltip } from "../../components/ui/Tooltip";
import { SkeletonCardGrid, SkeletonChart } from "../../components/ui/Skeleton";
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

// Deterministic colour for a plan name so unknown/future plans still get a
// stable, distinct swatch without any hardcoded plan list.
const PLAN_PALETTE = ["#818cf8", "#34d399", "#fb923c", "#f472b6", "#60a5fa", "#a78bfa", "#facc15"];
function planColor(plan: string): string {
  let hash = 0;
  for (let i = 0; i < plan.length; i++) hash = (hash * 31 + plan.charCodeAt(i)) >>> 0;
  return PLAN_PALETTE[hash % PLAN_PALETTE.length];
}

// Storage bar colour by share of total platform storage: the heaviest
// consumers surface as red, mid as orange, light as green.
function storageBarColor(pct: number): string {
  if (pct >= 50) return "bg-red-500/70";
  if (pct >= 25) return "bg-orange-500/70";
  return "bg-emerald-500/70";
}

function StorageBar({ name, bytes, pct }: { name: string; bytes: number; pct: number }) {
  return (
    <div className="py-1.5">
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-slate-300">{name}</span>
        <span className="shrink-0 tabular-nums text-slate-400">
          {formatBytes(bytes)} · {pct.toFixed(1)}%
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full ${storageBarColor(pct)}`} style={{ width: `${pct}%` }} />
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

  // Total company count across all plans — denominator for plan percentages.
  const totalPlanCompanies = useMemo(
    () => overview?.planBreakdown.reduce((sum, p) => sum + p.count, 0) ?? 0,
    [overview],
  );

  if (isLoading || !overview || !charts || !storage) {
    return (
      <div className="p-8" aria-busy="true">
        <PageHeader title={t("admin.dashboard.title")} subtitle={t("admin.dashboard.subtitle")} />
        <h2 className={sectionClass}>{t("admin.analytics.usersSection")}</h2>
        <div className="mb-8">
          <SkeletonCardGrid count={4} />
        </div>
        <h2 className={sectionClass}>{t("admin.analytics.growthSection")}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonChart key={i} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <PageHeader title={t("admin.dashboard.title")} subtitle={t("admin.dashboard.subtitle")} />

      {/* Users */}
      <h2 className={sectionClass}>{t("admin.analytics.usersSection")}</h2>
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title={t("admin.analytics.totalUsers")} value={overview.totalUsers} tooltip={t("admin.analytics.tip.totalUsers")} />
        <StatCard title={t("admin.analytics.activeToday")} value={overview.activeUsers.today} tooltip={t("admin.analytics.tip.activeToday")} />
        <StatCard title={t("admin.analytics.active7Days")} value={overview.activeUsers.sevenDays} tooltip={t("admin.analytics.tip.active7Days")} />
        <StatCard title={t("admin.analytics.active30Days")} value={overview.activeUsers.thirtyDays} tooltip={t("admin.analytics.tip.active30Days")} />
        <StatCard title={t("admin.analytics.newRegistrations")} value={overview.newRegistrations} tooltip={t("admin.analytics.tip.newRegistrations")} />
        <StatCard title={t("admin.analytics.newRegistrationsToday")} value={overview.newRegistrationsToday} tooltip={t("admin.analytics.tip.newRegistrationsToday")} />
      </div>

      {/* Tenants & resources */}
      <h2 className={sectionClass}>{t("admin.analytics.resourcesSection")}</h2>
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title={t("nav.companies")} value={overview.companies} tooltip={t("admin.analytics.tip.companies")} />
        <StatCard title={t("admin.analytics.newCompaniesToday")} value={overview.newCompaniesToday} tooltip={t("admin.analytics.tip.newCompaniesToday")} />
        <StatCard title={t("admin.analytics.newCompanies30Days")} value={overview.newCompanies30Days} tooltip={t("admin.analytics.tip.newCompanies30Days")} />
        <StatCard title={t("admin.analytics.platformProjects")} value={overview.projects} tooltip={t("admin.analytics.tip.platformProjects")} />
        <StatCard title={t("admin.analytics.newProjectsToday")} value={overview.newProjectsToday} tooltip={t("admin.analytics.tip.newProjectsToday")} />
        <StatCard title={t("admin.analytics.newProjects30Days")} value={overview.newProjects30Days} tooltip={t("admin.analytics.tip.newProjects30Days")} />
        <StatCard title={t("admin.analytics.platformEmployees")} value={overview.employees} tooltip={t("admin.analytics.tip.platformEmployees")} />
        <StatCard title={t("admin.analytics.newEmployees30Days")} value={overview.newEmployees30Days} tooltip={t("admin.analytics.tip.newEmployees30Days")} />
        <StatCard title={t("admin.analytics.platformCustomers")} value={overview.customers} tooltip={t("admin.analytics.tip.platformCustomers")} />
        <StatCard title={t("admin.analytics.newCustomers30Days")} value={overview.newCustomers30Days} tooltip={t("admin.analytics.tip.newCustomers30Days")} />
      </div>

      {/* Growth charts */}
      <h2 className={sectionClass}>{t("admin.analytics.growthSection")}</h2>
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MiniLineChart data={charts.userRegistrations} label={t("admin.analytics.chartUserRegistrations")} color="#818cf8" />
        <MiniLineChart data={charts.companyGrowth} label={t("admin.analytics.chartCompanyGrowth")} color="#34d399" />
        <MiniLineChart data={charts.projectCreations} label={t("admin.analytics.chartProjectCreations")} color="#fb923c" />
        <MiniLineChart data={charts.activeUsers} label={t("admin.analytics.chartActiveUsers")} color="#f472b6" />
      </div>

      {/* Subscriptions */}
      <h2 className={sectionClass}>{t("admin.analytics.subscriptionsSection")}</h2>
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t("admin.dashboard.activeSubscriptions")}
          value={overview.activeSubscriptions}
          tooltip={t("admin.analytics.tip.activeSubscriptions")}
        />
        <StatCard title={t("nav.companies")} value={overview.companies} tooltip={t("admin.analytics.tip.companies")} />
      </div>
      {totalPlanCompanies === 0 ? (
        <EmptyState
          icon="💳"
          title={t("admin.analytics.empty.subscriptions.title")}
          description={t("admin.analytics.empty.subscriptions.desc")}
        />
      ) : (
        <div className={`${cardClass} mb-8`}>
          <div className="mb-4 flex items-center gap-1.5">
            <h3 className="text-sm font-semibold">{t("admin.analytics.planBreakdown")}</h3>
            <InfoTooltip label={t("admin.analytics.tip.planBreakdown")} />
          </div>
          <ul className="space-y-3">
            {overview.planBreakdown.map(({ plan, count, activeCount }) => {
              const pct = totalPlanCompanies > 0 ? (count / totalPlanCompanies) * 100 : 0;
              const key = `admin.analytics.plan.${plan}`;
              const label = t(key);
              const planLabel = label === key ? plan : label;
              return (
                <li key={plan}>
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: planColor(plan) }}
                        aria-hidden="true"
                      />
                      <span className="font-medium text-white">{planLabel}</span>
                    </span>
                    <span className="tabular-nums text-slate-400">
                      {t("admin.analytics.planStat", {
                        count: String(count),
                        active: String(activeCount),
                        pct: pct.toFixed(1),
                      })}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, backgroundColor: planColor(plan) }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Storage analytics */}
      <h2 className={sectionClass}>{t("admin.analytics.storageSection")}</h2>
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard title={t("admin.analytics.totalStorage")} value={formatBytes(storage.totalBytes)} tooltip={t("admin.analytics.tip.totalStorage")} />
        <StatCard title={t("admin.analytics.avgStorage")} value={formatBytes(storage.avgBytesPerCompany)} tooltip={t("admin.analytics.tip.avgStorage")} />
      </div>
      {storage.topCompanies.length === 0 ? (
        <EmptyState
          icon="📂"
          title={t("admin.analytics.empty.storage.title")}
          description={t("admin.analytics.empty.storage.desc")}
        />
      ) : (
        <div className={cardClass}>
          <div className="mb-4 flex items-center gap-1.5">
            <h3 className="text-sm font-semibold">{t("admin.analytics.topStorage")}</h3>
            <InfoTooltip label={t("admin.analytics.tip.topStorage")} />
          </div>
          {storage.topCompanies.map((c) => (
            <StorageBar
              key={c.companyId}
              name={c.companyName}
              bytes={c.totalBytes}
              pct={storage.totalBytes > 0 ? (c.totalBytes / storage.totalBytes) * 100 : 0}
            />
          ))}
        </div>
      )}
    </div>
  );
}
