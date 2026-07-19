import { useEffect, useState } from "react";
import Button from "../ui/Button";
import CustomSelect from "../ui/CustomSelect";
import {
  getCompanySettings,
  updateCompanySettings,
  type CompanySettings,
} from "../../services/companySettings.service";
import { useTranslation, LANGUAGES } from "../../i18n";
import { useWriteGuard } from "../../hooks/useWriteGuard";
import { useIsOwner } from "../../hooks/useIsOwner";

// C1.4 — a curated set of common IANA timezones (a full tz-database
// dropdown would be hundreds of entries for no real benefit here); the
// server still accepts any well-formed IANA name (services/companyValidation.ts),
// this list just covers the common cases in the picker.
const TIMEZONES = [
  "UTC",
  "Europe/Budapest",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Warsaw",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];

const CURRENCIES = ["EUR", "HUF", "USD", "GBP", "CHF", "PLN", "RON"];
const DATE_FORMATS = ["yyyy-MM-dd", "dd/MM/yyyy", "MM/dd/yyyy"] as const;
const TIME_FORMATS = ["24h", "12h"] as const;

type FormState = {
  language: string;
  currency: string;
  timezone: string;
  dateFormat: string;
  timeFormat: string;
};

function toFormState(settings: CompanySettings, fallbackLanguage: string): FormState {
  return {
    language: settings.language ?? fallbackLanguage,
    currency: settings.currency ?? "",
    timezone: settings.timezone ?? "",
    dateFormat: settings.dateFormat ?? DATE_FORMATS[0],
    timeFormat: settings.timeFormat ?? TIME_FORMATS[0],
  };
}

export default function LocalizationSection() {
  const { t, language: activeLanguage, setLanguage } = useTranslation();
  const { readOnly } = useWriteGuard();
  const isOwner = useIsOwner();
  const disabled = readOnly || !isOwner;

  const [form, setForm] = useState<FormState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    getCompanySettings()
      .then((settings) => setForm(toFormState(settings, activeLanguage)))
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function handleSave() {
    if (!form) return;
    setMessage(null);
    setIsSaving(true);

    try {
      const updated = await updateCompanySettings(form);
      setForm(toFormState(updated, activeLanguage));
      // "Changing settings must immediately update the UI where
      // applicable" — flips the current session's language right away via
      // the existing LanguageProvider, reusing its own public setter
      // (no changes to the language system itself).
      if (updated.language && (updated.language === "en" || updated.language === "hu")) {
        setLanguage(updated.language);
      }
      setMessage(t("settings.localization.saved"));
    } catch {
      setMessage(t("settings.localization.saveFailed"));
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading || !form) {
    return null;
  }

  return (
    <div className="mt-8 max-w-2xl rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
      <h3 className="text-lg font-semibold text-white">{t("settings.localization.title")}</h3>
      <p className="mt-1 text-sm text-slate-400">{t("settings.localization.description")}</p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label className="block text-sm text-white/70">{t("settings.localization.language")}</label>
          <CustomSelect
            value={form.language}
            onChange={(value) => update("language", value)}
            options={LANGUAGES.map((code) => ({ value: code, label: t(`settings.localization.languages.${code}`) }))}
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm text-white/70">{t("settings.localization.currency")}</label>
          <CustomSelect
            value={form.currency}
            onChange={(value) => update("currency", value)}
            options={CURRENCIES.map((code) => ({ value: code, label: code }))}
            placeholder={t("settings.localization.currencyPlaceholder")}
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <label className="block text-sm text-white/70">{t("settings.localization.timezone")}</label>
          <CustomSelect
            value={form.timezone}
            onChange={(value) => update("timezone", value)}
            options={TIMEZONES.map((tz) => ({ value: tz, label: tz }))}
            placeholder={t("settings.localization.timezonePlaceholder")}
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm text-white/70">{t("settings.localization.dateFormat")}</label>
          <CustomSelect
            value={form.dateFormat}
            onChange={(value) => update("dateFormat", value)}
            options={DATE_FORMATS.map((fmt) => ({ value: fmt, label: fmt }))}
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm text-white/70">{t("settings.localization.timeFormat")}</label>
          <CustomSelect
            value={form.timeFormat}
            onChange={(value) => update("timeFormat", value)}
            options={[
              { value: "24h", label: t("settings.localization.timeFormat24h") },
              { value: "12h", label: t("settings.localization.timeFormat12h") },
            ]}
          />
        </div>
      </div>

      {message && <p className="mt-4 text-sm text-slate-400">{message}</p>}

      {isOwner && (
        <div className="mt-6">
          <Button onClick={handleSave} disabled={disabled || isSaving} title={readOnly ? t("readOnly.tooltip") : undefined}>
            {isSaving ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      )}
    </div>
  );
}
