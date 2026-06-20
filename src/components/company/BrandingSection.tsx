import { useEffect, useRef, useState } from "react";
import Button from "../ui/Button";
import {
  getCompanySettings,
  updateCompanySettings,
} from "../../services/companySettings.service";

// No file-storage backend exists yet (no S3/multer setup) — the logo is
// stored as a base64 data URL directly in Company.logoUrl. Good enough for
// a small company logo; index.ts raises the JSON body limit to 5mb to fit it.
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function BrandingSection() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    getCompanySettings()
      .then((settings) => setLogoUrl(settings.logoUrl))
      .finally(() => setIsLoading(false));
  }, []);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setMessage(null);
    const dataUrl = await readFileAsDataUrl(file);
    setPreviewUrl(dataUrl);
  }

  async function handleSave() {
    if (!previewUrl) return;

    setMessage(null);
    setIsSaving(true);

    try {
      const updated = await updateCompanySettings({ logoUrl: previewUrl });
      setLogoUrl(updated.logoUrl);
      setPreviewUrl(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setMessage("Logo updated.");
    } catch {
      setMessage("Failed to upload logo.");
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return null;
  }

  const displayUrl = previewUrl ?? logoUrl;

  return (
    <div className="mt-8 max-w-2xl rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
      <h3 className="text-lg font-semibold text-white">Branding</h3>
      <p className="mt-1 text-sm text-slate-400">
        Your logo appears on emails, PDFs, quotes, and invoices.
      </p>

      <div className="mt-6 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/5">
          {displayUrl ? (
            <img
              src={displayUrl}
              alt="Company logo preview"
              className="h-full w-full object-contain"
            />
          ) : (
            <span className="text-xs text-slate-500">No logo</span>
          )}
        </div>

        <div className="space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="block text-sm text-slate-400 file:mr-4 file:rounded-xl file:border-0 file:bg-white/10 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-white/20"
          />

          {previewUrl && (
            <Button onClick={handleSave}>
              {isSaving ? "Uploading..." : "Save logo"}
            </Button>
          )}
        </div>
      </div>

      {message && <p className="mt-4 text-sm text-slate-400">{message}</p>}
    </div>
  );
}
