import Modal from "./Modal";
import { useTranslation } from "../../i18n";

type ConfirmModalProps = {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onClose: () => void;
};

export default function ConfirmModal({
  open,
  title,
  message,
  confirmText,
  cancelText,
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  const { t } = useTranslation();
  const resolvedConfirmText = confirmText ?? t("common.delete");
  const resolvedCancelText = cancelText ?? t("common.cancel");

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
    >
      <div className="space-y-6">
        <p className="text-slate-300">
          {message}
        </p>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="
              rounded-xl
              border
              border-white/10
              bg-white/5
              px-5
              py-2
              text-slate-300
              transition
              hover:bg-white/10
            "
          >
            {resolvedCancelText}
          </button>

          <button
            onClick={onConfirm}
            className="
              rounded-xl
              border
              border-red-500/30
              bg-red-500/10
              px-5
              py-2
              font-medium
              text-red-400
              transition
              hover:bg-red-500/20
            "
          >
            {resolvedConfirmText}
          </button>
        </div>
      </div>
    </Modal>
  );
}