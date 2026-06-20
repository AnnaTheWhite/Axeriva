import { useEffect, useRef, useState } from "react";

type DateTimePickerProps = {
  value: string; // "YYYY-MM-DDTHH:mm"
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
};

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function DateTimePicker({
  value,
  onChange,
  placeholder = "Select date & time",
  required,
}: DateTimePickerProps) {
  const today = new Date();
  const parsed = value ? new Date(value) : null;

  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(parsed?.getFullYear() ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed?.getMonth() ?? today.getMonth());
  const [selectedDay, setSelectedDay] = useState<number | null>(parsed?.getDate() ?? null);
  const [hour, setHour] = useState(parsed ? String(parsed.getHours()).padStart(2, "0") : "08");
  const [minute, setMinute] = useState(parsed ? String(parsed.getMinutes()).padStart(2, "0") : "00");

  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Sync state when value changes externally
  useEffect(() => {
    if (value) {
      const d = new Date(value);
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
      setSelectedDay(d.getDate());
      setHour(String(d.getHours()).padStart(2, "0"));
      setMinute(String(d.getMinutes()).padStart(2, "0"));
    }
  }, [value]);

  const getDaysInMonth = (year: number, month: number) =>
    new Date(year, month + 1, 0).getDate();

  const getFirstDayOfMonth = (year: number, month: number) =>
    new Date(year, month, 1).getDay();

  const emitChange = (day: number, h: string, m: string) => {
    const month = String(viewMonth + 1).padStart(2, "0");
    const dayStr = String(day).padStart(2, "0");
    onChange(`${viewYear}-${month}-${dayStr}T${h}:${m}`);
  };

  const handleDayClick = (day: number) => {
    setSelectedDay(day);
    emitChange(day, hour, minute);
  };

  const handleHourChange = (h: string) => {
    setHour(h);
    if (selectedDay) emitChange(selectedDay, h, minute);
  };

  const handleMinuteChange = (m: string) => {
    setMinute(m);
    if (selectedDay) emitChange(selectedDay, hour, m);
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
    ? parsed.toLocaleString("hu-HU", { dateStyle: "short", timeStyle: "short" })
    : "";

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDay = getFirstDayOfMonth(viewYear, viewMonth);
  const cells = Array.from({ length: firstDay + daysInMonth }, (_, i) =>
    i < firstDay ? null : i - firstDay + 1
  );

  const isSelected = (day: number) =>
    selectedDay === day &&
    parsed?.getFullYear() === viewYear &&
    parsed?.getMonth() === viewMonth;

  const isToday = (day: number) =>
    today.getFullYear() === viewYear &&
    today.getMonth() === viewMonth &&
    today.getDate() === day;

  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const minutes = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

  return (
    <div ref={ref} className="relative w-full">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:border-white/20 focus:border-orange-500 focus:outline-none"
      >
        <span className={displayValue ? "text-white" : "text-slate-500"}>
          {displayValue || placeholder}
        </span>
        <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
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
        <div className="absolute z-50 mt-2 rounded-2xl border border-white/10 bg-slate-900 p-4 shadow-2xl"
          style={{ minWidth: "320px" }}>

          {/* Month nav */}
          <div className="mb-4 flex items-center justify-between">
            <button type="button" onClick={prevMonth}
              className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white">
              ‹
            </button>
            <span className="font-semibold text-white">
              {MONTHS[viewMonth]} {viewYear}
            </span>
            <button type="button" onClick={nextMonth}
              className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white">
              ›
            </button>
          </div>

          {/* Day names */}
          <div className="mb-2 grid grid-cols-7 text-center">
            {DAYS.map(d => (
              <div key={d} className="text-xs font-medium text-slate-500">{d}</div>
            ))}
          </div>

          {/* Calendar cells */}
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
                ) : <div />}
              </div>
            ))}
          </div>

          {/* Time picker */}
          <div className="mt-4 border-t border-white/10 pt-4">
            <p className="mb-2 text-xs font-medium text-slate-400">Time</p>
            <div className="flex items-center gap-2">
              <select
                value={hour}
                onChange={(e) => handleHourChange(e.target.value)}
                className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-orange-500"
              >
                {hours.map(h => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>

              <span className="text-slate-400 font-bold">:</span>

              <select
                value={minute}
                onChange={(e) => handleMinuteChange(e.target.value)}
                className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-orange-500"
              >
                {minutes.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Done + Clear */}
          <div className="mt-3 flex gap-2">
            {value && (
              <button
                type="button"
                onClick={() => { onChange(""); setSelectedDay(null); setOpen(false); }}
                className="flex-1 rounded-lg py-2 text-sm text-slate-400 hover:bg-white/5 hover:text-white"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex-1 rounded-lg bg-orange-500 py-2 text-sm font-medium text-white hover:bg-orange-600"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
