import { useEffect, useState } from "react";
import PageHeader from "../../components/PageHeader";
import StatCard from "../../components/StatCard";
import { getAdminCompanies, getAdminUsers } from "../../services/admin.service";
import type { AdminCompany, AdminUser } from "../../services/admin.service";

export default function PlatformDashboardPage() {
  const [companies, setCompanies] = useState<AdminCompany[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([getAdminCompanies(), getAdminUsers()])
      .then(([companiesData, usersData]) => {
        setCompanies(companiesData);
        setUsers(usersData);
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) {
    return null;
  }

  const activeSubscriptions = companies.filter(
    (company) => company.subscriptionStatus === "active"
  ).length;

  return (
    <div className="p-8">
      <PageHeader title="Platform Dashboard" subtitle="Cross-tenant overview." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard title="Companies" value={companies.length} />
        <StatCard title="Users" value={users.length} />
        <StatCard title="Active subscriptions" value={activeSubscriptions} />
      </div>
    </div>
  );
}
