import { API_URL, authHeaders } from "./api";

export type SubscriptionStatus = {
  plan: string;
  subscriptionStatus: string;
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

// Will redirect to a Stripe Checkout session once payments are wired up.
export async function startCheckout(): Promise<never> {
  const response = await fetch(`${API_URL}/subscription/checkout`, {
    method: "POST",
    headers: { ...authHeaders() },
  });

  const data = await response.json().catch(() => ({}));

  throw new Error(data.error || "Failed to start checkout");
}
