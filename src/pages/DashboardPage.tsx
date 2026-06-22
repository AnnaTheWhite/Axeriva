import { useEffect, useState } from "react";

import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import Loading from "../components/Loading";
import EmptyState from "../components/ui/EmptyState";
import ImportantNotesWidget from "../components/dashboard/ImportantNotesWidget";
import { useTranslation } from "../i18n";

import { getDashboard } from "../services/dashboard.service";
import type { DashboardData } from "../services/dashboard.service";
import { getOwnerNotes } from "../services/ownerNotes.service";
import type { OwnerNote } from "../types/ownerNote";

export default function DashboardPage() {
  const { t } = useTranslation();
  const [data, setData] = useState<DashboardData | null>(null);
  const [notes, setNotes] = useState<OwnerNote[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getDashboard(),
      // Owner Notes are already sorted pinned-first, newest-first by the
      // backend — fetched here at the page level so the widget itself stays
      // purely presentational.
      getOwnerNotes().catch(() => [] as OwnerNote[]),
    ])
      .then(([dashboardData, ownerNotes]) => {
        setData(dashboardData);
        setNotes(ownerNotes);
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) {
    return (
      <div className="p-4 sm:p-8">
        <PageHeader title={t("dashboard.title")} subtitle={t("dashboard.subtitle")} />
        <Loading />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-4 sm:p-8">
        <PageHeader title={t("dashboard.title")} subtitle={t("dashboard.subtitle")} />
        <EmptyState
          title={t("dashboard.couldNotLoad")}
          description={t("dashboard.couldNotLoadDesc")}
        />
      </div>
    );
  }

  const { kpis, activeNow, hoursByProject, upcomingShifts } = data;

  return (
    <div className="p-4 sm:p-8">
      <PageHeader title={t("dashboard.title")} subtitle={t("dashboard.subtitle")} />

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title={t("dashboard.activeEmployees")} value={kpis.activeEmployees} />
        <StatCard title={t("dashboard.activeProjects")} value={kpis.activeProjects} />
        <StatCard title={t("dashboard.totalCustomers")} value={kpis.totalCustomers} />
        <StatCard title={t("dashboard.todaysHours")} value={kpis.todaysHours.toFixed(1)} />
      </div>

      {/* Weekly Hours + Important Notes — own row so the main 4-card KPI
          grid above stays untouched. */}
      <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <StatCard title={t("dashboard.weeklyHours")} value={kpis.weeklyHours.toFixed(1)} />

        <div className="lg:col-span-2">
          <h2 className="mb-4 text-xl font-semibold">{t("dashboard.importantNotes.title")}</h2>
          <ImportantNotesWidget notes={notes.slice(0, 5)} />
        </div>
      </div>

      <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Today's activity */}
        <section>
          <h2 className="mb-4 text-xl font-semibold">{t("dashboard.todaysActivity")}</h2>

          {activeNow.length === 0 ? (
            <EmptyState
              title={t("dashboard.nobodyClockedIn")}
              description={t("dashboard.nobodyClockedInDesc")}
            />
          ) : (
            <div className="space-y-3">
              {activeNow.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl"
                >
                  <p className="font-semibold text-white">{entry.employeeName}</p>
                  <p className="text-sm text-slate-400">
                    {entry.projectName ?? t("dashboard.noProject")}
                  </p>
                  <p className="mt-1 text-sm text-orange-400">
                    {t("dashboard.started")}{" "}
                    {new Date(entry.start).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Hours by project */}
        <section>
          <h2 className="mb-4 text-xl font-semibold">{t("dashboard.topProjectsByHours")}</h2>

          {hoursByProject.length === 0 ? (
            <EmptyState
              title={t("dashboard.noTrackedHours")}
              description={t("dashboard.noTrackedHoursDesc")}
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
                    {hoursByProject.slice(0, 5).map((row) => (
                      <tr key={row.projectId} className="border-b border-white/5">
                        <td className="p-4">{row.projectName}</td>
                        <td className="p-4">{row.hours.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Upcoming shifts */}
      <section className="mt-10">
        <h2 className="mb-4 text-xl font-semibold">{t("dashboard.upcomingShifts")}</h2>

        {upcomingShifts.length === 0 ? (
          <EmptyState
            title={t("dashboard.noUpcomingShifts")}
            description={t("dashboard.noUpcomingShiftsDesc")}
          />
        ) : (
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/5">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10 text-left">
                    <th className="p-4">{t("table.employee")}</th>
                    <th className="p-4">{t("table.project")}</th>
                    <th className="p-4">{t("table.date")}</th>
                  </tr>
                </thead>
                <tbody>
                  {upcomingShifts.map((shift) => (
                    <tr key={shift.id} className="border-b border-white/5">
                      <td className="p-4">{shift.employeeName}</td>
                      <td className="p-4">{shift.projectName ?? "—"}</td>
                      <td className="p-4">
                        {new Date(shift.start).toLocaleString([], {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
