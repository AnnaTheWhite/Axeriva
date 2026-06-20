import { API_URL, authHeaders } from "./api";

export async function getShifts() {
  const response = await fetch(
    `${API_URL}/shifts`,
    { headers: { ...authHeaders() } }
  );

  if (!response.ok) {
    throw new Error(
      "Failed to load shifts"
    );
  }

  return response.json();
}

export async function createShift(data: {
  employeeId: number;
  projectId: number | null;
  start: string;
  end: string;
  notes: string;
}) {
  const response = await fetch(
    `${API_URL}/shifts`,
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify(data),
    }
  );

  if (!response.ok) {
    throw new Error(
      "Failed to create shift"
    );
  }

  return response.json();
}

export async function updateShift(
  id: number,
  data: {
    employeeId: number;
    projectId: number | null;
    start: string;
    end: string;
    notes: string;
  }
) {
  const response = await fetch(
    `${API_URL}/shifts/${id}`,
    {
      method: "PUT",
      headers: {
        "Content-Type":
          "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify(data),
    }
  );

  if (!response.ok) {
    throw new Error(
      "Failed to update shift"
    );
  }

  return response.json();
}

export async function deleteShift(
  id: number
) {
  const response = await fetch(
    `${API_URL}/shifts/${id}`,
    {
      method: "DELETE",
      headers: { ...authHeaders() },
    }
  );

  if (!response.ok) {
    throw new Error(
      "Failed to delete shift"
    );
  }

  return true;
}

export async function getMyShifts() {
  const response = await fetch(`${API_URL}/shifts/me`, {
    headers: { ...authHeaders() },
  });

  if (!response.ok) {
    throw new Error("Failed to load my shifts");
  }

  return response.json();
}

export async function clockIn(projectId: number) {
  const response = await fetch(`${API_URL}/shifts/clock-in`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ projectId }),
  });

  if (!response.ok) {
    throw new Error("Failed to clock in");
  }

  return response.json();
}

export async function clockOut() {
  const response = await fetch(`${API_URL}/shifts/clock-out`, {
    method: "POST",
    headers: { ...authHeaders() },
  });

  if (!response.ok) {
    throw new Error("Failed to clock out");
  }

  return response.json();
}

export type ProjectHours = {
  projectId: number;
  projectName: string;
  hours: number;
};

export async function getHoursByProject(): Promise<ProjectHours[]> {
  const response = await fetch(`${API_URL}/shifts/hours-by-project`, {
    headers: { ...authHeaders() },
  });

  if (!response.ok) {
    throw new Error("Failed to load hours by project");
  }

  return response.json();
}
