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

// Does the company have a LIVE subscription or trial right now? True only for
// an "active"/"trialing" status whose period has not yet elapsed. This is the
// "active subscription" half of the eligibility rule — deliberately separate
// from the "assigned plan" (company.plan), so the billing UI and the
// plan-change service can tell "on Starter, actively subscribed" apart from
// "assigned Starter but the trial/subscription has ended" (the re-subscribe
// case). Ignores the plan value, so it is meaningful for founder/enterprise
// too (their status is managed separately via isManuallyManaged).
export function hasActiveSubscription(company: ReadOnlyCompany): boolean {
  if (!WRITABLE_STATUSES.has(company.subscriptionStatus)) {
    return false;
  }
  // No end date means "no known expiry" → still live. An elapsed end date
  // means the trial/subscription has expired (e.g. a registration trial that
  // lapsed with no Stripe subscription to transition it).
  return !(company.subscriptionEndsAt && company.subscriptionEndsAt.getTime() < Date.now());
}

export function isReadOnly(company: ReadOnlyCompany): boolean {
  // Founder / Enterprise never enter read-only.
  if (isManuallyManaged(company.plan)) {
    return false;
  }

  // Read-only exactly when there is no active paid subscription and no live
  // trial. (Same rule as before, expressed through the shared helper.)
  return !hasActiveSubscription(company);
}

// Minimal Prisma select for the fields isReadOnly() needs — shared so callers
// never over- or under-fetch.
export const READ_ONLY_SELECT = {
  plan: true,
  subscriptionStatus: true,
  subscriptionEndsAt: true,
} as const;
