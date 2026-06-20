import { useEffect, useState } from "react";

import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import Loading from "../components/Loading";
import EmptyState from "../components/ui/EmptyState";

import { getDashboard } from "../services/dashboard.service";
import type { DashboardData } from "../services/dashboard.service";

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getDashboard()
      .then(setData)
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) {
    return (
      <div className="p-8">
        <PageHeader title="Dashboard" subtitle="Your company at a glance." />
        <Loading />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8">
        <PageHeader title="Dashboard" subtitle="Your company at a glance." />
        <EmptyState
          title="Couldn't load the dashboard"
          description="Please try refreshing the page."
        />
      </div>
    );
  }

  const { kpis, activeNow, hoursByProject, upcomingShifts } = data;

  return (
    <div className="p-8">
      <PageHeader title="Dashboard" subtitle="Your company at a glance." />

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Active employees" value={kpis.activeEmployees} />
        <StatCard title="Active projects" value={kpis.activeProjects} />
        <StatCard title="Total customers" value={kpis.totalCustomers} />
        <StatCard title="Today's hours" value={kpis.todaysHours.toFixed(1)} />
      </div>

      <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Today's activity */}
        <section>
          <h2 className="mb-4 text-xl font-semibold">Today's activity</h2>

          {activeNow.length === 0 ? (
            <EmptyState
              title="Nobody is clocked in"
              description="Employees who clock in will show up here."
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
                    {entry.projectName ?? "No project"}
                  </p>
                  <p className="mt-1 text-sm text-orange-400">
                    Started{" "}
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
          <h2 className="mb-4 text-xl font-semibold">Top projects by hours</h2>

          {hoursByProject.length === 0 ? (
            <EmptyState
              title="No tracked hours yet"
              description="Hours will show up here once employees clock in and out."
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
                  {hoursByProject.slice(0, 5).map((row) => (
                    <tr key={row.projectId} className="border-b border-white/5">
                      <td className="p-4">{row.projectName}</td>
                      <td className="p-4">{row.hours.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* Upcoming shifts */}
      <section className="mt-10">
        <h2 className="mb-4 text-xl font-semibold">Upcoming shifts (next 7 days)</h2>

        {upcomingShifts.length === 0 ? (
          <EmptyState
            title="No upcoming shifts"
            description="Shifts scheduled in the next 7 days will show up here."
          />
        ) : (
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/5">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10 text-left">
                  <th className="p-4">Employee</th>
                  <th className="p-4">Project</th>
                  <th className="p-4">Date</th>
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
        )}
      </section>
    </div>
  );
}
