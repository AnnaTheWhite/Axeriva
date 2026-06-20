import { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader";
import Button from "../components/ui/Button";
import { clockIn, clockOut, getMyShifts } from "../services/shift.service";
import { getProjects } from "../services/project.service";
import type { Project } from "../types/project";

type MyShift = {
  id: number;
  start: string;
  end: string | null;
  project: { id: number; name: string } | null;
};

export default function MyTimePage() {
  const [shifts, setShifts] = useState<MyShift[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const openShift = shifts.find((shift) => !shift.end) ?? null;

  const load = async () => {
    try {
      const [shiftData, projectData] = await Promise.all([
        getMyShifts(),
        getProjects(),
      ]);
      setShifts(shiftData);
      setProjects(projectData);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  async function handleClockIn() {
    if (!selectedProjectId) {
      setError("Please select a project before clocking in.");
      return;
    }

    setError(null);

    try {
      await clockIn(Number(selectedProjectId));
      setSelectedProjectId("");
      await load();
    } catch {
      setError("Failed to clock in.");
    }
  }

  async function handleClockOut() {
    setError(null);
    try {
      await clockOut();
      await load();
    } catch {
      setError("Failed to clock out.");
    }
  }

  if (isLoading) {
    return null;
  }

  return (
    <div className="p-8">
      <PageHeader title="My Time" subtitle="Track your worked hours." />

      <div className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
        <p className="text-sm text-slate-400">Current status</p>
        <p className="mt-2 text-2xl font-bold text-white">
          {openShift ? "Clocked in" : "Clocked out"}
        </p>

        {openShift && (
          <p className="mt-1 text-slate-400">
            Project: <span className="text-white">{openShift.project?.name ?? "—"}</span>
          </p>
        )}

        {error && (
          <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="mt-6">
          {openShift ? (
            <Button variant="danger" onClick={handleClockOut}>
              Clock out
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="min-w-[220px]"
              >
                <option value="">Select a project...</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>

              <Button onClick={handleClockIn}>Clock in</Button>
            </div>
          )}
        </div>
      </div>

      <div className="mt-8 overflow-hidden rounded-3xl border border-white/10 bg-white/5">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10 text-left">
              <th className="p-4">Start</th>
              <th className="p-4">End</th>
              <th className="p-4">Project</th>
            </tr>
          </thead>
          <tbody>
            {shifts.map((shift) => (
              <tr key={shift.id} className="border-b border-white/5">
                <td className="p-4">{new Date(shift.start).toLocaleString()}</td>
                <td className="p-4">
                  {shift.end ? new Date(shift.end).toLocaleString() : "In progress"}
                </td>
                <td className="p-4">{shift.project?.name ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
