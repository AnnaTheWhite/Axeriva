import { useEffect, useRef, useState } from "react";
import { LANGUAGES, useTranslation, type Language } from "../i18n";

const LABEL_KEY: Record<Language, string> = {
  en: "language.english",
  hu: "language.hungarian",
};

const SHORT_LABEL: Record<Language, string> = {
  en: "EN",
  hu: "HU",
};

const ESTIMATED_MENU_HEIGHT = LANGUAGES.length * 36 + 8;

// Compact dropdown reused in both the authenticated Topbar and the public
// LandingNavbar. Closed state only ever shows the current language's short
// code ("HU"/"EN"), so the trigger button stays a fixed, narrow size
// regardless of language — unlike a native <select>, whose closed-state
// width follows the selected <option> text. Opening reveals the full
// language names ("Magyar"/"English") in a small menu, same interaction
// pattern as CustomSelect.tsx elsewhere in the app. i18n logic
// (useTranslation, setLanguage) and localStorage persistence are
// untouched — this is a pure presentation change.
export default function LanguageSwitcher() {
  const { language, setLanguage, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!open) return;

    // The up/down decision is measured once at open time; if the page
    // scrolls or resizes while open, that decision can go stale, so we
    // just close instead of repositioning continuously — same convention
    // as click-outside.
    function close() {
      setOpen(false);
    }

    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  function handleTriggerClick() {
    if (open) {
      setOpen(false);
      return;
    }

    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const spaceBelow = window.innerHeight - rect.bottom;
      setOpenUpward(spaceBelow < ESTIMATED_MENU_HEIGHT && rect.top > spaceBelow);
    }

    setOpen(true);
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={handleTriggerClick}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("common.appName")}
        className="flex h-9 items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2.5 text-xs font-medium text-white transition hover:bg-white/10"
      >
        {SHORT_LABEL[language]}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* `absolute`, anchored to this component's own `relative` wrapper —
          not `position: fixed`. A previous version used fixed positioning
          computed from getBoundingClientRect(), but LandingNavbar's header
          uses backdrop-blur-xl (backdrop-filter), which establishes a new
          containing block for fixed-position descendants in modern
          browsers. That silently broke the viewport-relative math, making
          the menu (and visually, the trigger/header area around it)
          behave unpredictably instead of acting as a clean overlay.
          `absolute` only cares about the nearest positioned ancestor —
          this wrapper — so it's immune to that bug regardless of any
          backdrop-filter/transform on outer ancestors. It still never
          takes up document flow space and never changes the trigger's or
          navbar's size, since flex siblings only react to in-flow boxes.
          The up/down flip (top-full vs bottom-full) is decided once at
          open time from the trigger's real position, so a trigger sitting
          low on a short page opens upward instead of spilling past the
          viewport bottom and growing the page's scrollable area. */}
      {open && (
        <div
          role="listbox"
          className={`absolute right-0 z-50 w-32 overflow-hidden rounded-xl border border-white/10 bg-slate-900 shadow-2xl ${
            openUpward ? "bottom-full mb-2" : "top-full mt-2"
          }`}
        >
          {LANGUAGES.map((lang) => (
            <button
              key={lang}
              type="button"
              role="option"
              aria-selected={lang === language}
              onClick={() => {
                setLanguage(lang);
                setOpen(false);
              }}
              className={`flex w-full items-center px-3 py-2 text-left text-sm transition hover:bg-orange-500/10 hover:text-orange-400 ${
                lang === language ? "bg-orange-500/15 text-orange-400" : "text-slate-300"
              }`}
            >
              {t(LABEL_KEY[lang])}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
