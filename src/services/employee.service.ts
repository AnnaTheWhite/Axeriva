import { API_URL } from "./api";

export async function getEmployees() {
  const response = await fetch(
    `${API_URL}/employees`
  );

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
}) {
  const response = await fetch(
    `${API_URL}/employees`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    }
  );

  if (!response.ok) {
    throw new Error("Failed to create employee");
  }

  return response.json();
}