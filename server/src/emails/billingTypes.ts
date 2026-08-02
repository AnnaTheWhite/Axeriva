import type { NotificationLocale } from "../constants/notifications";
import type { EmailBranding } from "./components/theme";

// N1.8 Fázis 0 — the payload shapes the twelve billing templates will consume.
//
// DELIBERATELY INDEPENDENT OF THE STRIPE SDK. Not a single field here is a
// Stripe type, and that is the point:
//
//  - A template must be renderable from a plain object in a test, without
//    constructing a Stripe.Invoice. The five existing templates are testable
//    precisely because their props are primitives; billing must not regress
//    that.
//  - Stripe reshapes its objects between API versions. `invoice.upcoming` has
//    no `id` at all, and the subscription moved to
//    `invoice.parent.subscription_details.subscription`. If templates read SDK
//    objects, every such change becomes a template change.
//  - Several of these fields are NOT Stripe-derived (companyName, plan display
//    names, portal URLs we build ourselves), so an SDK-shaped contract would be
//    a lie about where the data comes from.
//
// EVERY MONEY AND DATE FIELD IS ALREADY A FORMATTED STRING by the time a
// TEMPLATE sees it. A template snapshot containing an Intl call would depend on
// the runner's ICU version, so templates stay pure. The naming makes that
// non-negotiable: `amountFormatted`, not `amount`.
//
// ⚠️ WHERE that formatting happens changed in N1.8 Slice 1 review. It was the
// trigger; it is now the email CHANNEL, and the difference is not stylistic.
//
// A notification has no single locale. The trigger knows only the COMPANY
// language; the recipient's own `User.language` overrides it, and that override
// is resolved later, per recipient, by the dispatcher (recipients.ts). Anything
// the trigger formats is therefore formatted in the wrong language for any user
// whose preference differs from their company's — producing an email whose body
// is Hungarian and whose amounts are English. Reported as "locale split-brain".
//
// So the split is:
//   trigger  → writes RAW, locale-independent values into the event context
//              (see the *NotificationContext types below)
//   channel  → formats them with delivery.locale, the recipient's ACTUAL locale
//   template → receives finished strings, exactly as before
//
// One event fanned out to two owners with different languages now produces two
// correctly-localised emails from one context row, which the old design could
// not express at all.

// What every billing email carries.
export type BillingEmailBase = {
  companyName: string;
  locale: NotificationLocale;
  branding?: EmailBranding;
};

// An invoice the customer can look at — a paid receipt or a renewal.
// hostedInvoiceUrl / invoicePdfUrl are optional because Stripe types them as
// `string | null | undefined`, and Q3 settled that we LINK to the hosted PDF
// rather than attaching it (no worker-side download, no 40 MB attachment risk).
export type InvoiceEmailData = {
  amountFormatted: string;
  // The ISO code, kept alongside the formatted string purely so copy can say
  // "charged in EUR" without re-parsing the formatted value.
  currency: string;
  periodStartFormatted: string;
  periodEndFormatted: string;
  invoiceNumber?: string | null;
  hostedInvoiceUrl?: string | null;
  invoicePdfUrl?: string | null;
};

// A failed payment. `attemptNumber` is Stripe's attempt_count, which counts
// automatic retries only — a manual retry in the Portal does not increment it
// (Invoices.d.ts:176). Copy must therefore not promise "attempt N of M".
export type PaymentFailureEmailData = {
  amountFormatted: string;
  attemptNumber: number;
  // Absent when Stripe has scheduled no further automatic retry, which is
  // exactly when the message must become "act now" rather than "we'll try
  // again". The optionality is load-bearing copy logic, not laziness.
  nextAttemptFormatted?: string | null;
  portalUrl: string;
};

// An upcoming renewal — the "no surprise chargebacks" notice.
export type UpcomingRenewalEmailData = {
  amountFormatted: string;
  renewalDateFormatted: string;
};

// A newly attached payment method. Never anything beyond brand + last four:
// no PAN, no expiry, nothing that would make this email worth stealing.
export type PaymentMethodEmailData = {
  brand: string;
  last4: string;
};

// A plan change — upgrade, scheduled downgrade, applied downgrade.
// Plan names are DISPLAY names resolved by the trigger, not internal plan keys:
// "Professional", not "professional".
export type PlanChangeEmailData = {
  fromPlanName: string;
  toPlanName: string;
  effectiveAtFormatted: string;
};

// A cancellation or a resume. `activeUntilFormatted` is what makes a
// cancellation email not read as "your access ended today".
export type SubscriptionLifecycleEmailData = {
  planName: string;
  activeUntilFormatted?: string | null;
  portalUrl?: string | null;
};

// ---------------------------------------------------------------------------
// Raw context — what a TRIGGER writes into NotificationEvent.context
// ---------------------------------------------------------------------------

