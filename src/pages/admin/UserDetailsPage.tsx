import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import PageHeader from "../../components/PageHeader";
import StatCard from "../../components/StatCard";
import {
  getAnalyticsUserDetails,
  getAnalyticsUserActivity,
} from "../../services/adminAnalytics.service";
import type {
  AnalyticsUserDetails,
  ActivityEvent,
} from "../../services/adminAnalytics.service";
import { useTranslation } from "../../i18n";

function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "—";
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// Turns an event type into a readable label from an ACTION_CONSTANT_CASE
// string, used when a specific i18n label isn't defined for it.
function humanizeEventType(type: string): string {
  return type
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const cardClass = "rounded-3xl border border-white/10 bg-white/5 p-6";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-white/5 py-2 last:border-0">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="text-sm text-white">{value}</span>
    </div>
  );
}

export default function UserDetailsPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const userId = Number(id);

  const [details, setDetails] = useState<AnalyticsUserDetails | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!Number.isInteger(userId)) return;
    setIsLoading(true);
    Promise.all([getAnalyticsUserDetails(userId), getAnalyticsUserActivity(userId)])
      .then(([d, a]) => {
        setDetails(d);
        setActivity(a);
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [userId]);

  if (isLoading || !details) {
    return (
      <div className="p-8">
        <PageHeader title={t("admin.analytics.userDetails")} />
      </div>
    );
  }

  return (
    <div className="p-8">
      <Link to="/admin/users" className="mb-4 inline-block text-sm text-slate-400 hover:text-white">
        ← {t("admin.analytics.backToUsers")}
      </Link>
      <PageHeader title={details.email} subtitle={details.role} />

      {/* Company resource usage cards — values are company-wide totals */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard title={t("admin.analytics.companyProjects")} value={details.usage.projects} />
        <StatCard title={t("admin.analytics.companyEmployees")} value={details.usage.employees} />
        <StatCard title={t("admin.analytics.companyCustomers")} value={details.usage.customers} />
        <StatCard title={t("admin.analytics.storage")} value={formatBytes(details.usage.storageBytes)} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Profile */}
        <section className={cardClass}>
          <h2 className="mb-3 text-lg font-semibold">{t("admin.analytics.profile")}</h2>
          <Row label={t("table.email")} value={details.email} />
          <Row label={t("table.role")} value={details.role} />
          <Row label={t("admin.analytics.verified")} value={details.emailVerified ? "✓" : "—"} />
          <Row label={t("table.status")} value={details.active ? t("admin.analytics.status.active") : t("admin.analytics.status.inactive")} />
          <Row label={t("admin.analytics.registered")} value={formatDateTime(details.createdAt)} />
          <Row label={t("admin.analytics.lastLogin")} value={formatDateTime(details.lastLoginAt)} />
        </section>

        {/* Company + subscription */}
        <section className={cardClass}>
          <h2 className="mb-3 text-lg font-semibold">{t("admin.analytics.companyInfo")}</h2>
          {details.company ? (
            <>
              <Row label={t("table.name")} value={details.company.name} />
              <Row label={t("admin.analytics.contactEmail")} value={details.company.contactEmail ?? "—"} />
              <Row label={t("table.phone")} value={details.company.phone ?? "—"} />
              <Row label={t("admin.analytics.website")} value={details.company.website ?? "—"} />
              <Row label={t("admin.analytics.companyCreated")} value={formatDateTime(details.company.createdAt)} />
              <h3 className="mb-2 mt-4 text-sm font-semibold uppercase tracking-wide text-slate-400">
                {t("admin.analytics.subscription")}
              </h3>
              <Row label={t("table.plan")} value={details.company.plan} />
              <Row label={t("table.status")} value={details.company.subscriptionStatus} />
              <Row label={t("admin.analytics.renewsEnds")} value={formatDateTime(details.company.subscriptionEndsAt)} />
            </>
          ) : (
            <p className="text-sm text-slate-400">{t("admin.analytics.noCompany")}</p>
          )}
        </section>
      </div>

      {/* Activity timeline */}
      <section className={`${cardClass} mt-6`}>
        <h2 className="mb-4 text-lg font-semibold">{t("admin.analytics.activityTimeline")}</h2>
        {activity.length === 0 ? (
          <p className="text-sm text-slate-400">{t("admin.analytics.noActivity")}</p>
        ) : (
          <ol className="space-y-3">
            {activity.map((event, index) => (
              <li key={index} className="flex items-start gap-3">
                <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-white/40" />
                <div>
                  <p className="text-sm text-white">
                    {(() => {
                      const key = `admin.analytics.event.${event.type}`;
                      const label = t(key);
                      // t() returns the key itself when no translation exists.
                      return label === key ? humanizeEventType(event.type) : label;
                    })()}
                    {event.label ? <span className="text-slate-400"> — {event.label}</span> : null}
                  </p>
                  <p className="text-xs text-slate-500">{formatDateTime(event.timestamp)}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
