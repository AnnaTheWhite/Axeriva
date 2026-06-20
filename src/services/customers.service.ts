import { API_URL, authHeaders } from "./api";

export type Customer = {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  createdAt?: string;
  updatedAt?: string;
};

export async function getCustomers(): Promise<Customer[]> {
  const res = await fetch(`${API_URL}/customers`, {
    headers: { ...authHeaders() },
  });

  if (!res.ok) {
    throw new Error("Failed to load customers");
  }

  return res.json();
}

export async function createCustomer(data: {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
}): Promise<Customer> {
  const res = await fetch(`${API_URL}/customers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    throw new Error("Failed to create customer");
  }

  return res.json();
}

export async function updateCustomer(
  id: number,
  data: {
    name: string;
    email?: string;
    phone?: string;
    address?: string;
  }
): Promise<Customer> {
  const res = await fetch(`${API_URL}/customers/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    throw new Error("Failed to update customer");
  }

  return res.json();
}

export async function deleteCustomer(id: number): Promise<void> {
  const res = await fetch(`${API_URL}/customers/${id}`, {
    method: "DELETE",
    headers: { ...authHeaders() },
  });

  if (!res.ok) {
    throw new Error("Failed to delete customer");
  }
  // 204 No Content — no body to parse
}
