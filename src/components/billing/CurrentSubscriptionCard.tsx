import { useState } from "react";
import Badge from "../ui/Badge";
import Button from "../ui/Button";
import ConfirmModal from "../ui/ConfirmModal";
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

type CurrentSubscriptionCardProps = {
  status: SubscriptionStatus;
  // S2.6 cancel/resume — the page owns the service calls + refresh; this
  // card only renders the actions and the cancel confirmation.
  onCancel: () => void;
  onResume: () => void;
  isProcessing: boolean;
};

export default function CurrentSubscriptionCard({
  status,
  onCancel,
  onResume,
  isProcessing,
}: CurrentSubscriptionCardProps) {
  const { t, language } = useTranslation();
  const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState(false);

  const planId = status.effectivePlan;
  const planName = planId === "founder" ? "Founder" : t(`pricing.plans.${planId}.name`);
  const isTrialing = status.subscriptionStatus === "trialing";
  const currency = currencyForLanguage(language);
  const storageLimit = status.limits.storageBytes;

  const periodEndText = status.subscriptionEndsAt
    ? new Date(status.subscriptionEndsAt).toLocaleDateString()
    : "—";
  const pendingPlanName = status.pendingPlan
    ? t(`pricing.plans.${status.pendingPlan}.name`)
    : null;
  // Cancel/resume applies only to a live Stripe subscription; local
  // registration trials and manually-managed plans have nothing to cancel.
  const hasLiveStripeSubscription =
    Boolean(status.stripeSubscriptionId) &&
    (status.subscriptionStatus === "active" || status.subscriptionStatus === "trialing");
  const showActions = hasLiveStripeSubscription && planId !== "founder";

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
        <div className="flex flex-wrap items-center gap-2">
          {status.cancelAtPeriodEnd && (
            <Badge variant="danger">{t("subscription.cancellation.pendingBadge")}</Badge>
          )}
          {pendingPlanName && !status.cancelAtPeriodEnd && (
            <Badge variant="warning">
              {t("subscription.downgrade.pendingBadge", { plan: pendingPlanName })}
            </Badge>
          )}
          <Badge variant={STATUS_VARIANT[status.subscriptionStatus] ?? "neutral"}>
            {statusLabel(t, status.subscriptionStatus)}
          </Badge>
        </div>
      </div>

      <dl className="mt-6">
        <Row
          label={t("subscription.currentPlan.trialStatus")}
          tooltip={t("subscription.currentPlan.trialStatusTip")}
          value={isTrialing ? t("subscription.currentPlan.onTrial") : t("subscription.currentPlan.notOnTrial")}
        />
        {/* Pending period-end downgrade (S2.6): make the destination explicit. */}
        {pendingPlanName && (
          <Row
            label={t("subscription.downgrade.nextPlan")}
            value={
              <span className="text-amber-300">
                {t("subscription.downgrade.pendingLine", { plan: pendingPlanName })}
              </span>
            }
          />
        )}
        <Row
          label={t("subscription.currentPlan.billingPeriod")}
          value={
            status.subscriptionEndsAt
              ? t("subscription.currentPlan.billingPeriodUntil", { date: periodEndText })
              : "—"
          }
        />
        <Row
          label={
            status.cancelAtPeriodEnd
              ? t("subscription.cancellation.cancellationDate")
              : t("subscription.currentPlan.renewalDate")
          }
          tooltip={status.cancelAtPeriodEnd ? undefined : t("subscription.currentPlan.renewalDateTip")}
          value={
            status.cancelAtPeriodEnd ? (
              <span className="text-red-300">{periodEndText}</span>
            ) : (
              periodEndText
            )
          }
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

      {/* Cancel / resume (S2.6). The subscription itself is never deleted —
          cancelling only flips Stripe's cancel_at_period_end, so access runs
          until the end of the paid period and can be resumed any time before
          then. */}
      {showActions && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5">
          {status.cancelAtPeriodEnd ? (
            <>
              <p className="text-sm text-slate-400">
                {t("subscription.cancellation.endsOn", { date: periodEndText })}
              </p>
              <Button onClick={onResume} disabled={isProcessing}>
                {isProcessing
                  ? t("subscription.plans.processing")
                  : t("subscription.cancellation.resume")}
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-400">{t("subscription.cancellation.hint")}</p>
              <Button
                variant="danger"
                onClick={() => setIsCancelConfirmOpen(true)}
                disabled={isProcessing}
              >
                {isProcessing
                  ? t("subscription.plans.processing")
                  : t("subscription.cancellation.cancel")}
              </Button>
            </>
          )}
        </div>
      )}

      <ConfirmModal
        open={isCancelConfirmOpen}
        title={t("subscription.cancellation.confirmTitle")}
        message={t("subscription.cancellation.confirmMessage", { date: periodEndText })}
        confirmText={t("subscription.cancellation.confirmCta")}
        cancelText={t("subscription.cancellation.keepSubscription")}
        onConfirm={() => {
          setIsCancelConfirmOpen(false);
          onCancel();
        }}
        onClose={() => setIsCancelConfirmOpen(false)}
      />
    </section>
  );
}
