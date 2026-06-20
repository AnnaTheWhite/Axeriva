import { useEffect, useState } from "react";
import PageHeader from "../../components/PageHeader";
import { getAdminCompanies } from "../../services/admin.service";
import type { AdminCompany } from "../../services/admin.service";

export default function AdminBillingPage() {
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
      <PageHeader title="Billing" subtitle="Plan and subscription status per company." />

      {isLoading ? null : (
        <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/5">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10 text-left">
                <th className="p-4">Company</th>
                <th className="p-4">Plan</th>
                <th className="p-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => (
                <tr key={company.id} className="border-b border-white/5">
                  <td className="p-4">{company.name}</td>
                  <td className="p-4 capitalize">{company.plan}</td>
                  <td className="p-4 capitalize">{company.subscriptionStatus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
