import { Text } from "@react-email/components";
import { BaseLayout } from "../../components/BaseLayout";
import { InfoPanel, InfoRow } from "../../components/InfoRow";
import { CtaButton } from "../../components/CtaButton";
import type { EmailBranding } from "../../components/theme";
import { theme } from "../../components/theme";
import { renderEmail, type RenderedEmail } from "../../render";
import { translator } from "../../../i18n";
import type { NotificationLocale } from "../../../constants/notifications";

// N1.8 Slice 3 — the failed-payment notice, sent when Stripe reports
// invoice.payment_failed for a subscription invoice it is auto-collecting.
//
// This is the one billing message whose loss actually costs the customer
// something: it is `mandatory` and `critical` because the end of the dunning
// cycle takes the whole company read-only. Everything below is shaped by two
// constraints that follow from that.
//
// 1. IT MAY ONLY ASSERT WHAT THE INVOICE PROVES. Unlike the two receipts, this
//    handler deliberately sends WITHOUT a liveness gate — suppressing it in the
//    terminal dunning state would drop the most important message in the
//    sequence. The price of having no gate is that this template must never
//    name a plan and never state the subscription's CURRENT status: the payload
//    supports neither, and Company state may not have caught up with Stripe.
//    Everything here is derived from the invoice: an amount that failed, whether
//    another attempt is scheduled, and where to act.
//
// 2. THE ATTEMPT NUMBER IS NEVER RENDERED. Stripe documents attempt_count as
//    counting AUTOMATIC retries only — "manual payment attempts after the first
//    attempt do not affect the retry schedule" (Invoices.d.ts:176) — so it is a
//    floor on what the customer experienced, not a count of it. There is also no
//    total anywhere in the payload, so "attempt 3 of 4" is unsupportable. It
//    selects between two openings and does nothing else.
export type InvoiceFailedEmailProps = {
  companyName: string;
  amountFormatted: string;
  // Stripe's attempt_count. Chooses the opening line; never printed.
  attemptNumber: number;
  // The next scheduled automatic attempt, already formatted — or null when
  // Stripe has scheduled none. NULL IS A MEANING, not a missing value, and it
  // selects a structurally different message rather than trimming a clause off
  // this one.
  nextAttemptFormatted?: string | null;
  // The app's own subscription page. Never a Stripe Billing Portal session URL:
  // those are short-lived and single-use, so one baked into an email is a dead
  // link by the time it is read.
  portalUrl: string;
  locale: NotificationLocale;
  branding?: EmailBranding;
};

export function InvoiceFailedEmail({
  companyName,
  amountFormatted,
  attemptNumber,
  nextAttemptFormatted,
  portalUrl,
  locale,
  branding,
}: InvoiceFailedEmailProps) {
  const t = translator(locale);

  // Two independent decisions, deliberately not collapsed into one. The first
  // is about tone (has this failed before?), the second about what is true
  // (will Stripe try again?) — and only the second changes the instruction.
  const isRepeat = attemptNumber > 1;

  return (
    <BaseLayout locale={locale} footerText={t("common.footerTagline")} branding={branding}>
      <Text style={{ margin: "0 0 16px" }}>
        {isRepeat
          ? t("billing.invoiceFailed.introRepeat", { companyName })
          : t("billing.invoiceFailed.introFirst", { companyName })}
      </Text>

      <InfoPanel>
        <InfoRow label={t("billing.common.amount")} value={amountFormatted} emphasis />
      </InfoPanel>

      {/* The two branches share no string. A single message with an optional
          "we'll try again on X" tail would, when the tail is dropped, leave a
          reassuring sentence in the one case where nothing further is going to
          happen automatically. */}
      <Text style={{ margin: "16px 0 0" }}>
        {/* Branching on the VALUE, not on a precomputed boolean: that is what
            narrows the type here, so the scheduled branch cannot be reached
            with nothing to put in {{date}}. */}
        {nextAttemptFormatted
          ? t("billing.invoiceFailed.retryScheduled", { date: nextAttemptFormatted })
          : t("billing.invoiceFailed.retryNone")}
      </Text>

      {/* Exactly one CTA, and it is present in BOTH branches — the action is the
          same whether or not Stripe intends to try again. */}
      <CtaButton label={t("billing.invoiceFailed.cta")} url={portalUrl} branding={branding} />

      {/* Strictly conditional, and true: dunning ending moves the subscription
          to canceled or unpaid, both of which are read-only, and read-only
          preserves the data (services/readOnly.ts). Phrased as a consequence of
          non-payment, never as a statement about the account's state today. */}
      <Text
        className="ax-muted"
        style={{ margin: "16px 0 0", color: theme.color.mutedText, fontSize: theme.font.small }}
      >
        {t("billing.invoiceFailed.consequence")}
      </Text>
    </BaseLayout>
  );
}

export function invoiceFailedEmailTemplate(
  props: InvoiceFailedEmailProps
): Promise<RenderedEmail> {
  const t = translator(props.locale);

  // The subject escalates only on the fact that carries urgency — no further
  // automatic attempt — not on the attempt count, which cannot be trusted to
  // reflect how many times the customer has actually been charged.
  const subjectKey = props.nextAttemptFormatted
    ? "billing.invoiceFailed.subject"
    : "billing.invoiceFailed.subjectFinal";

  return renderEmail(
    t(subjectKey, { amount: props.amountFormatted }),
    <InvoiceFailedEmail {...props} />
  );
}
