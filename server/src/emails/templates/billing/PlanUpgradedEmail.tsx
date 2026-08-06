import { Text } from "@react-email/components";
import { BaseLayout } from "../../components/BaseLayout";
import { InfoPanel, InfoRow } from "../../components/InfoRow";
import type { EmailBranding } from "../../components/theme";
import { theme } from "../../components/theme";
import { renderEmail, type RenderedEmail } from "../../render";
import { translator } from "../../../i18n";
import type { NotificationLocale } from "../../../constants/notifications";

// N1.8 Slice 6 — the upgrade confirmation, sent when
// customer.subscription.updated moves the company UP a tier.
//
// THE FIRST BILLING MESSAGE IN THIS MILESTONE THAT IS NOT ABOUT MONEY, and
// almost everything below follows from that.
//
// 1. IT NAMES NO AMOUNT. An upgrade fires two Axeriva emails by approved
//    design: `billing.invoice_paid` reports the money (a switchable receipt),
//    and this reports the capability change (mandatory). That is not a
//    duplicate — they make different claims — but it only stays true if this
//    one does not also quote a figure. And there is no honest figure to quote:
//    what the customer paid today is a PRORATION for the rest of the current
//    cycle, while what they will pay from the next cycle is the new plan's full
//    price. Printing either without the other misleads, and the payload
//    deliberately carries neither.
//
// 2. IT IS A TRANSITION, NOT A STATE. "You are on Professional" would be true
//    and useless — the customer just chose it. Naming both ends is what lets
//    them confirm the change landed the way they intended, and it is the only
//    form that makes a WRONG change visible to them.
//
// 3. NO CTA BUTTON, and that is the approved contract rather than an oversight.
//    PlanChangeEmailData is {fromPlanName, toPlanName, effectiveAtFormatted} —
//    the plan gives a link only to the messages whose template data lists one
//    (the failure notice's Portal link), and this is not one of them. So the
//    closing line names the Subscription page in words, exactly as Slices 4 and
//    5 do. Adding a URL here would mean widening a contract the roadmap fixed.
export type PlanUpgradedEmailProps = {
  companyName: string;
  // DISPLAY names — "Professional", never "professional". Resolved by the
  // trigger through planDisplayName(); see emails/billingTypes.ts.
  fromPlanName: string;
  toPlanName: string;
  // Already through utils/billingFormat in the channel, in the recipient's
  // locale and the company's timezone.
  effectiveAtFormatted: string;
  locale: NotificationLocale;
  branding?: EmailBranding;
};

export function PlanUpgradedEmail({
  companyName,
  fromPlanName,
  toPlanName,
  effectiveAtFormatted,
  locale,
  branding,
}: PlanUpgradedEmailProps) {
  const t = translator(locale);

  return (
    <BaseLayout locale={locale} footerText={t("common.footerTagline")} branding={branding}>
      <Text style={{ margin: "0 0 16px" }}>{t("billing.planUpgraded.intro")}</Text>
      <Text style={{ margin: "0 0 16px" }}>
        {t("billing.planUpgraded.body", { companyName, toPlanName })}
      </Text>

      <InfoPanel>
        {/* The transition, as two labelled rows rather than one "A → B" string:
            an arrow between two proper nouns is a glyph some clients render as
            a box, and a label on each side survives every renderer. */}
        <InfoRow label={t("billing.planUpgraded.previousPlan")} value={fromPlanName} />
        <InfoRow label={t("billing.planUpgraded.newPlan")} value={toPlanName} emphasis />
        <InfoRow label={t("billing.planUpgraded.effectiveFrom")} value={effectiveAtFormatted} />
      </InfoPanel>

      {/* Says where the money is reported, without restating it. This is what
          keeps the two-email pair legible to the customer instead of looking
          like Axeriva sent the same thing twice. */}
      <Text
        className="ax-muted"
        style={{ margin: "16px 0 0", color: theme.color.mutedText, fontSize: theme.font.small }}
      >
        {t("billing.planUpgraded.billingNote")}
      </Text>
    </BaseLayout>
  );
}

export function planUpgradedEmailTemplate(
  props: PlanUpgradedEmailProps
): Promise<RenderedEmail> {
  const t = translator(props.locale);
  return renderEmail(
    t("billing.planUpgraded.subject", { toPlanName: props.toPlanName }),
    <PlanUpgradedEmail {...props} />
  );
}
