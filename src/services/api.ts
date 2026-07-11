// VITE_API_URL is read at build time — set it in the production build
// environment (e.g. Render Static Site env vars) to the deployed backend
// URL. Falls back to the local dev server when unset.
export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

// A production build without VITE_API_URL would silently talk to localhost —
// every API call would fail for real users. Surface it loudly in the browser
// console so a misconfigured deploy is diagnosable in seconds.
if (import.meta.env.PROD && !import.meta.env.VITE_API_URL) {
  console.error(
    "[config] VITE_API_URL was not set at build time — API calls will target http://localhost:5000. " +
      "Rebuild with VITE_API_URL set to the deployed backend URL (see docs/render-deployment.md)."
  );
}

export function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("token");

  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Clears the locally persisted session. Shared by AuthContext's logout()
// and apiFetch's automatic 401 handling below, so "what counts as logging
// out" lives in exactly one place instead of being duplicated.
export function clearSession(): void {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
}

// Drop-in replacement for `fetch`, for authenticated requests only (any
// call sending authHeaders()). If the server responds 401 — expired
// token, malformed token, or a soft-deleted account caught by the auth
// middleware's active-user check — the stored session is no longer valid
// anywhere in the app, so we clear it and send the user to the login page
// instead of leaving every protected page silently broken.
//
// Deliberately NOT used by the public, unauthenticated auth endpoints in
// auth.service.ts (login, register, verify-email, forgot-password,
// reset-password) or by the public invite-lookup/accept calls in
// invites.service.ts — login returns 401 for a plain wrong-password
// attempt, which is a normal form-validation outcome, not a
// session-invalidity signal, and redirecting/reloading there would wipe
// the on-screen error message before the user ever saw it.
export async function apiFetch(
  input: string,
  init?: RequestInit
): Promise<Response> {
  const response = await fetch(input, init);

  if (response.status === 401) {
    clearSession();
    window.location.href = "/login";
  }

  return response;
}
