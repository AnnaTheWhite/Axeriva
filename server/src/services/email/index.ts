import { MockEmailService } from "./MockEmailService";
import { ResendEmailService } from "./ResendEmailService";
import { config } from "../../config";

export type { EmailService } from "./EmailService";

// Falls back to the console-logging mock whenever RESEND_API_KEY isn't set
// — keeps local development working without real email credentials, while
// any environment with the key configured sends real email through Resend.
// In production a missing key is a startup error (see config.ts).
export const emailService = config.resend.apiKey
  ? new ResendEmailService(config.resend.apiKey, config.resend.fromEmail)
  : new MockEmailService();

console.log(
  config.resend.apiKey
    ? `[email] Using ResendEmailService (from: ${config.resend.fromEmail})`
    : "[email] RESEND_API_KEY not set — using MockEmailService (emails are logged, not sent)"
);
