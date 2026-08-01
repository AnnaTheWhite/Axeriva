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
