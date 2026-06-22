import { useEffect, useState } from "react";

import Modal from "../ui/Modal";
import { getEmployees } from "../../services/employee.service";
import { assignEmployeeToProject } from "../../services/project.service";
import { useTranslation } from "../../i18n";

import type { Employee } from "../../types/employee";
import type { Project } from "../../types/project";

type AssignEmployeeModalProps = {
  open: boolean;
  project: Project | null;
  onClose: () => void;
  onSuccess: () => void;
};

export default function AssignEmployeeModal({
  open,
  project,
  onClose,
  onSuccess,
}: AssignEmployeeModalProps) {
  const { t } = useTranslation();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;

    const loadEmployees = async () => {
      try {
        const data = await getEmployees();
        setEmployees(data);
      } catch (error) {
        console.error(error);
      }
    };

    loadEmployees();
  }, [open]);

  // Already assigned employee IDs
  const assignedIds = new Set(
    project?.assignments?.map((a) => a.employee.id) ?? []
  );

  const filteredEmployees = employees.filter(
    (employee) =>
      !assignedIds.has(employee.id) &&
      (`${employee.firstName} ${employee.lastName}`
        .toLowerCase()
        .includes(search.toLowerCase()))
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project || !employeeId) return;

    try {
      await assignEmployeeToProject(project.id, Number(employeeId));
      setEmployeeId("");
      setSearch("");
      onClose();
      onSuccess();
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <Modal open={open} title={t("projects.assignModalTitle")} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="text"
          placeholder={t("projects.searchEmployeePlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-orange-500"
        />

        <div className="max-h-80 space-y-2 overflow-y-auto">
          {filteredEmployees.map((employee) => (
            <button
              key={employee.id}
              type="button"
              onClick={() => setEmployeeId(employee.id.toString())}
              className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                employeeId === employee.id.toString()
                  ? "border-orange-500 bg-orange-500/20"
                  : "border-white/10 bg-white/5 hover:bg-white/10"
              }`}
            >
              <div className="font-medium">
                {employee.firstName} {employee.lastName}
              </div>
              <div className="text-sm text-slate-400">
                {t("projects.employeeHashId", { id: employee.id })}
              </div>
            </button>
          ))}

          {filteredEmployees.length === 0 && (
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-center text-slate-400">
              {t("projects.noEmployeesFound")}
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={!employeeId}
          className="w-full rounded-xl bg-orange-500 px-5 py-3 font-medium text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("projects.assignEmployeeSubmit")}
        </button>
      </form>
    </Modal>
  );
}
