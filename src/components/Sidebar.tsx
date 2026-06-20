import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ROLES, type Role } from "../types/auth";

const menusByRole: Record<Role, { label: string; path: string }[]> = {
  [ROLES.DEVELOPER]: [
    { label: "Platform Dashboard", path: "/admin" },
    { label: "Companies", path: "/admin/companies" },
    { label: "Users", path: "/admin/users" },
    { label: "Billing", path: "/admin/billing" },
    { label: "Logs", path: "/admin/logs" },
  ],
  [ROLES.BUSINESS_OWNER]: [
    { label: "Dashboard", path: "/" },
    { label: "Employees", path: "/employees" },
    { label: "Projects", path: "/projects" },
    { label: "Customers", path: "/customers" },
    { label: "Schedule", path: "/schedule" },
    { label: "Time Tracking", path: "/time-tracking" },
    { label: "Subscription", path: "/subscription" },
    { label: "Settings", path: "/settings" },
  ],
  [ROLES.EMPLOYEE]: [
    { label: "My Schedule", path: "/my-schedule" },
    { label: "My Time", path: "/my-time" },
    { label: "My Projects", path: "/my-projects" },
    { label: "Profile", path: "/profile" },
  ],
};

export default function Sidebar() {
  const { user } = useAuth();
  const menuItems = user ? menusByRole[user.role] : [];

  return (
    <aside className="w-[280px] border-r border-white/10 bg-white/5 backdrop-blur-xl">
      <div className="p-6">
        <h1 className="text-2xl font-bold text-white">CrewFlow</h1>
        <p className="mt-1 text-sm text-slate-400">Workforce Management</p>
      </div>

      <nav className="px-3">
        <ul className="space-y-2">
          {menuItems.map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                end={item.path === "/" || item.path === "/admin"}
                className={({ isActive }) =>
                  `block w-full rounded-xl px-4 py-3 transition ${
                    isActive
                      ? "bg-orange-500 text-white"
                      : "text-slate-300 hover:bg-white/10 hover:text-white"
                  }`
                }
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
