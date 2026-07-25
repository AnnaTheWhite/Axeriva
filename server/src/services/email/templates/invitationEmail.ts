import { emailLayout, ctaButton } from "./layout";
import { escapeHtml } from "../../../utils/escapeHtml";

export type InvitationEmailData = {
  companyName: string;
  inviteLink: string;
};

export function invitationEmailTemplate({ companyName, inviteLink }: InvitationEmailData) {
  // `companyName` is attacker-controlled and this email goes to a THIRD PARTY
  // (the invitee), which makes it the highest-value injection target of the
  // three. Escaped for the HTML body only — the subject and text parts below
  // are not HTML.
  const safeCompanyName = escapeHtml(companyName);

  const subject = `You've been invited to join ${companyName} on Axeriva`;

  const html = emailLayout(`
    <p style="margin:0 0 16px;">Hi,</p>
    <p style="margin:0 0 16px;">
      You've been invited to join <strong>${safeCompanyName}</strong> on Axeriva.
      Click below to set your password and activate your account.
    </p>
    ${ctaButton("Accept invitation", inviteLink)}
    <p style="margin:16px 0 0;color:#64748b;font-size:13px;">
      This link expires in 7 days. If you weren't expecting this invitation,
      you can safely ignore this email.
    </p>
  `);

  const text = `You've been invited to join ${companyName} on Axeriva.\n\nAccept your invitation: ${inviteLink}\n\nThis link expires in 7 days.`;

  return { subject, html, text };
}
