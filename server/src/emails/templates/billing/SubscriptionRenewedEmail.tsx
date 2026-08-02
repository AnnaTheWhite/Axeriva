import { Text } from "@react-email/components";
import { BaseLayout } from "../../components/BaseLayout";
import { InfoPanel, InfoRow } from "../../components/InfoRow";
import { CtaButton } from "../../components/CtaButton";
import type { EmailBranding } from "../../components/theme";
import { theme } from "../../components/theme";
import { renderEmail, type RenderedEmail } from "../../render";
import { translator } from "../../../i18n";
import type { NotificationLocale } from "../../../constants/notifications";

// N1.8 Slice 1 — the renewal receipt, sent when Stripe reports invoice.paid
// with billing_reason = subscription_cycle.
//
// Every money and date value arrives ALREADY FORMATTED (see emails/billingTypes
// and utils/billingFormat). Nothing in this file calls Intl: a snapshot test
// over a template that formatted its own values would depend on the ICU version
// of whatever machine ran the suite.
export type SubscriptionRenewedEmailProps = {
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

export function SubscriptionRenewedEmail({
  companyName,
  planName,
  amountFormatted,
  periodStartFormatted,
  periodEndFormatted,
  invoiceUrl,
  locale,
  branding,
}: SubscriptionRenewedEmailProps) {
  const t = translator(locale);

  return (
    <BaseLayout locale={locale} footerText={t("common.footerTagline")} branding={branding}>
      <Text style={{ margin: "0 0 16px" }}>{t("billing.subscriptionRenewed.intro")}</Text>
      <Text style={{ margin: "0 0 16px" }}>
        {t("billing.subscriptionRenewed.body", { companyName, planName })}
      </Text>

      <InfoPanel>
        <InfoRow label={t("billing.common.plan")} value={planName} />
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
        {t("billing.subscriptionRenewed.manage")}
      </Text>
    </BaseLayout>
  );
}

export function subscriptionRenewedEmailTemplate(
  props: SubscriptionRenewedEmailProps
): Promise<RenderedEmail> {
  const t = translator(props.locale);
  return renderEmail(
    t("billing.subscriptionRenewed.subject", { amount: props.amountFormatted }),
    <SubscriptionRenewedEmail {...props} />
  );
}
