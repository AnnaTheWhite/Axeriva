import { useEffect, useState } from "react";
import PageHeader from "../../components/PageHeader";
import EmptyState from "../../components/ui/EmptyState";
import { getAdminLogs } from "../../services/admin.service";
import type { AuditLogEntry } from "../../services/admin.service";
import { useTranslation } from "../../i18n";

export default function AdminLogsPage() {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getAdminLogs()
      .then(setLogs)
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="p-8">
      <PageHeader title={t("admin.logs.title")} subtitle={t("admin.logs.subtitle")} />

      {isLoading ? null : logs.length === 0 ? (
        <EmptyState
          title={t("admin.logs.noActivityTitle")}
          description={t("admin.logs.noActivityDesc")}
        />
      ) : (
        <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/5">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10 text-left">
                <th className="p-4">{t("table.action")}</th>
                <th className="p-4">{t("table.userId")}</th>
                <th className="p-4">{t("table.company")}</th>
                <th className="p-4">{t("table.details")}</th>
                <th className="p-4">{t("table.when")}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b border-white/5">
                  <td className="p-4 font-mono text-sm">{log.action}</td>
                  <td className="p-4">{log.userId ?? "—"}</td>
                  <td className="p-4">{log.companyName ?? "—"}</td>
                  <td className="p-4 text-sm text-slate-400">
                    {log.metadata ? JSON.stringify(log.metadata) : "—"}
                  </td>
                  <td className="p-4">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
