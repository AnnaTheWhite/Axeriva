import { useTranslation } from "../../i18n";
import { useCalendar } from "../../context/useCalendar";
import type { CalendarView } from "../../context/calendarRange";

// CAL1.6 — view switch, date navigation and the period label.
//
// Rendered OUTSIDE react-big-calendar (the library's own toolbar is replaced
// with a no-op) so it speaks the app's design language and reads its state from
// CalendarContext rather than from the library's toolbar props. The calendar is
// driven as a CONTROLLED component; this is where the control lives.

const VIEWS: CalendarView[] = ["month", "week", "day"];

export default function CalendarToolbar() {
  const { t, language } = useTranslation();
  const { view, setView, date, range, goToday, goPrevious, goNext, isLoading } = useCalendar();

  // The same locale mapping the rest of the app uses (see SchedulePage).
  const locale = language === "hu" ? "hu-HU" : "en-US";

  const label = (() => {
    if (view === "day") {
      return new Intl.DateTimeFormat(locale, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(date);
    }

    if (view === "week") {
      // The range end is the last millisecond of the week, so the label is
      // built from the day before it — otherwise a week ending at midnight
      // would be named with the following Monday.
      const start = range.from;
      const end = new Date(range.to.getTime() - 1);
      const formatter = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
      const year = new Intl.DateTimeFormat(locale, { year: "numeric" }).format(end);
      return `${formatter.format(start)} – ${formatter.format(end)} ${year}`;
    }

    return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(date);
  })();

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={goPrevious}
          aria-label={t("calendar.toolbar.previous")}
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-slate-300 transition hover:bg-white/10"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={goNext}
          aria-label={t("calendar.toolbar.next")}
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-slate-300 transition hover:bg-white/10"
        >
          ›
        </button>
        <button
          type="button"
          onClick={goToday}
          className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/10"
        >
          {t("calendar.toolbar.today")}
        </button>

        <span className="ml-2 min-w-0 truncate text-base font-semibold text-white sm:text-lg">
          {label}
        </span>

        {/* A quiet marker rather than a spinner over the grid: the previous
            window stays visible while the next one loads. */}
        {isLoading && (
          <span className="text-xs text-slate-500">{t("calendar.toolbar.loading")}</span>
        )}
      </div>

      <div className="flex gap-2">
        {VIEWS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            onClick={() => setView(candidate)}
            aria-pressed={view === candidate}
            className={`rounded-xl border px-4 py-2 text-sm transition ${
              view === candidate
                ? "border-orange-500/40 bg-orange-500/20 text-orange-200"
                : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
            }`}
          >
            {t(`calendar.toolbar.view.${candidate}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
