import { API_URL, authHeaders, apiFetch } from "./api";

// Admin Analytics & User Activity dashboard client. Mirrors the
// /admin/analytics/* endpoints (DEVELOPER only). Same apiFetch + authHeaders
// convention as admin.service.ts.

export type AnalyticsOverview = {
  totalUsers: number;
  activeUsers: { today: number; sevenDays: number; thirtyDays: number };
  newRegistrations: number;
  companies: number;
  projects: number;
  employees: number;
  customers: number;
  activeSubscriptions: number;
  plans: { free: number; pro: number; enterprise: number };
};

export type UserStatus = "active" | "inactive" | "never";

export type AnalyticsUserRow = {
  id: number;
  email: string;
  role: string;
  company: { id: number; name: string } | null;
  plan: string | null;
  subscriptionStatus: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  emailVerified: boolean;
  projectCount: number;
  employeeCount: number;
  customerCount: number;
  status: UserStatus;
};

export type AnalyticsUsersPage = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  users: AnalyticsUserRow[];
};

export type AnalyticsUserDetails = {
  id: number;
  email: string;
  role: string;
  emailVerified: boolean;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  isEmployee: boolean;
  company: {
    id: number;
    name: string;
    plan: string;
    subscriptionStatus: string;
    subscriptionEndsAt: string | null;
    createdAt: string;
    contactEmail: string | null;
    phone: string | null;
    website: string | null;
  } | null;
  usage: { projects: number; employees: number; customers: number; storageBytes: number };
};

export type ActivityEvent = { type: string; timestamp: string; label?: string };

export async function getAnalyticsOverview(): Promise<AnalyticsOverview> {
  const response = await apiFetch(`${API_URL}/admin/analytics/overview`, {
    headers: { ...authHeaders() },
  });
  if (!response.ok) throw new Error("Failed to load analytics overview");
  return response.json();
}

export type UsersQuery = {
  page?: number;
  pageSize?: number;
  search?: string;
  role?: string;
  status?: string;
  plan?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
};

export async function getAnalyticsUsers(query: UsersQuery): Promise<AnalyticsUsersPage> {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });

  const response = await apiFetch(`${API_URL}/admin/analytics/users?${params.toString()}`, {
    headers: { ...authHeaders() },
  });
  if (!response.ok) throw new Error("Failed to load users");
  return response.json();
}

export async function getAnalyticsUserDetails(id: number): Promise<AnalyticsUserDetails> {
  const response = await apiFetch(`${API_URL}/admin/analytics/users/${id}`, {
    headers: { ...authHeaders() },
  });
  if (!response.ok) throw new Error("Failed to load user details");
  return response.json();
}

export async function getAnalyticsUserActivity(id: number): Promise<ActivityEvent[]> {
  const response = await apiFetch(`${API_URL}/admin/analytics/users/${id}/activity`, {
    headers: { ...authHeaders() },
  });
  if (!response.ok) throw new Error("Failed to load user activity");
  const data = await response.json();
  return data.events;
}
