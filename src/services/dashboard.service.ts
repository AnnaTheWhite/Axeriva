import { API_URL, authHeaders } from "./api";

export type DashboardData = {
  kpis: {
    activeEmployees: number;
    activeProjects: number;
    totalCustomers: number;
    todaysHours: number;
    weeklyHours: number;
  };
  activeNow: {
    id: number;
    employeeName: string;
    projectName: string | null;
    start: string;
  }[];
  hoursByProject: {
    projectId: number;
    projectName: string;
    hours: number;
  }[];
  upcomingShifts: {
    id: number;
    employeeName: string;
    projectName: string | null;
    start: string;
  }[];
};

export async function getDashboard(): Promise<DashboardData> {
  const response = await fetch(`${API_URL}/dashboard`, {
    headers: { ...authHeaders() },
  });

  if (!response.ok) {
    throw new Error("Failed to load dashboard");
  }

  return response.json();
}
