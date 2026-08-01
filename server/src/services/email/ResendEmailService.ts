import { Resend } from "resend";
import type { EmailContext, EmailService } from "./EmailService";
import { DEFAULT_NOTIFICATION_LOCALE } from "../../constants/notifications";
import { INVITE_TTL_DAYS, VERIFICATION_TTL_HOURS } from "../../constants/tokenTtl";
import { invitationEmailTemplate } from "../../emails/templates/employees/InvitationEmail";
import { welcomeEmailTemplate } from "../../emails/templates/auth/WelcomeEmail";
import { passwordResetEmailTemplate } from "../../emails/templates/auth/PasswordResetEmail";
import { verificationEmailTemplate } from "../../emails/templates/auth/VerificationEmail";
import { subscriptionConfirmedEmailTemplate } from "../../emails/templates/billing/SubscriptionConfirmedEmail";

// N1.3 — the templates moved to React Email (src/emails/), so the imports
// changed and the template calls became async. The transport itself is
// untouched: same Resend client, same from-address, same error handling.
export class ResendEmailService implements EmailService {
  private resend: Resend;
  private fromAddress: string;

  constructor(apiKey: string, fromAddress: string) {
    this.resend = new Resend(apiKey);
    this.fromAddress = fromAddress;
  }

  async sendInvitationEmail(
    to: string,
    inviteLink: string,
    companyName: string,
    context?: EmailContext
  ): Promise<void> {
    const { subject, html, text } = await invitationEmailTemplate({
      companyName,
      inviteLink,
      expiryDays: INVITE_TTL_DAYS,
      ...resolveContext(context),
    });
    await this.send(to, subject, html, text);
  }

  async sendWelcomeEmail(
    to: string,
    companyName: string,
    context?: EmailContext
  ): Promise<void> {
    const { subject, html, text } = await welcomeEmailTemplate({
      companyName,
      ...resolveContext(context),
    });
    await this.send(to, subject, html, text);
  }

  async sendPasswordResetEmail(
    to: string,
    resetLink: string,
    context?: EmailContext
  ): Promise<void> {
    const { subject, html, text } = await passwordResetEmailTemplate({
      resetLink,
      ...resolveContext(context),
    });
    await this.send(to, subject, html, text);
  }

  async sendVerificationEmail(
    to: string,
    verifyLink: string,
    context?: EmailContext
  ): Promise<void> {
    const { subject, html, text } = await verificationEmailTemplate({
      verifyLink,
      expiryHours: VERIFICATION_TTL_HOURS,
      ...resolveContext(context),
    });
    await this.send(to, subject, html, text);
  }

  async sendSubscriptionConfirmedEmail(
    to: string,
    companyName: string,
    planName: string,
    context?: EmailContext
  ): Promise<void> {
    const { subject, html, text } = await subscriptionConfirmedEmailTemplate({
      companyName,
      planName,
      ...resolveContext(context),
    });
    await this.send(to, subject, html, text);
  }

  private async send(to: string, subject: string, html: string, text: string): Promise<void> {
    const { error } = await this.resend.emails.send({
      from: this.fromAddress,
      to,
      subject,
      html,
      text,
    });

    if (error) {
      throw new Error(`Resend send failed: ${error.message}`);
    }
  }
}

// A caller that passes no context gets exactly the pre-N1.3 output: English,
// Axeriva colours.
function resolveContext(context?: EmailContext) {
  return {
    locale: context?.locale ?? DEFAULT_NOTIFICATION_LOCALE,
    branding: context?.branding,
  };
}
