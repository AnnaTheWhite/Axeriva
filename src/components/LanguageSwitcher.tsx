import { LANGUAGES, useTranslation, type Language } from "../i18n";

const LABEL_KEY: Record<Language, string> = {
  en: "language.english",
  hu: "language.hungarian",
};

const SHORT_LABEL: Record<Language, string> = {
  en: "EN",
  hu: "HU",
};

// Single switcher reused in both the authenticated Topbar and the public
// LandingNavbar — h-10 + px-3 sm:px-4 here must stay in sync with the
// Login/Sign up/Logout button styles in those two headers so every header
// control lines up at the same height regardless of which language is
// selected (selected option text length must never shift the box size).
export default function LanguageSwitcher() {
  const { language, setLanguage, t } = useTranslation();

  return (
    <select
      value={language}
      onChange={(e) => setLanguage(e.target.value as Language)}
      aria-label={t("common.appName")}
      className="h-10 shrink-0 whitespace-nowrap rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white outline-none transition hover:bg-white/10 focus:border-orange-500 sm:px-4"
    >
      {LANGUAGES.map((lang) => (
        <option key={lang} value={lang}>
          {SHORT_LABEL[lang]} — {t(LABEL_KEY[lang])}
        </option>
      ))}
    </select>
  );
}
