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
// LandingNavbar. A native <select> sizes its closed-state box to fit
// whichever <option> text is currently selected — with the full language
// name in there ("EN — English" vs "HU — Hungarian"), the box width
// changed depending on the selected language, which on the landing page
// pushed the Login/Sign up buttons partially off-screen. Showing only the
// short code (EN/HU) keeps the rendered text identical length in both
// languages, and the fixed w-14/w-16 caps the box so it can never grow
// past that regardless of font or OS rendering differences. The full
// language name is still available via `title` for hover/accessibility.
export default function LanguageSwitcher() {
  const { language, setLanguage, t } = useTranslation();

  return (
    <select
      value={language}
      onChange={(e) => setLanguage(e.target.value as Language)}
      aria-label={t("common.appName")}
      title={t(LABEL_KEY[language])}
      className="h-9 w-14 shrink-0 whitespace-nowrap rounded-xl border border-white/10 bg-white/5 px-1 text-center text-xs leading-none text-white outline-none transition hover:bg-white/10 focus:border-orange-500"
    >
      {LANGUAGES.map((lang) => (
        <option key={lang} value={lang} title={t(LABEL_KEY[lang])}>
          {SHORT_LABEL[lang]}
        </option>
      ))}
    </select>
  );
}
