import { useEffect, useState } from "react";
import Button from "../ui/Button";
import {
  getCompanySettings,
  updateCompanySettings,
  exportCompanySettings,
  CompanySettingsValidationError,
  type CompanySettings,
  type CompanySettingsFieldErrors,
} from "../../services/companySettings.service";
import { useTranslation } from "../../i18n";
import { useWriteGuard } from "../../hooks/useWriteGuard";
import { useIsOwner } from "../../hooks/useIsOwner";

type FormState = {
  name: string;
  legalName: string;
  vatNumber: string;
  registrationNumber: string;
  contactEmail: string;
  billingEmail: string;
  phone: string;
  website: string;
  address: string;
  postalCode: string;
  city: string;
  country: string;
  taxNumber: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  legalName: "",
  vatNumber: "",
  registrationNumber: "",
  contactEmail: "",
  billingEmail: "",
  phone: "",
  website: "",
  address: "",
  postalCode: "",
  city: "",
  country: "",
  taxNumber: "",
};

function toFormState(settings: CompanySettings): FormState {
  return {
    name: settings.name,
    legalName: settings.legalName ?? "",
    vatNumber: settings.vatNumber ?? "",
    registrationNumber: settings.registrationNumber ?? "",
    contactEmail: settings.contactEmail ?? "",
    billingEmail: settings.billingEmail ?? "",
    phone: settings.phone ?? "",
    website: settings.website ?? "",
    address: settings.address ?? "",
    postalCode: settings.postalCode ?? "",
    city: settings.city ?? "",
    country: settings.country ?? "",
    taxNumber: settings.taxNumber ?? "",
  };
}

// C1.1 — every profile field this section manages. Adding a field is one
// row here (plus the FormState/toFormState entries above) — no per-field
// JSX is hand-written.
const FIELDS: Array<{ key: keyof FormState; labelKey: string; type?: string }> = [
  { key: "name", labelKey: "settings.companyProfile.companyName" },
  { key: "legalName", labelKey: "settings.companyProfile.legalName" },
  { key: "vatNumber", labelKey: "settings.companyProfile.vatNumber" },
  { key: "registrationNumber", labelKey: "settings.companyProfile.registrationNumber" },
  { key: "contactEmail", labelKey: "settings.companyProfile.contactEmail", type: "email" },
  { key: "billingEmail", labelKey: "settings.companyProfile.billingEmail", type: "email" },
  { key: "phone", labelKey: "settings.companyProfile.phoneNumber", type: "tel" },
  { key: "website", labelKey: "settings.companyProfile.website", type: "url" },
  { key: "address", labelKey: "settings.companyProfile.address" },
  { key: "postalCode", labelKey: "settings.companyProfile.postalCode" },
  { key: "city", labelKey: "settings.companyProfile.city" },
  { key: "country", labelKey: "settings.companyProfile.country" },
  { key: "taxNumber", labelKey: "settings.companyProfile.taxNumber" },
];

// Lightweight client-side checks — UX only, so the owner sees a problem
// before submitting. The server (services/companyValidation.ts) is the real,
// authoritative gate; this never replaces it.
function validateClientSide(form: FormState): CompanySettingsFieldErrors {
  const errors: CompanySettingsFieldErrors = {};
  if (!form.name.trim()) errors.name = "Company name is required.";
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (form.contactEmail && !emailRe.test(form.contactEmail)) {
    errors.contactEmail = "Enter a valid email address.";
  }
  if (form.billingEmail && !emailRe.test(form.billingEmail)) {
    errors.billingEmail = "Enter a valid email address.";
  }
  if (form.website && !/^https?:\/\/[^\s]+\.[^\s]+$/.test(form.website)) {
    errors.website = "Enter a valid URL (starting with http:// or https://).";
  }
  return errors;
}

export default function CompanyProfileSection() {
  const { t } = useTranslation();
  const { readOnly } = useWriteGuard();
  const isOwner = useIsOwner();
  const disabled = readOnly || !isOwner;

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<CompanySettingsFieldErrors>({});

  useEffect(() => {
    getCompanySettings()
      .then((settings) => setForm(toFormState(settings)))
      .finally(() => setIsLoading(false));
  }, []);

  function handleChange(key: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setMessage(null);

    const clientErrors = validateClientSide(form);
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      return;
    }
    setFieldErrors({});
    setIsSaving(true);

    try {
      const updated = await updateCompanySettings(form);
      setForm(toFormState(updated));
      setMessage(t("settings.companyProfile.saved"));
    } catch (error) {
      if (error instanceof CompanySettingsValidationError) {
        setFieldErrors(error.fields);
      }
      setMessage(t("settings.companyProfile.saveFailed"));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleExport() {
    setIsExporting(true);
    try {
      await exportCompanySettings();
    } catch {
      setMessage(t("settings.export.failed"));
    } finally {
      setIsExporting(false);
    }
  }

  if (isLoading) {
    return null;
  }

  return (
    <div className="mt-8 max-w-2xl rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-white">{t("settings.companyProfile.title")}</h3>
          <p className="mt-1 text-sm text-slate-400">
            {t("settings.companyProfile.description")}
          </p>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={isExporting}
          className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/10 disabled:opacity-50"
        >
          {isExporting ? t("settings.export.exporting") : t("settings.export.button")}
        </button>
      </div>

      {!isOwner && (
        <p className="mt-4 rounded-lg bg-white/5 px-3 py-2 text-xs text-slate-400">
          {t("settings.readOnlyForRole")}
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {FIELDS.map(({ key, labelKey, type }) => (
          <div key={key} className="space-y-2">
            <label className="block text-sm text-white/70">{t(labelKey)}</label>
            <input
              type={type ?? "text"}
              value={form[key]}
              onChange={(e) => handleChange(key, e.target.value)}
              disabled={disabled}
              title={readOnly ? t("readOnly.tooltip") : undefined}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
            />
            {fieldErrors[key] && <p className="text-xs text-red-400">{fieldErrors[key]}</p>}
          </div>
        ))}
      </div>

      {message && <p className="mt-4 text-sm text-slate-400">{message}</p>}

      {isOwner && (
        <div className="mt-6">
          <Button onClick={handleSave} disabled={disabled} title={readOnly ? t("readOnly.tooltip") : undefined}>
            {isSaving ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      )}
    </div>
  );
}
