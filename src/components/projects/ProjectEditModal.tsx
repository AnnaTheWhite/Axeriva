import { useEffect, useState } from "react";

import Modal from "../ui/Modal";
import DatePicker from "../ui/DatePicker";
import { updateProject } from "../../services/project.service";
import { useToast } from "../../hooks/useToast";

import type { Project } from "../../types/project";

type Props = {
  open: boolean;
  project: Project | null;
  onClose: () => void;
  onSuccess: () => void;
};

export default function ProjectEditModal({ open, project, onClose, onSuccess }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("Planned");
  const [deadline, setDeadline] = useState("");

  const { triggerToast } = useToast();

  useEffect(() => {
    if (project) {
      setName(project.name);
      setDescription(project.description ?? "");
      setStatus(project.status);
      // deadline comes as ISO string, slice to YYYY-MM-DD
      setDeadline(project.deadline ? project.deadline.slice(0, 10) : "");
    }
  }, [project]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project) return;

    try {
      await updateProject(project.id, { name, description, status, deadline });
      triggerToast("Project updated");
      onSuccess();
      onClose();
    } catch (error) {
      console.error(error);
      triggerToast("Update failed");
    }
  };

  if (!open) return null;

  const inputClass = "w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-orange-500";

  return (
    <Modal open={open} title="Edit Project" onClose={onClose}>
      <form onSubmit={handleSave} className="space-y-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Project Name"
          required
          className={inputClass}
        />

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description"
          className={inputClass}
        />

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={inputClass}
        >
          <option value="Planned">Planned</option>
          <option value="Active">Active</option>
          <option value="Completed">Completed</option>
        </select>

        <div>
          <label className="mb-2 block text-sm text-slate-400">Deadline</label>
          <DatePicker
            value={deadline}
            onChange={setDeadline}
            placeholder="Select deadline"
          />
        </div>

        <button
          type="submit"
          className="w-full rounded-xl bg-orange-500 px-5 py-3 font-medium text-white hover:bg-orange-600"
        >
          Save Changes
        </button>
      </form>
    </Modal>
  );
}
