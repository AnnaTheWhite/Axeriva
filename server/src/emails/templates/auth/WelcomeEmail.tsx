import { Text } from "@react-email/components";
import { BaseLayout } from "../../components/BaseLayout";
import type { EmailBranding } from "../../components/theme";
import { theme } from "../../components/theme";
import { renderEmail, type RenderedEmail } from "../../render";
import { translator } from "../../../i18n";
import type { NotificationLocale } from "../../../constants/notifications";

export type WelcomeEmailProps = {
  companyName: string;
  locale: NotificationLocale;
  branding?: EmailBranding;
};

export function WelcomeEmail({ companyName, locale, branding }: WelcomeEmailProps) {
  const t = translator(locale);

  return (
    <BaseLayout locale={locale} footerText={t("common.footerTagline")} branding={branding}>
      <Text style={{ margin: "0 0 16px" }}>{t("auth.welcome.intro")}</Text>
      <Text style={{ margin: "0 0 16px" }}>{t("auth.welcome.body", { companyName })}</Text>
      <Text
        className="ax-muted"
        style={{ margin: "16px 0 0", color: theme.color.mutedText, fontSize: theme.font.small }}
      >
        {t("auth.welcome.help")}
      </Text>
    </BaseLayout>
  );
}

export function welcomeEmailTemplate(props: WelcomeEmailProps): Promise<RenderedEmail> {
  const t = translator(props.locale);
  return renderEmail(t("auth.welcome.subject"), <WelcomeEmail {...props} />);
}
