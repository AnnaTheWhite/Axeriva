import { MockEmailService } from "./MockEmailService";

export type { EmailService } from "./EmailService";

export const emailService = new MockEmailService();
