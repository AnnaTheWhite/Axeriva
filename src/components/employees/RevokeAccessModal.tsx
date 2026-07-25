import { useState } from "react";
import Modal from "../ui/Modal";
import { useTranslation } from "../../i18n";

const CONFIRMATION_TEXT = "REVOKE";

type RevokeAccessModalProps = {
  open: boolean;
  employeeName: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
};

// B1 — typed-keyword confirmation for revoking an employee's login. The
// existing ConfirmModal can't be used: it has no input field, and the whole
// point of this ceremony is that revocation must never be a single
// accidental click (the reason option (B) — a status with an auth side
// effect — was rejected).
//
// No reset-on-open effect: the caller passes a `key` tied to the employee,
// so React remounts this component (with fresh state) for every open.
export default function RevokeAccessModal({
  open,
  employeeName,
  onConfirm,
  onClose,
}: RevokeAccessModalProps) {
  const { t } = useTranslation();
  const [confirmation, setConfirmation] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleConfirm() {
    if (confirmation !== CONFIRMATION_TEXT || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal open={open} title={t("employees.revokeTitle")} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-400">
          {t("employees.revokeMessage", { name: employeeName })}
        </p>

        <input
          type="text"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          placeholder={t("employees.revokeConfirmPlaceholder")}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-orange-500"
        />

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/5"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleConfirm}
            disabled={confirmation !== CONFIRMATION_TEXT || isSubmitting}
            className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-red-500/10"
          >
            {t("employees.revokeAccess")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
