import Badge from "../ui/Badge";
import { InfoTooltip } from "../ui/Tooltip";
import UsageBar from "./UsageBar";
import { formatBytes } from "../../utils/formatBytes";
import { currencyForLanguage } from "../../config/pricing";
import { useTranslation } from "../../i18n";
import type { SubscriptionStatus } from "../../services/subscription.service";

const cardClass = "rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl sm:p-8";

function Row({ label, value, tooltip }: { label: string; value: React.ReactNode; tooltip?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/5 py-3 last:border-0">
      <span className="flex items-center gap-1.5 text-sm text-slate-400">
        {label}
        {tooltip && <InfoTooltip label={tooltip} />}
      </span>
      <span className="text-right text-sm font-medium text-white">{value}</span>
    </div>
  );
}

const STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = {
  active: "success",
  trialing: "info",
  past_due: "warning",
  canceled: "danger",
  inactive: "neutral",
};

// t() returns the key itself when a status has no translation (e.g. an
// unfamiliar Stripe status) — fall back to the raw value instead of showing
// the literal key string, same pattern as UserDetailsPage's event labels.
function statusLabel(t: (key: string) => string, status: string): string {
  const key = `subscription.status.${status}`;
  const label = t(key);
  return label === key ? status : label;
}

export default function CurrentSubscriptionCard({ status }: { status: SubscriptionStatus }) {
  const { t, language } = useTranslation();

  const planId = status.effectivePlan;
  const planName = planId === "founder" ? "Founder" : t(`pricing.plans.${planId}.name`);
  const isTrialing = status.subscriptionStatus === "trialing";
  const currency = currencyForLanguage(language);
  const storageLimit = status.limits.storageBytes;

  return (
    <section className={cardClass} aria-label={t("subscription.currentPlan.title")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-400">{t("subscription.currentPlan.title")}</p>
          <div className="mt-2 flex items-center gap-2">
            <h2 className="text-2xl font-bold text-white">{planName}</h2>
            <Badge variant="info">{t("subscription.currentPlan.badge")}</Badge>
          </div>
        </div>
        <Badge variant={STATUS_VARIANT[status.subscriptionStatus] ?? "neutral"}>
          {statusLabel(t, status.subscriptionStatus)}
        </Badge>
      </div>

      <dl className="mt-6">
        <Row
          label={t("subscription.currentPlan.trialStatus")}
          tooltip={t("subscription.currentPlan.trialStatusTip")}
          value={isTrialing ? t("subscription.currentPlan.onTrial") : t("subscription.currentPlan.notOnTrial")}
        />
        <Row
          label={t("subscription.currentPlan.renewalDate")}
          tooltip={t("subscription.currentPlan.renewalDateTip")}
          value={status.subscriptionEndsAt ? new Date(status.subscriptionEndsAt).toLocaleDateString() : "—"}
        />
        <Row label={t("subscription.currentPlan.currency")} value={currency} />
        <Row
          label={t("subscription.currentPlan.storageUsage")}
          value={
            <span className="inline-flex w-32 flex-col items-end gap-1">
              <span>
                {formatBytes(status.usage.storageBytes)}
                {" / "}
                {storageLimit === null ? t("subscription.usage.unlimited") : formatBytes(storageLimit)}
              </span>
              <span className="w-full">
                <UsageBar current={status.usage.storageBytes} limit={storageLimit} />
              </span>
            </span>
          }
        />
      </dl>

      {/* Compact limits summary (see the Usage section below for the full
          usage-vs-limit breakdown across all four resources). */}
      <div className="mt-4 grid grid-cols-3 gap-3 rounded-2xl border border-white/5 bg-white/5 p-4 text-center text-xs">
        <div>
          <p className="text-slate-400">{t("subscription.usage.employees")}</p>
          <p className="mt-1 font-semibold text-white">
            {status.limits.employees === null ? t("subscription.usage.unlimited") : status.limits.employees}
          </p>
        </div>
        <div>
          <p className="text-slate-400">{t("subscription.usage.projects")}</p>
          <p className="mt-1 font-semibold text-white">
            {status.limits.projects === null ? t("subscription.usage.unlimited") : status.limits.projects}
          </p>
        </div>
        <div>
          <p className="text-slate-400">{t("subscription.usage.customers")}</p>
          <p className="mt-1 font-semibold text-white">
            {status.limits.customers === null ? t("subscription.usage.unlimited") : status.limits.customers}
          </p>
        </div>
      </div>
    </section>
  );
}
