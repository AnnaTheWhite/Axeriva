import { useEffect, useState } from "react";
import PageHeader from "../../components/PageHeader";
import { getAdminUsers } from "../../services/admin.service";
import type { AdminUser } from "../../services/admin.service";
import { useTranslation } from "../../i18n";

export default function AdminUsersPage() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getAdminUsers()
      .then(setUsers)
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="p-8">
      <PageHeader title={t("admin.users.title")} subtitle={t("admin.users.subtitle")} />

      {isLoading ? null : (
        <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/5">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10 text-left">
                <th className="p-4">{t("table.id")}</th>
                <th className="p-4">{t("table.email")}</th>
                <th className="p-4">{t("table.role")}</th>
                <th className="p-4">{t("table.companyId")}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-white/5">
                  <td className="p-4">{user.id}</td>
                  <td className="p-4">{user.email}</td>
                  <td className="p-4">{user.role}</td>
                  <td className="p-4">{user.companyId ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
