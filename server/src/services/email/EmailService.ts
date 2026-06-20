export interface EmailService {
  sendInvitationEmail(
    to: string,
    inviteLink: string,
    companyName: string
  ): Promise<void>;
}
