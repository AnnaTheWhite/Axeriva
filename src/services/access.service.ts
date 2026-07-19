import { API_URL, authHeaders, apiFetch } from "./api";

export type ReadOnlyState = { readOnly: boolean };

// S2.7 — role-agnostic read-only state. Every authenticated tenant role
// (BUSINESS_OWNER and EMPLOYEE) may call this; DEVELOPER always gets false.
export async function getReadOnlyState(): Promise<ReadOnlyState> {
  const response = await apiFetch(`${API_URL}/access/read-only`, {
    headers: { ...authHeaders() },
  });

  if (!response.ok) {
    throw new Error("Failed to load access state");
  }

  return response.json();
}
