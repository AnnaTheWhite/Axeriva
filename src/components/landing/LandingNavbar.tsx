import { Link } from "react-router-dom";
import { useTranslation } from "../../i18n";
import LanguageSwitcher from "../LanguageSwitcher";

export default function LandingNavbar() {
  const { t } = useTranslation();
  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[#0f172a]/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link to="/" className="text-xl font-bold text-white">
          Axeriva
        </Link>

        <nav className="hidden items-center gap-8 text-sm text-slate-300 md:flex">
          <a href="#benefits" className="hover:text-white">
            {t("landing.nav.whyAxeriva")}
          </a>
          <a href="#features" className="hover:text-white">
            {t("landing.nav.features")}
          </a>
          <Link to="/pricing" className="hover:text-white">
            {t("landing.nav.pricing")}
          </Link>
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <LanguageSwitcher />
          <Link
            to="/login"
            className="rounded-xl px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10 sm:px-4"
          >
            {t("landing.nav.logIn")}
          </Link>
          <Link
            to="/register"
            className="rounded-xl bg-orange-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-orange-600 sm:px-4"
          >
            {t("landing.nav.signUp")}
          </Link>
        </div>
      </div>
    </header>
  );
}
