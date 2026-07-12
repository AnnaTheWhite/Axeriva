// Limit Registry (S2.2) — the single, immutable source of truth for every
// numeric plan ceiling, per canonical plan.
//
// Consumed via services/planAccess.ts (getLimit / isUnlimited / isWithinLimit)
// — code must never hardcode per-plan numbers. Unlimited is represented as
// `Infinity`, which compares cleanly (`usage < Infinity` is always true) and
// is detected by isUnlimited().
//
// Adding a limit later means adding ONE row here; nothing else.

import type { PlanId } from "./plans";

const GB = 1024 ** 3;

export const LIMIT_IDS = [
  "projects",
  "employees",
  "customers",
  "storage", // bytes
  "admin_users",
  "api_requests", // per month
  "locations",
  "automation_rules",
] as const;

export type LimitId = (typeof LIMIT_IDS)[number];

// Per-plan ceilings. `Infinity` = unlimited. Employee/project/customer numbers
// are generous fair-use guardrails (the product is billed per company, never
// per unit). Storage is in bytes.
function freezeLimits<T extends Record<string, object>>(limits: T): Readonly<T> {
  for (const value of Object.values(limits)) {
    Object.freeze(value);
  }
  return Object.freeze(limits);
}

export const LIMITS: Readonly<Record<LimitId, Readonly<Record<PlanId, number>>>> = freezeLimits({
  projects: { starter: 25, professional: 250, business: 2500, enterprise: Infinity },
  employees: { starter: 10, professional: 50, business: 200, enterprise: Infinity },
  customers: { starter: 100, professional: 1000, business: 10000, enterprise: Infinity },
  storage: { starter: 5 * GB, professional: 25 * GB, business: 100 * GB, enterprise: Infinity },
  admin_users: { starter: 1, professional: 3, business: 10, enterprise: Infinity },
  api_requests: { starter: 0, professional: 50000, business: 200000, enterprise: Infinity },
  locations: { starter: 1, professional: 1, business: 10, enterprise: Infinity },
  automation_rules: { starter: 0, professional: 0, business: 50, enterprise: Infinity },
});
