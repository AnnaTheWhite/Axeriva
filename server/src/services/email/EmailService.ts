import type { NotificationLocale } from "../../constants/notifications";
import type { EmailBranding } from "../../emails/components/theme";

// N1.3 — every send now carries an optional context: which language to render
// in, and (from N1.5) which company's branding to wear. Optional on purpose:
// omitting it reproduces the pre-N1.3 behaviour exactly (English, Axeriva
// colours), so a caller with no cheap way to resolve a recipient's language is
// not forced to invent one.
export type EmailContext = {
  locale?: NotificationLocale;
  branding?: EmailBranding;
  // N1.7.1 — an idempotency key for the provider, stable across retries of the
  // SAME delivery. The queue's retry policy was always documented as being
  // sized to fit inside Resend's 24-hour idempotency window (config.ts,
  // services/queue/index.ts) — but no key was ever sent, so the property those
  // comments relied on did not exist and a retry after a partial failure
  // delivered the message twice.
  idempotencyKey?: string;
};

// What the transport reports back. Before N1.7.1 every method returned void
// and Resend's message id was destructured away, which left
// NotificationDelivery.providerMessageId permanently NULL — and that column is
// the ONLY join key the delivery webhooks (N1.6) have. Every provider event
// therefore missed, so no delivery ever left "sent": `delivered`, `bounced`
// and `complained` were unreachable in production while the tests passed by
// seeding the column into fixtures by hand.
export type EmailSendResult = {
  // The provider's id for the message, and the only join key the delivery
  // webhooks have.
  //
  // Nullable because of RESEND, not because of the mock — N1.7.2 corrected this
  // comment, which previously claimed the opposite and would have told an
  // on-call engineer that a NULL in production was impossible. MockEmailService
  // ALWAYS returns a synthetic `mock_` id. ResendEmailService is the one that
  // can return null: if Resend answers 200 with no id in the body, the mail is
  // out and throwing would only buy a duplicate on retry, so the send succeeds
  // with the correlation permanently lost for that message. That row stays
  // `sent` forever and no webhook will ever match it.
  messageId: string | null;
};

// The method list itself is unchanged. The general send(OutboundEmail)
// interface the architecture calls for arrives with the Notification Service
// (N1.5); introducing it here would have meant rewriting the five call sites
// twice.
export interface EmailService {
  sendInvitationEmail(
    to: string,
    inviteLink: string,
    companyName: string,
    context?: EmailContext
  ): Promise<EmailSendResult>;

  sendWelcomeEmail(
    to: string,
    companyName: string,
    context?: EmailContext
  ): Promise<EmailSendResult>;

  sendVerificationEmail(
    to: string,
    verifyLink: string,
    context?: EmailContext
  ): Promise<EmailSendResult>;

  sendPasswordResetEmail(
    to: string,
    resetLink: string,
    context?: EmailContext
  ): Promise<EmailSendResult>;

  sendSubscriptionConfirmedEmail(
    to: string,
    companyName: string,
    planName: string,
    context?: EmailContext
  ): Promise<EmailSendResult>;

  // N1.8 Slice 1. Takes a single already-formatted payload rather than a
  // widening positional list: the five pre-N1.8 methods grew positional
  // parameters one migration at a time, and twelve billing templates down that
  // road would be unreadable at the call site. The shape is the contract from
  // emails/billingTypes.ts, so the trigger and the template cannot drift.
  sendSubscriptionRenewedEmail(
    to: string,
    data: InvoiceReceiptEmailPayload,
    context?: EmailContext
  ): Promise<EmailSendResult>;

  // N1.8 Slice 2 — the mid-cycle plan-change receipt (invoice.paid with
  // billing_reason = subscription_update). Same payload, different message:
  // see emails/templates/billing/InvoicePaidEmail.tsx for why the two receipts
  // are not one template with a flag.
  sendInvoicePaidEmail(
    to: string,
    data: InvoiceReceiptEmailPayload,
    context?: EmailContext
  ): Promise<EmailSendResult>;

