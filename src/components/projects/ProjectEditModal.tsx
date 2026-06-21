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
  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [geofenceRadius, setGeofenceRadius] = useState("");
  const [geofenceEnabled, setGeofenceEnabled] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const { triggerToast } = useToast();

  useEffect(() => {
    if (project) {
      setName(project.name);
      setDescription(project.description ?? "");
      setStatus(project.status);
      // deadline comes as ISO string, slice to YYYY-MM-DD
      setDeadline(project.deadline ? project.deadline.slice(0, 10) : "");
      setAddress(project.address ?? "");
      setLatitude(project.latitude != null ? String(project.latitude) : "");
      setLongitude(project.longitude != null ? String(project.longitude) : "");
      setGeofenceRadius(
        project.geofenceRadius != null ? String(project.geofenceRadius) : ""
      );
      setGeofenceEnabled(Boolean(project.geofenceEnabled));
      setShowAdvanced(
        Boolean(project.geofenceEnabled || project.latitude || project.longitude)
      );
    }
  }, [project]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project) return;

    try {
      await updateProject(project.id, {
        name,
        description,
        status,
        deadline,
        address: address || undefined,
        latitude: latitude ? Number(latitude) : null,
        longitude: longitude ? Number(longitude) : null,
        geofenceRadius: geofenceRadius ? Number(geofenceRadius) : null,
        geofenceEnabled,
      });
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

        <div className="border-t border-white/10 pt-4">
          <p className="mb-3 text-sm font-medium text-slate-300">Site location</p>

          <div>
            <label className="mb-2 block text-sm text-slate-400">Address</label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="1138 Budapest, Váci út 100"
              className={inputClass}
            />
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="mt-4 flex w-full items-center justify-between text-sm text-slate-400 hover:text-slate-300"
          >
            <span>Advanced (geofence — coming soon)</span>
            <span>{showAdvanced ? "▾" : "▸"}</span>
          </button>

          {showAdvanced && (
            <div className="mt-3 space-y-4 rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs text-slate-500">
                These fields are stored for a future automatic clock-in/out
                feature, which isn't active yet — safe to leave blank.
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-2 block text-sm text-slate-400">Latitude</label>
                  <input
                    type="number"
                    step="any"
                    value={latitude}
                    onChange={(e) => setLatitude(e.target.value)}
                    placeholder="47.531245"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm text-slate-400">Longitude</label>
                  <input
                    type="number"
                    step="any"
                    value={longitude}
                    onChange={(e) => setLongitude(e.target.value)}
                    placeholder="19.070834"
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm text-slate-400">
                  Geofence radius (meters)
                </label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={geofenceRadius}
                  onChange={(e) => setGeofenceRadius(e.target.value)}
                  placeholder="100"
                  className={inputClass}
                />
              </div>

              <label className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                <span className="text-sm text-slate-300">Enable GPS tracking</span>
                <input
                  type="checkbox"
                  checked={geofenceEnabled}
                  onChange={(e) => setGeofenceEnabled(e.target.checked)}
                  className="h-5 w-5 accent-orange-500"
                />
              </label>
            </div>
          )}
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
