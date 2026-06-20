import Modal from "../ui/Modal";
import EmployeeForm from "./EmployeeForm";

type EmployeeModalProps = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

export default function EmployeeModal({
  open,
  onClose,
  onSuccess,
}: EmployeeModalProps) {
  return (
    <Modal
      open={open}
      title="Add Employee"
      onClose={onClose}
    >
      <EmployeeForm
        onSuccess={() => {
          onClose();
          onSuccess();
        }}
      />
    </Modal>
  );
}