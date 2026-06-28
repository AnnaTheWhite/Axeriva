import { API_URL, authHeaders, apiFetch } from "./api";

export type AdminCompany = {
  id: number;
  name: string;
  plan: string;
  subscriptionStatus: string;
  createdAt: string;
  _count: { users: number; employees: number };
};

export type AdminUser = {
  id: number;
  email: string;
  role: string;
  companyId: number | null;
  createdAt: string;
};

export async function getAdminCompanies(): Promise<AdminCompany[]> {
  const response = await apiFetch(`${API_URL}/admin/companies`, {
    headers: { ...authHeaders() },
  });

  if (!response.ok) {
    throw new Error("Failed to load companies");
  }

  return response.json();
}

export async function getAdminUsers(): Promise<AdminUser[]> {
  const response = await apiFetch(`${API_URL}/admin/users`, {
    headers: { ...authHeaders() },
  });

  if (!response.ok) {
    throw new Error("Failed to load users");
  }

  return response.json();
}

export type AuditLogEntry = {
  id: number;
  action: string;
  userId: number | null;
  companyId: number | null;
  companyName: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export async function getAdminLogs(): Promise<AuditLogEntry[]> {
  const response = await apiFetch(`${API_URL}/admin/logs`, {
    headers: { ...authHeaders() },
  });

  if (!response.ok) {
    throw new Error("Failed to load logs");
  }

  return response.json();
}
