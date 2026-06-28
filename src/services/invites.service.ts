import { API_URL, authHeaders, apiFetch } from "./api";

export type Invitation = {
  id: number;
  email: string;
  token: string;
  role: string;
  companyId: number;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
  inviteLink?: string;
};

export async function createInvite(email: string): Promise<Invitation> {
  const response = await apiFetch(`${API_URL}/invites`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to create invite");
  }

  return response.json();
}

export async function getInvites(): Promise<Invitation[]> {
  const response = await apiFetch(`${API_URL}/invites`, {
    headers: { ...authHeaders() },
  });

  if (!response.ok) {
    throw new Error("Failed to load invites");
  }

  return response.json();
}

export async function revokeInvite(id: number): Promise<void> {
  const response = await apiFetch(`${API_URL}/invites/${id}`, {
    method: "DELETE",
    headers: { ...authHeaders() },
  });

  if (!response.ok) {
    throw new Error("Failed to revoke invite");
  }
}

// Public — looked up by an unauthenticated visitor following the invite
// link, before they have any session. Intentionally left on plain
// `fetch`, not apiFetch: there's no token to invalidate here, and a 401
// would be an unexpected/irrelevant case to route through the
// authenticated-session "clear and redirect to /login" behavior.
export async function getInviteByToken(
  token: string
): Promise<{ email: string; companyName: string }> {
  const response = await fetch(`${API_URL}/invites/${token}`);

  if (!response.ok) {
    throw new Error("Invitation not found or expired");
  }

  return response.json();
}

// Public — same reasoning as getInviteByToken above.
export async function acceptInvite(
  token: string,
  data: { firstName: string; lastName: string; password: string }
) {
  const response = await fetch(`${API_URL}/invites/${token}/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error("Failed to accept invitation");
  }

  return response.json();
}
