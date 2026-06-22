import Modal from "../ui/Modal";
import ProjectForm from "./ProjectForm";
import { useTranslation } from "../../i18n";

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
  const { t } = useTranslation();
  return (
    <Modal
      open={open}
      title={t("projects.addProject")}
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