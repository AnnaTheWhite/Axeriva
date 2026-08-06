import { API_URL, authHeaders, apiFetch } from "./api";

// CAL1.6 — the calendar client. Same shape as every other service here:
// typed responses, apiFetch (so a stale session is handled centrally), and no
// state of its own.
//
// THE ONE TYPE DECISION THAT MATTERS: an occurrence is a DISCRIMINATED UNION on
// `busy`. At free/busy access level the server does not send `title`,
// `description` or `location` at all — the keys are absent, not empty — so
// modelling the two shapes as one optional-field type would let a component
// read `occurrence.title` and render `undefined` where the whole point (R4) is
// that the content never left the server. With the union, that line does not
// compile.

// --- Vocabulary (mirrors server/src/constants/*) ---------------------------

export type CalendarType = "PERSONAL" | "COMPANY" | "PROJECT" | "EMPLOYEE";

export type CalendarPermission =
  | "view_free_busy"
  | "view_details"
  | "event.create"
  | "event.edit_own"
  | "event.edit_any"
  | "event.delete_own"
  | "event.delete_any"
  | "participant.invite"
  | "share"
  | "manage";

export type EventStatus = "confirmed" | "tentative" | "cancelled";
export type EventVisibility = "default" | "private" | "confidential";

// PUT /calendars/:id/share-level accepts the first three. GET can also answer
// "OTHER" — the owner granted the company something that is not one of the two
// share presets, and the API refuses to misreport it as a level it is not.
export type ShareLevel = "PRIVATE" | "FREE_BUSY" | "DETAILS";
export type ReadShareLevel = ShareLevel | "OTHER";

export type SeriesScope = "this" | "following" | "series";

// --- Shapes ----------------------------------------------------------------

export type CalendarSummary = {
  id: number;
  companyId: number;
  type: CalendarType;
  name: string;
  description: string | null;
  color: string | null;
  timezone: string | null;
  ownerUserId: number | null;
  projectId: number | null;
  employeeId: number | null;
  isDefault: boolean;
  archivedAt: string | null;
  // What THIS caller may do on it, resolved server-side. The UI only ever
  // hides; the server is the gate (plan §10.1).
  permissions: CalendarPermission[];
};

