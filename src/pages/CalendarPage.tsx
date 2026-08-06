import { useMemo, useState } from "react";
import { Calendar, dateFnsLocalizer, type View } from "react-big-calendar";
import { format, getDay, parse, startOfWeek } from "date-fns";
import { enUS, hu } from "date-fns/locale";

import "react-big-calendar/lib/css/react-big-calendar.css";

import CalendarToolbar from "../components/calendar/CalendarToolbar";
import CalendarSourceFilter from "../components/calendar/CalendarSourceFilter";
import EventModal from "../components/calendar/EventModal";
import EventDetailsPanel from "../components/calendar/EventDetailsPanel";
import RecurrenceScopeDialog from "../components/calendar/RecurrenceScopeDialog";
import { BUSY_COLOR, colorFor } from "../components/calendar/calendarColors";
import ConfirmModal from "../components/ui/ConfirmModal";
import Toast from "../components/ui/Toast";

import { CalendarProvider } from "../context/CalendarContext";
import { useCalendar } from "../context/useCalendar";
import { useToast } from "../hooks/useToast";
import { useWriteGuard } from "../hooks/useWriteGuard";
import { useTranslation } from "../i18n";
import {
  type CalendarOccurrence,
  type EventDefinition,
  type SeriesScope,
  can,
  deleteEvent,
  getEvent,
} from "../services/calendar.service";

// CAL1.6 — the calendar page. THE FIRST MILESTONE THE USER CAN SEE.
//
// Written from scratch: the orphan CalendarPage.tsx deleted in CAL1.1 shared
// nothing with this one beyond the library import. Its defects are the reason
// D11 said "delete, do not extend" — a hardcoded Hungarian `culture`, `any[]`
// state, and `new Date(shift.end)` on a nullable column rendering
// "Invalid Date".
//
// The server is the only authority on permissions (plan §10.1). Everything
// here HIDES; nothing here grants. A control this page fails to hide answers
// 403, it does not succeed.

// One localizer for the whole app, holding both catalogues. Which one is used
// is decided per render by the `culture` prop, from useTranslation() — never a
// hardcoded language.
//
// ⚠️ `startOfWeek` looks like it ignores its arguments because it DOES, and
// that is required rather than sloppy. react-big-calendar 1.20's date-fns
// localizer uses this only as `getDay(startOfWeek(new Date(), { locale }))` to
// derive the first weekday — the date and the locale it passes are discarded
// by design here so both languages start the week on MONDAY (decision (c)).
// Left to the locale, `en` would start on Sunday and the two languages would
// disagree about which column is which.
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales: { en: enUS, hu },
});

// The grid's own event shape. `occurrence` carries the server payload through
// untouched, so nothing has to be reconstructed on click.
type GridEvent = {
  key: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  occurrence: CalendarOccurrence;
};

// react-big-calendar ships a light theme; the app is dark. Scoped to this page
// rather than added to a global stylesheet, so rolling the milestone back is
// deleting files plus two lines elsewhere.
const RBC_DARK_THEME = `
.rbc-calendar { color: #e2e8f0; }
.rbc-month-view, .rbc-time-view, .rbc-time-header-content, .rbc-header,
.rbc-day-bg + .rbc-day-bg, .rbc-month-row + .rbc-month-row,
.rbc-time-content, .rbc-time-content > * + * > *, .rbc-timeslot-group,
.rbc-time-header.rbc-overflowing, .rbc-time-view .rbc-allday-cell {
  border-color: rgba(255,255,255,0.10);
}
.rbc-header { padding: 8px 4px; font-weight: 600; color: #94a3b8; }
.rbc-off-range-bg { background: rgba(255,255,255,0.02); }
.rbc-off-range { color: #64748b; }
.rbc-today { background: rgba(249,115,22,0.10); }
.rbc-date-cell { padding: 6px; color: #cbd5e1; }
.rbc-time-slot { border-color: rgba(255,255,255,0.06); }
.rbc-current-time-indicator { background: #f97316; }
.rbc-show-more { background: transparent; color: #f97316; }
.rbc-event { border: none; padding: 2px 6px; }
.rbc-event.rbc-selected { outline: 2px solid rgba(249,115,22,0.6); }
`;

