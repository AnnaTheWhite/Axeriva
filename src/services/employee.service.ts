import { API_URL, authHeaders, apiFetch } from "./api";

export async function getEmployees() {
  const response = await apiFetch(`${API_URL}/employees`, {
    headers: { ...authHeaders() },
  });

  if (!response.ok) {
    throw new Error("Failed to load employees");
  }

  return response.json();
}

// No createEmployee here by design — employees may only enter the system
// through the invitation flow (see invites.service.ts createInvite). This
// is a permanent product rule; do not reintroduce manual creation.

export async function updateEmployeeStatus(
  id: number,
  status: string
) {
  const response = await apiFetch(
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

// B1 — revokes the employee's login (User.active=false + token kill) while
// leaving the Employee row, status and shift history untouched. Note the
// separate /employee-access prefix: the endpoint deliberately works in
// read-only mode too, so it lives outside the /employees write guard.
export async function revokeEmployeeAccess(id: number, confirmation: string) {
  const response = await apiFetch(
    `${API_URL}/employee-access/${id}/revoke`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify({ confirmation }),
    }
  );

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || "Failed to revoke access");
  }

  return response.json();
}

export async function deleteEmployee(id: number) {
  const response = await apiFetch(
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
  const response = await apiFetch(
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