// Locale-independent by construction: minor units and UNIX seconds, never
// rendered text. This is the wire format between the webhook and the email
// channel, and it is what makes one event serve recipients in two languages.
//
// `timeZone` travels with the data rather than being re-read at send time
// because it is a property of the COMPANY being billed, not of the recipient —
// an invoice period belongs to the tenant's calendar, and re-reading it in the
// channel would mean a second query per delivery for a value that cannot change
// between fan-out and send in any way that should alter a past invoice.
export type InvoiceNotificationContext = {
  companyName: string;
  planName: string;
  // Stripe minor units, exactly as reported (invoice.amount_paid).
  amountMinor: number;
  // ISO 4217, any case.
  currency: string;
  // UNIX SECONDS, from the LINE ITEM's service period — not the invoice's
  // period_start/period_end, which Stripe documents as the invoice-item
  // association window rather than the service period. See the trigger.
  periodStartAt: number;
  periodEndAt: number;
  timeZone?: string | null;
  invoiceUrl?: string | null;
};

// Parses and validates the JSON-decoded context. The compiler cannot help here:
// NotificationEvent.context is a string column, so everything arrives as
// `unknown`. A trigger that forgets a field would otherwise surface as
// `undefined` inside a customer's receipt.
export function parseInvoiceNotificationContext(
  context: Record<string, unknown>
): InvoiceNotificationContext {
  const str = (key: string): string => {
    const value = context[key];
    if (typeof value !== "string" || value.length === 0) {
      throw new BillingContractError(`invoice context is missing "${key}"`);
    }
    return value;
  };

  const num = (key: string): number => {
    const value = context[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new BillingContractError(
        `invoice context "${key}" must be a finite number, got ${String(value)}`
      );
    }
    return value;
  };

  return {
    companyName: str("companyName"),
    planName: str("planName"),
    amountMinor: num("amountMinor"),
    currency: str("currency"),
    periodStartAt: num("periodStartAt"),
    periodEndAt: num("periodEndAt"),
    timeZone: typeof context.timeZone === "string" ? context.timeZone : null,
    // Empty string is treated as absent: Stripe types the URL nullable, and a
    // CTA pointing at "" renders a dead button rather than no button.
    invoiceUrl:
      typeof context.invoiceUrl === "string" && context.invoiceUrl.length > 0
        ? context.invoiceUrl
        : null,
  };
}

// ---------------------------------------------------------------------------
// Runtime validation
// ---------------------------------------------------------------------------

// TypeScript checks these contracts at the boundary the compiler can see. It
// cannot check the boundary that actually matters here: NotificationEvent
// .context is a JSON STRING, so every field arrives at the email channel as
// `unknown` after a JSON.parse and is cast into shape. A trigger that forgets a
// field produces `undefined` in a customer's invoice email, and the existing
// requireString() guard only covers the keys a template happens to read.
//
// So the contracts get a runtime check too, used by the triggers before they
// call notify(). Failing at the trigger — where there is a stack trace and a
// Stripe event id — is far cheaper than failing in a worker three retries later.
export class BillingContractError extends Error {}

function requirePresent(data: Record<string, unknown>, keys: string[], what: string): void {
  const missing = keys.filter((key) => {
    const value = data[key];
    return value === undefined || value === null || value === "";
  });

  if (missing.length > 0) {
    throw new BillingContractError(`${what} is missing: ${missing.join(", ")}`);
  }
}

// Numbers are checked separately: 0 is a legitimate amount (a fully discounted
// invoice) and would be rejected by the emptiness test above.
function requireFiniteNumber(data: Record<string, unknown>, key: string, what: string): void {
  const value = data[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BillingContractError(`${what}.${key} must be a finite number, got ${String(value)}`);
  }
}

export function assertInvoiceEmailData(data: InvoiceEmailData): void {
  requirePresent(
    data as unknown as Record<string, unknown>,
    ["amountFormatted", "currency", "periodStartFormatted", "periodEndFormatted"],
    "InvoiceEmailData"
  );
}

export function assertPaymentFailureEmailData(data: PaymentFailureEmailData): void {
  const record = data as unknown as Record<string, unknown>;
  requirePresent(record, ["amountFormatted", "portalUrl"], "PaymentFailureEmailData");
  requireFiniteNumber(record, "attemptNumber", "PaymentFailureEmailData");
}

export function assertUpcomingRenewalEmailData(data: UpcomingRenewalEmailData): void {
  requirePresent(
    data as unknown as Record<string, unknown>,
    ["amountFormatted", "renewalDateFormatted"],
    "UpcomingRenewalEmailData"
  );
}

export function assertPaymentMethodEmailData(data: PaymentMethodEmailData): void {
  requirePresent(
    data as unknown as Record<string, unknown>,
    ["brand", "last4"],
    "PaymentMethodEmailData"
  );
}

export function assertPlanChangeEmailData(data: PlanChangeEmailData): void {
  requirePresent(
    data as unknown as Record<string, unknown>,
    ["fromPlanName", "toPlanName", "effectiveAtFormatted"],
    "PlanChangeEmailData"
  );
}

export function assertSubscriptionLifecycleEmailData(
  data: SubscriptionLifecycleEmailData
): void {
  requirePresent(
    data as unknown as Record<string, unknown>,
    ["planName"],
    "SubscriptionLifecycleEmailData"
  );
}