export type ResolvedLocation = {
  source: "event" | "project" | "customer" | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type BusyOccurrence = {
  id: number;
  calendarId: number;
  originalStartsAt: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  recurring: boolean;
  overridden: boolean;
  busy: true;
};

export type DetailOccurrence = {
  id: number;
  calendarId: number;
  companyId: number;
  originalStartsAt: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  timezone: string | null;
  title: string;
  description: string | null;
  status: EventStatus;
  visibility: EventVisibility;
  recurring: boolean;
  recurrenceRule: string | null;
  overridden: boolean;
  createdByUserId: number;
  projectId: number | null;
  customerId: number | null;
  employeeId: number | null;
  shiftId: number | null;
  location: ResolvedLocation;
  metadata: unknown;
  busy: false;
};

export type CalendarOccurrence = BusyOccurrence | DetailOccurrence;

export type EventWindow = {
  from: string;
  to: string;
  // The server bounds how much one window may expand. Surfacing this is not
  // optional politeness: a silently truncated calendar is a calendar that lies.
  truncated: boolean;
  occurrences: CalendarOccurrence[];
};

export type BusyEventDefinition = {
  id: number;
  calendarId: number;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  recurring: boolean;
  busy: true;
};

export type EventDefinition = {
  id: number;
  calendarId: number;
  companyId: number;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  timezone: string | null;
  recurrenceRule: string | null;
  recurrenceEndsAt: string | null;
  status: EventStatus;
  visibility: EventVisibility;
  createdByUserId: number;
  projectId: number | null;
  customerId: number | null;
  employeeId: number | null;
  shiftId: number | null;
  location: ResolvedLocation;
  metadata: unknown;
  exceptions: Array<{
    originalStartsAt: string;
    cancelled: boolean;
    startsAt: string | null;
    endsAt: string | null;
    title: string | null;
    location: string | null;
  }>;
  busy: false;
};

// What a write endpoint accepts. Every field optional: an absent key means
// "leave it alone", which is exactly how the server reads it.
export type EventInput = {
  calendarId?: number;
  title?: string;
  description?: string | null;
  startsAt?: string;
  endsAt?: string;
  allDay?: boolean;
  timezone?: string | null;
  recurrenceRule?: string | null;
  status?: EventStatus;
  visibility?: EventVisibility;
  location?: string | null;
  projectId?: number | null;
  customerId?: number | null;
  employeeId?: number | null;
};

// --- Transport -------------------------------------------------------------

// The calendar endpoints answer validation failures with a specific,
// user-meaningful message ("recurrenceRule: unsupported FREQ \"HOURLY\"", "the
// window cannot exceed 366 days"). Throwing a generic string here would drop
// exactly the part the user needs to fix, so the server's own message is
// carried through when there is one.
async function request<T>(path: string, init: RequestInit, fallback: string): Promise<T> {
  const response = await apiFetch(`${API_URL}${path}`, init);

  if (!response.ok) {
    const message = await response
      .clone()
      .json()
      .then((body: { error?: string }) => body?.error)
      .catch(() => undefined);
    throw new Error(message || fallback);
  }

  return response.json() as Promise<T>;
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

// --- Calendars -------------------------------------------------------------

export async function getCalendars(): Promise<CalendarSummary[]> {
  return request<CalendarSummary[]>(
    "/calendars",
    { headers: { ...authHeaders() } },
    "Failed to load calendars"
  );
}

// Q5's lazy creation, reaching the UI. A brand-new user owns NO calendar, so
// GET /calendars answers with an empty list and there is nothing to put an
// event on. POST /calendars is idempotent by design (find-then-create), which
// is what makes calling it on every first visit safe.
export async function ensurePersonalCalendar(): Promise<CalendarSummary> {
  return request<CalendarSummary>(
    "/calendars",
    jsonInit("POST", { type: "PERSONAL" }),
    "Failed to create your personal calendar"
  );
}

export async function getShareLevel(calendarId: number): Promise<{ shareLevel: ReadShareLevel }> {
  return request<{ shareLevel: ReadShareLevel }>(
    `/calendars/${calendarId}/share-level`,
    { headers: { ...authHeaders() } },
    "Failed to load the sharing level"
  );
}

export async function setShareLevel(
  calendarId: number,
  shareLevel: ShareLevel
): Promise<{ shareLevel: ReadShareLevel }> {
  return request<{ shareLevel: ReadShareLevel }>(
    `/calendars/${calendarId}/share-level`,
    jsonInit("PUT", { shareLevel }),
    "Failed to change the sharing level"
  );
}

// --- Events ----------------------------------------------------------------

export type WindowQuery = {
  from: Date;
  to: Date;
  calendarIds?: number[];
};

export async function getEvents(query: WindowQuery): Promise<EventWindow> {
  const params = new URLSearchParams({
    from: query.from.toISOString(),
    to: query.to.toISOString(),
  });
  // Omitted entirely when every visible calendar is selected — an absent
  // filter and a filter naming all of them mean the same thing to the server,
  // and the shorter URL is the one that caches.
  if (query.calendarIds && query.calendarIds.length > 0) {
    params.set("calendarIds", query.calendarIds.join(","));
  }

  return request<EventWindow>(
    `/calendar/events?${params.toString()}`,
    { headers: { ...authHeaders() } },
    "Failed to load calendar events"
  );
}

export async function getEvent(id: number): Promise<EventDefinition | BusyEventDefinition> {
  return request<EventDefinition | BusyEventDefinition>(
    `/calendar/events/${id}`,
    { headers: { ...authHeaders() } },
    "Failed to load the event"
  );
}

export async function createEvent(input: EventInput): Promise<EventDefinition | BusyEventDefinition> {
  return request<EventDefinition | BusyEventDefinition>(
    "/calendar/events",
    jsonInit("POST", input),
    "Failed to create the event"
  );
}

// `scope` and `occurrenceStart` are QUERY parameters, not body fields — the
// server reads them from the URL, and sending them in the body would silently
// do nothing.
function scopeQuery(scope: SeriesScope, occurrenceStart?: string): string {
  const params = new URLSearchParams({ scope });
  if (scope !== "series" && occurrenceStart) {
    params.set("occurrenceStart", occurrenceStart);
  }
  return params.toString();
}

export async function updateEvent(
  id: number,
  input: EventInput,
  scope: SeriesScope = "series",
  occurrenceStart?: string
): Promise<EventDefinition | BusyEventDefinition> {
  return request<EventDefinition | BusyEventDefinition>(
    `/calendar/events/${id}?${scopeQuery(scope, occurrenceStart)}`,
    jsonInit("PATCH", input),
    "Failed to update the event"
  );
}

export async function deleteEvent(
  id: number,
  scope: SeriesScope = "series",
  occurrenceStart?: string
): Promise<void> {
  const response = await apiFetch(
    `${API_URL}/calendar/events/${id}?${scopeQuery(scope, occurrenceStart)}`,
    { method: "DELETE", headers: { ...authHeaders() } }
  );

  // 204 No Content — there is no body to parse, so this one does not go
  // through request().
  if (!response.ok) {
    const message = await response
      .clone()
      .json()
      .then((body: { error?: string }) => body?.error)
      .catch(() => undefined);
    throw new Error(message || "Failed to delete the event");
  }
}

// --- Permission helpers ----------------------------------------------------

export function can(calendar: CalendarSummary | undefined, permission: CalendarPermission): boolean {
  return calendar ? calendar.permissions.includes(permission) : false;
}

// Whether this caller may edit/delete a specific occurrence: the `_any`
// permission, or the `_own` one when they authored it. Mirrors the server's
// own check so the UI does not offer a button that will answer 403.
export function canModify(
  calendar: CalendarSummary | undefined,
  occurrence: CalendarOccurrence,
  currentUserId: number | null,
  action: "edit" | "delete"
): boolean {
  if (!calendar) return false;
  // A busy block carries no author, so ownership cannot be established — and
  // its content is hidden anyway. `_any` is the only way in.
  if (occurrence.busy) return can(calendar, `event.${action}_any` as CalendarPermission);

  if (can(calendar, `event.${action}_any` as CalendarPermission)) return true;
  return (
    currentUserId !== null &&
    occurrence.createdByUserId === currentUserId &&
    can(calendar, `event.${action}_own` as CalendarPermission)
  );
}
