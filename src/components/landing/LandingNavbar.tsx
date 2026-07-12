import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "../../i18n";
import LanguageSwitcher from "../LanguageSwitcher";

// Landing-page sections, in document order. `id` matches the section's DOM id
// (see BenefitsSection/FeaturesSection/PricingSection); `labelKey` is the i18n
// key for the nav label. Single list so desktop (and any future mobile menu)
// render from the same source.
const SECTIONS = [
  { id: "benefits", labelKey: "landing.nav.whyAxeriva" },
  { id: "features", labelKey: "landing.nav.features" },
  { id: "pricing", labelKey: "landing.nav.pricing" },
] as const;

export default function LandingNavbar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  // A landing-section link works from every page:
  // - On "/" it smooth-scrolls in place and reflects the section in the URL
  //   with a history *replace* (no stacked entries when hopping sections).
  // - On any other page it does a single client-side push to "/#<id>"; the
  //   landing page mounts and useScrollToHash performs the scroll. The real
  //   href keeps middle-click / open-in-new-tab / refresh / SEO working.
  function handleSectionClick(event: React.MouseEvent, id: string) {
    // Respect new-tab / modifier clicks — let the browser handle the href.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();

    if (location.pathname === "/") {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      navigate(`/#${id}`, { replace: true });
    } else {
      navigate(`/#${id}`);
    }
  }

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[#0f172a]/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-4 sm:px-6">
        <Link to="/" className="shrink-0 text-lg font-bold text-white sm:text-xl">
          Axeriva
        </Link>

        <nav className="hidden items-center gap-8 text-sm text-slate-300 md:flex">
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`/#${section.id}`}
              onClick={(event) => handleSectionClick(event, section.id)}
              className="hover:text-white"
            >
              {t(section.labelKey)}
            </a>
          ))}
        </nav>

        {/* LanguageSwitcher + Log in + Sign up form one header control
            group — all three share the same h-9 height and rounded-xl
            radius (matches the compact LanguageSwitcher trigger). min-w-0 +
            shrink-0 on each child + the LanguageSwitcher's own fixed width
            keep this whole group from ever pushing wider than the
            viewport, so it always stays on one row without clipping
            either auth button. No fixed height on this wrapper itself —
            same as Topbar's control group — so it sizes from its children
            (all h-9) via items-center, instead of imposing its own box.
            Gap matches Topbar's control group (gap-2 sm:gap-4) so the
            LanguageSwitcher sits with the same spacing rhythm on both the
            dashboard and the landing page. */}
        <div className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-4">
          <LanguageSwitcher />
          <Link
            to="/login"
            className="flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl px-2.5 text-xs font-medium text-white transition hover:bg-white/10 sm:px-4 sm:text-sm"
          >
            {t("landing.nav.logIn")}
          </Link>
          <Link
            to="/register"
            className="flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl bg-orange-500 px-2.5 text-xs font-medium text-white transition hover:bg-orange-600 sm:px-4 sm:text-sm"
          >
            {t("landing.nav.signUp")}
          </Link>
        </div>
      </div>
    </header>
  );
}
