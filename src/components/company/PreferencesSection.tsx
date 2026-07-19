import { useEffect, useState } from "react";
import Button from "../ui/Button";
import CustomSelect from "../ui/CustomSelect";
import TimePicker from "../ui/TimePicker";
import {
  getCompanySettings,
  updateCompanySettings,
  type CompanySettings,
} from "../../services/companySettings.service";
import { useTranslation } from "../../i18n";
import { useWriteGuard } from "../../hooks/useWriteGuard";
import { useIsOwner } from "../../hooks/useIsOwner";

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

type FormState = {
  firstDayOfWeek: number;
  defaultWorkStart: string;
  defaultWorkEnd: string;
  defaultShiftMinutes: string;
  notificationsEnabled: boolean;
  emailNotificationsEnabled: boolean;
  desktopNotificationsEnabled: boolean;
};

function toFormState(settings: CompanySettings): FormState {
  return {
    firstDayOfWeek: settings.firstDayOfWeek ?? 1,
    defaultWorkStart: settings.defaultWorkStart ?? "09:00",
    defaultWorkEnd: settings.defaultWorkEnd ?? "17:00",
    defaultShiftMinutes: String(settings.defaultShiftMinutes ?? 480),
    notificationsEnabled: settings.notificationsEnabled,
    emailNotificationsEnabled: settings.emailNotificationsEnabled,
    desktopNotificationsEnabled: settings.desktopNotificationsEnabled,
  };
}

export default function PreferencesSection() {
  const { t } = useTranslation();
  const { readOnly } = useWriteGuard();
  const isOwner = useIsOwner();
  const disabled = readOnly || !isOwner;

  const [form, setForm] = useState<FormState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCompanySettings()
      .then((settings) => setForm(toFormState(settings)))
      .finally(() => setIsLoading(false));
  }, []);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function handleSave() {
    if (!form) return;
    setMessage(null);
    setError(null);

    const shiftMinutes = Number(form.defaultShiftMinutes);
    if (!Number.isInteger(shiftMinutes) || shiftMinutes <= 0 || shiftMinutes > 24 * 60) {
      setError(t("settings.preferences.shiftMinutesError"));
      return;
    }

    setIsSaving(true);
    try {
      const updated = await updateCompanySettings({
        firstDayOfWeek: form.firstDayOfWeek,
        defaultWorkStart: form.defaultWorkStart,
        defaultWorkEnd: form.defaultWorkEnd,
        defaultShiftMinutes: shiftMinutes,
        notificationsEnabled: form.notificationsEnabled,
        emailNotificationsEnabled: form.emailNotificationsEnabled,
        desktopNotificationsEnabled: form.desktopNotificationsEnabled,
      });
      setForm(toFormState(updated));
      setMessage(t("settings.preferences.saved"));
    } catch {
      setMessage(t("settings.preferences.saveFailed"));
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading || !form) {
    return null;
  }

  return (
    <div className="mt-8 max-w-2xl rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
      <h3 className="text-lg font-semibold text-white">{t("settings.preferences.title")}</h3>
      <p className="mt-1 text-sm text-slate-400">{t("settings.preferences.description")}</p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label className="block text-sm text-white/70">{t("settings.preferences.firstDayOfWeek")}</label>
          <CustomSelect
            value={String(form.firstDayOfWeek)}
            onChange={(value) => update("firstDayOfWeek", Number(value))}
            options={WEEKDAYS.map((day) => ({
              value: String(day),
              label: t(`settings.preferences.weekdays.${day}`),
            }))}
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm text-white/70">{t("settings.preferences.defaultShiftLength")}</label>
          <input
            type="number"
            min={1}
            max={1440}
            value={form.defaultShiftMinutes}
            onChange={(e) => update("defaultShiftMinutes", e.target.value)}
            disabled={disabled}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="space-y-2">
          <label className="block text-sm text-white/70">{t("settings.preferences.defaultWorkStart")}</label>
          <TimePicker value={form.defaultWorkStart} onChange={(value) => update("defaultWorkStart", value)} />
        </div>

        <div className="space-y-2">
          <label className="block text-sm text-white/70">{t("settings.preferences.defaultWorkEnd")}</label>
          <TimePicker value={form.defaultWorkEnd} onChange={(value) => update("defaultWorkEnd", value)} />
        </div>
      </div>

      <div className="mt-6 space-y-3">
        <label className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
          <span className="text-sm text-slate-300">{t("settings.preferences.notificationsEnabled")}</span>
          <input
            type="checkbox"
            checked={form.notificationsEnabled}
            onChange={(e) => update("notificationsEnabled", e.target.checked)}
            disabled={disabled}
            className="h-5 w-5 accent-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </label>
        <label className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
          <span className="text-sm text-slate-300">{t("settings.preferences.emailNotifications")}</span>
          <input
            type="checkbox"
            checked={form.emailNotificationsEnabled}
            onChange={(e) => update("emailNotificationsEnabled", e.target.checked)}
            disabled={disabled || !form.notificationsEnabled}
            className="h-5 w-5 accent-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </label>
        <label className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
          <span className="text-sm text-slate-300">{t("settings.preferences.desktopNotifications")}</span>
          <input
            type="checkbox"
            checked={form.desktopNotificationsEnabled}
            onChange={(e) => update("desktopNotificationsEnabled", e.target.checked)}
            disabled={disabled || !form.notificationsEnabled}
            className="h-5 w-5 accent-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </label>
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
