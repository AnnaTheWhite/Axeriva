import type { EmailService } from "./EmailService";

// Logs instead of sending a real email. Used automatically whenever
// RESEND_API_KEY isn't set (see ./index.ts) — keeps local development
// working without needing real email credentials.
export class MockEmailService implements EmailService {
  async sendInvitationEmail(
    to: string,
    inviteLink: string,
    companyName: string
  ): Promise<void> {
    console.log(
      `[MockEmailService] Invitation for ${to} to join "${companyName}": ${inviteLink}`
    );
  }

  async sendWelcomeEmail(to: string, companyName: string): Promise<void> {
    console.log(`[MockEmailService] Welcome email for ${to} ("${companyName}")`);
  }

  async sendPasswordResetEmail(to: string, resetLink: string): Promise<void> {
    console.log(`[MockEmailService] Password reset for ${to}: ${resetLink}`);
  }

  async sendVerificationEmail(to: string, verifyLink: string): Promise<void> {
    console.log(`[MockEmailService] Verification email for ${to}: ${verifyLink}`);
  }

  async sendSubscriptionConfirmedEmail(
    to: string,
    companyName: string,
    planName: string
  ): Promise<void> {
    console.log(
      `[MockEmailService] Subscription confirmed for ${to} ("${companyName}", ${planName})`
    );
  }
}
