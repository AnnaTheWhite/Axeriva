import { useEffect, useState } from "react";
import Button from "../ui/Button";
import {
  getCompanySettings,
  updateCompanySettings,
  type CompanySettings,
} from "../../services/companySettings.service";
import { useTranslation } from "../../i18n";

type FormState = {
  name: string;
  billingEmail: string;
  contactEmail: string;
  phone: string;
  website: string;
  address: string;
  taxNumber: string;
  vatNumber: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  billingEmail: "",
  contactEmail: "",
  phone: "",
  website: "",
  address: "",
  taxNumber: "",
  vatNumber: "",
};

function toFormState(settings: CompanySettings): FormState {
  return {
    name: settings.name,
    billingEmail: settings.billingEmail ?? "",
    contactEmail: settings.contactEmail ?? "",
    phone: settings.phone ?? "",
    website: settings.website ?? "",
    address: settings.address ?? "",
    taxNumber: settings.taxNumber ?? "",
    vatNumber: settings.vatNumber ?? "",
  };
}

const FIELDS: Array<{ key: keyof FormState; labelKey: string; type?: string }> = [
  { key: "name", labelKey: "settings.companyProfile.companyName" },
  { key: "billingEmail", labelKey: "settings.companyProfile.billingEmail", type: "email" },
  { key: "contactEmail", labelKey: "settings.companyProfile.contactEmail", type: "email" },
  { key: "phone", labelKey: "settings.companyProfile.phoneNumber", type: "tel" },
  { key: "website", labelKey: "settings.companyProfile.website", type: "url" },
  { key: "address", labelKey: "settings.companyProfile.address" },
  { key: "taxNumber", labelKey: "settings.companyProfile.taxNumber" },
  { key: "vatNumber", labelKey: "settings.companyProfile.vatNumber" },
];

export default function CompanyProfileSection() {
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
    setIsSaving(true);

    try {
      const updated = await updateCompanySettings(form);
      setForm(toFormState(updated));
      setMessage(t("settings.companyProfile.saved"));
    } catch {
      setMessage(t("settings.companyProfile.saveFailed"));
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return null;
  }

  return (
    <div className="mt-8 max-w-2xl rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
      <h3 className="text-lg font-semibold text-white">{t("settings.companyProfile.title")}</h3>
      <p className="mt-1 text-sm text-slate-400">
        {t("settings.companyProfile.description")}
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {FIELDS.map(({ key, labelKey, type }) => (
          <div key={key} className="space-y-2">
            <label className="block text-sm text-white/70">{t(labelKey)}</label>
            <input
              type={type ?? "text"}
              value={form[key]}
              onChange={(e) => handleChange(key, e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-orange-500"
            />
          </div>
        ))}
      </div>

      {message && <p className="mt-4 text-sm text-slate-400">{message}</p>}

      <div className="mt-6">
        <Button onClick={handleSave}>{isSaving ? t("common.saving") : t("common.save")}</Button>
      </div>
    </div>
  );
}
