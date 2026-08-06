import type {
  NotificationCategory,
  NotificationChannel,
  NotificationSeverity,
} from "../../constants/notifications";

// N1.5 — THE CATALOG. Every notification type is declared here once, with all
// of its behaviour: who receives it, on which channels, in which category,
// and how severe it is.
//
// In code, not in a table, and deliberately so — the repo's stated rule is
// that adding a capability is a registry append, never a migration (see
// constants/features.ts, which the plan cites). A database-backed template
// table would only earn its keep if tenants could edit the copy, which is not
// a goal.

// Who a notification is addressed to. Resolution lives in ./recipients.ts.
export const RECIPIENT_STRATEGIES = [
  // The company's BUSINESS_OWNER.
  "OWNER",
  // Every active user of the company.
  "COMPANY_USERS",
  // One specific user, named in the event context as `userId`.
  "USER",
  // A raw address from the event context — the recipient has no account yet
  // (an invitee, or someone verifying a brand-new registration).
  "EMAIL",
] as const;
export type RecipientStrategy = (typeof RECIPIENT_STRATEGIES)[number];

export type NotificationTypeDefinition = {
  category: NotificationCategory;
  severity: NotificationSeverity;
  // Mandatory types ignore every preference and company toggle. Reserved for
  // messages whose suppression would harm the recipient (security) or leave
  // them unaware of something they are paying for (critical billing) — Q2.
  mandatory: boolean;
  // N1.7.2 — survives a `complained` suppression. Reserved for the messages
  // whose loss is an ACCOUNT LOCKOUT, not an inconvenience: the user asked for
  // this one seconds ago and cannot get back in without it.
  //
  // Deliberately a per-type flag rather than "category === security". N1.7.1
  // used the category, which silently swept in `auth.welcome` — a marketing-
  // adjacent courtesy mail that has no business overriding someone who
  // explicitly marked us as spam. The exemption has to be argued per message,
  // so it is declared per message.
  //
  // Never applies to a `bounced` suppression: there the mailbox does not
  // exist, so sending reaches nobody and only damages the shared domain.
  bypassesComplaintSuppression?: boolean;
  recipients: RecipientStrategy;
  channels: NotificationChannel[];
  // i18n keys for the in-app feed entry. Required when IN_APP is a channel.
  inApp?: {
    titleKey: string;
    bodyKey: string;
    ctaLabelKey?: string;
    ctaPath?: string;
  };
};

