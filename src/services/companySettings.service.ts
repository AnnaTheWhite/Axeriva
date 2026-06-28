import { API_URL, authHeaders, apiFetch } from "./api";

export type CompanySettings = {
  id: number;
  name: string;
  logoUrl: string | null;
  billingEmail: string | null;
  contactEmail: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  taxNumber: string | null;
  vatNumber: string | null;
};

export type UpdateCompanySettingsInput = Partial<Omit<CompanySettings, "id">>;

// companyId is only needed for DEVELOPER (who belongs to no company of
// their own) — BUSINESS_OWNER is always scoped server-side to their own
// company regardless of this param.
function settingsUrl(companyId?: number): string {
  const base = `${API_URL}/company/settings`;
  return companyId ? `${base}?companyId=${companyId}` : base;
}

export async function getCompanySettings(
  companyId?: number
): Promise<CompanySettings> {
  const response = await apiFetch(settingsUrl(companyId), {
    headers: { ...authHeaders() },
  });

  if (!response.ok) {
    throw new Error("Failed to load company settings");
  }

  return response.json();
}

export async function updateCompanySettings(
  data: UpdateCompanySettingsInput,
  companyId?: number
): Promise<CompanySettings> {
  const response = await apiFetch(settingsUrl(companyId), {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error("Failed to update company settings");
  }

  return response.json();
}
