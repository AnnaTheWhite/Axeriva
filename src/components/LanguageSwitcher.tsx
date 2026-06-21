import { LANGUAGES, useTranslation, type Language } from "../i18n";

const LABEL_KEY: Record<Language, string> = {
  en: "language.english",
  hu: "language.hungarian",
};

const SHORT_LABEL: Record<Language, string> = {
  en: "EN",
  hu: "HU",
};

// Single switcher reused in Topbar — same component renders correctly on
// both mobile and desktop since Topbar itself is always visible.
export default function LanguageSwitcher() {
  const { language, setLanguage, t } = useTranslation();

  return (
    <select
      value={language}
      onChange={(e) => setLanguage(e.target.value as Language)}
      aria-label={t("common.appName")}
      className="rounded-xl border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white outline-none transition hover:bg-white/10 focus:border-orange-500"
    >
      {LANGUAGES.map((lang) => (
        <option key={lang} value={lang}>
          {SHORT_LABEL[lang]} — {t(LABEL_KEY[lang])}
        </option>
      ))}
    </select>
  );
}
