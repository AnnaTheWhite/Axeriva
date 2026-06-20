import dotenv from "dotenv";
import { MockEmailService } from "./MockEmailService";
import { ResendEmailService } from "./ResendEmailService";

dotenv.config();

export type { EmailService } from "./EmailService";

const apiKey = process.env.RESEND_API_KEY;
const fromAddress = process.env.RESEND_FROM_EMAIL || "Axeriva <onboarding@resend.dev>";

// Falls back to the console-logging mock whenever RESEND_API_KEY isn't set
// — keeps local development working without real email credentials, while
// any environment with the key configured sends real email through Resend.
export const emailService = apiKey
  ? new ResendEmailService(apiKey, fromAddress)
  : new MockEmailService();

console.log(
  apiKey
    ? `[email] Using ResendEmailService (from: ${fromAddress})`
    : "[email] RESEND_API_KEY not set — using MockEmailService (emails are logged, not sent)"
);