function CalendarPageContent() {
  const { t, language } = useTranslation();
  const { readOnly, guardProps } = useWriteGuard();
  const { show, message, triggerToast } = useToast();
  const {
    calendars,
    calendarById,
    view,
    setView,
    date,
    setDate,
    occurrences,
    truncated,
    error,
    refresh,
  } = useCalendar();

  const [selected, setSelected] = useState<CalendarOccurrence | null>(null);
  const [creatingSlot, setCreatingSlot] = useState<{ start: Date; end: Date } | null>(null);
  const [editing, setEditing] = useState<{
    definition: EventDefinition;
    scope: SeriesScope;
    occurrenceStart: string | null;
  } | null>(null);
  const [scopePrompt, setScopePrompt] = useState<{
    occurrence: CalendarOccurrence;
    action: "edit" | "delete";
  } | null>(null);
  const [deleting, setDeleting] = useState<{
    occurrence: CalendarOccurrence;
    scope: SeriesScope;
  } | null>(null);

  // Only calendars this caller may actually create in — the button is pointless
  // otherwise, and offering it would produce a 403 the user cannot act on.
  const writableCalendars = useMemo(
    () => calendars.filter((calendar) => can(calendar, "event.create")),
    [calendars]
  );

  const events = useMemo<GridEvent[]>(
    () =>
      occurrences.map((occurrence) => ({
        // The event id alone is NOT unique: one recurring series produces many
        // occurrences that all share it.
        key: `${occurrence.id}|${occurrence.originalStartsAt}`,
        title: occurrence.busy ? t("calendar.busy") : occurrence.title,
        start: new Date(occurrence.startsAt),
        end: new Date(occurrence.endsAt),
        allDay: occurrence.allDay,
        occurrence,
      })),
    [occurrences, t]
  );

  const messages = useMemo(
    () => ({
      date: t("calendar.rbc.date"),
      time: t("calendar.rbc.time"),
      event: t("calendar.rbc.event"),
      allDay: t("calendar.rbc.allDay"),
      week: t("calendar.toolbar.view.week"),
      work_week: t("calendar.rbc.workWeek"),
      day: t("calendar.toolbar.view.day"),
      month: t("calendar.toolbar.view.month"),
      previous: t("calendar.toolbar.previous"),
      next: t("calendar.toolbar.next"),
      today: t("calendar.toolbar.today"),
      agenda: t("calendar.rbc.agenda"),
      noEventsInRange: t("calendar.rbc.noEventsInRange"),
      showMore: (total: number) => t("calendar.rbc.showMore", { count: total }),
    }),
    [t]
  );

  function openCreate(start: Date, end: Date) {
    if (readOnly || writableCalendars.length === 0) return;
    setCreatingSlot({ start, end });
  }

  // Loads the SERIES DEFINITION before editing. The expanded occurrence is not
  // the stored row — its start may be an override, and it carries no
  // recurrence rule to edit — so the form must be seeded from the definition.
  function beginEdit(occurrence: CalendarOccurrence, scope: SeriesScope) {
    getEvent(occurrence.id)
      .then((definition) => {
        if (definition.busy) {
          // Free/busy level: there is no content to put in a form, and the
          // server would refuse the write anyway.
          triggerToast(t("calendar.toast.notEditable"));
          return;
        }

        setEditing({
          definition:
            scope === "this"
              ? // A single-occurrence edit is about THIS instance, so the form
                // opens on the instance's own values rather than the series'.
                {
                  ...definition,
                  startsAt: occurrence.startsAt,
                  endsAt: occurrence.endsAt,
                  title: occurrence.busy ? definition.title : occurrence.title,
                  location: occurrence.busy ? definition.location : occurrence.location,
                }
              : definition,
          scope,
          occurrenceStart: scope === "series" ? null : occurrence.originalStartsAt,
        });
        setSelected(null);
      })
      .catch((caught: unknown) =>
        triggerToast(caught instanceof Error ? caught.message : t("calendar.toast.loadFailed"))
      );
  }

  // The details panel always closes first. Found in browser verification: the
  // scope dialog stacked on top of it, leaving two modals and two backdrops on
  // screen at once. The occurrence is captured into the next step's state
  // before this runs, so clearing the selection loses nothing.
  function requestEdit(occurrence: CalendarOccurrence) {
    setSelected(null);
    // A one-off event has exactly one occurrence, so there is nothing to ask.
    if (!occurrence.recurring) {
      beginEdit(occurrence, "series");
      return;
    }
    setScopePrompt({ occurrence, action: "edit" });
  }

  function requestDelete(occurrence: CalendarOccurrence) {
    setSelected(null);
    if (!occurrence.recurring) {
      setDeleting({ occurrence, scope: "series" });
      return;
    }
    setScopePrompt({ occurrence, action: "delete" });
  }

  function confirmDelete() {
    if (!deleting) return;
    const { occurrence, scope } = deleting;

    deleteEvent(
      occurrence.id,
      scope,
      scope === "series" ? undefined : occurrence.originalStartsAt
    )
      .then(() => {
        setDeleting(null);
        setSelected(null);
        triggerToast(t("calendar.toast.deleted"));
        refresh();
      })
      .catch((caught: unknown) => {
        setDeleting(null);
        triggerToast(caught instanceof Error ? caught.message : t("calendar.toast.deleteFailed"));
      });
  }

  return (
    <div className="p-4 sm:p-8">
      <style>{RBC_DARK_THEME}</style>

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold sm:text-4xl">{t("calendar.title")}</h1>
          <p className="mt-2 text-slate-400">{t("calendar.subtitle")}</p>
        </div>

        {writableCalendars.length > 0 && (
          <button
            type="button"
            onClick={() => {
              const start = new Date();
              openCreate(start, new Date(start.getTime() + 60 * 60 * 1000));
            }}
            {...guardProps}
            className="w-full rounded-xl bg-orange-500 px-5 py-3 font-medium text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {t("calendar.newEvent")}
          </button>
        )}
      </div>

      {error && (
        <p className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {/* The server bounds how much one window may expand. If it had to, the
          user is told — a calendar that quietly drops entries is worse than one
          that admits it is incomplete. */}
      {truncated && (
        <p className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {t("calendar.truncated")}
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
        <CalendarSourceFilter />

        <div className="space-y-4">
          <CalendarToolbar />

          <div className="rounded-3xl border border-white/10 bg-white/5 p-2 sm:p-4">
            <Calendar<GridEvent>
              localizer={localizer}
              culture={language}
              messages={messages}
              events={events}
              // Controlled: CalendarToolbar and CalendarContext own the period,
              // so the library's own toolbar is replaced with a no-op rather
              // than left to fight over the same state.
              date={date}
              onNavigate={setDate}
              view={view as View}
              onView={(next) => setView(next as "month" | "week" | "day")}
              views={["month", "week", "day"]}
              components={{ toolbar: () => null }}
              selectable={!readOnly && writableCalendars.length > 0}
              onSelectSlot={(slot) => openCreate(slot.start, slot.end)}
              onSelectEvent={(gridEvent) => setSelected(gridEvent.occurrence)}
              eventPropGetter={(gridEvent) => {
                const occurrence = gridEvent.occurrence;
                return {
                  style: {
                    backgroundColor: occurrence.busy
                      ? // R4: one neutral colour for every busy block. Tinting
                        // them per calendar would hand back a little of what
                        // the redaction just removed.
                        BUSY_COLOR
                      : colorFor(calendarById.get(occurrence.calendarId)),
                    opacity: !occurrence.busy && occurrence.status === "cancelled" ? 0.45 : 1,
                    color: "#0f172a",
                    fontWeight: 500,
                  },
                };
              }}
              style={{ height: 640 }}
            />
          </div>
        </div>
      </div>

      <EventDetailsPanel
        occurrence={selected}
        calendar={selected ? calendarById.get(selected.calendarId) : undefined}
        onEdit={() => selected && requestEdit(selected)}
        onDelete={() => selected && requestDelete(selected)}
        onClose={() => setSelected(null)}
      />

      <RecurrenceScopeDialog
        open={scopePrompt !== null}
        action={scopePrompt?.action ?? "edit"}
        onSelect={(scope) => {
          if (!scopePrompt) return;
          const { occurrence, action } = scopePrompt;
          setScopePrompt(null);
          if (action === "edit") {
            beginEdit(occurrence, scope);
          } else {
            setDeleting({ occurrence, scope });
            setSelected(null);
          }
        }}
        onClose={() => setScopePrompt(null)}
      />

      {creatingSlot && (
        <EventModal
          open
          event={null}
          scope="series"
          slotStart={creatingSlot.start}
          slotEnd={creatingSlot.end}
          calendars={writableCalendars}
          onClose={() => setCreatingSlot(null)}
          onSaved={() => {
            setCreatingSlot(null);
            triggerToast(t("calendar.toast.created"));
            refresh();
          }}
        />
      )}

      {editing && (
        <EventModal
          // Remounts when the target or the scope changes, so the form
          // initialises from props without a synchronous effect.
          key={`${editing.definition.id}|${editing.scope}|${editing.occurrenceStart ?? ""}`}
          open
          event={editing.definition}
          scope={editing.scope}
          occurrenceStart={editing.occurrenceStart}
          calendars={writableCalendars}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            triggerToast(t("calendar.toast.updated"));
            refresh();
          }}
        />
      )}

      <ConfirmModal
        open={deleting !== null}
        title={t("calendar.delete.title")}
        message={t(`calendar.delete.message.${deleting?.scope ?? "series"}`)}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />

      <Toast show={show} message={message} />
    </div>
  );
}

export default function CalendarPage() {
  // The provider wraps the page rather than the app: every other route would
  // otherwise pay for a calendar fetch it never reads.
  return (
    <CalendarProvider>
      <CalendarPageContent />
    </CalendarProvider>
  );
}
