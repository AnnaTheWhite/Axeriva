import type { EmailService } from "./EmailService";

// Logs the invite link instead of sending a real email. Swap the export in
// ./index.ts for a Resend/SendGrid implementation once one is wired up.
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
}
