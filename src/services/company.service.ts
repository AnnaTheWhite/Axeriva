import { API_URL, authHeaders } from "./api";

export type Company = {
  id: number;
  name: string;
  plan: string;
  subscriptionStatus: string;
};

export async function getMyCompany(companyId: number): Promise<Company> {
  const response = await fetch(`${API_URL}/companies/${companyId}`, {
    headers: { ...authHeaders() },
  });

  if (!response.ok) {
    throw new Error("Failed to load company");
  }

  return response.json();
}

export async function updateMyCompany(
  companyId: number,
  data: { name: string }
): Promise<Company> {
  const response = await fetch(`${API_URL}/companies/${companyId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error("Failed to update company");
  }

  return response.json();
}
