import { API_URL, authHeaders } from "./api";
import type { OwnerNote, OwnerNoteStatus } from "../types/ownerNote";

export type OwnerNoteFilters = {
  status?: OwnerNoteStatus;
  projectId?: number;
  customerId?: number;
  date?: string; // "YYYY-MM-DD"
};

function buildQuery(filters: OwnerNoteFilters = {}): string {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.projectId) params.set("projectId", String(filters.projectId));
  if (filters.customerId) params.set("customerId", String(filters.customerId));
  if (filters.date) params.set("date", filters.date);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export async function getOwnerNotes(
  filters?: OwnerNoteFilters
): Promise<OwnerNote[]> {
  const response = await fetch(`${API_URL}/owner-notes${buildQuery(filters)}`, {
    headers: { ...authHeaders() },
  });

  if (!response.ok) {
    throw new Error("Failed to load notes");
  }

  return response.json();
}

export async function createOwnerNote(data: {
  title: string;
  content: string;
  projectId?: number | null;
  customerId?: number | null;
}): Promise<OwnerNote> {
  const response = await fetch(`${API_URL}/owner-notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Failed to create note");
  }

  return response.json();
}

export async function updateOwnerNote(
  id: number,
  data: {
    title?: string;
    content?: string;
    status?: OwnerNoteStatus;
    projectId?: number | null;
    customerId?: number | null;
  }
): Promise<OwnerNote> {
  const response = await fetch(`${API_URL}/owner-notes/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Failed to update note");
  }

  return response.json();
}
