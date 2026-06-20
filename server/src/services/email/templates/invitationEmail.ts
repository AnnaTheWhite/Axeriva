import { emailLayout, ctaButton } from "./layout";

export type InvitationEmailData = {
  companyName: string;
  inviteLink: string;
};

export function invitationEmailTemplate({ companyName, inviteLink }: InvitationEmailData) {
  const subject = `You've been invited to join ${companyName} on CrewFlow`;

  const html = emailLayout(`
    <p style="margin:0 0 16px;">Hi,</p>
    <p style="margin:0 0 16px;">
      You've been invited to join <strong>${companyName}</strong> on CrewFlow.
      Click below to set your password and activate your account.
    </p>
    ${ctaButton("Accept invitation", inviteLink)}
    <p style="margin:16px 0 0;color:#64748b;font-size:13px;">
      This link expires in 7 days. If you weren't expecting this invitation,
      you can safely ignore this email.
    </p>
  `);

  const text = `You've been invited to join ${companyName} on CrewFlow.\n\nAccept your invitation: ${inviteLink}\n\nThis link expires in 7 days.`;

  return { subject, html, text };
}
