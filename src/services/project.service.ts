import { API_URL, authHeaders } from "./api";
import type { Project } from "../types/project";

export async function getProjects(): Promise<Project[]> {
  const response = await fetch(`${API_URL}/projects`, {
    headers: { ...authHeaders() },
  });

  if (!response.ok) {
    throw new Error("Failed to load projects");
  }

  return response.json();
}

export async function createProject(data: {
  name: string;
  description?: string;
  status?: string;
  deadline?: string;
  customerId?: number;
}) {
  const response = await fetch(`${API_URL}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error("Failed to create project");
  }

  return response.json();
}

export async function updateProject(
  id: number,
  data: {
    name: string;
    description?: string;
    status: string;
    deadline?: string;
    customerId?: number;
  }
) {
  const response = await fetch(`${API_URL}/projects/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error("Failed to update project");
  }

  return response.json();
}

export async function deleteProject(id: number) {
  const response = await fetch(`${API_URL}/projects/${id}`, {
    method: "DELETE",
    headers: { ...authHeaders() },
  });

  if (!response.ok) {
    throw new Error("Failed to delete project");
  }
}

export async function assignEmployeeToProject(
  projectId: number,
  employeeId: number
) {
  const response = await fetch(`${API_URL}/projects/${projectId}/assign`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ employeeId }),
  });

  if (!response.ok) {
    throw new Error("Failed to assign employee");
  }

  return response.json();
}

export async function removeEmployeeFromProject(
  projectId: number,
  employeeId: number
) {
  const response = await fetch(
    `${API_URL}/projects/${projectId}/assign/${employeeId}`,
    { method: "DELETE", headers: { ...authHeaders() } }
  );

  if (!response.ok) {
    throw new Error("Failed to remove employee from project");
  }
}
