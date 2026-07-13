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
  hasStripeCustomer: boolean;
  usage: SubscriptionUsage;
  limits: SubscriptionLimits;
};

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
