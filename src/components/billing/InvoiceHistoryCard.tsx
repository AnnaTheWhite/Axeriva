import EmptyState from "../ui/EmptyState";
import { useTranslation } from "../../i18n";

const cardClass = "rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl sm:p-8";

// Invoice History (S2.4) — no Stripe Invoice API integration yet, so this
// always renders the empty state. Wiring real invoice data is a later story.
export default function InvoiceHistoryCard() {
  const { t } = useTranslation();
  return (
    <section className={cardClass} aria-label={t("subscription.invoices.title")}>
      <h2 className="text-lg font-semibold text-white">{t("subscription.invoices.title")}</h2>
      <div className="mt-4">
        <EmptyState
          bare
          icon="🧾"
          title={t("subscription.invoices.emptyTitle")}
          description={t("subscription.invoices.emptyDesc")}
        />
      </div>
    </section>
  );
}
