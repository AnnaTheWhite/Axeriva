import { config } from "../config";
import { NOTIFICATION_LOCALES, type NotificationLocale } from "../constants/notifications";
import { PREVIEW_CASES } from "./emailPreview";
import { ResendEmailService } from "../services/email/ResendEmailService";

// N1.3 — sends every template, in every language, to ONE address, so the
// milestone's last exit criterion (real-client rendering in Gmail / Apple
// Mail, light and dark) can actually be checked.
//
//   npm run emails:test-send -- you@example.com
//
// ⚠️ This sends REAL email through the configured Resend account and counts
// against its quota. It refuses to run without RESEND_API_KEY rather than
// silently falling back to the mock, because a run that logs instead of
// sending would look like a pass and prove nothing.
//
// Ten messages arrive (5 templates x 2 locales); the subject line names the
// locale so the inbox is self-describing.

async function main() {
  const to = process.argv[2];

  if (!to || !to.includes("@")) {
    console.error("Usage: npm run emails:test-send -- you@example.com");
    process.exit(1);
  }

  if (!config.resend.apiKey) {
    console.error(
      "RESEND_API_KEY is not set. This script deliberately does not fall back to\n" +
        "MockEmailService: a run that only logs would look like a successful test."
    );
    process.exit(1);
  }

  const service = new ResendEmailService(config.resend.apiKey, config.resend.fromEmail);
  console.log(`Sending ${PREVIEW_CASES.length * NOTIFICATION_LOCALES.length} test emails to ${to}`);
  console.log(`From: ${config.resend.fromEmail}\n`);

  for (const testCase of PREVIEW_CASES) {
    for (const locale of NOTIFICATION_LOCALES) {
      // Rendered through the SAME template functions the preview uses, then
      // handed to the real transport — the send path is the production one.
      const { subject, html, text } = await testCase.render(locale as NotificationLocale);

      await sendRaw(service, {
        to,
        // Prefixed so ten similar messages are distinguishable in an inbox.
        subject: `[${locale}] ${subject}`,
        html,
        text,
      });

      console.log(`  sent  ${testCase.id}.${locale}`);
      // Resend allows 10 requests/second per team; a small gap keeps a
      // ten-message run comfortably clear of it.
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  console.log("\nDone. Check the inbox in Gmail and Apple Mail, in BOTH light and dark mode.");
  console.log("Record the results in docs/notification-milestones.md (N1.3 exit criteria).");
}

// The EmailService interface intentionally exposes only the five business
// methods; this script needs to post an already-rendered message, so it uses
// the transport's private send through a narrow cast rather than widening the
// public interface for a dev tool.
type RawSend = {
  send(to: string, subject: string, html: string, text: string): Promise<void>;
};

async function sendRaw(
  service: ResendEmailService,
  message: { to: string; subject: string; html: string; text: string }
): Promise<void> {
  await (service as unknown as RawSend).send(
    message.to,
    message.subject,
    message.html,
    message.text
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
