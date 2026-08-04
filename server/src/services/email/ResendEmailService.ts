import { Resend } from "resend";
import type {
  EmailContext,
  EmailSendResult,
  EmailService,
  InvoiceReceiptEmailPayload,
} from "./EmailService";
import { DEFAULT_NOTIFICATION_LOCALE } from "../../constants/notifications";
import { INVITE_TTL_DAYS, VERIFICATION_TTL_HOURS } from "../../constants/tokenTtl";
import { invitationEmailTemplate } from "../../emails/templates/employees/InvitationEmail";
import { welcomeEmailTemplate } from "../../emails/templates/auth/WelcomeEmail";
import { passwordResetEmailTemplate } from "../../emails/templates/auth/PasswordResetEmail";
import { verificationEmailTemplate } from "../../emails/templates/auth/VerificationEmail";
import { subscriptionConfirmedEmailTemplate } from "../../emails/templates/billing/SubscriptionConfirmedEmail";
import { subscriptionRenewedEmailTemplate } from "../../emails/templates/billing/SubscriptionRenewedEmail";
import { invoicePaidEmailTemplate } from "../../emails/templates/billing/InvoicePaidEmail";

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
  ): Promise<EmailSendResult> {
    const { subject, html, text } = await invitationEmailTemplate({
      companyName,
      inviteLink,
      expiryDays: INVITE_TTL_DAYS,
      ...resolveContext(context),
    });
    return this.send(to, subject, html, text, context);
  }

  async sendWelcomeEmail(
    to: string,
    companyName: string,
    context?: EmailContext
  ): Promise<EmailSendResult> {
    const { subject, html, text } = await welcomeEmailTemplate({
      companyName,
      ...resolveContext(context),
    });
    return this.send(to, subject, html, text, context);
  }

  async sendPasswordResetEmail(
    to: string,
    resetLink: string,
    context?: EmailContext
  ): Promise<EmailSendResult> {
    const { subject, html, text } = await passwordResetEmailTemplate({
      resetLink,
      ...resolveContext(context),
    });
    return this.send(to, subject, html, text, context);
  }

  async sendVerificationEmail(
    to: string,
    verifyLink: string,
    context?: EmailContext
  ): Promise<EmailSendResult> {
    const { subject, html, text } = await verificationEmailTemplate({
      verifyLink,
      expiryHours: VERIFICATION_TTL_HOURS,
      ...resolveContext(context),
    });
    return this.send(to, subject, html, text, context);
  }

  async sendSubscriptionConfirmedEmail(
    to: string,
    companyName: string,
    planName: string,
    context?: EmailContext
  ): Promise<EmailSendResult> {
    const { subject, html, text } = await subscriptionConfirmedEmailTemplate({
      companyName,
      planName,
      ...resolveContext(context),
    });
    return this.send(to, subject, html, text, context);
  }

  // N1.8 Slice 1 — one payload object rather than a widening positional list.
  // The five methods above grew a parameter per migration; twelve billing
  // templates down that road would be unreadable at the call site.
  async sendSubscriptionRenewedEmail(
    to: string,
    data: InvoiceReceiptEmailPayload,
    context?: EmailContext
  ): Promise<EmailSendResult> {
    const { subject, html, text } = await subscriptionRenewedEmailTemplate({
      ...data,
      ...resolveContext(context),
    });
    return this.send(to, subject, html, text, context);
  }

  // N1.8 Slice 2 — same payload as the renewal receipt above, different
  // template. The two messages make different claims; see InvoicePaidEmail.tsx.
  async sendInvoicePaidEmail(
    to: string,
    data: InvoiceReceiptEmailPayload,
    context?: EmailContext
  ): Promise<EmailSendResult> {
    const { subject, html, text } = await invoicePaidEmailTemplate({
      ...data,
      ...resolveContext(context),
    });
    return this.send(to, subject, html, text, context);
  }

  // N1.7.1 — two things this used to throw away, both load-bearing.
  //
  // (1) The message id. `const { error } = await ...` discarded `data`, so
  //     NotificationDelivery.providerMessageId was never written and the N1.6
  //     webhook had nothing to correlate against: every delivery event missed,
  //     and no delivery could ever leave "sent".
  //
  // (2) The idempotency key. The retry policy in config.ts is explicitly sized
  //     to fit inside Resend's 24-hour idempotency window, but no key was sent,
  //     so the safety that justified the policy did not exist. A retry after a
  //     partial failure — Resend accepted the message, the response never
  //     arrived — sent the customer a second copy. The key is stable per
  //     DELIVERY (see email.channel.ts), which is exactly the unit pg-boss
  //     retries.
  private async send(
    to: string,
    subject: string,
    html: string,
    text: string,
    context?: EmailContext
  ): Promise<EmailSendResult> {
    const { data, error } = await this.resend.emails.send(
      {
        from: this.fromAddress,
        to,
        subject,
        html,
        text,
      },
      context?.idempotencyKey ? { idempotencyKey: context.idempotencyKey } : undefined
    );

    if (error) {
      throw new Error(`Resend send failed: ${error.message}`);
    }

    // Resend returns 200 with a body on success, so a missing id means the
    // contract changed rather than that the send failed. Not fatal — the mail
    // is out — but it silently disables delivery tracking for this message, so
    // it must not pass unnoticed.
    if (!data?.id) {
      console.warn(`[email] Resend accepted the send but returned no message id (to: ${to})`);
    }

    return { messageId: data?.id ?? null };
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
