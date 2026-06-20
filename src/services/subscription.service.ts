import { API_URL, authHeaders } from "./api";

export type SubscriptionStatus = {
  plan: string;
  subscriptionStatus: string;
  subscriptionEndsAt: string | null;
  stripeSubscriptionId: string | null;
};

export async function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  const response = await fetch(`${API_URL}/subscription`, {
    headers: { ...authHeaders() },
  });

  if (!response.ok) {
    throw new Error("Failed to load subscription status");
  }

  return response.json();
}

async function startStripeFlow(path: string): Promise<string> {
  const response = await fetch(`${API_URL}${path}`, {
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
