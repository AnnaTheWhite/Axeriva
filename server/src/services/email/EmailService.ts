export interface EmailService {
  sendInvitationEmail(
    to: string,
    inviteLink: string,
    companyName: string
  ): Promise<void>;

  sendWelcomeEmail(to: string, companyName: string): Promise<void>;

  sendVerificationEmail(to: string, verifyLink: string): Promise<void>;

  // Foundation for a future "forgot password" flow — the route that
  // generates the reset token/link doesn't exist yet, only the ability to
  // send the email once it does.
  sendPasswordResetEmail(to: string, resetLink: string): Promise<void>;

  sendSubscriptionConfirmedEmail(
    to: string,
    companyName: string,
    planName: string
  ): Promise<void>;
}
