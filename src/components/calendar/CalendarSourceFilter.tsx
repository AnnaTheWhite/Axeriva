import { useTranslation } from "../../i18n";
import { useCalendar } from "../../context/useCalendar";
import ShareLevelControl from "./ShareLevelControl";
import { useAuth } from "../../context/AuthContext";
import { colorFor } from "./calendarColors";

// CAL1.6 — which calendars are drawn.
//
// SCOPE NOTE: in CAL1.6 the "sources" are calendars and nothing else. The
// read-only layers over the existing operational rows (Shift, Task.dueDate,
// Reminder.dueDate, Project.deadline) are CAL1.7 — services/calendar/sources.ts
// does not exist yet, so there is nothing else to switch on. The layer toggles
// belong here when that milestone lands; adding empty placeholders for them now
// would be shipping a control that does nothing.

export default function CalendarSourceFilter() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { calendars, selectedCalendarIds, toggleCalendar, calendarsLoading } = useCalendar();

  // The share-level control belongs to the caller's OWN personal calendar and
  // to no other row — a company owner has no authority over an employee's, and
  // the server answers them 404 (R2/§4.8).
  const ownPersonal = calendars.find(
    (calendar) => calendar.type === "PERSONAL" && calendar.ownerUserId === (user?.id ?? null)
  );

  return (
    <aside className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <p className="text-sm font-medium text-white">{t("calendar.filter.title")}</p>

        {calendarsLoading ? (
          <p className="mt-3 text-sm text-slate-400">{t("common.loading")}</p>
        ) : calendars.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">{t("calendar.filter.empty")}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {calendars.map((calendar) => (
              <li key={calendar.id}>
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selectedCalendarIds.includes(calendar.id)}
                    onChange={() => toggleCalendar(calendar.id)}
                    className="h-4 w-4 accent-orange-500"
                  />
                  <span
                    aria-hidden="true"
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: colorFor(calendar) }}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-300">
                    {calendar.name}
                  </span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {t(`calendar.type.${calendar.type}`)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      {ownPersonal && <ShareLevelControl calendar={ownPersonal} />}
    </aside>
  );
}
