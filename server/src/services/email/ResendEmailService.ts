import { Resend } from "resend";
import type { EmailService } from "./EmailService";
import { invitationEmailTemplate } from "./templates/invitationEmail";
import { welcomeEmailTemplate } from "./templates/welcomeEmail";
import { passwordResetEmailTemplate } from "./templates/passwordResetEmail";
import { verificationEmailTemplate } from "./templates/verificationEmail";
import { subscriptionConfirmedEmailTemplate } from "./templates/subscriptionConfirmedEmail";

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
    companyName: string
  ): Promise<void> {
    const { subject, html, text } = invitationEmailTemplate({ companyName, inviteLink });
    await this.send(to, subject, html, text);
  }

  async sendWelcomeEmail(to: string, companyName: string): Promise<void> {
    const { subject, html, text } = welcomeEmailTemplate({ companyName });
    await this.send(to, subject, html, text);
  }

  async sendPasswordResetEmail(to: string, resetLink: string): Promise<void> {
    const { subject, html, text } = passwordResetEmailTemplate({ resetLink });
    await this.send(to, subject, html, text);
  }

  async sendVerificationEmail(to: string, verifyLink: string): Promise<void> {
    const { subject, html, text } = verificationEmailTemplate({ verifyLink });
    await this.send(to, subject, html, text);
  }

  async sendSubscriptionConfirmedEmail(
    to: string,
    companyName: string,
    planName: string
  ): Promise<void> {
    const { subject, html, text } = subscriptionConfirmedEmailTemplate({
      companyName,
      planName,
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
