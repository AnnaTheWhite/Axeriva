import prisma from "../../../database/prisma";
import { emailService } from "../../email";
import type {
  EmailContext,
  EmailSendResult,
  InvoiceReceiptEmailPayload,
  PaymentFailureEmailPayload,
  PaymentMethodEmailPayload,
  UpcomingRenewalEmailPayload,
} from "../../email/EmailService";
import { config } from "../../../config";
import type { NotificationLocale } from "../../../constants/notifications";
import { INVITE_TTL_DAYS, VERIFICATION_TTL_HOURS } from "../../../constants/tokenTtl";
import {
  parseInvoiceNotificationContext,
  parsePaymentFailureNotificationContext,
  parsePaymentMethodNotificationContext,
  parseUpcomingRenewalNotificationContext,
} from "../../../emails/billingTypes";
import { formatDate, formatMoney } from "../../../utils/billingFormat";
import { redactEventContextIfSettled } from "../notify";
import { isNotificationType } from "../registry";

// N1.5 — turns one NotificationDelivery row into a sent email.
//
// This runs inside a queue worker, so throwing is the correct way to report
// failure: pg-boss retries with backoff and, when the budget is exhausted,
// moves the job to the dead-letter queue. That is the entire reason the five
// emails were worth moving onto the pipeline — until now a transient Resend
// outage lost the message permanently, with a console.error as the only trace.

type DeliveryContext = Record<string, unknown>;

function requireString(context: DeliveryContext, key: string): string {
  const value = context[key];
  if (typeof value !== "string" || value.length === 0) {
    // A permanent failure: retrying cannot conjure a missing link. It still
    // throws (the job dead-letters) rather than silently succeeding, because
    // a notification nobody receives must be visible somewhere.
    throw new Error(`notification context is missing "${key}"`);
  }
  return value;
}

