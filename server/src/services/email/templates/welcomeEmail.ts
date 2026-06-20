import { emailLayout } from "./layout";

export type WelcomeEmailData = {
  companyName: string;
};

export function welcomeEmailTemplate({ companyName }: WelcomeEmailData) {
  const subject = "Welcome to Axeriva";

  const html = emailLayout(`
    <p style="margin:0 0 16px;">Welcome to Axeriva!</p>
    <p style="margin:0 0 16px;">
      Your account for <strong>${companyName}</strong> is ready. You can now
      add employees, create projects, and start scheduling shifts.
    </p>
    <p style="margin:16px 0 0;color:#64748b;font-size:13px;">
      Need help getting started? Just reply to this email.
    </p>
  `);

  const text = `Welcome to Axeriva!\n\nYour account for ${companyName} is ready. You can now add employees, create projects, and start scheduling shifts.`;

  return { subject, html, text };
}
