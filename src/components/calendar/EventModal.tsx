import { useEffect, useState } from "react";

import Modal from "../ui/Modal";
import RecurrenceEditor from "./RecurrenceEditor";
import { useTranslation } from "../../i18n";
import { useIsOwner } from "../../hooks/useIsOwner";
import { useWriteGuard } from "../../hooks/useWriteGuard";
import { getProjects } from "../../services/project.service";
import { getCustomers, type Customer } from "../../services/customers.service";
import { getEmployees } from "../../services/employee.service";
import type { Project } from "../../types/project";
import type { Employee } from "../../types/employee";
import {
  buildRecurrenceRule,
  parseRecurrenceRule,
  type RecurrenceState,
} from "./recurrenceRule";
import {
  type CalendarSummary,
  type EventDefinition,
  type EventInput,
  type EventStatus,
  type EventVisibility,
  type SeriesScope,
  createEvent,
  updateEvent,
} from "../../services/calendar.service";

// CAL1.6 — create and edit.
//
// TWO THINGS DRIVE THE SHAPE OF THIS FORM:
//
//  1. SCOPE=THIS IS A DIFFERENT FORM. The server accepts only startsAt,
//     endsAt, title and location on a single-occurrence edit — those are the
//     four columns CalendarEventOccurrence has — and answers 400 for anything
//     else. So the form HIDES the rest rather than sending fields that would
//     be refused, and says why.
//
//  2. THE CUSTOMER AND EMPLOYEE PICKERS ARE OWNER-ONLY. GET /customers and
//     GET /employees are gated requireRole(BUSINESS_OWNER, DEVELOPER) at the
//     router level; an EMPLOYEE gets 403. GET /projects is open to all three
//     roles and self-filters to the caller's assignments. Widening those role
//     gates is out of CAL1's scope (it must not touch role.middleware.ts), so
//     the form adapts instead.
//
// State is initialised from props with useState initialisers, never with an
// effect — the page gives this component a `key` that changes with the target
// event, so a remount does what a sync effect would have, without tripping
// react-hooks/set-state-in-effect.

type EventModalProps = {
  open: boolean;
  // null = create
  event: EventDefinition | null;
  scope: SeriesScope;
  occurrenceStart?: string | null;
  // Pre-filled slot when creating from a click on the grid.
  slotStart?: Date | null;
  slotEnd?: Date | null;
  // Only calendars this caller may create events in.
  calendars: CalendarSummary[];
  onClose: () => void;
  onSaved: () => void;
};

const fieldClass =
  "w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-orange-500 disabled:cursor-not-allowed disabled:opacity-50";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

