// VITE_API_URL is read at build time — set it in the production build
// environment (e.g. Render Static Site env vars) to the deployed backend
// URL. Falls back to the local dev server when unset.
export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

export function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("token");

  return token ? { Authorization: `Bearer ${token}` } : {};
}
