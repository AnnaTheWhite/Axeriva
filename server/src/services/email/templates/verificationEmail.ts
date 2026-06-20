import { emailLayout, ctaButton } from "./layout";

export type VerificationEmailData = {
  verifyLink: string;
};

export function verificationEmailTemplate({ verifyLink }: VerificationEmailData) {
  const subject = "Confirm your email for Axeriva";

  const html = emailLayout(`
    <p style="margin:0 0 16px;">Thanks for signing up for Axeriva!</p>
    <p style="margin:0 0 16px;">
      Please confirm your email address to finish setting up your account.
    </p>
    ${ctaButton("Verify email", verifyLink)}
    <p style="margin:16px 0 0;color:#64748b;font-size:13px;">
      This link expires in 24 hours. If you didn't create a Axeriva
      account, you can safely ignore this email.
    </p>
  `);

  const text = `Thanks for signing up for Axeriva!\n\nConfirm your email: ${verifyLink}\n\nThis link expires in 24 hours.`;

  return { subject, html, text };
}
