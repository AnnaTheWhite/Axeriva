import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "../../components/PageHeader";
import EmptyState from "../../components/ui/EmptyState";
import Tooltip from "../../components/ui/Tooltip";
import { SkeletonTable } from "../../components/ui/Skeleton";
import {
  getAnalyticsUsers,
  exportAnalyticsUsers,
} from "../../services/adminAnalytics.service";
import type { AnalyticsUsersPage, UserStatus, UsersQuery } from "../../services/adminAnalytics.service";
import { formatRelativeTime, formatExact } from "../../utils/relativeTime";
import { useTranslation } from "../../i18n";

const inputClass =
  "rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30";

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

// Builds a CSV string from an array of flat objects.
function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(",")),
  ].join("\r\n");
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Sortable column header: a real button for keyboard access + aria-sort.
// Defined at module scope (not inside the page component) so it isn't
// re-created on every render.
function SortHeader({
  column,
  label,
  sortBy,
  sortDir,
  onToggle,
}: {
  column: string;
  label: string;
  sortBy: string;
  sortDir: "asc" | "desc";
  onToggle: (column: string) => void;
}) {
  const isActive = sortBy === column;
  const arrow = isActive ? (sortDir === "asc" ? " ↑" : " ↓") : "";
  const ariaSort = isActive ? (sortDir === "asc" ? "ascending" : "descending") : "none";
  return (
    <th className="p-0" aria-sort={ariaSort} scope="col">
      <button
        type="button"
        onClick={() => onToggle(column)}
        className="flex w-full items-center gap-1 p-4 text-left font-inherit hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40"
      >
        {label}
        <span aria-hidden="true">{arrow}</span>
      </button>
    </th>
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
  const [isExporting, setIsExporting] = useState(false);

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
    [page, debouncedSearch, role, status, plan, sortBy, sortDir],
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

  // Navigate to a user's detail page (row click / keyboard).
  const openUser = (id: number) => navigate(`/admin/users/${id}`);
  // Navigate to the company on the existing companies page (row highlight),
  // stopping propagation so the row's user-navigation doesn't also fire.
  const openCompany = (e: React.MouseEvent, companyId: number) => {
    e.stopPropagation();
    navigate(`/admin/companies?focus=${companyId}`);
  };

  // Build export query from current filter state (no page/pageSize).
  const exportQuery: Omit<UsersQuery, "page" | "pageSize"> = {
    search: debouncedSearch,
    role,
    status,
    plan,
    sortBy,
    sortDir,
  };

  async function handleExportCsv() {
    setIsExporting(true);
    try {
      const rows = await exportAnalyticsUsers(exportQuery);
      const csv = toCsv(rows as unknown as Record<string, unknown>[]);
      downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), "users.csv");
    } catch (err) {
      console.error(err);
    } finally {
      setIsExporting(false);
    }
  }

  async function handleExportXlsx() {
    setIsExporting(true);
    try {
      // Lazy-load xlsx so the ~290 kB SheetJS bundle is code-split out of the
      // main chunk and only fetched when a user actually exports to Excel.
      const XLSX = await import("xlsx");
      const rows = await exportAnalyticsUsers(exportQuery);
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Users");
      XLSX.writeFile(wb, "users.xlsx");
    } catch (err) {
      console.error(err);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="p-8">
      <PageHeader title={t("admin.users.title")} subtitle={t("admin.analytics.usersSubtitle")} />

      {/* Filters + Export */}
      <div className="mb-4 flex flex-wrap gap-3">
        <label className="min-w-[220px] flex-1">
          <span className="sr-only">{t("admin.analytics.searchPlaceholder")}</span>
          <input
            className={`${inputClass} w-full`}
            placeholder={t("admin.analytics.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select aria-label={t("admin.analytics.allRoles")} className={inputClass} value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}>
          <option value="">{t("admin.analytics.allRoles")}</option>
          <option value="BUSINESS_OWNER">BUSINESS_OWNER</option>
          <option value="EMPLOYEE">EMPLOYEE</option>
          <option value="DEVELOPER">DEVELOPER</option>
        </select>
        <select aria-label={t("admin.analytics.allStatuses")} className={inputClass} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">{t("admin.analytics.allStatuses")}</option>
          <option value="active">{t("admin.analytics.status.active")}</option>
          <option value="inactive">{t("admin.analytics.status.inactive")}</option>
          <option value="never">{t("admin.analytics.status.never")}</option>
        </select>
        <select aria-label={t("admin.analytics.allPlans")} className={inputClass} value={plan} onChange={(e) => { setPlan(e.target.value); setPage(1); }}>
          <option value="">{t("admin.analytics.allPlans")}</option>
          <option value="free">free</option>
          <option value="pro">pro</option>
          <option value="enterprise">enterprise</option>
        </select>

        {/* Export buttons */}
        <button
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:opacity-40"
          onClick={handleExportCsv}
          disabled={isExporting}
          title={t("admin.analytics.exportCsvHint")}
        >
          {isExporting ? t("admin.analytics.exporting") : t("admin.analytics.exportCsv")}
        </button>
        <button
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:opacity-40"
          onClick={handleExportXlsx}
          disabled={isExporting}
          title={t("admin.analytics.exportXlsxHint")}
        >
          {isExporting ? t("admin.analytics.exporting") : t("admin.analytics.exportXlsx")}
        </button>
      </div>

      {isLoading && !data ? (
        <SkeletonTable rows={8} cols={9} />
      ) : data?.users.length === 0 ? (
        <EmptyState
          icon="🔍"
          title={t("admin.analytics.empty.users.title")}
          description={t("admin.analytics.empty.users.desc")}
        />
      ) : (
        <div className="overflow-x-auto rounded-3xl border border-white/10 bg-white/5">
          <table className="w-full min-w-[900px] text-sm">
            <caption className="sr-only">{t("admin.users.title")}</caption>
            <thead>
              <tr className="border-b border-white/10 text-left text-slate-400">
                <SortHeader column="email" label={t("table.email")} sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} />
                <th className="p-4" scope="col">{t("nav.companies")}</th>
                <SortHeader column="role" label={t("table.role")} sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} />
                <th className="p-4" scope="col">{t("table.plan")}</th>
                <SortHeader column="createdAt" label={t("admin.analytics.registered")} sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} />
                <SortHeader column="lastLoginAt" label={t("admin.analytics.lastLogin")} sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} />
                <th className="p-4 text-center" scope="col">{t("admin.analytics.verified")}</th>
                <th className="p-4 text-center" scope="col">
                  <span className="inline-flex items-center justify-center gap-1">
                    <Tooltip label={t("admin.analytics.companyTotalsHint")}>
                      <span className="cursor-help underline decoration-dotted underline-offset-2">
                        {t("admin.analytics.companyTotalsHeader")}
                      </span>
                    </Tooltip>
                  </span>
                </th>
                <th className="p-4" scope="col">{t("table.status")}</th>
              </tr>
            </thead>
            <tbody>
              {data?.users.map((u) => (
                <tr
                  key={u.id}
                  className="cursor-pointer border-b border-white/5 hover:bg-white/5 focus-within:bg-white/5"
                  onClick={() => openUser(u.id)}
                >
                  <td className="p-4 font-medium">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openUser(u.id); }}
                      className="text-left hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                      aria-label={t("admin.analytics.viewUser", { email: u.email })}
                    >
                      {u.email}
                    </button>
                  </td>
                  <td className="p-4 text-slate-300">
                    {u.company ? (
                      <button
                        type="button"
                        onClick={(e) => openCompany(e, u.company!.id)}
                        className="text-left text-indigo-300 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                      >
                        {u.company.name}
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="p-4 text-slate-300">{u.role}</td>
                  <td className="p-4 text-slate-300">{u.plan ?? "—"}</td>
                  <td className="p-4 text-slate-300">{formatDate(u.createdAt)}</td>
                  <td className="p-4 text-slate-300">
                    <Tooltip label={formatExact(u.lastLoginAt)}>
                      <span className="cursor-help">{formatRelativeTime(u.lastLoginAt, t)}</span>
                    </Tooltip>
                  </td>
                  <td className="p-4 text-center">{u.emailVerified ? "✓" : "—"}</td>
                  <td className="p-4 text-center tabular-nums text-slate-300">{u.projectCount} / {u.employeeCount} / {u.customerCount}</td>
                  <td className="p-4"><StatusBadge status={u.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm text-slate-400" aria-label={t("admin.analytics.pagination")}>
          <span>{t("admin.analytics.totalCount", { total: String(data.total) })}</span>
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg border border-white/10 px-3 py-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:opacity-40"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {t("admin.analytics.prev")}
            </button>
            <span>{page} / {data.totalPages}</span>
            <button
              className="rounded-lg border border-white/10 px-3 py-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:opacity-40"
              disabled={page >= data.totalPages}
              onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
            >
              {t("admin.analytics.next")}
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}
