import Badge from "../ui/Badge";
import Button from "../ui/Button";
import { getPlanPrice, type PlanPricing } from "../../config/pricing";
import { useTranslation } from "../../i18n";

export type BillingPlanAction =
  | "current"
  | "upgrade"
  | "downgrade"
  // Assigned this plan but no active subscription/trial (expired) → subscribe
  // again via a fresh Checkout session.
  | "subscribe"
  | "contact"
  // Founder/Enterprise companies: catalog is visible, self-serve changes are
  // not offered (operator-managed).
  | "managed";

type BillingPlanCardProps = {
  plan: PlanPricing;
  action: BillingPlanAction;
  isCurrent: boolean;
  // This plan is the target of a scheduled period-end downgrade.
  isPendingDowngradeTarget: boolean;
  onAction: () => void;
  // This card's own request is in flight.
  isProcessing: boolean;
  // Some other change is in flight — every action stays disabled meanwhile.
  disabled: boolean;
};

// Enterprise-CTA target is a placeholder — a real sales flow is wired in a
// later story, matching the same approach as the public pricing page.
const CTA_CONTACT_HREF = "mailto:sales@axeriva.com";

export default function BillingPlanCard({
  plan,
  action,
  isCurrent,
  isPendingDowngradeTarget,
  onAction,
  isProcessing,
  disabled,
}: BillingPlanCardProps) {
  const { t, language } = useTranslation();
  const price = getPlanPrice(plan, language);

  const actionDisabled = disabled || isProcessing;

  return (
    <article
      className={`flex flex-col rounded-3xl border p-6 backdrop-blur-xl ${
        isCurrent ? "border-orange-500/50" : "border-white/10 bg-white/5"
      }`}
      aria-label={t(`pricing.plans.${plan.id}.name`)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold text-white">{t(`pricing.plans.${plan.id}.name`)}</h3>
        {isCurrent && <Badge variant="info">{t("subscription.plans.current")}</Badge>}
        {isPendingDowngradeTarget && (
          <Badge variant="warning">{t("subscription.plans.pendingTarget")}</Badge>
        )}
        {plan.recommended && !isCurrent && (
          <Badge variant="neutral">{t("pricing.recommended")}</Badge>
        )}
      </div>

      <div className="mt-4">
        {price ? (
          <p className="flex items-baseline gap-1">
            <span className="text-3xl font-bold text-white">{price}</span>
            <span className="text-sm text-slate-400">{t("pricing.perMonth")}</span>
          </p>
        ) : (
          <p className="text-2xl font-bold text-white">{t("pricing.contactSales")}</p>
        )}
      </div>

      <ul className="mt-4 flex-1 space-y-2 text-sm text-slate-300">
        {plan.highlightIds.slice(0, 3).map((hid) => (
          <li key={hid} className="flex items-center gap-2">
            <span aria-hidden="true" className="text-orange-400">✓</span>
            {t(`pricing.plans.${plan.id}.highlights.${hid}`)}
          </li>
        ))}
      </ul>

      <div className="mt-6">
        {action === "contact" ? (
          <a
            href={CTA_CONTACT_HREF}
            className="block w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            {t("pricing.cta.contactSales")}
          </a>
        ) : action === "managed" ? (
          <Button variant="secondary" className="w-full" disabled>
            {t("subscription.plans.managed")}
          </Button>
        ) : action === "current" ? (
          <Button variant="secondary" className="w-full" disabled>
            {t("subscription.plans.current")}
          </Button>
        ) : action === "subscribe" ? (
          <Button className="w-full" onClick={onAction} disabled={actionDisabled}>
            {isProcessing
              ? t("subscription.plans.processing")
              : t("subscription.plans.subscribeTo", { plan: t(`pricing.plans.${plan.id}.name`) })}
          </Button>
        ) : action === "upgrade" ? (
          <Button className="w-full" onClick={onAction} disabled={actionDisabled}>
            {isProcessing
              ? t("subscription.plans.processing")
              : t("subscription.plans.upgradeTo", { plan: t(`pricing.plans.${plan.id}.name`) })}
          </Button>
        ) : (
          <Button variant="secondary" className="w-full" onClick={onAction} disabled={actionDisabled}>
            {isProcessing
              ? t("subscription.plans.processing")
              : t("subscription.plans.downgradeTo", { plan: t(`pricing.plans.${plan.id}.name`) })}
          </Button>
        )}
      </div>
    </article>
  );
}
