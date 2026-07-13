import { PUBLIC_PLAN_IDS, type PlanId } from "../../config/pricing";

// Frontend DISPLAY-ONLY helper for Billing Settings tier comparisons
// (Upgrade vs Downgrade button labeling). Takes the already-resolved
// `effectivePlan` from the /subscription response (server-computed by the
// S2.2 plan-access service's getEffectivePlan — legacy "free"/"pro" already
// normalized there) — this file does NOT re-implement that mapping.
//
// Tier is derived from PUBLIC_PLAN_IDS' order (the single centralized plan
// list, config/pricing.ts) — starter=1 … enterprise=4. Founder sorts above
// every public plan (99 is an arbitrary "higher than all" sentinel used only
// to disable Upgrade/Downgrade comparisons; not a billing value).
export function displayPlanTier(id: PlanId | "founder"): number {
  if (id === "founder") return 99;
  const index = PUBLIC_PLAN_IDS.indexOf(id);
  return index === -1 ? 1 : index + 1;
}
