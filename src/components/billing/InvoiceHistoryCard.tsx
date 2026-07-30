import EmptyState from "../ui/EmptyState";
import Button from "../ui/Button";
import { useTranslation } from "../../i18n";

const cardClass = "rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl sm:p-8";

// Invoice History (S2.4 + Design C) — no in-app Stripe Invoice API
// integration; invoices live in the Stripe Customer Portal, so the empty
// state points there (AC18) whenever a Stripe customer exists.
export default function InvoiceHistoryCard({
  hasStripeCustomer,
  onOpenPortal,
  isPortalDisabled,
}: {
  hasStripeCustomer: boolean;
  onOpenPortal: () => void;
  isPortalDisabled: boolean;
}) {
  const { t } = useTranslation();
  return (
    <section className={cardClass} aria-label={t("subscription.invoices.title")}>
      <h2 className="text-lg font-semibold text-white">{t("subscription.invoices.title")}</h2>
      <div className="mt-4">
        <EmptyState
          bare
          icon="🧾"
          title={t("subscription.invoices.emptyTitle")}
          description={
            hasStripeCustomer
              ? t("subscription.invoices.portalDesc")
              : t("subscription.invoices.emptyDesc")
          }
        />
        {hasStripeCustomer && (
          <div className="flex justify-center">
            <Button variant="secondary" onClick={onOpenPortal} disabled={isPortalDisabled}>
              {t("subscription.invoices.openPortal")}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
