import type { EmailContext, EmailService } from "./EmailService";
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
export class MockEmailService implements EmailService {
  async sendInvitationEmail(
    to: string,
    inviteLink: string,
    companyName: string,
    context?: EmailContext
  ): Promise<void> {
    console.log(
      `[MockEmailService] Invitation for ${to} to join "${companyName}" [${locale(context)}]: ${inviteLink}`
    );
  }

  async sendWelcomeEmail(
    to: string,
    companyName: string,
    context?: EmailContext
  ): Promise<void> {
    console.log(
      `[MockEmailService] Welcome email for ${to} ("${companyName}") [${locale(context)}]`
    );
  }

  async sendPasswordResetEmail(
    to: string,
    resetLink: string,
    context?: EmailContext
  ): Promise<void> {
    console.log(
      `[MockEmailService] Password reset for ${to} [${locale(context)}]: ${resetLink}`
    );
  }

  async sendVerificationEmail(
    to: string,
    verifyLink: string,
    context?: EmailContext
  ): Promise<void> {
    console.log(
      `[MockEmailService] Verification email for ${to} [${locale(context)}]: ${verifyLink}`
    );
  }

  async sendSubscriptionConfirmedEmail(
    to: string,
    companyName: string,
    planName: string,
    context?: EmailContext
  ): Promise<void> {
    console.log(
      `[MockEmailService] Subscription confirmed for ${to} ("${companyName}", ${planName}) [${locale(context)}]`
    );
  }
}

function locale(context?: EmailContext): string {
  return context?.locale ?? DEFAULT_NOTIFICATION_LOCALE;
}
