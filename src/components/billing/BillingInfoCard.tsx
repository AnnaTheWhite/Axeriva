import Badge from "../ui/Badge";
import { currencyForLanguage } from "../../config/pricing";
import { useTranslation } from "../../i18n";
import type { CompanySettings } from "../../services/companySettings.service";

const cardClass = "rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl sm:p-8";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/5 py-3 last:border-0">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="text-right text-sm font-medium text-white">{value}</span>
    </div>
  );
}

// Billing Information (S2.4) — read-only. Editing is out of scope; the
// existing Company Profile section (Settings page) already owns editing
// billingEmail/vatNumber/etc., so this view-only card just displays them.
export default function BillingInfoCard({
  settings,
  hasStripeCustomer,
}: {
  settings: CompanySettings;
  hasStripeCustomer: boolean;
}) {
  const { t, language } = useTranslation();

  return (
    <section className={cardClass} aria-label={t("subscription.billingInfo.title")}>
      <h2 className="text-lg font-semibold text-white">{t("subscription.billingInfo.title")}</h2>
      <dl className="mt-4">
        <Row label={t("subscription.billingInfo.companyName")} value={settings.name} />
        <Row label={t("subscription.billingInfo.billingEmail")} value={settings.billingEmail || "—"} />
        <Row label={t("subscription.billingInfo.vatNumber")} value={settings.vatNumber || "—"} />
        {/* No dedicated country field exists on Company yet — shown as an
            honest placeholder rather than inferred from the free-form
            address string. */}
        <Row label={t("subscription.billingInfo.billingCountry")} value="—" />
        <Row label={t("subscription.billingInfo.currency")} value={currencyForLanguage(language)} />
        <Row
          label={t("subscription.billingInfo.stripeCustomer")}
          value={
            <Badge variant={hasStripeCustomer ? "success" : "neutral"}>
              {hasStripeCustomer
                ? t("subscription.billingInfo.stripeConnected")
                : t("subscription.billingInfo.stripeNotConnected")}
            </Badge>
          }
        />
      </dl>
    </section>
  );
}
