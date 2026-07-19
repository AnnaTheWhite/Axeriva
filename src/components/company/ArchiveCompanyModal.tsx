import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import { useAuth } from "../../context/AuthContext";
import { archiveCompany } from "../../services/companySettings.service";
import { useTranslation } from "../../i18n";

const CONFIRMATION_TEXT = "ARCHIVE";

type ArchiveCompanyModalProps = {
  open: boolean;
  onClose: () => void;
};

// C1.7 — mirrors DeleteAccountModal's exact confirmation pattern (password +
// typed keyword). On success the company is immediately inactive
// server-side (auth.middleware.ts will 401 any further request from this
// company), so we proactively log out and return to the landing page rather
// than let the user hit a confusing failed request on their next click.
export default function ArchiveCompanyModal({ open, onClose }: ArchiveCompanyModalProps) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = password.length > 0 && confirmation === CONFIRMATION_TEXT;

  function handleClose() {
    setPassword("");
    setConfirmation("");
    setError(null);
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!canSubmit) {
      setError(t("settings.archiveModal.missingFields"));
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await archiveCompany(password, confirmation);
      logout();
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.archiveModal.failed"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal open={open} title={t("settings.archiveModal.title")} onClose={handleClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-slate-300">{t("settings.archiveModal.description")}</p>

        {error && (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}

        <div>
          <label className="block text-sm text-white/70">{t("settings.archiveModal.password")}</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-red-500"
          />
        </div>

        <div>
          <label className="block text-sm text-white/70">
            {t("settings.archiveModal.confirmPrefix")}{" "}
            <span className="font-mono text-red-400">{CONFIRMATION_TEXT}</span>{" "}
            {t("settings.archiveModal.confirmSuffix")}
          </label>
          <input
            type="text"
            required
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-red-500"
          />
        </div>

        <Button type="submit" variant="danger">
          {isSubmitting ? t("settings.archiveModal.submitting") : t("settings.archiveModal.submit")}
        </Button>
      </form>
    </Modal>
  );
}
