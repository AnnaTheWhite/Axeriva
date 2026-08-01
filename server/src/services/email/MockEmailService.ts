import crypto from "crypto";
import type { EmailContext, EmailSendResult, EmailService } from "./EmailService";
import { DEFAULT_NOTIFICATION_LOCALE } from "../../constants/notifications";

// Logs instead of sending a real email. Used automatically whenever
// RESEND_API_KEY isn't set (see ./index.ts) — keeps local development
// working without needing real email credentials.
//
// N1.3 note: this stays a pure logger on purpose. It does NOT render the
// React Email templates — rendering here would add template work to every
// integration test for no coverage gain, since emailTemplates.test.ts renders
// all five directly and the props are type-checked at each call site. The
// resolved locale is logged so a developer can see which language a real send
// would have gone out in.
//
// N1.7.1: it now also returns a message id, and that is not decoration. The
// integration suite runs on this transport, so a mock returning null would
// leave providerMessageId NULL in every test — which is precisely the hole
// that let the real Resend path ship without ever writing that column. A test
// double has to model the part of the contract the system depends on, and the
// id IS the contract here: it is the only join key the delivery webhooks have.
//
// The id is derived from the idempotency key when one is supplied, so the mock
// reproduces the property that matters about Resend's idempotency: the same
// key returns the same message id instead of sending twice.
export class MockEmailService implements EmailService {
  async sendInvitationEmail(
    to: string,
    inviteLink: string,
    companyName: string,
    context?: EmailContext
  ): Promise<EmailSendResult> {
    console.log(
      `[MockEmailService] Invitation for ${to} to join "${companyName}" [${locale(context)}]: ${inviteLink}`
    );
    return result(context);
  }

  async sendWelcomeEmail(
    to: string,
    companyName: string,
    context?: EmailContext
  ): Promise<EmailSendResult> {
    console.log(
      `[MockEmailService] Welcome email for ${to} ("${companyName}") [${locale(context)}]`
    );
    return result(context);
  }

  async sendPasswordResetEmail(
    to: string,
    resetLink: string,
    context?: EmailContext
  ): Promise<EmailSendResult> {
    console.log(
      `[MockEmailService] Password reset for ${to} [${locale(context)}]: ${resetLink}`
    );
    return result(context);
  }

  async sendVerificationEmail(
    to: string,
    verifyLink: string,
    context?: EmailContext
  ): Promise<EmailSendResult> {
    console.log(
      `[MockEmailService] Verification email for ${to} [${locale(context)}]: ${verifyLink}`
    );
    return result(context);
  }

  async sendSubscriptionConfirmedEmail(
    to: string,
    companyName: string,
    planName: string,
    context?: EmailContext
  ): Promise<EmailSendResult> {
    console.log(
      `[MockEmailService] Subscription confirmed for ${to} ("${companyName}", ${planName}) [${locale(context)}]`
    );
    return result(context);
  }
}

function locale(context?: EmailContext): string {
  return context?.locale ?? DEFAULT_NOTIFICATION_LOCALE;
}

// `mock_` prefixed so a stray id in a log or a database row is instantly
// recognisable as never having been near a real provider.
function result(context?: EmailContext): EmailSendResult {
  const seed = context?.idempotencyKey
    ? crypto.createHash("sha256").update(context.idempotencyKey).digest("hex").slice(0, 32)
    : crypto.randomUUID();

  return { messageId: `mock_${seed}` };
}