// The five types that exist today are exactly the five emails the product
// already sent before this module — N1.5 moves them onto the pipeline without
// inventing new ones. Billing and project types arrive in N1.8/N1.9.
export const NOTIFICATION_TYPES = {
  "auth.welcome": {
    category: "security",
    severity: "info",
    // Mandatory: an account-lifecycle message. There is also no preference to
    // consult at this point — the account is seconds old.
    mandatory: true,
    recipients: "EMAIL",
    channels: ["EMAIL"],
  },
  "auth.verify_email": {
    category: "security",
    severity: "info",
    mandatory: true,
    recipients: "EMAIL",
    channels: ["EMAIL"],
  },
  "auth.password_reset": {
    category: "security",
    severity: "critical",
    // Never suppressible under any setting: a reset the user requested and
    // did not receive is an account lockout.
    mandatory: true,
    // The one message that outranks a spam complaint. The user clicked "forgot
    // password" moments ago; refusing to send because they once marked a
    // different Axeriva email as spam locks them out of their own account with
    // no route back.
    bypassesComplaintSuppression: true,
    recipients: "EMAIL",
    channels: ["EMAIL"],
  },
  "employees.invitation": {
    category: "employees",
    severity: "info",
    // Mandatory despite being in an optional category: the owner explicitly
    // clicked "invite this person", and a preference switch quietly breaking
    // that flow would be a bug, not a preference. (The invite link is also
    // returned in the API response, so the UI can still share it.)
    mandatory: true,
    recipients: "EMAIL",
    channels: ["EMAIL"],
  },
  // N1.8 Slice 4 — the advance notice for the next charge (invoice.upcoming).
  "billing.renewal_upcoming": {
    // `billing_receipts`: a courtesy heads-up, and Q2 lets a customer decline
    // courtesies. It is NOT the dunning warning, which is `billing`.
    category: "billing_receipts",
    // `info`, not `warning`: nothing is wrong. This message exists so the
    // charge is expected, not so the customer acts.
    severity: "info",
    mandatory: false,
    recipients: "OWNER",
    channels: ["EMAIL"],
    // ⚠️ ACCEPTED RISK, recorded rather than left implicit: switchable + owner-
    // only means an owner who muted receipts, or a company whose billing
    // contact is not the owner, gets no advance warning of a charge — which
    // inverts this type's chargeback-prevention purpose for exactly those
    // tenants. K3 fixes the flags; the consequence is written down so a future
    // reader sees a decision and not an oversight.
  },
  // N1.8 Slice 3 — the failed-payment notice. `invoice.payment_failed`, for a
  // subscription invoice Stripe is auto-collecting.
  "billing.invoice_failed": {
    // `billing`, NOT `billing_receipts`: the two receipts are courtesies a
    // customer may switch off, and this is the message that tells them their
    // company is heading for read-only. Q2 draws the line exactly here.
    category: "billing",
    severity: "critical",
    // Ignores every preference and company toggle. The end of Stripe's dunning
    // cycle moves the subscription to canceled or unpaid, both of which make
    // the whole company read-only (services/readOnly.ts) — a customer who
    // silenced this and then lost write access was never warned.
    mandatory: true,
    // NOT bypassesComplaintSuppression, and the consequence is written down
    // rather than left implicit. That flag is reserved for messages whose loss
    // is an ACCOUNT LOCKOUT the recipient asked for seconds ago
    // (auth.password_reset). A dunning notice is not that, and mailing an
    // address that reported us as spam damages the sending domain for every
    // tenant. THE RESIDUAL RISK, stated so it is a decision and not an
    // oversight: an owner on the suppression list never receives this, and
    // because the type is EMAIL-only there is no second channel behind it.
    recipients: "OWNER",
    // EMAIL only. An in-app banner for read-only mode already exists on its own
    // path (services/readOnly.ts feeds the frontend's global state), so an
    // IN_APP entry here would be a second, worse copy of a warning the product
    // already shows — and the customer whose card is dead needs it in their
    // inbox, not behind a login.
    channels: ["EMAIL"],
  },
  // N1.8 Slice 2 — the mid-cycle plan-change receipt. `invoice.paid` with
  // billing_reason = subscription_update, which in this product means the
  // customer approved an upgrade on Stripe's hosted confirmation page: that
  // portal configuration sets proration_behavior "always_invoice"
  // (scripts/stripeSetup.ts), so Stripe invoices and charges the proration
  // immediately instead of rolling it into the next cycle.
  "billing.invoice_paid": {
    // Same reasoning as the renewal receipt below — a receipt for a charge the
    // customer themselves just authorised is exactly what Q2 lets them switch
    // off. The message they cannot switch off is `billing.plan_upgraded`
    // (N1.8 Phase 2), which reports the CHANGE rather than the payment.
    category: "billing_receipts",
    severity: "success",
    mandatory: false,
    recipients: "OWNER",
    // EMAIL only — a receipt belongs in an inbox, where invoices are kept.
    channels: ["EMAIL"],
  },
  // N1.8 Slice 1 — the renewal receipt. `invoice.paid` with
  // billing_reason = subscription_cycle; the other billing_reasons route
  // elsewhere or nowhere (K1), so one payment never produces two emails.
  "billing.subscription_renewed": {
    // `billing_receipts`, NOT `billing`: a monthly "we charged you again"
    // receipt is exactly the kind of message Q2 says a customer may switch off.
    // The critical billing messages (payment failed, subscription ended) are
    // the ones that stay mandatory.
    category: "billing_receipts",
    severity: "success",
    mandatory: false,
    recipients: "OWNER",
    // EMAIL only, deliberately. An in-app entry every billing cycle is noise in
    // the bell — the receipt belongs in an inbox, where invoices are kept.
    channels: ["EMAIL"],
  },
  "billing.subscription_created": {
    category: "billing",
    severity: "success",
    // Confirms that money changed hands and the paid relationship began.
    // Renewal receipts are the optional ones (billing_receipts, N1.8).
    mandatory: true,
    recipients: "OWNER",
    channels: ["EMAIL", "IN_APP"],
    inApp: {
      titleKey: "billing.subscriptionConfirmed.inApp.title",
      bodyKey: "billing.subscriptionConfirmed.inApp.body",
      ctaLabelKey: "billing.subscriptionConfirmed.inApp.cta",
      ctaPath: "/subscription",
    },
  },
} as const satisfies Record<string, NotificationTypeDefinition>;

export type NotificationTypeKey = keyof typeof NOTIFICATION_TYPES;

export function isNotificationType(value: unknown): value is NotificationTypeKey {
  return typeof value === "string" && value in NOTIFICATION_TYPES;
}

export function getNotificationType(type: NotificationTypeKey): NotificationTypeDefinition {
  return NOTIFICATION_TYPES[type];
}
