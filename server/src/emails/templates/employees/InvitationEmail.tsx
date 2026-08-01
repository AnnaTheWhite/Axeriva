import { Text } from "@react-email/components";
import { BaseLayout } from "../../components/BaseLayout";
import { CtaButton } from "../../components/CtaButton";
import type { EmailBranding } from "../../components/theme";
import { theme } from "../../components/theme";
import { renderEmail, type RenderedEmail } from "../../render";
import { translator } from "../../../i18n";
import type { NotificationLocale } from "../../../constants/notifications";

export type InvitationEmailProps = {
  // Attacker-controlled AND delivered to a third party (the invitee), which
  // makes this the highest-value injection target of the five. React escapes
  // it automatically now — the old template had to call escapeHtml() by hand
  // and only for the HTML body.
  companyName: string;
  inviteLink: string;
  expiryDays: number;
  locale: NotificationLocale;
  branding?: EmailBranding;
};

export function InvitationEmail({
  companyName,
  inviteLink,
  expiryDays,
  locale,
  branding,
}: InvitationEmailProps) {
  const t = translator(locale);

  return (
    <BaseLayout locale={locale} footerText={t("common.footerTagline")} branding={branding}>
      <Text style={{ margin: "0 0 16px" }}>{t("common.greeting")}</Text>
      <Text style={{ margin: "0 0 16px" }}>
        {t("employees.invitation.body", { companyName })}
      </Text>
      <CtaButton label={t("employees.invitation.cta")} url={inviteLink} branding={branding} />
      <Text
        className="ax-muted"
        style={{ margin: "16px 0 0", color: theme.color.mutedText, fontSize: theme.font.small }}
      >
        {t("employees.invitation.expiry", { days: expiryDays })}
      </Text>
    </BaseLayout>
  );
}

export function invitationEmailTemplate(props: InvitationEmailProps): Promise<RenderedEmail> {
  const t = translator(props.locale);
  return renderEmail(
    t("employees.invitation.subject", { companyName: props.companyName }),
    <InvitationEmail {...props} />
  );
}
