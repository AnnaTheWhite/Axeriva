import { Text } from "@react-email/components";
import { BaseLayout } from "../../components/BaseLayout";
import { CtaButton } from "../../components/CtaButton";
import type { EmailBranding } from "../../components/theme";
import { theme } from "../../components/theme";
import { renderEmail, type RenderedEmail } from "../../render";
import { translator } from "../../../i18n";
import type { NotificationLocale } from "../../../constants/notifications";

export type PasswordResetEmailProps = {
  resetLink: string;
  locale: NotificationLocale;
  branding?: EmailBranding;
};

export function PasswordResetEmail({ resetLink, locale, branding }: PasswordResetEmailProps) {
  const t = translator(locale);

  return (
    <BaseLayout locale={locale} footerText={t("common.footerTagline")} branding={branding}>
      <Text style={{ margin: "0 0 16px" }}>{t("auth.passwordReset.body")}</Text>
      <CtaButton label={t("auth.passwordReset.cta")} url={resetLink} branding={branding} />
      <Text
        className="ax-muted"
        style={{ margin: "16px 0 0", color: theme.color.mutedText, fontSize: theme.font.small }}
      >
        {t("auth.passwordReset.ignore")}
      </Text>
    </BaseLayout>
  );
}

export function passwordResetEmailTemplate(
  props: PasswordResetEmailProps
): Promise<RenderedEmail> {
  const t = translator(props.locale);
  return renderEmail(t("auth.passwordReset.subject"), <PasswordResetEmail {...props} />);
}
