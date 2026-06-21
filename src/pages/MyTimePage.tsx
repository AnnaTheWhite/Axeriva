import { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader";
import Button from "../components/ui/Button";
import { clockIn, clockOut, getMyShifts } from "../services/shift.service";
import { getProjects } from "../services/project.service";
import type { Project } from "../types/project";
import { useTranslation } from "../i18n";

type MyShift = {
  id: number;
  start: string;
  end: string | null;
  project: {
    id: number;
    name: string;
    address?: string | null;
    customer?: { address?: string | null } | null;
  } | null;
};

// Project address, falling back to the customer's address — employees need
// to know where to go, not the project's raw GPS coordinates (those stay
// database-only, see Project.latitude/longitude).
function workAddress(project: {
  address?: string | null;
  customer?: { address?: string | null } | null;
} | null | undefined): string | null {
  if (!project) return null;
  return project.address || project.customer?.address || null;
}

export default function MyTimePage() {
  const { t } = useTranslation();
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
      setError(t("myTime.selectProjectError"));
      return;
    }

    setError(null);

    try {
      await clockIn(Number(selectedProjectId));
      setSelectedProjectId("");
      await load();
    } catch {
      setError(t("myTime.clockInFailed"));
    }
  }

  async function handleClockOut() {
    setError(null);
    try {
      await clockOut();
      await load();
    } catch {
      setError(t("myTime.clockOutFailed"));
    }
  }

  if (isLoading) {
    return null;
  }

  return (
    <div className="p-4 sm:p-8">
      <PageHeader title={t("myTime.title")} subtitle={t("myTime.subtitle")} />

      <div className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl sm:p-8">
        <p className="text-sm text-slate-400">{t("myTime.currentStatus")}</p>
        <p className="mt-2 text-2xl font-bold text-white">
          {openShift ? t("myTime.clockedIn") : t("myTime.clockedOut")}
        </p>

        {openShift && (
          <>
            <p className="mt-1 text-slate-400">
              {t("table.project")}: <span className="text-white">{openShift.project?.name ?? "—"}</span>
            </p>
            <p className="mt-1 text-slate-400">
              {t("myTime.where")}:{" "}
              <span className="text-white">
                {workAddress(openShift.project) ?? t("myTime.noAddressSet")}
              </span>
            </p>
          </>
        )}

        {error && (
          <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="mt-6">
          {openShift ? (
            <Button variant="danger" size="lg" onClick={handleClockOut}>
              {t("myTime.clockOut")}
            </Button>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white sm:min-w-[220px] sm:flex-1"
              >
                <option value="">{t("myTime.selectProject")}</option>
                {projects.map((project) => {
                  const address = workAddress(project);
                  return (
                    <option key={project.id} value={project.id}>
                      {project.name}
                      {address ? ` — ${address}` : ""}
                    </option>
                  );
                })}
              </select>

              <Button size="lg" onClick={handleClockIn}>
                {t("myTime.clockIn")}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile: stacked cards (no horizontal scroll). Desktop: table. */}
      <div className="mt-8 space-y-3 sm:hidden">
        {shifts.map((shift) => (
          <div key={shift.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400">{t("table.start")}</span>
              <span className="text-white">{new Date(shift.start).toLocaleString()}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-slate-400">{t("table.end")}</span>
              <span className="text-white">
                {shift.end ? new Date(shift.end).toLocaleString() : t("schedule.inProgress")}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-slate-400">{t("table.project")}</span>
              <span className="text-white">{shift.project?.name ?? "—"}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-slate-400">{t("table.location")}</span>
              <span className="text-right text-white">{workAddress(shift.project) ?? "—"}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 hidden overflow-hidden rounded-3xl border border-white/10 bg-white/5 sm:block">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10 text-left">
                <th className="p-4">{t("table.start")}</th>
                <th className="p-4">{t("table.end")}</th>
                <th className="p-4">{t("table.project")}</th>
                <th className="p-4">{t("table.location")}</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((shift) => (
                <tr key={shift.id} className="border-b border-white/5">
                  <td className="p-4">{new Date(shift.start).toLocaleString()}</td>
                  <td className="p-4">
                    {shift.end ? new Date(shift.end).toLocaleString() : t("schedule.inProgress")}
                  </td>
                  <td className="p-4">{shift.project?.name ?? "—"}</td>
                  <td className="p-4">{workAddress(shift.project) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
