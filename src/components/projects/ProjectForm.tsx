import { useState } from "react";

import { createProject } from "../../services/project.service";
import { useToast } from "../../hooks/useToast";
import Toast from "../ui/Toast";
import DatePicker from "../ui/DatePicker";

type ProjectFormProps = {
  onSuccess: () => void;
};

export default function ProjectForm({ onSuccess }: ProjectFormProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("Planned");
  const [deadline, setDeadline] = useState("");

  const { show, message, triggerToast } = useToast();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    try {
      await createProject({ name, description, status, deadline });
      setName("");
      setDescription("");
      setStatus("Planned");
      setDeadline("");
      triggerToast("Project created successfully");
      onSuccess();
    } catch (error) {
      console.error(error);
      triggerToast("Failed to create project");
    }
  };

  const inputClass = "w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-orange-500";

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-2 block text-sm text-slate-400">Project Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className={inputClass}
          />
        </div>

        <div>
          <label className="mb-2 block text-sm text-slate-400">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label className="mb-2 block text-sm text-slate-400">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={inputClass}
          >
            <option value="Planned">Planned</option>
            <option value="Active">Active</option>
            <option value="Completed">Completed</option>
          </select>
        </div>

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
          className="w-full rounded-xl bg-orange-500 px-5 py-3 font-medium text-white transition hover:bg-orange-600"
        >
          Save Project
        </button>
      </form>

      <Toast show={show} message={message} />
    </>
  );
}
