import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "../../components/PageHeader";
import { getAnalyticsUsers } from "../../services/adminAnalytics.service";
import type { AnalyticsUsersPage, UserStatus } from "../../services/adminAnalytics.service";
import { useTranslation } from "../../i18n";

const inputClass =
  "rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-white/30 focus:outline-none";

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "—";
}

function StatusBadge({ status }: { status: UserStatus }) {
  const { t } = useTranslation();
  const styles: Record<UserStatus, string> = {
    active: "bg-emerald-500/15 text-emerald-300",
    inactive: "bg-amber-500/15 text-amber-300",
    never: "bg-slate-500/15 text-slate-400",
  };
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${styles[status]}`}>
      {t(`admin.analytics.status.${status}`)}
    </span>
  );
}

export default function AdminUsersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [plan, setPlan] = useState("");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  const [data, setData] = useState<AnalyticsUsersPage | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Debounce the search box so typing doesn't fire a request per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useMemo(
    () => ({ page, pageSize: 20, search: debouncedSearch, role, status, plan, sortBy, sortDir }),
    [page, debouncedSearch, role, status, plan, sortBy, sortDir]
  );

  useEffect(() => {
    setIsLoading(true);
    getAnalyticsUsers(query)
      .then(setData)
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [query]);

  function toggleSort(column: string) {
    if (sortBy === column) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column);
      setSortDir("desc");
    }
    setPage(1);
  }

  const sortArrow = (column: string) => (sortBy === column ? (sortDir === "asc" ? " ↑" : " ↓") : "");

  return (
    <div className="p-8">
      <PageHeader title={t("admin.users.title")} subtitle={t("admin.analytics.usersSubtitle")} />

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3">
        <input
          className={`${inputClass} min-w-[220px] flex-1`}
          placeholder={t("admin.analytics.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className={inputClass} value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}>
          <option value="">{t("admin.analytics.allRoles")}</option>
          <option value="BUSINESS_OWNER">BUSINESS_OWNER</option>
          <option value="EMPLOYEE">EMPLOYEE</option>
          <option value="DEVELOPER">DEVELOPER</option>
        </select>
        <select className={inputClass} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">{t("admin.analytics.allStatuses")}</option>
          <option value="active">{t("admin.analytics.status.active")}</option>
          <option value="inactive">{t("admin.analytics.status.inactive")}</option>
          <option value="never">{t("admin.analytics.status.never")}</option>
        </select>
        <select className={inputClass} value={plan} onChange={(e) => { setPlan(e.target.value); setPage(1); }}>
          <option value="">{t("admin.analytics.allPlans")}</option>
          <option value="free">free</option>
          <option value="pro">pro</option>
          <option value="enterprise">enterprise</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-3xl border border-white/10 bg-white/5">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-slate-400">
              <th className="cursor-pointer p-4" onClick={() => toggleSort("email")}>{t("table.email")}{sortArrow("email")}</th>
              <th className="p-4">{t("nav.companies")}</th>
              <th className="cursor-pointer p-4" onClick={() => toggleSort("role")}>{t("table.role")}{sortArrow("role")}</th>
              <th className="p-4">{t("table.plan")}</th>
              <th className="cursor-pointer p-4" onClick={() => toggleSort("createdAt")}>{t("admin.analytics.registered")}{sortArrow("createdAt")}</th>
              <th className="cursor-pointer p-4" onClick={() => toggleSort("lastLoginAt")}>{t("admin.analytics.lastLogin")}{sortArrow("lastLoginAt")}</th>
              <th className="p-4 text-center">{t("admin.analytics.verified")}</th>
              <th className="p-4 text-center" title={t("admin.analytics.companyTotalsHint")}>P / E / C</th>
              <th className="p-4">{t("table.status")}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && !data ? null : data?.users.length === 0 ? (
              <tr><td colSpan={9} className="p-8 text-center text-slate-400">{t("admin.analytics.noUsers")}</td></tr>
            ) : (
              data?.users.map((u) => (
                <tr
                  key={u.id}
                  className="cursor-pointer border-b border-white/5 hover:bg-white/5"
                  onClick={() => navigate(`/admin/users/${u.id}`)}
                >
                  <td className="p-4 font-medium">{u.email}</td>
                  <td className="p-4 text-slate-300">{u.company?.name ?? "—"}</td>
                  <td className="p-4 text-slate-300">{u.role}</td>
                  <td className="p-4 text-slate-300">{u.plan ?? "—"}</td>
                  <td className="p-4 text-slate-300">{formatDate(u.createdAt)}</td>
                  <td className="p-4 text-slate-300">{formatDate(u.lastLoginAt)}</td>
                  <td className="p-4 text-center">{u.emailVerified ? "✓" : "—"}</td>
                  <td className="p-4 text-center text-slate-300">{u.projectCount} / {u.employeeCount} / {u.customerCount}</td>
                  <td className="p-4"><StatusBadge status={u.status} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-400">
          <span>{t("admin.analytics.totalCount", { total: String(data.total) })}</span>
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg border border-white/10 px-3 py-1.5 disabled:opacity-40"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {t("admin.analytics.prev")}
            </button>
            <span>{page} / {data.totalPages}</span>
            <button
              className="rounded-lg border border-white/10 px-3 py-1.5 disabled:opacity-40"
              disabled={page >= data.totalPages}
              onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
            >
              {t("admin.analytics.next")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
