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

// Full-page navigation (e.g. to a Stripe-hosted Checkout/Portal URL). A
// plain top-level function rather than an inline `window.location.href = …`
// inside a component — the React Compiler's static analysis flags mutating
// `window` from within component/hook scope, so callers that need this from
// a component (see BillingPlansSection) call this helper instead.
export function redirectTo(url: string): void {
  window.location.href = url;
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
// S2.7 — standard error code a write endpoint returns when the company is in
// read-only mode. Also the name of the window event apiFetch fires so the
// global ReadOnly context can flip to read-only even if a control wasn't
// disabled client-side (defense in depth — the server is the real gate).
export const READ_ONLY_MODE = "READ_ONLY_MODE";
export const READ_ONLY_EVENT = "axeriva:read-only";

export async function apiFetch(
  input: string,
  init?: RequestInit
): Promise<Response> {
  const response = await fetch(input, init);

  if (response.status === 401) {
    clearSession();
    window.location.href = "/login";
    return response;
  }

  // A write rejected because the company is read-only: notify the app so the
  // global banner appears and controls disable, without every caller needing
  // to special-case it. The response is still returned so the caller's own
  // error handling runs. Cloned so reading the body here doesn't consume it.
  if (response.status === 403) {
    response
      .clone()
      .json()
      .then((body) => {
        if (body?.error === READ_ONLY_MODE) {
          window.dispatchEvent(new CustomEvent(READ_ONLY_EVENT));
        }
      })
      .catch(() => {
        /* non-JSON 403 — not a read-only signal */
      });
  }

  return response;
}
