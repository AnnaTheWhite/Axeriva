import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ROLES, type Role } from "../types/auth";
import { useTranslation } from "../i18n";

// Labels are translation keys, not literal strings — resolved via t()
// below so this menu definition stays language-agnostic.
const menusByRole: Record<Role, { labelKey: string; path: string }[]> = {
  [ROLES.DEVELOPER]: [
    { labelKey: "nav.platformDashboard", path: "/admin" },
    { labelKey: "nav.companies", path: "/admin/companies" },
    { labelKey: "nav.users", path: "/admin/users" },
    { labelKey: "nav.billing", path: "/admin/billing" },
    { labelKey: "nav.logs", path: "/admin/logs" },
    { labelKey: "nav.commandCenter", path: "/command-center" },
  ],
  [ROLES.BUSINESS_OWNER]: [
    { labelKey: "nav.dashboard", path: "/" },
    { labelKey: "nav.employees", path: "/employees" },
    { labelKey: "nav.projects", path: "/projects" },
    { labelKey: "nav.customers", path: "/customers" },
    { labelKey: "nav.schedule", path: "/schedule" },
    { labelKey: "nav.timeTracking", path: "/time-tracking" },
    { labelKey: "nav.commandCenter", path: "/command-center" },
    { labelKey: "nav.subscription", path: "/subscription" },
    { labelKey: "nav.settings", path: "/settings" },
  ],
  [ROLES.EMPLOYEE]: [
    { labelKey: "nav.mySchedule", path: "/my-schedule" },
    { labelKey: "nav.myTime", path: "/my-time" },
    { labelKey: "nav.myProjects", path: "/my-projects" },
    { labelKey: "nav.profile", path: "/profile" },
  ],
};

type SidebarProps = {
  isOpen: boolean;
  onClose: () => void;
};

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const menuItems = user ? menusByRole[user.role] : [];

  return (
    <>
      {/* Backdrop — mobile/tablet only, closes the drawer on tap outside it. */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-[280px] max-w-[85vw] border-r border-white/10 bg-slate-950/95 backdrop-blur-xl transition-transform duration-200 ease-out lg:static lg:z-auto lg:max-w-none lg:translate-x-0 lg:bg-white/5 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between p-6">
          <div>
            <h1 className="text-2xl font-bold text-white">{t("common.appName")}</h1>
            <p className="mt-1 text-sm text-slate-400">{t("common.tagline")}</p>
          </div>

          <button
            onClick={onClose}
            aria-label={t("common.closeMenu")}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-white/10 hover:text-white lg:hidden"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-6 w-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <nav className="px-3">
          <ul className="space-y-2">
            {menuItems.map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  end={item.path === "/" || item.path === "/admin"}
                  onClick={onClose}
                  className={({ isActive }) =>
                    `block w-full rounded-xl px-4 py-3 text-base transition ${
                      isActive
                        ? "bg-orange-500 text-white"
                        : "text-slate-300 hover:bg-white/10 hover:text-white"
                    }`
                  }
                >
                  {t(item.labelKey)}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
    </>
  );
}
