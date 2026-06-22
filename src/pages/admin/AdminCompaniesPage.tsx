import { useEffect, useState } from "react";
import PageHeader from "../../components/PageHeader";
import { getAdminCompanies } from "../../services/admin.service";
import type { AdminCompany } from "../../services/admin.service";
import { useTranslation } from "../../i18n";

export default function AdminCompaniesPage() {
  const { t } = useTranslation();
  const [companies, setCompanies] = useState<AdminCompany[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getAdminCompanies()
      .then(setCompanies)
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="p-8">
      <PageHeader title={t("admin.companies.title")} subtitle={t("admin.companies.subtitle")} />

      {isLoading ? null : (
        <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/5">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10 text-left">
                <th className="p-4">{t("table.id")}</th>
                <th className="p-4">{t("table.name")}</th>
                <th className="p-4">{t("table.plan")}</th>
                <th className="p-4">{t("table.status")}</th>
                <th className="p-4">{t("table.users")}</th>
                <th className="p-4">{t("table.employees")}</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => (
                <tr key={company.id} className="border-b border-white/5">
                  <td className="p-4">{company.id}</td>
                  <td className="p-4">{company.name}</td>
                  <td className="p-4 capitalize">{company.plan}</td>
                  <td className="p-4 capitalize">{company.subscriptionStatus}</td>
                  <td className="p-4">{company._count.users}</td>
                  <td className="p-4">{company._count.employees}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
