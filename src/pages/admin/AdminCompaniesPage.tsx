import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import PageHeader from "../../components/PageHeader";
import EmptyState from "../../components/ui/EmptyState";
import { SkeletonTable } from "../../components/ui/Skeleton";
import { getAdminCompanies } from "../../services/admin.service";
import type { AdminCompany } from "../../services/admin.service";
import { useTranslation } from "../../i18n";

export default function AdminCompaniesPage() {
  const { t } = useTranslation();
  const [companies, setCompanies] = useState<AdminCompany[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Optional ?focus=<id> deep-link from the analytics pages: highlight and
  // scroll the matching company row into view.
  const [searchParams] = useSearchParams();
  const focusId = Number(searchParams.get("focus")) || null;
  const focusRef = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    getAdminCompanies()
      .then(setCompanies)
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  // Once data is in and a focus target exists, scroll it into view.
  useEffect(() => {
    if (!isLoading && focusId && focusRef.current) {
      focusRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isLoading, focusId, companies]);

  return (
    <div className="p-8">
      <PageHeader title={t("admin.companies.title")} subtitle={t("admin.companies.subtitle")} />

      {isLoading ? (
        <SkeletonTable rows={8} cols={6} />
      ) : companies.length === 0 ? (
        <EmptyState
          icon="🏢"
          title={t("admin.companies.empty.title")}
          description={t("admin.companies.empty.desc")}
        />
      ) : (
        <div className="overflow-x-auto rounded-3xl border border-white/10 bg-white/5">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="border-b border-white/10 text-left">
                <th className="p-4" scope="col">{t("table.id")}</th>
                <th className="p-4" scope="col">{t("table.name")}</th>
                <th className="p-4" scope="col">{t("table.plan")}</th>
                <th className="p-4" scope="col">{t("table.status")}</th>
                <th className="p-4" scope="col">{t("table.users")}</th>
                <th className="p-4" scope="col">{t("table.employees")}</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => {
                const isFocused = company.id === focusId;
                return (
                  <tr
                    key={company.id}
                    ref={isFocused ? focusRef : undefined}
                    className={`border-b border-white/5 transition-colors ${
                      isFocused ? "bg-indigo-500/15 ring-1 ring-inset ring-indigo-400/40" : ""
                    }`}
                  >
                    <td className="p-4">{company.id}</td>
                    <td className="p-4">{company.name}</td>
                    <td className="p-4 capitalize">{company.plan}</td>
                    <td className="p-4 capitalize">{company.subscriptionStatus}</td>
                    <td className="p-4">{company._count.users}</td>
                    <td className="p-4">{company._count.employees}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
