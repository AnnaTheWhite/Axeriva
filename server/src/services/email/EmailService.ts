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
  ): Promise<void>;

  sendWelcomeEmail(to: string, companyName: string, context?: EmailContext): Promise<void>;

  sendVerificationEmail(to: string, verifyLink: string, context?: EmailContext): Promise<void>;

  sendPasswordResetEmail(to: string, resetLink: string, context?: EmailContext): Promise<void>;

  sendSubscriptionConfirmedEmail(
    to: string,
    companyName: string,
    planName: string,
    context?: EmailContext
  ): Promise<void>;
}
