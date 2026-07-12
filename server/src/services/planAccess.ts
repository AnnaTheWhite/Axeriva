// Plan-access service (S2.2) — the ONLY place plan capability/limit decisions
// are made. Everything resolves through the Feature Registry, Limit Registry
// and plan tier ordering; callers pass the raw stored plan string and get a
// yes/no or a number back. No feature/limit logic lives anywhere else, and no
// code compares plan strings directly.
//
// All functions accept the raw `Company.plan` string (which may still be a
// legacy value such as "free"/"pro", or the hidden "founder" plan) and
// normalize internally, so callers never worry about plan spelling.

import {
  PLAN_IDS,
  PLAN_TIER,
  FOUNDER_TIER,
  LEGACY_PLAN_MAP,
  LEGACY_UNLIMITED_PLANS,
  FOUNDER_PLAN,
  type PlanId,
  type FounderPlan,
} from "../constants/plans";
import { FEATURES, type FeatureId } from "../constants/features";
import { LIMITS, type LimitId } from "../constants/limits";

const CANONICAL_PLANS: readonly string[] = PLAN_IDS;

// Founder is the hidden internal plan: unlimited everything, every feature.
export function isFounder(rawPlan: string | null | undefined): boolean {
  return rawPlan === FOUNDER_PLAN;
}

// Maps any stored plan string to a canonical PlanId:
//   - a canonical plan → itself
//   - a legacy value ("free"/"pro") → its mapped canonical plan
//   - anything else / null → "starter" (safe lowest tier)
export function normalizePlan(rawPlan: string | null | undefined): PlanId {
  if (rawPlan && CANONICAL_PLANS.includes(rawPlan)) return rawPlan as PlanId;
  if (rawPlan && rawPlan in LEGACY_PLAN_MAP) return LEGACY_PLAN_MAP[rawPlan];
  return "starter";
}

// The effective plan used for resolution: "founder" for the hidden plan,
// otherwise the normalized canonical plan.
export function getEffectivePlan(rawPlan: string | null | undefined): PlanId | FounderPlan {
  return isFounder(rawPlan) ? FOUNDER_PLAN : normalizePlan(rawPlan);
}

// Does this plan include the feature? Founder always does; otherwise the
// plan's tier must be >= the feature's minimum plan tier.
export function hasFeature(rawPlan: string | null | undefined, featureId: FeatureId): boolean {
  if (isFounder(rawPlan)) return true;
  const feature = FEATURES[featureId];
  return PLAN_TIER[normalizePlan(rawPlan)] >= PLAN_TIER[feature.minimumPlan];
}

// Convenience alias with the task's requested name — identical semantics to
// hasFeature (kept as an alias, not a second implementation).
export const canUseFeature = hasFeature;

// The numeric ceiling for a limit on this plan. Founder → Infinity. Legacy
// unlimited plans (e.g. "pro") also stay Infinity to preserve their current
// unlimited access until the subscription migration runs (see
// LEGACY_UNLIMITED_PLANS).
export function getLimit(rawPlan: string | null | undefined, limitId: LimitId): number {
  if (isFounder(rawPlan)) return Infinity;
  if (rawPlan && LEGACY_UNLIMITED_PLANS.includes(rawPlan)) return Infinity;
  return LIMITS[limitId][normalizePlan(rawPlan)];
}

// Is this limit unlimited on this plan?
export function isUnlimited(rawPlan: string | null | undefined, limitId: LimitId): boolean {
  return getLimit(rawPlan, limitId) === Infinity;
}

// Given current usage, is the company still under the limit (i.e. may it
// create one more)? Unlimited plans are always within limit.
export function isWithinLimit(
  rawPlan: string | null | undefined,
  limitId: LimitId,
  currentUsage: number,
): boolean {
  return currentUsage < getLimit(rawPlan, limitId);
}

// --- Plan comparison helpers ---------------------------------------------
// Future-proofing for the upgrade/downgrade flows (S2.6). Not consumed yet;
// pure tier comparisons that accept any raw plan string (legacy/founder
// tolerant). Business rules about which transitions are *offered* (e.g. no
// self-serve to founder/enterprise) live in the flow layer, not here.

// Numeric tier for any plan: Founder is above every public plan; legacy
// values normalize first.
export function getPlanTier(rawPlan: string | null | undefined): number {
  if (isFounder(rawPlan)) return FOUNDER_TIER;
  return PLAN_TIER[normalizePlan(rawPlan)];
}

// Comparator: negative if `a` is a lower tier than `b`, positive if higher,
// 0 if the same tier. Suitable for Array.prototype.sort.
export function comparePlans(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const diff = getPlanTier(a) - getPlanTier(b);
  return diff === 0 ? 0 : diff > 0 ? 1 : -1;
}

// Would moving from `from` to `to` be an upgrade (strictly higher tier)?
export function canUpgrade(
  from: string | null | undefined,
  to: string | null | undefined,
): boolean {
  return getPlanTier(to) > getPlanTier(from);
}

// Would moving from `from` to `to` be a downgrade (strictly lower tier)?
export function canDowngrade(
  from: string | null | undefined,
  to: string | null | undefined,
): boolean {
  return getPlanTier(to) < getPlanTier(from);
}
