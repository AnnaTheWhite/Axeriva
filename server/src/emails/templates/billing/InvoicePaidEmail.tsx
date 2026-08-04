import { Text } from "@react-email/components";
import { BaseLayout } from "../../components/BaseLayout";
import { InfoPanel, InfoRow } from "../../components/InfoRow";
import { CtaButton } from "../../components/CtaButton";
import type { EmailBranding } from "../../components/theme";
import { theme } from "../../components/theme";
import { renderEmail, type RenderedEmail } from "../../render";
import { translator } from "../../../i18n";
import type { NotificationLocale } from "../../../constants/notifications";

// N1.8 Slice 2 — the plan-change receipt, sent when Stripe reports invoice.paid
// with billing_reason = subscription_update.
//
// WHY THIS IS A SEPARATE MESSAGE FROM THE RENEWAL RECEIPT, given both render
// the same five values: the two make different CLAIMS. "Your subscription
// renewed" says the customer is covered for another full cycle at the price
// they already knew; this one says money was taken mid-cycle for a change the
// customer just made, and the period shown is the REMAINDER of the current
// cycle, not a whole one. Merging them behind a flag would mean one template
// asserting two different things about the same numbers.
//
// The shared parts are shared where sharing is safe: the payload contract
// (services/email/EmailService.ts — InvoiceReceiptEmailPayload), the formatting
// (utils/billingFormat, applied once in the email channel), the period
// selection (stripeWebhook.routes.ts — invoiceServicePeriod) and the info-row
// labels (billing.common.*). Only the copy differs, which is the only thing
// that should.
//
// Every money and date value arrives ALREADY FORMATTED. Nothing in this file
// calls Intl — a snapshot over a template that formatted its own values would
// depend on the ICU version of whatever machine ran the suite.
export type InvoicePaidEmailProps = {
  companyName: string;
  planName: string;
  amountFormatted: string;
  periodStartFormatted: string;
  periodEndFormatted: string;
  // Stripe's hosted invoice page. Optional because Stripe types it nullable —
  // and Q3 settled that we LINK to the hosted invoice rather than attaching a
  // PDF (no worker-side download, no attachment size risk).
  invoiceUrl?: string | null;
  locale: NotificationLocale;
  branding?: EmailBranding;
};

export function InvoicePaidEmail({
  companyName,
  planName,
  amountFormatted,
  periodStartFormatted,
  periodEndFormatted,
  invoiceUrl,
  locale,
  branding,
}: InvoicePaidEmailProps) {
  const t = translator(locale);

  return (
    <BaseLayout locale={locale} footerText={t("common.footerTagline")} branding={branding}>
      <Text style={{ margin: "0 0 16px" }}>{t("billing.invoicePaid.intro")}</Text>
      <Text style={{ margin: "0 0 16px" }}>
        {t("billing.invoicePaid.body", { companyName, planName })}
      </Text>

      <InfoPanel>
        <InfoRow label={t("billing.common.plan")} value={planName} />
        {/* The proration window — the part of the current cycle this charge
            covers, which is why the copy above says "the rest of". */}
        <InfoRow
          label={t("billing.common.period")}
          value={`${periodStartFormatted} – ${periodEndFormatted}`}
        />
        {/* The amount is the one row a receipt is actually read for. */}
        <InfoRow label={t("billing.common.amount")} value={amountFormatted} emphasis />
      </InfoPanel>

      {/* Exactly one CTA — the billing UX spec's rule. Omitted entirely rather
          than rendered dead when Stripe gave us no hosted invoice URL. */}
      {invoiceUrl ? (
        <CtaButton label={t("billing.common.viewInvoice")} url={invoiceUrl} branding={branding} />
      ) : null}

      <Text
        className="ax-muted"
        style={{ margin: "16px 0 0", color: theme.color.mutedText, fontSize: theme.font.small }}
      >
        {t("billing.common.manage")}
      </Text>
    </BaseLayout>
  );
}

export function invoicePaidEmailTemplate(
  props: InvoicePaidEmailProps
): Promise<RenderedEmail> {
  const t = translator(props.locale);
  return renderEmail(
    t("billing.invoicePaid.subject", { amount: props.amountFormatted }),
    <InvoicePaidEmail {...props} />
  );
}
