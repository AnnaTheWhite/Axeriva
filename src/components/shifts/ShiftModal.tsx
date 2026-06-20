import Modal from "../ui/Modal";
import ShiftForm from "./ShiftForm";
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
  return (
    <Modal
      open={open}
      title={shift ? "Edit Shift" : "Add Shift"}
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
