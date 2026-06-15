import { NavLink } from "react-router-dom";

const menuItems = [
  {
    label: "Dashboard",
    path: "/",
  },
  {
    label: "Employees",
    path: "/employees",
  },
  {
    label: "Projects",
    path: "/projects",
  },
  {
    label: "Schedules",
    path: "/schedules",
  },
  {
    label: "Work Logs",
    path: "/worklogs",
  },
  {
    label: "Reports",
    path: "/reports",
  },
  {
    label: "Settings",
    path: "/settings",
  },
];

export default function Sidebar() {
  return (
    <aside
      className="
        w-[280px]
        border-r
        border-white/10
        bg-white/5
        backdrop-blur-xl
      "
    >
      <div className="p-6">
        <h1 className="text-2xl font-bold">
          CrewFlow
        </h1>

        <p className="mt-1 text-sm text-slate-400">
          Workforce Management
        </p>
      </div>

      <nav className="px-3">
        <ul className="space-y-2">
          {menuItems.map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                className={({ isActive }) =>
                  `
                  block
                  w-full
                  rounded-xl
                  px-4
                  py-3
                  transition
                  ${
                    isActive
                      ? "bg-orange-500 text-white"
                      : "text-slate-300 hover:bg-white/10 hover:text-white"
                  }
                `
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