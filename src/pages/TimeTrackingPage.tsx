import { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/ui/EmptyState";
import { getHoursByProject } from "../services/shift.service";
import type { ProjectHours } from "../services/shift.service";
import { useTranslation } from "../i18n";

export default function TimeTrackingPage() {
  const { t } = useTranslation();
  const [hours, setHours] = useState<ProjectHours[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getHoursByProject()
      .then(setHours)
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  const totalHours = hours.reduce((sum, row) => sum + row.hours, 0);

  return (
    <div className="p-4 sm:p-8">
      <PageHeader
        title={t("timeTracking.title")}
        subtitle={t("timeTracking.subtitle")}
      />

      {isLoading ? null : hours.length === 0 ? (
        <EmptyState
          title={t("timeTracking.noHours")}
          description={t("timeTracking.noHoursDesc")}
        />
      ) : (
        <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/5">
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10 text-left">
                <th className="p-4">{t("table.project")}</th>
                <th className="p-4">{t("table.hours")}</th>
              </tr>
            </thead>
            <tbody>
              {hours.map((row) => (
                <tr key={row.projectId} className="border-b border-white/5">
                  <td className="p-4">{row.projectName}</td>
                  <td className="p-4">{row.hours.toFixed(1)}</td>
                </tr>
              ))}
              <tr>
                <td className="p-4 font-semibold text-white">{t("table.total")}</td>
                <td className="p-4 font-semibold text-white">
                  {totalHours.toFixed(1)}
                </td>
              </tr>
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
