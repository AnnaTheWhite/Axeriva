import { API_URL, authHeaders } from "./api";

export async function getEmployees() {
  const response = await fetch(`${API_URL}/employees`, {
    headers: { ...authHeaders() },
  });

  if (!response.ok) {
    throw new Error("Failed to load employees");
  }

  return response.json();
}

export async function createEmployee(data: {
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
  status?: string;
}) {
  const response = await fetch(`${API_URL}/employees`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error("Failed to create employee");
  }

  return response.json();
}

export async function updateEmployeeStatus(
  id: number,
  status: string
) {
  const response = await fetch(
    `${API_URL}/employees/${id}/status`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify({ status }),
    }
  );

  if (!response.ok) {
    throw new Error("Failed to update employee status");
  }

  return response.json();
}

export async function deleteEmployee(id: number) {
  const response = await fetch(
    `${API_URL}/employees/${id}`,
    {
      method: "DELETE",
      headers: { ...authHeaders() },
    }
  );

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || "Failed to delete employee");
  }
}

export async function updateEmployee(
  id: number,
  data: {
    firstName: string;
    lastName: string;
    phone?: string;
    email?: string;
    status: string;
  }
) {
  const response = await fetch(
    `${API_URL}/employees/${id}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify(data),
    }
  );

  if (!response.ok) {
    throw new Error("Failed to update employee");
  }

  return response.json();
}
