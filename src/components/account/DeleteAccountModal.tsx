import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import { useAuth } from "../../context/AuthContext";
import { deleteAccount } from "../../services/account.service";
import { useTranslation } from "../../i18n";

const CONFIRMATION_TEXT = "DELETE";

type DeleteAccountModalProps = {
  open: boolean;
  onClose: () => void;
};

export default function DeleteAccountModal({
  open,
  onClose,
}: DeleteAccountModalProps) {
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
      setError(t("account.deleteModal.missingFields"));
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await deleteAccount(password, confirmation);
      logout();
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("account.deleteModal.failed"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal open={open} title={t("account.deleteModal.title")} onClose={handleClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-slate-300">
          {t("account.deleteModal.description")}
        </p>

        {error && (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}

        <div>
          <label className="block text-sm text-white/70">{t("account.deleteModal.password")}</label>
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
            {t("account.deleteModal.confirmPrefix")}{" "}
            <span className="font-mono text-red-400">{CONFIRMATION_TEXT}</span>{" "}
            {t("account.deleteModal.confirmSuffix")}
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
          {isSubmitting ? t("account.deleteModal.submitting") : t("account.deleteModal.submit")}
        </Button>
      </form>
    </Modal>
  );
}
