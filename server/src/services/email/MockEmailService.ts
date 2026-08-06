import crypto from "crypto";
import type {
  EmailContext,
  EmailSendResult,
  EmailService,
  InvoiceReceiptEmailPayload,
  PaymentFailureEmailPayload,
  PaymentMethodEmailPayload,
  PlanChangeEmailPayload,
  UpcomingRenewalEmailPayload,
} from "./EmailService";
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
//
// N1.7.1: it now also returns a message id, and that is not decoration. The
// integration suite runs on this transport, so a mock returning null would
// leave providerMessageId NULL in every test — which is precisely the hole
// that let the real Resend path ship without ever writing that column. A test
// double has to model the part of the contract the system depends on, and the
// id IS the contract here: it is the only join key the delivery webhooks have.
//
// The id is derived from the idempotency key when one is supplied, so the mock
// reproduces the property that matters about Resend's idempotency: the same
// key returns the same message id instead of sending twice.
export class MockEmailService implements EmailService {
  async sendInvitationEmail(
    to: string,
    inviteLink: string,
    companyName: string,
    context?: EmailContext
  ): Promise<EmailSendResult> {
    console.log(
      `[MockEmailService] Invitation for ${to} to join "${companyName}" [${locale(context)}]: ${inviteLink}`
    );
    return result(context);
  }

  async sendWelcomeEmail(
    to: string,
    companyName: string,
    context?: EmailContext
  ): Promise<EmailSendResult> {
    console.log(
      `[MockEmailService] Welcome email for ${to} ("${companyName}") [${locale(context)}]`
    );
    return result(context);
  }

  async sendPasswordResetEmail(
    to: string,
    resetLink: string,
    context?: EmailContext
  ): Promise<EmailSendResult> {
    console.log(
      `[MockEmailService] Password reset for ${to} [${locale(context)}]: ${resetLink}`
    );
    return result(context);
  }

  async sendVerificationEmail(
    to: string,
    verifyLink: string,
    context?: EmailContext
  ): Promise<EmailSendResult> {
    console.log(
      `[MockEmailService] Verification email for ${to} [${locale(context)}]: ${verifyLink}`
    );
    return result(context);
  }

  async sendSubscriptionConfirmedEmail(
    to: string,
    companyName: string,
    planName: string,
    context?: EmailContext
  ): Promise<EmailSendResult> {
    console.log(
      `[MockEmailService] Subscription confirmed for ${to} ("${companyName}", ${planName}) [${locale(context)}]`
    );
    return result(context);
  }

  async sendSubscriptionRenewedEmail(
    to: string,
    data: InvoiceReceiptEmailPayload,
    context?: EmailContext
  ): Promise<EmailSendResult> {
    // The amount is logged because it is the value most worth eyeballing in a
    // dev run — a missing divide-by-100 is obvious here and nowhere else.
    console.log(
      `[MockEmailService] Subscription renewed for ${to} ("${data.companyName}", ${data.planName}, ${data.amountFormatted}) [${locale(context)}]`
    );
    return result(context);
  }

  async sendInvoicePaidEmail(
    to: string,
    data: InvoiceReceiptEmailPayload,
    context?: EmailContext
  ): Promise<EmailSendResult> {
    // The service period is logged alongside the amount here, unlike the
    // renewal above: for a plan change this is the PRORATION window, and a
    // dev run showing a whole month is the visible symptom of the wrong
    // invoice line having been picked.
    console.log(
      `[MockEmailService] Invoice paid (plan change) for ${to} ("${data.companyName}", ${data.planName}, ${data.amountFormatted}, ${data.periodStartFormatted} – ${data.periodEndFormatted}) [${locale(context)}]`
    );
    return result(context);
  }

  async sendInvoiceFailedEmail(
    to: string,
    data: PaymentFailureEmailPayload,
    context?: EmailContext
  ): Promise<EmailSendResult> {
    // The next attempt is logged as the literal "none" when absent rather than
    // being omitted: that is the branch that produces the urgent copy, and a
    // dev run in which it is silently missing looks identical to one where it
    // was never populated.
    console.log(
      `[MockEmailService] Invoice payment FAILED for ${to} ("${data.companyName}", ${data.amountFormatted}, attempt ${data.attemptNumber}, next attempt: ${data.nextAttemptFormatted ?? "none"}) [${locale(context)}]`
    );
    return result(context);
  }

  async sendRenewalUpcomingEmail(
    to: string,
    data: UpcomingRenewalEmailPayload,
    context?: EmailContext
  ): Promise<EmailSendResult> {
    // The DATE is the value worth eyeballing in a dev run here: an off-by-one
    // cycle reads as a plausible date and is invisible anywhere else.
    console.log(
      `[MockEmailService] Renewal upcoming for ${to} ("${data.companyName}", ${data.amountFormatted} on ${data.renewalDateFormatted}) [${locale(context)}]`
    );
    return result(context);
  }

  async sendPaymentMethodUpdatedEmail(
    to: string,
    data: PaymentMethodEmailPayload,
    context?: EmailContext
  ): Promise<EmailSendResult> {
    // Brand and last4 are logged as the RAW pair the context carries, not as
    // the template's "Visa •••• 4242": a dev run is where an unmapped brand
    // token has to be visible, and the display form hides exactly that by
    // rendering the generic fallback instead.
    console.log(
      `[MockEmailService] Payment method updated for ${to} ("${data.companyName}", brand ${data.brand}, last4 ${data.last4}) [${locale(context)}]`
    );
    return result(context);
  }

  async sendPlanUpgradedEmail(
    to: string,
    data: PlanChangeEmailPayload,
    context?: EmailContext
  ): Promise<EmailSendResult> {
    // BOTH plan names, in order. The whole message is a transition, and a dev
    // run showing only the destination cannot tell a correct upgrade from one
    // whose "from" was read after applySubscriptionUpdate had already
    // overwritten it — which is this slice's central hazard.
    console.log(
      `[MockEmailService] Plan upgraded for ${to} ("${data.companyName}", ${data.fromPlanName} -> ${data.toPlanName}, effective ${data.effectiveAtFormatted}) [${locale(context)}]`
    );
    return result(context);
  }
}

function locale(context?: EmailContext): string {
  return context?.locale ?? DEFAULT_NOTIFICATION_LOCALE;
}

// `mock_` prefixed so a stray id in a log or a database row is instantly
// recognisable as never having been near a real provider.
function result(context?: EmailContext): EmailSendResult {
  const seed = context?.idempotencyKey
    ? crypto.createHash("sha256").update(context.idempotencyKey).digest("hex").slice(0, 32)
    : crypto.randomUUID();

  return { messageId: `mock_${seed}` };
}
