import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../../i18n";

type DatePickerProps = {
  value: string; // "YYYY-MM-DD"
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
};

const DAYS_EN = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const DAYS_HU = ["V", "H", "K", "Sze", "Cs", "P", "Szo"];

const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_HU = [
  "Január", "Február", "Március", "Április", "Május", "Június",
  "Július", "Augusztus", "Szeptember", "Október", "November", "December",
];

export default function DatePicker({
  value,
  onChange,
  placeholder,
  required,
}: DatePickerProps) {
  const { t, language } = useTranslation();
  const DAYS = language === "hu" ? DAYS_HU : DAYS_EN;
  const MONTHS = language === "hu" ? MONTHS_HU : MONTHS_EN;
  const dateLocale = language === "hu" ? "hu-HU" : "en-US";
  const resolvedPlaceholder = placeholder ?? t("common.selectDate");

  const today = new Date();
  const parsed = value ? new Date(value + "T00:00:00") : null;

  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(parsed?.getFullYear() ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed?.getMonth() ?? today.getMonth());

  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const getDaysInMonth = (year: number, month: number) =>
    new Date(year, month + 1, 0).getDate();

  const getFirstDayOfMonth = (year: number, month: number) =>
    new Date(year, month, 1).getDay();

  const handleDayClick = (day: number) => {
    const month = String(viewMonth + 1).padStart(2, "0");
    const dayStr = String(day).padStart(2, "0");
    onChange(`${viewYear}-${month}-${dayStr}`);
    setOpen(false);
  };

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };

  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  const displayValue = parsed
    ? parsed.toLocaleDateString(dateLocale)
    : "";

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDay = getFirstDayOfMonth(viewYear, viewMonth);
  const cells = Array.from({ length: firstDay + daysInMonth }, (_, i) =>
    i < firstDay ? null : i - firstDay + 1
  );

  const isSelected = (day: number) => {
    if (!parsed) return false;
    return (
      parsed.getFullYear() === viewYear &&
      parsed.getMonth() === viewMonth &&
      parsed.getDate() === day
    );
  };

  const isToday = (day: number) =>
    today.getFullYear() === viewYear &&
    today.getMonth() === viewMonth &&
    today.getDate() === day;

  return (
    <div ref={ref} className="relative w-full">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:border-white/20 focus:border-orange-500 focus:outline-none"
      >
        <span className={displayValue ? "text-white" : "text-slate-500"}>
          {displayValue || resolvedPlaceholder}
        </span>
        <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </button>

      {required && (
        <input
          type="text"
          required
          value={value}
          onChange={() => {}}
          className="absolute inset-0 opacity-0 pointer-events-none"
          tabIndex={-1}
        />
      )}

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-2 w-[calc(100vw-2rem)] max-w-72 rounded-2xl border border-white/10 bg-slate-900 p-4 shadow-2xl sm:w-72">
          {/* Header */}
          <div className="mb-4 flex items-center justify-between">
            <button
              type="button"
              onClick={prevMonth}
              className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
            >
              ‹
            </button>

            <span className="font-semibold text-white">
              {MONTHS[viewMonth]} {viewYear}
            </span>

            <button
              type="button"
              onClick={nextMonth}
              className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
            >
              ›
            </button>
          </div>

          {/* Day names */}
          <div className="mb-2 grid grid-cols-7 text-center">
            {DAYS.map(d => (
              <div key={d} className="text-xs font-medium text-slate-500">{d}</div>
            ))}
          </div>

          {/* Cells */}
          <div className="grid grid-cols-7 gap-y-1 text-center">
            {cells.map((day, i) => (
              <div key={i}>
                {day ? (
                  <button
                    type="button"
                    onClick={() => handleDayClick(day)}
                    className={`h-8 w-8 rounded-lg text-sm transition ${
                      isSelected(day)
                        ? "bg-orange-500 font-bold text-white"
                        : isToday(day)
                        ? "border border-orange-500/50 text-orange-400 hover:bg-white/10"
                        : "text-slate-300 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    {day}
                  </button>
                ) : (
                  <div />
                )}
              </div>
            ))}
          </div>

          {/* Clear */}
          {value && (
            <button
              type="button"
              onClick={() => { onChange(""); setOpen(false); }}
              className="mt-3 w-full rounded-lg py-1 text-sm text-slate-400 hover:bg-white/5 hover:text-white"
            >
              {t("common.clear")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
