import { Text } from "@react-email/components";
import { BaseLayout } from "../../components/BaseLayout";
import { CtaButton } from "../../components/CtaButton";
import type { EmailBranding } from "../../components/theme";
import { theme } from "../../components/theme";
import { renderEmail, type RenderedEmail } from "../../render";
import { translator } from "../../../i18n";
import type { NotificationLocale } from "../../../constants/notifications";

export type VerificationEmailProps = {
  verifyLink: string;
  // The real TTL, passed in rather than repeated in prose. The old template
  // hard-coded "24 hours" next to a VERIFICATION_TTL_MS constant it could not
  // see — if the constant moved, the email lied.
  expiryHours: number;
  locale: NotificationLocale;
  branding?: EmailBranding;
};

export function VerificationEmail({
  verifyLink,
  expiryHours,
  locale,
  branding,
}: VerificationEmailProps) {
  const t = translator(locale);

  return (
    <BaseLayout locale={locale} footerText={t("common.footerTagline")} branding={branding}>
      <Text style={{ margin: "0 0 16px" }}>{t("auth.verifyEmail.intro")}</Text>
      <Text style={{ margin: "0 0 16px" }}>{t("auth.verifyEmail.body")}</Text>
      <CtaButton label={t("auth.verifyEmail.cta")} url={verifyLink} branding={branding} />
      <Text
        className="ax-muted"
        style={{ margin: "16px 0 0", color: theme.color.mutedText, fontSize: theme.font.small }}
      >
        {t("auth.verifyEmail.expiry", { hours: expiryHours })}
      </Text>
    </BaseLayout>
  );
}

export function verificationEmailTemplate(
  props: VerificationEmailProps
): Promise<RenderedEmail> {
  const t = translator(props.locale);
  return renderEmail(t("auth.verifyEmail.subject"), <VerificationEmail {...props} />);
}
