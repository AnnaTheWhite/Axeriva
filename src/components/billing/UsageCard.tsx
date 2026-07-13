import UsageBar from "./UsageBar";
import { formatBytes } from "../../utils/formatBytes";
import { useTranslation } from "../../i18n";
import type { SubscriptionUsage, SubscriptionLimits } from "../../services/subscription.service";

const cardClass = "rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl sm:p-8";

type UsageTileProps = {
  label: string;
  current: number;
  limit: number | null;
  format?: (n: number) => string;
};

function UsageTile({ label, current, limit, format = String }: UsageTileProps) {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl border border-white/5 bg-white/5 p-4">
      <p className="text-sm text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-white">
        {format(current)}
        <span className="ml-1 text-sm font-normal text-slate-400">
          / {limit === null ? t("subscription.usage.unlimited") : format(limit)}
        </span>
      </p>
      <div className="mt-3">
        <UsageBar current={current} limit={limit} />
      </div>
    </div>
  );
}

// Usage (S2.4) — Storage, Employees, Projects, Customers, read via the S2.2
// Limit Registry (through the subscription status payload's `usage`/`limits`,
// resolved server-side by planAccess.getLimit()). No enforcement here — this
// is a read-only display.
export default function UsageCard({
  usage,
  limits,
}: {
  usage: SubscriptionUsage;
  limits: SubscriptionLimits;
}) {
  const { t } = useTranslation();

  return (
    <section className={cardClass} aria-label={t("subscription.usage.title")}>
      <h2 className="text-lg font-semibold text-white">{t("subscription.usage.title")}</h2>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <UsageTile
          label={t("subscription.usage.storage")}
          current={usage.storageBytes}
          limit={limits.storageBytes}
          format={formatBytes}
        />
        <UsageTile label={t("subscription.usage.employees")} current={usage.employees} limit={limits.employees} />
        <UsageTile label={t("subscription.usage.projects")} current={usage.projects} limit={limits.projects} />
        <UsageTile label={t("subscription.usage.customers")} current={usage.customers} limit={limits.customers} />
      </div>
    </section>
  );
}