// LOCAL calendar date/time, never the UTC slice of an ISO string: a 00:30
// Budapest event is the previous day in UTC, and a form that showed that would
// be wrong by a day for two hours out of every 24.
function toDateInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toTimeInput(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// "2026-09-07T09:00" with no zone suffix is parsed as LOCAL time, which is what
// the user typed. The server stores the resulting instant.
function toIso(date: string, time: string): string {
  return new Date(`${date}T${time || "00:00"}`).toISOString();
}

export default function EventModal({
  open,
  event,
  scope,
  occurrenceStart,
  slotStart,
  slotEnd,
  calendars,
  onClose,
  onSaved,
}: EventModalProps) {
  const { t } = useTranslation();
  const isOwner = useIsOwner();
  const { readOnly, guardProps } = useWriteGuard();

  const isEdit = event !== null;
  // Only the four columns an exception row carries.
  const singleOccurrence = isEdit && scope === "this";

  const initialStart = event ? new Date(event.startsAt) : (slotStart ?? new Date());
  const initialEnd = event
    ? new Date(event.endsAt)
    : (slotEnd ?? new Date(initialStart.getTime() + 60 * 60 * 1000));

  const [calendarId, setCalendarId] = useState<string>(() =>
    String(event?.calendarId ?? calendars[0]?.id ?? "")
  );
  const [title, setTitle] = useState(() => event?.title ?? "");
  const [description, setDescription] = useState(() => event?.description ?? "");
  const [allDay, setAllDay] = useState(() => event?.allDay ?? false);
  const [startDate, setStartDate] = useState(() => toDateInput(initialStart));
  const [startTime, setStartTime] = useState(() => toTimeInput(initialStart));
  const [endDate, setEndDate] = useState(() => toDateInput(initialEnd));
  const [endTime, setEndTime] = useState(() => toTimeInput(initialEnd));
  const [status, setStatus] = useState<EventStatus>(() => event?.status ?? "confirmed");
  const [visibility, setVisibility] = useState<EventVisibility>(
    () => event?.visibility ?? "default"
  );
  // The event's OWN location — an override, not a copy. Left empty the address
  // resolves from the project or the customer at read time and follows them
  // when they move (R5).
  const [location, setLocation] = useState(() => event?.location.source === "event"
    ? (event.location.address ?? "")
    : "");
  const [projectId, setProjectId] = useState(() =>
    event?.projectId != null ? String(event.projectId) : ""
  );
  const [customerId, setCustomerId] = useState(() =>
    event?.customerId != null ? String(event.customerId) : ""
  );
  const [employeeId, setEmployeeId] = useState(() =>
    event?.employeeId != null ? String(event.employeeId) : ""
  );
  const [recurrence, setRecurrence] = useState<RecurrenceState>(() =>
    parseRecurrenceRule(event?.recurrenceRule ?? null)
  );

  const [projects, setProjects] = useState<Project[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reference lists. Only loaded while the modal is open, and only the ones
  // this role may read — asking for /customers as an EMPLOYEE is a guaranteed
  // 403 and would put a console error on every open.
  useEffect(() => {
    if (!open || singleOccurrence) return;

    let cancelled = false;

    getProjects()
      .then((loaded) => {
        if (!cancelled) setProjects(loaded);
      })
      .catch(() => undefined);

    if (isOwner) {
      getCustomers()
        .then((loaded) => {
          if (!cancelled) setCustomers(loaded);
        })
        .catch(() => undefined);
      getEmployees()
        .then((loaded: Employee[]) => {
          if (!cancelled) setEmployees(loaded);
        })
        .catch(() => undefined);
    }

    return () => {
      cancelled = true;
    };
  }, [open, isOwner, singleOccurrence]);

  function buildInput(): EventInput | { error: string } {
    if (!title.trim()) return { error: t("calendar.form.titleRequired") };
    if (!startDate) return { error: t("calendar.form.startRequired") };

    // All-day: the END DATE IS INCLUSIVE for the user, so it is sent as the end
    // of that day. The server snaps both ends to local midnight in the
    // calendar's zone; sending 00:00 would silently drop the last day.
    const startsAt = allDay ? toIso(startDate, "00:00") : toIso(startDate, startTime);
    const endsAt = allDay
      ? toIso(endDate || startDate, "23:59")
      : toIso(endDate || startDate, endTime);

    if (!allDay && (!startTime || !endTime)) {
      return { error: t("calendar.form.timeRequired") };
    }
    if (new Date(endsAt).getTime() < new Date(startsAt).getTime()) {
      return { error: t("calendar.form.rangeError") };
    }

    if (singleOccurrence) {
      // Exactly the four overridable columns. Anything else here is a 400.
      return { title: title.trim(), startsAt, endsAt, location: location.trim() || null };
    }

    const input: EventInput = {
      title: title.trim(),
      description: description.trim() || null,
      startsAt,
      endsAt,
      allDay,
      status,
      visibility,
      location: location.trim() || null,
      recurrenceRule: buildRecurrenceRule(recurrence),
      projectId: projectId ? Number(projectId) : null,
    };

    // Sending customerId/employeeId as an EMPLOYEE would be harmless (the
    // server re-resolves them under the tenant), but the picker was never
    // shown, so an explicit null would CLEAR a reference the owner set.
    // Omitting the key means "leave it alone", which is the honest edit.
    if (isOwner) {
      input.customerId = customerId ? Number(customerId) : null;
      input.employeeId = employeeId ? Number(employeeId) : null;
    }

    if (!isEdit) input.calendarId = Number(calendarId);

    return input;
  }

  function handleSubmit(submitEvent: React.FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    if (saving || readOnly) return;

    const input = buildInput();
    if ("error" in input) {
      setError(input.error);
      return;
    }

    if (!isEdit && !calendarId) {
      setError(t("calendar.form.calendarRequired"));
      return;
    }

    setSaving(true);
    setError(null);

    const request = isEdit
      ? updateEvent(event.id, input, scope, occurrenceStart ?? undefined)
      : createEvent(input);

    request
      .then(() => onSaved())
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : t("calendar.form.saveFailed"))
      )
      .finally(() => setSaving(false));
  }

  const modalTitle = isEdit
    ? singleOccurrence
      ? t("calendar.form.editOccurrenceTitle")
      : t("calendar.form.editTitle")
    : t("calendar.form.createTitle");

  return (
    <Modal open={open} title={modalTitle} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {singleOccurrence && (
          <p className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-200">
            {t("calendar.form.occurrenceNotice")}
          </p>
        )}

        {!isEdit && (
          <div>
            <label className="mb-2 block text-sm text-slate-400">
              {t("calendar.form.calendar")}
            </label>
            <select
              value={calendarId}
              onChange={(changed) => setCalendarId(changed.target.value)}
              className={fieldClass}
              required
            >
              {calendars.map((calendar) => (
                <option key={calendar.id} value={calendar.id}>
                  {calendar.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="mb-2 block text-sm text-slate-400">{t("calendar.form.title")}</label>
          <input
            value={title}
            onChange={(changed) => setTitle(changed.target.value)}
            className={fieldClass}
            required
          />
        </div>

        {!singleOccurrence && (
          <div>
            <label className="mb-2 block text-sm text-slate-400">
              {t("calendar.form.description")}
            </label>
            <textarea
              value={description}
              onChange={(changed) => setDescription(changed.target.value)}
              className={fieldClass}
            />
          </div>
        )}

        {!singleOccurrence && (
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(changed) => setAllDay(changed.target.checked)}
              className="h-4 w-4 accent-orange-500"
            />
            <span className="text-sm text-slate-300">{t("calendar.form.allDay")}</span>
          </label>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm text-slate-400">{t("calendar.form.starts")}</label>
            <div className="flex gap-2">
              <input
                type="date"
                value={startDate}
                onChange={(changed) => setStartDate(changed.target.value)}
                className={fieldClass}
                required
              />
              {!allDay && (
                <input
                  type="time"
                  value={startTime}
                  onChange={(changed) => setStartTime(changed.target.value)}
                  className={fieldClass}
                  required
                />
              )}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm text-slate-400">{t("calendar.form.ends")}</label>
            <div className="flex gap-2">
              <input
                type="date"
                value={endDate}
                onChange={(changed) => setEndDate(changed.target.value)}
                className={fieldClass}
                required
              />
              {!allDay && (
                <input
                  type="time"
                  value={endTime}
                  onChange={(changed) => setEndTime(changed.target.value)}
                  className={fieldClass}
                  required
                />
              )}
            </div>
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm text-slate-400">{t("calendar.form.location")}</label>
          <input
            value={location}
            onChange={(changed) => setLocation(changed.target.value)}
            placeholder={t("calendar.form.locationPlaceholder")}
            className={fieldClass}
          />
          <p className="mt-2 text-xs text-slate-500">{t("calendar.form.locationHint")}</p>
        </div>

        {!singleOccurrence && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm text-slate-400">
                  {t("calendar.form.status")}
                </label>
                <select
                  value={status}
                  onChange={(changed) => setStatus(changed.target.value as EventStatus)}
                  className={fieldClass}
                >
                  {(["confirmed", "tentative", "cancelled"] as const).map((option) => (
                    <option key={option} value={option}>
                      {t(`calendar.status.${option}`)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm text-slate-400">
                  {t("calendar.form.visibility")}
                </label>
                <select
                  value={visibility}
                  onChange={(changed) => setVisibility(changed.target.value as EventVisibility)}
                  className={fieldClass}
                >
                  {(["default", "private", "confidential"] as const).map((option) => (
                    <option key={option} value={option}>
                      {t(`calendar.visibility.${option}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm text-slate-400">
                {t("calendar.form.project")}
              </label>
              <select
                value={projectId}
                onChange={(changed) => setProjectId(changed.target.value)}
                className={fieldClass}
              >
                <option value="">{t("calendar.form.none")}</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Owner-only: the two endpoints behind these pickers are gated
                requireRole(BUSINESS_OWNER, DEVELOPER) on the server. */}
            {isOwner && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm text-slate-400">
                    {t("calendar.form.customer")}
                  </label>
                  <select
                    value={customerId}
                    onChange={(changed) => setCustomerId(changed.target.value)}
                    className={fieldClass}
                  >
                    <option value="">{t("calendar.form.none")}</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm text-slate-400">
                    {t("calendar.form.employee")}
                  </label>
                  <select
                    value={employeeId}
                    onChange={(changed) => setEmployeeId(changed.target.value)}
                    className={fieldClass}
                  >
                    <option value="">{t("calendar.form.none")}</option>
                    {employees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.firstName} {employee.lastName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <RecurrenceEditor value={recurrence} onChange={setRecurrence} />
          </>
        )}

        {error && (
          <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/5 px-5 py-2 text-slate-300 transition hover:bg-white/10"
          >
            {t("common.cancel")}
          </button>

          <button
            type="submit"
            {...guardProps}
            disabled={saving || readOnly}
            className="rounded-xl bg-orange-500 px-5 py-2 font-medium text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? t("common.loading") : t("common.saveChanges")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
