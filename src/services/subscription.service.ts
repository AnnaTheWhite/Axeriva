import { API_URL, authHeaders, apiFetch } from "./api";
import type { PlanId } from "../config/pricing";

// Usage counts and S2.2 Limit Registry ceilings for the logged-in company.
// `null` in a limit means unlimited (Infinity serializes to null over JSON).
export type SubscriptionUsage = {
  projects: number;
  employees: number;
  customers: number;
  storageBytes: number;
};

export type SubscriptionLimits = {
  projects: number | null;
  employees: number | null;
  customers: number | null;
  storageBytes: number | null;
};

export type SubscriptionStatus = {
  plan: string;
  // Canonical plan (legacy "free"/"pro" already resolved to starter/
  // professional; "founder" passed through as-is) — computed server-side by
  // the same S2.2 plan-access service used for feature/limit gating. Use
  // this for display/tier comparisons instead of re-deriving it from `plan`.
  effectivePlan: PlanId | "founder";
  subscriptionStatus: string;
  subscriptionEndsAt: string | null;
  stripeSubscriptionId: string | null;
  // S2.6 — mirrors Stripe's cancel_at_period_end flag.
  cancelAtPeriodEnd: boolean;
  // S2.6 — canonical plan a scheduled period-end downgrade lands on, or null.
  pendingPlan: PlanId | null;
  // Hotfix — whether a LIVE subscription/trial is in effect right now,
  // distinct from the assigned `effectivePlan`. Drives "Current plan"
  // (active) vs "Subscribe" (assigned but expired) on the billing cards.
  hasActiveSubscription: boolean;
  hasStripeCustomer: boolean;
  usage: SubscriptionUsage;
  limits: SubscriptionLimits;
};

// Result of POST /subscription/change-plan — the backend decides what kind
// of change applies; the UI only reacts to it.
export type PlanChangeResponse =
  | { ok: true; kind: "upgraded"; plan: string }
  | { ok: true; kind: "downgrade_scheduled"; pendingPlan: string; effectiveAt: string | null }
  | { ok: true; kind: "downgrade_cancelled" }
  | { ok: true; kind: "requires_checkout" };

export async function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  const response = await apiFetch(`${API_URL}/subscription`, {
    headers: { ...authHeaders() },
  });

  if (!response.ok) {
    throw new Error("Failed to load subscription status");
  }

  return response.json();
}

async function startStripeFlow(path: string, body?: unknown): Promise<string> {
  const response = await apiFetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body ?? {}),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Failed to start checkout");
  }

  return data.url as string;
}

// Returns the Stripe Checkout URL to redirect the browser to. Passing a plan
// resolves that plan's price via the S2.3 centralized Stripe pricing config;
// omitting it keeps the legacy single-price flow (backward compatible).
export async function startCheckout(plan?: PlanId, currency?: "EUR" | "HUF"): Promise<string> {
  return startStripeFlow("/subscription/checkout", plan ? { plan, currency } : undefined);
}

// Returns the Stripe Billing Portal URL to redirect the browser to.
export async function startPortal(): Promise<string> {
  return startStripeFlow("/subscription/portal");
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await apiFetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body ?? {}),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error((data as { error?: string }).error || "Request failed");
  }

  return data as T;
}

// S2.6 — upgrade (immediate) / downgrade (scheduled at period end) / cancel a
// pending downgrade by re-selecting the current plan. When the backend
// answers `requires_checkout`, the caller falls back to startCheckout().
export async function changePlan(
  plan: PlanId,
  currency?: "EUR" | "HUF"
): Promise<PlanChangeResponse> {
  return postJson<PlanChangeResponse>("/subscription/change-plan", { plan, currency });
}

// S2.6 — cancel at period end (access continues until the paid period ends).
export async function cancelSubscription(): Promise<void> {
  await postJson("/subscription/cancel");
}

// S2.6 — resume a pending cancellation on the same Stripe subscription.
export async function resumeSubscription(): Promise<void> {
  await postJson("/subscription/resume");
}

// Reconciles the subscription status right after returning from Checkout,
// without waiting for the webhook (which may be delayed, or — on a local
// dev machine without `stripe listen` running — may never arrive at all).
export async function syncCheckoutSession(sessionId: string): Promise<void> {
  const response = await apiFetch(`${API_URL}/subscription/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ sessionId }),
  });

  if (!response.ok) {
    throw new Error("Failed to sync subscription status");
  }
}
