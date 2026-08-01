import { API_URL, authHeaders, apiFetch } from "./api";

// N1.7 — client for the notification bell and the preference screen. Same
// shape as every other service here: typed responses, apiFetch (so a stale
// session is handled centrally), and no state of its own.

export type NotificationSeverity = "info" | "success" | "warning" | "critical";

export type NotificationItem = {
  id: number;
  type: string;
  severity: NotificationSeverity;
  // Already rendered server-side in the recipient's language at delivery time
  // — the feed is a plain read, and the wording a user saw stays what they saw
  // even if the copy is later reworded. Do NOT run these through t().
  title: string;
  body: string;
  ctaLabel: string | null;
  ctaPath: string | null;
  readAt: string | null;
  createdAt: string;
};

export type NotificationFeed = {
  items: NotificationItem[];
  // Pass back as ?cursor= for the next page; null means this was the last one.
  nextCursor: number | null;
};

export type NotificationChannel = "EMAIL" | "IN_APP";

export type ChannelResolution = {
  effective: boolean;
  user: boolean | null;
  company: boolean | null;
  registry: boolean;
  blockedBy: "company_notifications_off" | "company_channel_off" | null;
};

export type CategoryResolution = {
  category: string;
  mandatory: boolean;
  optIn: boolean;
  channels: Record<string, ChannelResolution>;
};

export type NotificationPreferences = {
  channels: NotificationChannel[];
  categories: CategoryResolution[];
  company: {
    notificationsEnabled: boolean;
    emailNotificationsEnabled: boolean;
    desktopNotificationsEnabled: boolean;
  } | null;
  canEditDefaults: boolean;
};

export type PreferenceUpdate = {
  category: string;
  channel: NotificationChannel;
  // null clears the override and falls back to the level below.
  enabled: boolean | null;
};

async function readJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || fallbackMessage);
  }
  return response.json();
}

export async function getNotifications(options: {
  cursor?: number | null;
  limit?: number;
  unreadOnly?: boolean;
} = {}): Promise<NotificationFeed> {
  const params = new URLSearchParams();
  if (options.cursor) params.set("cursor", String(options.cursor));
  if (options.limit) params.set("limit", String(options.limit));
  if (options.unreadOnly) params.set("unreadOnly", "true");

  const query = params.toString();
  const response = await apiFetch(`${API_URL}/notifications${query ? `?${query}` : ""}`, {
    headers: { ...authHeaders() },
  });

  return readJson(response, "Failed to load notifications");
}

export async function getUnreadCount(): Promise<number> {
  const response = await apiFetch(`${API_URL}/notifications/unread-count`, {
    headers: { ...authHeaders() },
  });

  const body = await readJson<{ unread: number }>(response, "Failed to load unread count");
  return body.unread;
}

export async function markNotificationRead(id: number): Promise<NotificationItem> {
  const response = await apiFetch(`${API_URL}/notifications/${id}/read`, {
    method: "POST",
    headers: { ...authHeaders() },
  });

  return readJson(response, "Failed to mark notification as read");
}

export async function markAllNotificationsRead(): Promise<number> {
  const response = await apiFetch(`${API_URL}/notifications/read-all`, {
    method: "POST",
    headers: { ...authHeaders() },
  });

  const body = await readJson<{ updated: number }>(response, "Failed to mark all as read");
  return body.updated;
}

// companyId is only needed for DEVELOPER (who belongs to no company) — every
// other role is pinned server-side to their own, exactly like the company
// settings service.
function preferencesUrl(path: string, companyId?: number): string {
  const base = `${API_URL}/notifications/preferences${path}`;
  return companyId ? `${base}?companyId=${companyId}` : base;
}

export async function getNotificationPreferences(
  companyId?: number
): Promise<NotificationPreferences> {
  const response = await apiFetch(preferencesUrl("", companyId), {
    headers: { ...authHeaders() },
  });

  return readJson(response, "Failed to load notification preferences");
}

export async function updateMyNotificationPreferences(
  preferences: PreferenceUpdate[],
  companyId?: number
): Promise<NotificationPreferences> {
  const response = await apiFetch(preferencesUrl("", companyId), {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ preferences }),
  });

  return readJson(response, "Failed to save notification preferences");
}

export async function updateCompanyNotificationDefaults(
  preferences: PreferenceUpdate[],
  companyId?: number
): Promise<NotificationPreferences> {
  const response = await apiFetch(preferencesUrl("/defaults", companyId), {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ preferences }),
  });

  return readJson(response, "Failed to save company notification defaults");
}
