import { Text } from "@react-email/components";
import { BaseLayout } from "../../components/BaseLayout";
import { InfoPanel, InfoRow } from "../../components/InfoRow";
import type { EmailBranding } from "../../components/theme";
import { theme } from "../../components/theme";
import { renderEmail, type RenderedEmail } from "../../render";
import { translator } from "../../../i18n";
import type { NotificationLocale } from "../../../constants/notifications";

// N1.8 Slice 4 — the advance notice, sent when Stripe previews the next
// subscription invoice (invoice.upcoming). Its entire purpose is that nobody is
// surprised by a charge, so three things about the copy are load-bearing.
//
// 1. IT IS CHARGE-FRAMED, NOT RENEWAL-FRAMED. The word "renews" is false for the
//    single most valuable instance of this message — a trial's FIRST real
//    charge, where the customer has never been billed before and the card may
//    have been collected only moments ago. "We'll charge X on Y" is true for
//    that case, for an ordinary cycle, and for a cycle whose amount reflects a
//    scheduled downgrade. One sentence, all three states.
//
// 2. IT STATES AN ABSOLUTE DATE, NEVER "in N days". How far ahead Stripe emits
//    this event is an ACCOUNT-LEVEL Dashboard setting with no representation in
//    this repository (Events.d.ts:1554). Copy that hardcoded a lead time would
//    silently become a lie the day an operator changes that number, with no code
//    change and nothing to fail.
//
// 3. IT NAMES NO PLAN. The amount is the whole invoice total — it can include a
//    pending invoice item or a proration riding the next cycle — so calling it
//    "your plan costs X" would be wrong, and Company.plan lags a scheduled
//    downgrade until the schedule flips, so a plan name taken from there would
//    sit beside the next phase's price. Saying neither is the only safe option,
//    and the payload deliberately does not carry one.
//
// No CTA button by design: the payload has no URL, because a preview invoice is
// unfinalized and has neither a hosted page nor a number. The closing line
// points at the Subscription page in words instead.
export type UpcomingRenewalEmailProps = {
  companyName: string;
  amountFormatted: string;
  renewalDateFormatted: string;
  locale: NotificationLocale;
  branding?: EmailBranding;
};

export function UpcomingRenewalEmail({
  companyName,
  amountFormatted,
  renewalDateFormatted,
  locale,
  branding,
}: UpcomingRenewalEmailProps) {
  const t = translator(locale);

  return (
    <BaseLayout locale={locale} footerText={t("common.footerTagline")} branding={branding}>
      <Text style={{ margin: "0 0 16px" }}>{t("billing.renewalUpcoming.intro")}</Text>
      <Text style={{ margin: "0 0 16px" }}>
        {t("billing.renewalUpcoming.body", {
          companyName,
          amount: amountFormatted,
          date: renewalDateFormatted,
        })}
      </Text>

      <InfoPanel>
        <InfoRow label={t("billing.common.chargeDate")} value={renewalDateFormatted} />
        {/* The amount is the row this email is opened for. */}
        <InfoRow label={t("billing.common.amount")} value={amountFormatted} emphasis />
      </InfoPanel>

      <Text
        className="ax-muted"
        style={{ margin: "16px 0 0", color: theme.color.mutedText, fontSize: theme.font.small }}
      >
        {t("billing.renewalUpcoming.changeNote")}
      </Text>
    </BaseLayout>
  );
}

export function upcomingRenewalEmailTemplate(
  props: UpcomingRenewalEmailProps
): Promise<RenderedEmail> {
  const t = translator(props.locale);
  return renderEmail(
    t("billing.renewalUpcoming.subject", {
      amount: props.amountFormatted,
      date: props.renewalDateFormatted,
    }),
    <UpcomingRenewalEmail {...props} />
  );
}
