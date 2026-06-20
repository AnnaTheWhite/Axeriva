import { API_URL, authHeaders } from "./api";
import type {
  ProjectAttachment,
  ProjectActivityEntry,
  ProjectNote,
} from "../types/projectActivity";

export function attachmentDownloadUrl(fileUrl: string): string {
  return `${API_URL}${fileUrl}`;
}

export async function getProjectNotes(projectId: number): Promise<ProjectNote[]> {
  const response = await fetch(`${API_URL}/projects/${projectId}/notes`, {
    headers: { ...authHeaders() },
  });

  if (!response.ok) {
    throw new Error("Failed to load notes");
  }

  return response.json();
}

export async function createProjectNote(
  projectId: number,
  content: string
): Promise<ProjectNote> {
  const response = await fetch(`${API_URL}/projects/${projectId}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ content }),
  });

  if (!response.ok) {
    throw new Error("Failed to add note");
  }

  return response.json();
}

export async function getProjectAttachments(
  projectId: number
): Promise<ProjectAttachment[]> {
  const response = await fetch(`${API_URL}/projects/${projectId}/attachments`, {
    headers: { ...authHeaders() },
  });

  if (!response.ok) {
    throw new Error("Failed to load attachments");
  }

  return response.json();
}

export async function uploadProjectAttachment(
  projectId: number,
  file: File
): Promise<ProjectAttachment> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_URL}/projects/${projectId}/attachments`, {
    method: "POST",
    // No Content-Type here on purpose — the browser sets the multipart
    // boundary itself when given a FormData body.
    headers: { ...authHeaders() },
    body: formData,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to upload file");
  }

  return response.json();
}

export async function deleteProjectAttachment(id: number): Promise<void> {
  const response = await fetch(`${API_URL}/attachments/${id}`, {
    method: "DELETE",
    headers: { ...authHeaders() },
  });

  if (!response.ok) {
    throw new Error("Failed to delete attachment");
  }
}

export async function getProjectActivity(
  projectId: number
): Promise<ProjectActivityEntry[]> {
  const response = await fetch(`${API_URL}/projects/${projectId}/activity`, {
    headers: { ...authHeaders() },
  });

  if (!response.ok) {
    throw new Error("Failed to load activity");
  }

  return response.json();
}
