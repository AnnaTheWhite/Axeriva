import { useEffect, useRef, useState } from "react";
import Button from "../ui/Button";
import {
  getCompanySettings,
  updateCompanySettings,
  uploadCompanyLogo,
  removeCompanyLogo,
  companyLogoUrl,
  type CompanySettings,
} from "../../services/companySettings.service";
import { useTranslation } from "../../i18n";
import { useWriteGuard } from "../../hooks/useWriteGuard";
import { useIsOwner } from "../../hooks/useIsOwner";

const DEFAULT_PRIMARY = "#F97316";
const DEFAULT_ACCENT = "#F97316";

// C1.2/C1.3 — logo upload/replace/remove now goes through the real
// server-side upload pipeline (multer + sharp, see
// server/src/middleware/upload.middleware.ts + services/companyLogo.ts) —
// no more base64-in-JSON. Primary/accent colors are the other two branding
// inputs; centralized consumption of all three (logo + colors) is
// documented in docs/company-management.md.
export default function BrandingSection() {
  const { t } = useTranslation();
  const { readOnly } = useWriteGuard();
  const isOwner = useIsOwner();
  const disabled = readOnly || !isOwner;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [primaryColor, setPrimaryColor] = useState(DEFAULT_PRIMARY);
  const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingColors, setIsSavingColors] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function applySettings(settings: CompanySettings) {
    setLogoUrl(settings.logoUrl);
    setPrimaryColor(settings.primaryColor ?? DEFAULT_PRIMARY);
    setAccentColor(settings.accentColor ?? DEFAULT_ACCENT);
  }

  useEffect(() => {
    getCompanySettings()
      .then(applySettings)
      .finally(() => setIsLoading(false));
  }, []);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setMessage(null);
    setIsSaving(true);
    try {
      const updated = await uploadCompanyLogo(file);
      applySettings(updated);
      setMessage(t("settings.branding.logoUpdated"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("settings.branding.uploadFailed"));
    } finally {
      setIsSaving(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleRemoveLogo() {
    setMessage(null);
    setIsSaving(true);
    try {
      const updated = await removeCompanyLogo();
      applySettings(updated);
      setMessage(t("settings.branding.logoRemoved"));
    } catch {
      setMessage(t("settings.branding.uploadFailed"));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveColors() {
    setMessage(null);
    setIsSavingColors(true);
    try {
      const updated = await updateCompanySettings({ primaryColor, accentColor });
      applySettings(updated);
      setMessage(t("settings.branding.colorsSaved"));
    } catch {
      setMessage(t("settings.branding.uploadFailed"));
    } finally {
      setIsSavingColors(false);
    }
  }

  if (isLoading) {
    return null;
  }

  const displayUrl = companyLogoUrl(logoUrl);

  return (
    <div className="mt-8 max-w-2xl rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
      <h3 className="text-lg font-semibold text-white">{t("settings.branding.title")}</h3>
      <p className="mt-1 text-sm text-slate-400">
        {t("settings.branding.description")}
      </p>

      <div className="mt-6 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/5">
          {displayUrl ? (
            <img
              src={displayUrl}
              alt={t("settings.branding.logoAlt")}
              className="h-full w-full object-contain"
            />
          ) : (
            <span className="text-xs text-slate-500">{t("settings.branding.noLogo")}</span>
          )}
        </div>

        <div className="space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
            onChange={handleFileChange}
            disabled={disabled || isSaving}
            title={readOnly ? t("readOnly.tooltip") : undefined}
            className="block text-sm text-slate-400 file:mr-4 file:rounded-xl file:border-0 file:bg-white/10 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <p className="text-xs text-slate-500">{t("settings.branding.formatHint")}</p>

          {logoUrl && (
            <Button
              variant="secondary"
              onClick={handleRemoveLogo}
              disabled={disabled || isSaving}
              title={readOnly ? t("readOnly.tooltip") : undefined}
            >
              {isSaving ? t("settings.branding.uploading") : t("settings.branding.removeLogo")}
            </Button>
          )}
        </div>
      </div>

      {isOwner && (
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="block text-sm text-white/70">{t("settings.branding.primaryColor")}</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                disabled={disabled}
                className="h-10 w-14 shrink-0 cursor-pointer rounded-lg border border-white/10 bg-transparent disabled:cursor-not-allowed disabled:opacity-50"
              />
              <input
                type="text"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                disabled={disabled}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="block text-sm text-white/70">{t("settings.branding.accentColor")}</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
                disabled={disabled}
                className="h-10 w-14 shrink-0 cursor-pointer rounded-lg border border-white/10 bg-transparent disabled:cursor-not-allowed disabled:opacity-50"
              />
              <input
                type="text"
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
                disabled={disabled}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          </div>
        </div>
      )}

      {message && <p className="mt-4 text-sm text-slate-400">{message}</p>}

      {isOwner && (
        <div className="mt-6">
          <Button onClick={handleSaveColors} disabled={disabled || isSavingColors} title={readOnly ? t("readOnly.tooltip") : undefined}>
            {isSavingColors ? t("common.saving") : t("settings.branding.saveColors")}
          </Button>
        </div>
      )}
    </div>
  );
}