export async function deliverEmail(deliveryId: number): Promise<void> {
  const delivery = await prisma.notificationDelivery.findUnique({
    where: { id: deliveryId },
    include: { event: true },
  });

  if (!delivery) throw new Error(`delivery ${deliveryId} not found`);

  // Already sent — a redelivered job must not send twice. pg-boss is
  // at-least-once, so this check is load-bearing, not defensive decoration.
  if (delivery.status !== "pending") return;

  // N1.7.2 — CLAIM the attempt before sending, with an optimistic lock on
  // `attempts`. Two things were wrong before, both fixed by moving the
  // increment to the front:
  //
  // 1. The status check above is not a claim. Two workers holding the same job
  //    (pg-boss is at-least-once, and the sweep can enqueue a second copy) both
  //    read status="pending" and both sent. The compare-and-set on `attempts`
  //    lets exactly one of them through.
  //
  // 2. `attempts` used to be incremented only AFTER the provider call resolved,
  //    so a row read `attempts: 0` for the whole duration of the HTTP request.
  //    sweepPendingDeliveries treats attempts=0 as "no worker has ever touched
  //    this" — which was therefore false precisely while a send was in flight,
  //    and the sweep could enqueue a duplicate underneath it. The increment now
  //    happens before any network call, so attempts=0 means what the sweep
  //    believes it means.
  const claimed = await prisma.notificationDelivery.updateMany({
    where: { id: deliveryId, status: "pending", attempts: delivery.attempts },
    data: { attempts: delivery.attempts + 1 },
  });
  if (claimed.count === 0) return;

  const context: DeliveryContext = delivery.event.context
    ? (JSON.parse(delivery.event.context) as DeliveryContext)
    : {};
  const locale = delivery.locale as NotificationLocale;

  try {
    // N1.7.1 — the key is derived from the DELIVERY id, which is exactly the
    // unit pg-boss retries: the same row retried an hour later presents the
    // same key, so Resend returns the original message instead of sending a
    // second copy. Deriving it from the event id instead would be wrong — one
    // event fans out to many recipients, and they must not deduplicate against
    // each other.
    const result = await send(delivery.event.type, delivery.recipientAddress, locale, context, {
      idempotencyKey: `notif-delivery-${deliveryId}`,
    });

    await prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: {
        status: "sent",
        sentAt: new Date(),
        // No increment here — the claim above already counted this attempt,
        // before the network call.
        lastError: null,
        // THE join key for every provider webhook (N1.6). Until N1.7.1 this
        // was never written, so every delivery event arrived unmatched and no
        // row could ever reach delivered/bounced/complained.
        providerMessageId: result.messageId,
      },
    });

    // H1 — the send is done, so a raw reset/verify/invite link in the event
    // context has served its purpose and must not outlive it. See notify.ts.
    await redactEventContextIfSettled(delivery.eventId);
  } catch (error) {
    // Record the attempt before rethrowing, so a job that eventually
    // dead-letters leaves a readable trail rather than just disappearing.
    await prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: {
        // Same as the success path: the attempt is already counted.
        lastError: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}

// One switch rather than a table of function pointers: each template takes
// different props, and a switch is the shape TypeScript can actually check.
async function send(
  type: string,
  to: string,
  locale: NotificationLocale,
  context: DeliveryContext,
  options: { idempotencyKey: string }
): Promise<EmailSendResult> {
  if (!isNotificationType(type)) {
    throw new Error(`unknown notification type: ${type}`);
  }

  const emailContext: EmailContext = { locale, idempotencyKey: options.idempotencyKey };

  switch (type) {
    case "auth.welcome":
      return emailService.sendWelcomeEmail(
        to,
        requireString(context, "companyName"),
        emailContext
      );

    case "auth.verify_email":
      return emailService.sendVerificationEmail(
        to,
        requireString(context, "verifyLink"),
        emailContext
      );

    case "auth.password_reset":
      return emailService.sendPasswordResetEmail(
        to,
        requireString(context, "resetLink"),
        emailContext
      );

    case "employees.invitation":
      return emailService.sendInvitationEmail(
        to,
        requireString(context, "inviteLink"),
        requireString(context, "companyName"),
        emailContext
      );

    case "billing.subscription_created":
      return emailService.sendSubscriptionConfirmedEmail(
        to,
        requireString(context, "companyName"),
        requireString(context, "planName"),
        emailContext
      );

    // N1.8 Slice 1 — the renewal receipt.
    case "billing.subscription_renewed":
      return emailService.sendSubscriptionRenewedEmail(
        to,
        invoiceReceiptPayload(context, locale),
        emailContext
      );

    // N1.8 Slice 2 — the mid-cycle plan-change receipt. Same context contract,
    // same formatting, different message.
    case "billing.invoice_paid":
      return emailService.sendInvoicePaidEmail(
        to,
        invoiceReceiptPayload(context, locale),
        emailContext
      );

    // N1.8 Slice 3 — the failed-payment notice. A different context contract
    // and a different payload from the two receipts above.
    case "billing.invoice_failed":
      return emailService.sendInvoiceFailedEmail(
        to,
        paymentFailurePayload(context, locale),
        emailContext
      );

    // N1.8 Slice 4 — the advance notice for the next charge.
    case "billing.renewal_upcoming":
      return emailService.sendRenewalUpcomingEmail(
        to,
        upcomingRenewalPayload(context, locale),
        emailContext
      );

    // N1.8 Slice 5 — the card on file changed. The one billing case that does
    // NOT take `locale`: there is nothing here to format, and passing it would
    // suggest otherwise.
    case "billing.payment_method_updated":
      return emailService.sendPaymentMethodUpdatedEmail(
        to,
        paymentMethodPayload(context),
        emailContext
      );
  }

  // N1.7.1 — exhaustiveness guard. The switch above returns for every member of
  // NotificationTypeKey, so this line is unreachable TODAY and TypeScript
  // proves it: `type` narrows to never. The moment a registry entry adds EMAIL
  // to its channels without a case here, that proof fails at compile time
  // instead of the delivery being silently marked "sent" with nothing sent.
  return assertNoEmailTemplate(type);
}

// N1.8 — THE MONEY AND DATES ARE FORMATTED HERE, not in the trigger, and
// `locale` is why: it is the RECIPIENT's locale, resolved per delivery by the
// dispatcher (User.language overriding Company.language). The trigger only
// knows the company's, so anything it formatted was in the wrong language for
// any user whose preference differs — a Hungarian email quoting English-
// formatted euros. The context therefore carries raw minor units and UNIX
// seconds, and one event can serve two owners in two languages correctly.
//
// Slice 2 lifted this out of the single case it started in. Every billing
// receipt reads the same context and needs the same four conversions, so
// leaving it inline would have meant re-deriving "divide by 100, seconds not
// milliseconds, company timezone, recipient locale" once per slice — four
// chances each to get one of them wrong, in code no reviewer would read twice.
function invoiceReceiptPayload(
  context: DeliveryContext,
  locale: NotificationLocale
): InvoiceReceiptEmailPayload {
  const invoice = parseInvoiceNotificationContext(context);

  return {
    companyName: invoice.companyName,
    planName: invoice.planName,
    amountFormatted: formatMoney({
      amountMinor: invoice.amountMinor,
      currency: invoice.currency,
      locale,
    }),
    periodStartFormatted: formatDate({
      value: invoice.periodStartAt,
      locale,
      timeZone: invoice.timeZone,
    }),
    periodEndFormatted: formatDate({
      value: invoice.periodEndAt,
      locale,
      timeZone: invoice.timeZone,
    }),
    invoiceUrl: invoice.invoiceUrl,
  };
}

// N1.8 Slice 3 — the failed-payment payload.
//
// TWO THINGS HERE ARE NOT SYMMETRIC WITH THE RECEIPT HELPER ABOVE, and both are
// deliberate.
//
// 1. `nextAttemptFormatted` is computed by BRANCHING on null, never by
//    formatting a coerced value. formatDate({ value: 0 }) does not throw and
//    does not return the "—" fallback — 0 is a perfectly valid Date, so it
//    renders "1 January 1970". In a message whose whole point is "here is when
//    we will try again", that is the worst available output, and it is what a
//    `?? 0` or a non-null assertion would produce.
//
//    Day precision (formatDate, not formatDateTime) on purpose: Stripe's retry
//    time-of-day is an implementation detail of its dunning scheduler, and
//    printing it invites a customer to watch the clock for a minute that means
//    nothing to them.
//
// 2. `portalUrl` is BUILT HERE rather than carried in the event context. It is
//    not Stripe data and it is not per-event: it is a property of this
//    deployment, and a copy stored in a queued NotificationEvent would go stale
//    against an APP_URL change while the row waited.
//
//    ⚠️ config.frontendUrl falls back to http://localhost:5173 when APP_URL is
//    unset (config.ts). In production that would be the only CTA of a critical
//    email pointing at nothing — which is an operational failure, not a code
//    one, and is why the rollout doc lists APP_URL as a precondition.
function paymentFailurePayload(
  context: DeliveryContext,
  locale: NotificationLocale
): PaymentFailureEmailPayload {
  const failure = parsePaymentFailureNotificationContext(context);

  return {
    companyName: failure.companyName,
    amountFormatted: formatMoney({
      amountMinor: failure.amountMinor,
      currency: failure.currency,
      locale,
    }),
    attemptNumber: failure.attemptNumber,
    nextAttemptFormatted:
      failure.nextAttemptAt === null || failure.nextAttemptAt === undefined
        ? null
        : formatDate({ value: failure.nextAttemptAt, locale, timeZone: failure.timeZone }),
    portalUrl: `${config.frontendUrl}/subscription`,
  };
}

// N1.8 Slice 4 — the advance-notice payload.
//
// `timeZone` matters more here than anywhere else in this milestone: a receipt's
// period is a bookkeeping detail a reader skims, whereas THIS message is exactly
// one date.
//
// ⚠️ AND IT IS NOT FULLY SOLVED, which is worth saying plainly rather than
// implying the zone handles it. Company.timezone is nullable with no default and
// nothing auto-detects it at registration, so for most tenants this resolves to
// UTC. A cycle anchor is the checkout instant, so a Budapest customer who
// subscribed at 01:30 local has a period.start at 23:30 UTC the PREVIOUS
// calendar day — and this email would name that previous day. The residual is
// bounded (±1 day on an advance notice, and the receipt that follows states the
// real date) but it is real, and it shrinks only when Company.timezone is
// actually populated. Raised as a product item, not papered over here.
//
// Day precision, like the failure notice: the time of day Stripe happens to
// charge is not something a customer can act on.
function upcomingRenewalPayload(
  context: DeliveryContext,
  locale: NotificationLocale
): UpcomingRenewalEmailPayload {
  const renewal = parseUpcomingRenewalNotificationContext(context);

  return {
    companyName: renewal.companyName,
    amountFormatted: formatMoney({
      amountMinor: renewal.amountMinor,
      currency: renewal.currency,
      locale,
    }),
    renewalDateFormatted: formatDate({
      value: renewal.renewsAt,
      locale,
      timeZone: renewal.timeZone,
    }),
  };
}

// N1.8 Slice 5 — the card-change payload.
//
// THE ONLY ONE OF THE FIVE THAT FORMATS NOTHING, and it still exists rather
// than the case inlining `context as PaymentMethodEmailPayload`. The parse is
// the whole value: `context` is a JSON string column, so both fields arrive as
// `unknown`, and an absent `last4` would otherwise reach the template as
// undefined and render "Visa •••• undefined" in a message whose entire content
// is those four digits. The trigger checks the same two fields — this is the
// second half of that pair, at the boundary the compiler cannot see.
//
// No `locale` parameter, deliberately. Every sibling helper takes one because
// money and dates must be rendered in the RECIPIENT's language; a brand token
// and four digits are the same in both, and the one language-dependent string
// (the fallback for an unrecognised brand) is resolved in the template, which
// has the locale from its own props.
function paymentMethodPayload(context: DeliveryContext): PaymentMethodEmailPayload {
  const method = parsePaymentMethodNotificationContext(context);

  return {
    companyName: method.companyName,
    brand: method.brand,
    last4: method.last4,
  };
}

function assertNoEmailTemplate(type: never): never {
  throw new Error(`notification type has an EMAIL channel but no template: ${String(type)}`);
}

// Exported for the tests that assert the TTL constants reach the templates
// through this path rather than being re-stated in prose.
export const EMAIL_TTL_FACTS = { INVITE_TTL_DAYS, VERIFICATION_TTL_HOURS };
