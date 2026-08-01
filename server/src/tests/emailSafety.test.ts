import { describe, expect, it } from "vitest";
import { emailService } from "../services/email";
import { MockEmailService } from "../services/email/MockEmailService";
import { config } from "../config";

// Guard against the test suite ever sending real email.
//
// This is not hypothetical. Until N1.5, vitest.config.ts merely OMITTED
// RESEND_API_KEY and a comment claimed that meant "no test can send a real
// email". It did not: config.ts calls dotenv.config(), which does not
// override variables already in process.env but does fill in the ones vitest
// left out — so the suite ran against the developer's LIVE Resend key and
// live from-address. Nothing had exercised the send path, so it stayed
// invisible; the first test that did immediately hit Resend's API. Real
// delivery was prevented only by the factories using @example.com, which
// Resend happens to reject.
//
// One assertion is worth more than that whole paragraph: whatever else
// changes, the suite must be holding a mock.

describe("test-environment email safety", () => {
  it("uses MockEmailService, never a real transport", () => {
    expect(emailService).toBeInstanceOf(MockEmailService);
  });

  it("has no Resend credential in scope", () => {
    expect(config.resend.apiKey).toBeNull();
  });

  it("cannot address a real domain even if a transport were swapped in", () => {
    // .invalid is reserved by RFC 2606 and can never resolve.
    expect(config.resend.fromEmail).toContain(".invalid");
  });
});
