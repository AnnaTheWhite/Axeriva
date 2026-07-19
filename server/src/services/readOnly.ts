import { isManuallyManaged } from "./planAccess";

// S2.7 — the ONE place that decides whether a company is in Read-only Mode.
// Reused by the write-guard middleware (enforcement), the /access/read-only
// endpoint (frontend global state) and the /subscription payload. No other
// code re-derives this rule.
//
// A company is Read-only when it has no active paid subscription and no live
// trial. Concretely, write access requires an "active" or "trialing" Stripe
// status whose current period has not yet ended; everything else — inactive
// (the default before any subscription), canceled after the period end,
// past_due (failed renewal), or a trial/subscription whose end date has
// passed — is Read-only.
//
// Founder and Enterprise are operator-managed (isManuallyManaged) and are
// NEVER read-only, exactly like the Stripe webhook guard never overwrites
// them.

export type ReadOnlyCompany = {
  plan: string;
  subscriptionStatus: string;
  subscriptionEndsAt: Date | null;
};

// Stripe statuses that grant write access — while still within their period.
const WRITABLE_STATUSES = new Set(["active", "trialing"]);

export function isReadOnly(company: ReadOnlyCompany): boolean {
  // Founder / Enterprise never enter read-only.
  if (isManuallyManaged(company.plan)) {
    return false;
  }

  if (WRITABLE_STATUSES.has(company.subscriptionStatus)) {
    // An active/trialing company whose period has already elapsed is expired
    // (a registration trial that lapsed with no Stripe subscription to
    // transition it, or a subscription that somehow ran past its end without
    // renewing) → read-only. No end date means "no known expiry" → writable.
    if (company.subscriptionEndsAt && company.subscriptionEndsAt.getTime() < Date.now()) {
      return true;
    }
    return false;
  }

  // inactive / canceled / past_due / incomplete / unpaid / … → no active paid
  // subscription and no live trial → read-only.
  return true;
}

// Minimal Prisma select for the fields isReadOnly() needs — shared so callers
// never over- or under-fetch.
export const READ_ONLY_SELECT = {
  plan: true,
  subscriptionStatus: true,
  subscriptionEndsAt: true,
} as const;