  // N1.8 Slice 3 — the failed-payment notice. A DIFFERENT payload from the two
  // receipts, not the same one with fields unused: a failure has no plan, no
  // service period and no invoice link, and it carries two things they do not
  // (the attempt count and the next scheduled attempt). Reusing
  // InvoiceReceiptEmailPayload here would mean a contract most of whose fields
  // are meaningless for the message being sent.
  sendInvoiceFailedEmail(
    to: string,
    data: PaymentFailureEmailPayload,
    context?: EmailContext
  ): Promise<EmailSendResult>;

  // N1.8 Slice 4 — the advance notice for the next charge. Two formatted values
  // and the company name; deliberately no plan, no URL, no invoice number.
  sendRenewalUpcomingEmail(
    to: string,
    data: UpcomingRenewalEmailPayload,
    context?: EmailContext
  ): Promise<EmailSendResult>;

  // N1.8 Slice 5 — the card on file changed. The narrowest payload in the
  // milestone, and the only one carrying no formatted value at all.
  sendPaymentMethodUpdatedEmail(
    to: string,
    data: PaymentMethodEmailPayload,
    context?: EmailContext
  ): Promise<EmailSendResult>;
}

// What an invoice receipt needs, whatever the receipt is FOR.
//
// N1.8 Slice 2 renamed this from SubscriptionRenewedEmailPayload and gave it a
// second caller rather than declaring an identical twin. The five fields are
// not "what the renewal email happens to want" — they are what any Stripe
// invoice receipt states: who was billed, for which plan, how much, and for
// which service window. Slices 3-12 add receipts that differ only in copy, and
// a per-type payload would give each of them its own chance to drift from the
// context contract in emails/billingTypes.ts.
//
// Every money and date field is a STRING that has already been through
// utils/billingFormat — see emails/billingTypes.ts for why the email CHANNEL
// formats (the recipient's locale is not known any earlier) and the template
// never does.
export type InvoiceReceiptEmailPayload = {
  companyName: string;
  planName: string;
  amountFormatted: string;
  periodStartFormatted: string;
  periodEndFormatted: string;
  invoiceUrl?: string | null;
};

// N1.8 Slice 3. Satisfies PaymentFailureEmailData (emails/billingTypes.ts) plus
// the company name every template greets with.
//
// `nextAttemptFormatted` is nullable and that nullability is load-bearing copy
// logic: null means Stripe has scheduled no further automatic attempt, which
// selects a structurally different message rather than dropping a clause. See
// InvoiceFailedEmail.tsx.
//
// `attemptNumber` arrives as a NUMBER and is never rendered — it only chooses
// wording. It is not pre-rendered into a string precisely so no template can
// print it by accident.
export type PaymentFailureEmailPayload = {
  companyName: string;
  amountFormatted: string;
  attemptNumber: number;
  nextAttemptFormatted?: string | null;
  portalUrl: string;
};

// N1.8 Slice 4. Satisfies UpcomingRenewalEmailData (emails/billingTypes.ts) plus
// the company name.
//
// Kept at exactly this width on purpose: a preview invoice is unfinalized, so it
// has no hosted page, no PDF and no number, and the amount is the whole invoice
// total rather than a plan price — so there is no honest plan name to add
// either. Every field a future "friendlier email" change might reach for is
// absent from the payload rather than present and unused.
export type UpcomingRenewalEmailPayload = {
  companyName: string;
  amountFormatted: string;
  renewalDateFormatted: string;
};

// N1.8 Slice 5. Satisfies PaymentMethodEmailData (emails/billingTypes.ts) plus
// the company name.
//
// NOTHING HERE IS PRE-FORMATTED, which makes it the one billing payload that is
// identical to its context. Every other type in this milestone exists in two
// shapes — raw minor units and UNIX seconds on the wire, finished strings at the
// template — because the recipient's locale is not known until fan-out. A card
// brand and four digits are the same in every language, so there is no second
// shape to maintain and the channel's only job is to check the two fields are
// there.
//
// `brand` is Stripe's raw lowercase token. The template turns it into a display
// name because the fallback for an unrecognised or "unknown" brand is a
// TRANSLATED word, and this layer has no locale.
//
// `last4` is a string, never a number — leading zeros are real.
export type PaymentMethodEmailPayload = {
  companyName: string;
  brand: string;
  last4: string;
};
