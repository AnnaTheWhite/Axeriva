import { Text } from "@react-email/components";
import { BaseLayout } from "../../components/BaseLayout";
import type { EmailBranding } from "../../components/theme";
import { theme } from "../../components/theme";
import { renderEmail, type RenderedEmail } from "../../render";
import { translator } from "../../../i18n";
import type { NotificationLocale } from "../../../constants/notifications";

export type SubscriptionConfirmedEmailProps = {
  companyName: string;
  planName: string;
  locale: NotificationLocale;
  branding?: EmailBranding;
};

export function SubscriptionConfirmedEmail({
  companyName,
  planName,
  locale,
  branding,
}: SubscriptionConfirmedEmailProps) {
  const t = translator(locale);

  return (
    <BaseLayout locale={locale} footerText={t("common.footerTagline")} branding={branding}>
      <Text style={{ margin: "0 0 16px" }}>{t("billing.subscriptionConfirmed.intro")}</Text>
      <Text style={{ margin: "0 0 16px" }}>
        {t("billing.subscriptionConfirmed.body", { companyName, planName })}
      </Text>
      <Text
        className="ax-muted"
        style={{ margin: "16px 0 0", color: theme.color.mutedText, fontSize: theme.font.small }}
      >
        {t("billing.subscriptionConfirmed.manage")}
      </Text>
    </BaseLayout>
  );
}

export function subscriptionConfirmedEmailTemplate(
  props: SubscriptionConfirmedEmailProps
): Promise<RenderedEmail> {
  const t = translator(props.locale);
  return renderEmail(
    t("billing.subscriptionConfirmed.subject", { planName: props.planName }),
    <SubscriptionConfirmedEmail {...props} />
  );
}
