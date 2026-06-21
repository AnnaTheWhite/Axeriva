import { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/ui/EmptyState";
import { getMyShifts } from "../services/shift.service";
import { useTranslation } from "../i18n";

type MyShift = {
  id: number;
  start: string;
  end: string | null;
  notes?: string;
  project?: {
    name: string;
    address?: string | null;
    customer?: { address?: string | null } | null;
  } | null;
};

// Project address, falling back to the customer's address — employees need
// to know where to go, not the project's raw GPS coordinates.
function workAddress(project: MyShift["project"]): string | null {
  if (!project) return null;
  return project.address || project.customer?.address || null;
}

export default function MySchedulePage() {
  const { t } = useTranslation();
  const [shifts, setShifts] = useState<MyShift[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getMyShifts()
      .then(setShifts)
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="p-4 sm:p-8">
      <PageHeader title={t("mySchedule.title")} subtitle={t("mySchedule.subtitle")} />

      {isLoading ? null : shifts.length === 0 ? (
        <EmptyState title={t("mySchedule.noShifts")} description={t("mySchedule.noShiftsDesc")} />
      ) : (
        <>
          {/* Mobile: cards (no horizontal scroll). Desktop: table. */}
          <div className="space-y-3 sm:hidden">
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
                {shift.notes && (
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-slate-400">{t("table.notes")}</span>
                    <span className="text-right text-white">{shift.notes}</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="hidden overflow-hidden rounded-3xl border border-white/10 bg-white/5 sm:block">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10 text-left">
                    <th className="p-4">{t("table.start")}</th>
                    <th className="p-4">{t("table.end")}</th>
                    <th className="p-4">{t("table.project")}</th>
                    <th className="p-4">{t("table.location")}</th>
                    <th className="p-4">{t("table.notes")}</th>
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
                      <td className="p-4">{shift.notes ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
