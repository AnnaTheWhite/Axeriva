import { useTranslation } from "../../i18n";
import {
  FREQUENCIES,
  MAX_COUNT,
  MAX_INTERVAL,
  WEEKDAYS,
  type Frequency,
  type RecurrenceState,
  type Weekday,
} from "./recurrenceRule";

// CAL1.6 — the recurrence editor's UI. The RRULE conversion, and the reason it
// is constrained the way it is, lives in ./recurrenceRule.ts.

type RecurrenceEditorProps = {
  value: RecurrenceState;
  onChange: (value: RecurrenceState) => void;
  disabled?: boolean;
};

const fieldClass =
  "w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-orange-500 disabled:cursor-not-allowed disabled:opacity-50";

export default function RecurrenceEditor({ value, onChange, disabled }: RecurrenceEditorProps) {
  const { t } = useTranslation();

  const patch = (changes: Partial<RecurrenceState>) => onChange({ ...value, ...changes });

  const toggleDay = (day: Weekday) => {
    patch({
      byDay: value.byDay.includes(day)
        ? value.byDay.filter((candidate) => candidate !== day)
        : [...value.byDay, day],
    });
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={value.enabled}
          disabled={disabled}
          onChange={(event) => patch({ enabled: event.target.checked })}
          className="h-4 w-4 accent-orange-500"
        />
        <span className="text-sm font-medium text-white">{t("calendar.recurrence.repeats")}</span>
      </label>

      {value.enabled && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm text-slate-400">
                {t("calendar.recurrence.frequency")}
              </label>
              <select
                value={value.freq}
                disabled={disabled}
                onChange={(event) => patch({ freq: event.target.value as Frequency })}
                className={fieldClass}
              >
                {FREQUENCIES.map((frequency) => (
                  <option key={frequency} value={frequency}>
                    {t(`calendar.recurrence.freq.${frequency}`)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm text-slate-400">
                {t("calendar.recurrence.interval")}
              </label>
              <input
                type="number"
                min={1}
                max={MAX_INTERVAL}
                value={value.interval}
                disabled={disabled}
                onChange={(event) => patch({ interval: Number(event.target.value) || 1 })}
                className={fieldClass}
              />
            </div>
          </div>

          {/* BYDAY is WEEKLY-only in the server's grammar — offering it under
              any other frequency would build a rule guaranteed to be refused. */}
          {value.freq === "WEEKLY" && (
            <div>
              <label className="mb-2 block text-sm text-slate-400">
                {t("calendar.recurrence.onDays")}
              </label>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((day) => (
                  <button
                    key={day}
                    type="button"
                    disabled={disabled}
                    onClick={() => toggleDay(day)}
                    className={`rounded-xl border px-3 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      value.byDay.includes(day)
                        ? "border-orange-500/40 bg-orange-500/20 text-orange-200"
                        : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                    }`}
                  >
                    {t(`calendar.recurrence.day.${day}`)}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-500">{t("calendar.recurrence.onDaysHint")}</p>
            </div>
          )}

          <div>
            <label className="mb-2 block text-sm text-slate-400">
              {t("calendar.recurrence.ends")}
            </label>
            <div className="space-y-3">
              {(["never", "count", "until"] as const).map((mode) => (
                <label key={mode} className="flex flex-wrap items-center gap-3">
                  <input
                    type="radio"
                    name="recurrence-end"
                    checked={value.endMode === mode}
                    disabled={disabled}
                    onChange={() => patch({ endMode: mode })}
                    className="h-4 w-4 accent-orange-500"
                  />
                  <span className="text-sm text-slate-300">
                    {t(`calendar.recurrence.end.${mode}`)}
                  </span>

                  {mode === "count" && value.endMode === "count" && (
                    <input
                      type="number"
                      min={1}
                      max={MAX_COUNT}
                      value={value.count}
                      disabled={disabled}
                      onChange={(event) => patch({ count: Number(event.target.value) || 1 })}
                      className="w-28 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-orange-500"
                    />
                  )}

                  {mode === "until" && value.endMode === "until" && (
                    <input
                      type="date"
                      value={value.until}
                      disabled={disabled}
                      onChange={(event) => patch({ until: event.target.value })}
                      className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-orange-500"
                    />
                  )}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
