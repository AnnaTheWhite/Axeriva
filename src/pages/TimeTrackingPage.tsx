import { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/ui/EmptyState";
import { getHoursByProject } from "../services/shift.service";
import type { ProjectHours } from "../services/shift.service";

export default function TimeTrackingPage() {
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
    <div className="p-8">
      <PageHeader
        title="Time Tracking"
        subtitle="Worked hours per project, based on completed shifts."
      />

      {isLoading ? null : hours.length === 0 ? (
        <EmptyState
          title="No tracked hours yet"
          description="Hours will show up here once employees clock in and out on a project."
        />
      ) : (
        <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/5">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10 text-left">
                <th className="p-4">Project</th>
                <th className="p-4">Hours</th>
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
                <td className="p-4 font-semibold text-white">Total</td>
                <td className="p-4 font-semibold text-white">
                  {totalHours.toFixed(1)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
