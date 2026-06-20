import Modal from "../ui/Modal";
import ProjectForm from "./ProjectForm";

type ProjectModalProps = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

export default function ProjectModal({
  open,
  onClose,
  onSuccess,
}: ProjectModalProps) {
  return (
    <Modal
      open={open}
      title="Add Project"
      onClose={onClose}
    >
      <ProjectForm
        onSuccess={() => {
          onClose();
          onSuccess();
        }}
      />
    </Modal>
  );
}