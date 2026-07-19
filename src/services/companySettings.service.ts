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
  // C1.1
  legalName: string | null;
  registrationNumber: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  // C1.3
  primaryColor: string | null;
  accentColor: string | null;
  // C1.4
  language: string | null;
  currency: string | null;
  timezone: string | null;
  dateFormat: string | null;
  timeFormat: string | null;
  // C1.5
  firstDayOfWeek: number | null;
  defaultWorkStart: string | null;
  defaultWorkEnd: string | null;
  defaultShiftMinutes: number | null;
  notificationsEnabled: boolean;
  emailNotificationsEnabled: boolean;
  desktopNotificationsEnabled: boolean;
};

export type UpdateCompanySettingsInput = Partial<Omit<CompanySettings, "id" | "logoUrl">>;

// Server-side field validation errors (PUT /company/settings 400 response).
export type CompanySettingsFieldErrors = Record<string, string>;

export class CompanySettingsValidationError extends Error {
  fields: CompanySettingsFieldErrors;
  constructor(fields: CompanySettingsFieldErrors) {
    super("Validation failed");
    this.fields = fields;
  }
}

// companyId is only needed for DEVELOPER (who belongs to no company of
// their own) — BUSINESS_OWNER/EMPLOYEE are always scoped server-side to
// their own company regardless of this param.
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
    const body = await response.json().catch(() => ({}));
    if (response.status === 400 && body.fields) {
      throw new CompanySettingsValidationError(body.fields);
    }
    throw new Error(body.error || "Failed to update company settings");
  }

  return response.json();
}

// C1.2 — logo upload/replace/remove. Reuses the same apiFetch/authHeaders
// convention as every other service; multipart requests must NOT set a
// Content-Type header themselves (the browser sets the multipart boundary).
export async function uploadCompanyLogo(
  file: File,
  companyId?: number
): Promise<CompanySettings> {
  const formData = new FormData();
  formData.append("logo", file);

  const response = await apiFetch(`${API_URL}/company/logo${companyId ? `?companyId=${companyId}` : ""}`, {
    method: "POST",
    headers: { ...authHeaders() },
    body: formData,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Failed to upload logo");
  }

  return response.json();
}

export async function removeCompanyLogo(companyId?: number): Promise<CompanySettings> {
  const response = await apiFetch(`${API_URL}/company/logo${companyId ? `?companyId=${companyId}` : ""}`, {
    method: "DELETE",
    headers: { ...authHeaders() },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Failed to remove logo");
  }

  return response.json();
}

// Resolves a stored logoUrl for <img src>. Handles both the current
// on-disk convention (a root-relative "/uploads/logos/…" path, prefixed with
// API_URL like every other upload in this app) and a legacy base64 data URL
// (companies whose logo was saved before this module existed) — used as-is,
// no prefix needed.
export function companyLogoUrl(logoUrl: string | null): string | null {
  if (!logoUrl) return null;
  return logoUrl.startsWith("data:") ? logoUrl : `${API_URL}${logoUrl}`;
}

// C1.6 — triggers a browser download of the company's settings as JSON.
export async function exportCompanySettings(companyId?: number): Promise<void> {
  const response = await apiFetch(`${API_URL}/company/export${companyId ? `?companyId=${companyId}` : ""}`, {
    headers: { ...authHeaders() },
  });

  if (!response.ok) {
    throw new Error("Failed to export company settings");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `axeriva-company-settings-${companyId ?? "me"}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// C1.7 — archive the company (BUSINESS_OWNER only; disables login for every
// user of the company, preserves all data).
export async function archiveCompany(password: string, confirmation: string): Promise<void> {
  const response = await apiFetch(`${API_URL}/company/archive`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ password, confirmation }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Failed to archive company");
  }
}
