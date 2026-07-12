// Canonical subscription plans (S2.2 foundation).
//
// Single source of truth for the plan set and their tier ordering. The
// Feature Registry (features.ts) and Limit Registry (limits.ts) both key off
// PlanId defined here, and the plan-access service (services/planAccess.ts)
// resolves everything through these — no code should compare plan strings
// directly (`plan === "..."`).
//
// Adding a plan later is an edit here + the two registries; nothing else.

export const PLAN_IDS = ["starter", "professional", "business", "enterprise"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

// Tier ranking used for "minimum plan" feature comparisons: a plan includes a
// feature when its tier is >= the feature's minimumPlan tier. Higher = more
// capable.
export const PLAN_TIER: Readonly<Record<PlanId, number>> = Object.freeze({
  starter: 1,
  professional: 2,
  business: 3,
  enterprise: 4,
});

// Tier assigned to the hidden Founder plan for comparison helpers — above
// every public plan (it is unlimited everything).
export const FOUNDER_TIER = 99;

// Hidden internal plan. Never public, never in PLAN_IDS (so it never appears
// in any public iteration). Handled by the plan-access service as
// "unlimited everything" — see isFounder() / getEffectivePlan().
export const FOUNDER_PLAN = "founder" as const;
export type FounderPlan = typeof FOUNDER_PLAN;

// Legacy plan values still present in the database (pre-commercial model).
// Normalized to canonical plans by the service. The one-time data migration
// that rewrites these rows is a later story (out of S2.2 scope); until then
// this keeps existing companies working. See docs/subscription-system-design.md §16.4.
export const LEGACY_PLAN_MAP: Readonly<Record<string, PlanId>> = Object.freeze({
  free: "starter",
  pro: "professional",
});

// Legacy plans whose LIMITS must stay unlimited until the subscription
// migration runs. Before the Limit Registry existed, any non-"free" plan
// (i.e. "pro", a paying customer) had no numeric ceilings. Mapping "pro" to
// professional's finite limits would silently remove that unlimited access,
// so limit resolution treats these as unlimited. Feature-tier resolution
// still normalizes "pro" → professional (no working capability is affected —
// feature gating is new and not yet enforced anywhere). This whole shim goes
// away when the migration rewrites these rows. See
// docs/subscription-system-design.md §16.4.
export const LEGACY_UNLIMITED_PLANS: readonly string[] = Object.freeze(["pro"]);
