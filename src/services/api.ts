export const API_URL = "http://localhost:5000";

export function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("token");

  return token ? { Authorization: `Bearer ${token}` } : {};
}
