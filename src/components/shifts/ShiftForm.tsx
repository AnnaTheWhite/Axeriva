import { useEffect, useState } from "react";

import { createShift, updateShift } from "../../services/shift.service";
import { getEmployees } from "../../services/employee.service";
import { getProjects } from "../../services/project.service";

import { useToast } from "../../hooks/useToast";
import Toast from "../ui/Toast";
import DateTimePicker from "../ui/DateTimePicker";

import type { Employee } from "../../types/employee";
import type { Project } from "../../types/project";
import type { Shift } from "../../types/shifts";

type ShiftFormProps = {
  shift?: Shift | null;
  onSuccess: () => void;
};

export default function ShiftForm({ shift = null, onSuccess }: ShiftFormProps) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  const [employeeId, setEmployeeId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [notes, setNotes] = useState("");

  const { show, message, triggerToast } = useToast();

  useEffect(() => {
    if (shift) {
      setEmployeeId(String(shift.employeeId));
      setProjectId(shift.projectId ? String(shift.projectId) : "");
      setStart(shift.start.slice(0, 16));
      setEnd(shift.end.slice(0, 16));
      setNotes(shift.notes ?? "");
    } else {
      setEmployeeId("");
      setProjectId("");
      setStart("");
      setEnd("");
      setNotes("");
    }
  }, [shift]);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [employeesData, projectsData] = await Promise.all([
          getEmployees(),
          getProjects(),
        ]);
        setEmployees(employeesData);
        setProjects(projectsData);
      } catch (error) {
        console.error("Failed to load form data:", error);
      }
    };
    loadData();
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!employeeId) {
      triggerToast("Please select an employee");
      return;
    }

    const data = {
      employeeId: Number(employeeId),
      projectId: projectId ? Number(projectId) : null,
      start,
      end,
      notes,
    };

    try {
      if (shift) {
        await updateShift(shift.id, data);
      } else {
        await createShift(data);
      }
      onSuccess();
    } catch (error) {
      console.error(error);
      triggerToast(shift ? "Failed to update shift" : "Failed to create shift");
    }
  };

  const selectClass =
    "w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-orange-500";

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-2 block text-sm text-slate-400">Employee</label>
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className={selectClass}
            required
          >
            <option value="">Select Employee</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.firstName} {employee.lastName}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-2 block text-sm text-slate-400">Project</label>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className={selectClass}
          >
            <option value="">Select Project (optional)</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-2 block text-sm text-slate-400">Start</label>
          <DateTimePicker
            value={start}
            onChange={setStart}
            placeholder="Select start time"
            required
          />
        </div>

        <div>
          <label className="mb-2 block text-sm text-slate-400">End</label>
          <DateTimePicker
            value={end}
            onChange={setEnd}
            placeholder="Select end time"
            required
          />
        </div>

        <div>
          <label className="mb-2 block text-sm text-slate-400">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-orange-500"
          />
        </div>

        <button
          type="submit"
          className="w-full rounded-xl bg-orange-500 px-5 py-3 font-medium text-white transition hover:bg-orange-600"
        >
          {shift ? "Save Changes" : "Save Shift"}
        </button>
      </form>

      <Toast show={show} message={message} />
    </>
  );
}
