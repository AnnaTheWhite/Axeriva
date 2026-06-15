import EmployeeForm from "./EmployeeForm";

type EmployeeModalProps = {
  open: boolean;
  onClose: () => void;
};

export default function EmployeeModal({
  open,
  onClose,
}: EmployeeModalProps) {
  if (!open) return null;

  return (
    <div
      className="
        fixed
        inset-0
        flex
        items-center
        justify-center
        bg-black/70
      "
    >
      <div
        className="
          relative
          w-full
          max-w-xl
          rounded-3xl
          border
          border-white/10
          bg-slate-900
          p-6
        "
      >
        <button
          onClick={onClose}
          className="
            absolute
            right-4
            top-4
            text-xl
            text-slate-400
            hover:text-white
          "
        >
          ✕
        </button>

        <h2 className="mb-6 text-2xl font-bold">
          Add Employee
        </h2>

        <EmployeeForm />
      </div>
    </div>
  );
}