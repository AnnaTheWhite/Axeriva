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
  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [geofenceRadius, setGeofenceRadius] = useState("");
  const [geofenceEnabled, setGeofenceEnabled] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const { show, message, triggerToast } = useToast();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    try {
      await createProject({
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
      setName("");
      setDescription("");
      setStatus("Planned");
      setDeadline("");
      setAddress("");
      setLatitude("");
      setLongitude("");
      setGeofenceRadius("");
      setGeofenceEnabled(false);
      triggerToast("Project created successfully");
      onSuccess();
    } catch (error) {
      console.error(error);
      triggerToast(
        error instanceof Error ? error.message : "Failed to create project"
      );
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
          className="w-full rounded-xl bg-orange-500 px-5 py-3 font-medium text-white transition hover:bg-orange-600"
        >
          Save Project
        </button>
      </form>

      <Toast show={show} message={message} />
    </>
  );
}
