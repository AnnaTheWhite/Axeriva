import { emailLayout, ctaButton } from "./layout";

export type PasswordResetEmailData = {
  resetLink: string;
};

// Foundation only — no route generates resetLink yet (see EmailService.ts).
export function passwordResetEmailTemplate({ resetLink }: PasswordResetEmailData) {
  const subject = "Reset your CrewFlow password";

  const html = emailLayout(`
    <p style="margin:0 0 16px;">We received a request to reset your CrewFlow password.</p>
    ${ctaButton("Reset password", resetLink)}
    <p style="margin:16px 0 0;color:#64748b;font-size:13px;">
      If you didn't request this, you can safely ignore this email — your
      password won't be changed.
    </p>
  `);

  const text = `We received a request to reset your CrewFlow password.\n\nReset it here: ${resetLink}\n\nIf you didn't request this, you can ignore this email.`;

  return { subject, html, text };
}
