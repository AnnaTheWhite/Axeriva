import Modal from "../ui/Modal";
import ShiftForm from "./ShiftForm";
import { useTranslation } from "../../i18n";
import type { Shift } from "../../types/shifts";

type ShiftModalProps = {
  open: boolean;
  shift?: Shift | null;
  onClose: () => void;
  onSuccess: () => void;
};

export default function ShiftModal({
  open,
  shift = null,
  onClose,
  onSuccess,
}: ShiftModalProps) {
  const { t } = useTranslation();
  return (
    <Modal
      open={open}
      title={shift ? t("schedule.editShiftTitle") : t("schedule.addShift")}
      onClose={onClose}
    >
      <ShiftForm
        shift={shift}
        onSuccess={() => {
          onClose();
          onSuccess();
        }}
      />
    </Modal>
  );
}
