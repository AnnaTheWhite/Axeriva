import { API_URL, authHeaders, apiFetch } from "./api";

export type SubscriptionStatus = {
  plan: string;
  subscriptionStatus: string;
  subscriptionEndsAt: string | null;
  stripeSubscriptionId: string | null;
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

async function startStripeFlow(path: string): Promise<string> {
  const response = await apiFetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { ...authHeaders() },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Failed to start checkout");
  }

  return data.url as string;
}

// Returns the Stripe Checkout URL to redirect the browser to.
export async function startCheckout(): Promise<string> {
  return startStripeFlow("/subscription/checkout");
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
