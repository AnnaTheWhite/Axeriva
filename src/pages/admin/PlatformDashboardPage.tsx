import { useEffect, useState } from "react";
import PageHeader from "../../components/PageHeader";
import StatCard from "../../components/StatCard";
import { getAdminCompanies, getAdminUsers } from "../../services/admin.service";
import type { AdminCompany, AdminUser } from "../../services/admin.service";
import { useTranslation } from "../../i18n";

export default function PlatformDashboardPage() {
  const { t } = useTranslation();
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
      <PageHeader title={t("admin.dashboard.title")} subtitle={t("admin.dashboard.subtitle")} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard title={t("nav.companies")} value={companies.length} />
        <StatCard title={t("nav.users")} value={users.length} />
        <StatCard title={t("admin.dashboard.activeSubscriptions")} value={activeSubscriptions} />
      </div>
    </div>
  );
}
