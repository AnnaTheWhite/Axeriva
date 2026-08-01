import type { NotificationLocale } from "../../constants/notifications";
import type { EmailBranding } from "../../emails/components/theme";

// N1.3 — every send now carries an optional context: which language to render
// in, and (from N1.5) which company's branding to wear. Optional on purpose:
// omitting it reproduces the pre-N1.3 behaviour exactly (English, Axeriva
// colours), so a caller with no cheap way to resolve a recipient's language is
// not forced to invent one.
export type EmailContext = {
  locale?: NotificationLocale;
  branding?: EmailBranding;
  // N1.7.1 — an idempotency key for the provider, stable across retries of the
  // SAME delivery. The queue's retry policy was always documented as being
  // sized to fit inside Resend's 24-hour idempotency window (config.ts,
  // services/queue/index.ts) — but no key was ever sent, so the property those
  // comments relied on did not exist and a retry after a partial failure
  // delivered the message twice.
  idempotencyKey?: string;
};

// What the transport reports back. Before N1.7.1 every method returned void
// and Resend's message id was destructured away, which left
// NotificationDelivery.providerMessageId permanently NULL — and that column is
// the ONLY join key the delivery webhooks (N1.6) have. Every provider event
// therefore missed, so no delivery ever left "sent": `delivered`, `bounced`
// and `complained` were unreachable in production while the tests passed by
// seeding the column into fixtures by hand.
export type EmailSendResult = {
  // The provider's id for the message, and the only join key the delivery
  // webhooks have.
  //
  // Nullable because of RESEND, not because of the mock — N1.7.2 corrected this
  // comment, which previously claimed the opposite and would have told an
  // on-call engineer that a NULL in production was impossible. MockEmailService
  // ALWAYS returns a synthetic `mock_` id. ResendEmailService is the one that
  // can return null: if Resend answers 200 with no id in the body, the mail is
  // out and throwing would only buy a duplicate on retry, so the send succeeds
  // with the correlation permanently lost for that message. That row stays
  // `sent` forever and no webhook will ever match it.
  messageId: string | null;
};

// The method list itself is unchanged. The general send(OutboundEmail)
// interface the architecture calls for arrives with the Notification Service
// (N1.5); introducing it here would have meant rewriting the five call sites
// twice.
export interface EmailService {
  sendInvitationEmail(
    to: string,
    inviteLink: string,
    companyName: string,
    context?: EmailContext
  ): Promise<EmailSendResult>;

  sendWelcomeEmail(
    to: string,
    companyName: string,
    context?: EmailContext
  ): Promise<EmailSendResult>;

  sendVerificationEmail(
    to: string,
    verifyLink: string,
    context?: EmailContext
  ): Promise<EmailSendResult>;

  sendPasswordResetEmail(
    to: string,
    resetLink: string,
    context?: EmailContext
  ): Promise<EmailSendResult>;

  sendSubscriptionConfirmedEmail(
    to: string,
    companyName: string,
    planName: string,
    context?: EmailContext
  ): Promise<EmailSendResult>;
}
