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

const MENU_WIDTH = 128; // matches w-32
const ESTIMATED_MENU_HEIGHT = LANGUAGES.length * 36 + 8;
const VIEWPORT_MARGIN = 8;

type MenuPosition = {
  top: number;
  left: number;
};

// Compact dropdown reused in both the authenticated Topbar and the public
// LandingNavbar. Closed state only ever shows the current language's short
// code ("HU"/"EN"), so the trigger button stays a fixed, narrow size
// regardless of language — unlike a native <select>, whose closed-state
// width follows the selected <option> text and previously made this
// control balloon to form-field size. Opening reveals the full language
// names ("Magyar"/"English") in a small menu, same interaction pattern as
// CustomSelect.tsx elsewhere in the app. i18n logic (useTranslation,
// setLanguage) and localStorage persistence are untouched — this is a
// pure presentation change.
export default function LanguageSwitcher() {
  const { language, setLanguage, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
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

    // Dropdowns can't reliably track scroll/resize while staying simple, so
    // instead of repositioning continuously we just close on either — the
    // same convention as click-outside. This avoids a stale, misplaced
    // menu after the page moves under it.
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
      const openUpward = spaceBelow < ESTIMATED_MENU_HEIGHT && rect.top > spaceBelow;

      const top = openUpward
        ? Math.max(VIEWPORT_MARGIN, rect.top - ESTIMATED_MENU_HEIGHT - 8)
        : Math.min(rect.bottom + 8, window.innerHeight - ESTIMATED_MENU_HEIGHT - VIEWPORT_MARGIN);

      const left = Math.min(
        Math.max(VIEWPORT_MARGIN, rect.right - MENU_WIDTH),
        window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN
      );

      setMenuPosition({ top, left });
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

      {/* Fixed + viewport-clamped instead of absolute-below-trigger: a
          regular absolute/top-full menu can render past the bottom edge of
          the window when the trigger sits low on the page (e.g. a short
          page, or no sticky header), which grows the document's scrollable
          area and forces the user to scroll just to reach the options.
          Computing top/left from the trigger's getBoundingClientRect() at
          open time and clamping against window.innerHeight/innerWidth
          keeps the whole menu on-screen and flips it above the trigger
          when there isn't room below — without ever expanding page
          height, since fixed elements are positioned relative to the
          viewport, not the document flow. */}
      {open && menuPosition && (
        <div
          role="listbox"
          style={{ position: "fixed", top: menuPosition.top, left: menuPosition.left, width: MENU_WIDTH }}
          className="z-50 overflow-hidden rounded-xl border border-white/10 bg-slate-900 shadow-2xl"
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
