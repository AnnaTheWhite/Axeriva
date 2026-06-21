import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTranslation } from "../i18n";
import LanguageSwitcher from "./LanguageSwitcher";

type TopbarProps = {
  onMenuClick: () => void;
};

export default function Topbar({ onMenuClick }: TopbarProps) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { t } = useTranslation();

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <header
      className="
        flex
        items-center
        justify-between
        gap-3
        border-b
        border-white/10
        px-4
        py-4
        sm:px-8
      "
    >
      <div className="flex min-w-0 items-center gap-3">
        <button
          onClick={onMenuClick}
          aria-label={t("common.openMenu")}
          className="
            -ml-2
            shrink-0
            rounded-lg
            p-2
            text-white
            transition
            hover:bg-white/10
            lg:hidden
          "
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-6 w-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <h2 className="truncate text-lg font-semibold">
          {t("common.appName")}
        </h2>
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        {user && (
          <span className="hidden max-w-[14rem] truncate text-sm text-white/60 sm:inline">
            {user.email}
          </span>
        )}

        <LanguageSwitcher />

        <button
          onClick={handleLogout}
          className="
            rounded-xl
            border
            border-white/10
            bg-white/5
            px-3
            py-1.5
            text-sm
            text-white
            transition
            hover:bg-white/10
          "
        >
          {t("common.logout")}
        </button>

        <div
          className="
            flex
            h-10
            w-10
            shrink-0
            items-center
            justify-center
            rounded-full
            bg-orange-500
            font-bold
          "
        >
          {user?.email?.[0]?.toUpperCase() ?? "A"}
        </div>
      </div>
    </header>
  );
}
