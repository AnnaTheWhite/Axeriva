// CAL1.5 — the event domain layer. See docs/calendar-system-plan.md §4.7, §5.2,
// §6.5, §8 and §11.1-§11.2, and docs/calendar-cal1-scope.md §2 (CAL1.5).
//
// NEARLY PURE. No Prisma client, no Express, no database call. It builds the
// where-clause and the select shapes the route hands to Prisma, and it turns
// loaded rows into responses — which is what makes the serialisation rules
// below unit-testable without a fixture per case.
//
// THE THREE RULES THIS MODULE EXISTS TO HOLD:
//
//   1. FREE/BUSY IS A NARROWER QUERY, NOT A NARROWER RESPONSE (R4, plan §8.5).
//      At view_free_busy level the server does not SELECT title, description or
//      location at all. A field that was fetched and then dropped is one
//      refactor away from being serialised, and a title that reaches the wire
//      is a click away in the network tab whatever the UI does with it.
//
//   2. THE EVENT REFERENCES, IT NEVER COPIES (R5, plan §6.5). The address on
//      the response is resolved at READ time from the project or the customer.
//      Copy it onto the event once and every past and future event keeps the
//      old address after the customer moves — and the technician drives to it.
//
//   3. VISIBILITY IS APPLIED ABOVE THE CALENDAR PERMISSION (plan §4.7), never
//      instead of it. `private` still blocks the slot so scheduling works;
//      `confidential` does not admit there is anything there at all.

import type { Prisma } from "@prisma/client";
import type { CalendarPermission } from "../../constants/calendarPermissions";
import {
  MAX_RECURRENCE_COUNT,
  RECURRENCE_WEEKDAYS,
  type Occurrence,
  type OccurrenceException,
  type ParsedRecurrenceRule,
  DEFAULT_OCCURRENCE_LIMIT,
  expandOccurrences,
  parseRecurrenceRule,
} from "./recurrence";
import {
  type CivilDate,
  allDayBoundsUtc,
  civilDateInZone,
  isValidInstant,
  isValidTimeZone,
} from "./timezone";

// ---------------------------------------------------------------------------
// Window limits (Q7)
// ---------------------------------------------------------------------------

// Q7, decided: yes, 366 days. The yearly view is the longest real requirement,
// and the leap-year day is why it is 366 rather than 365 — "1 January to
// 31 December" of a leap year must fit exactly.
//
// The limit is not a nicety. Without it a `from=1970` request expands every
// recurring rule in the tenant across half a century, in Node, inside one HTTP
// request (plan §11.2, "recurrence bomb").
export const MAX_WINDOW_DAYS = 366;

const DAY_MS = 86_400_000;

// Ceiling on the CANDIDATE rows loaded for one window. The index
// @@index([calendarId, startsAt]) makes the query cheap, but the expansion
// afterwards is per row and happens in this process.
export const MAX_CANDIDATE_EVENTS = 2000;

// Ceiling on the occurrences EMITTED for one window, across every series in it.
// CAL1.2 already bounds a single series (DEFAULT_OCCURRENCE_LIMIT); this bounds
// the sum, which a thousand daily series would otherwise blow past while each
// one stayed individually within its limit.
export const MAX_WINDOW_OCCURRENCES = 5000;

export type WindowParseResult =
  | { ok: true; from: Date; to: Date }
  | { ok: false; error: string };

function parseInstant(raw: unknown): Date | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const parsed = new Date(raw);
  return isValidInstant(parsed) ? parsed : null;
}

// from/to are MANDATORY and bounded. Both halves matter: mandatory stops an
// unbounded scan, bounded stops a request that is technically bounded but
// spans a century.
export function parseWindow(query: Record<string, unknown>): WindowParseResult {
  const from = parseInstant(query.from);
  const to = parseInstant(query.to);

  if (!from || !to) {
    return { ok: false, error: "from and to are required ISO-8601 instants" };
  }
  if (to.getTime() <= from.getTime()) {
    return { ok: false, error: "to must be after from" };
  }
  if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * DAY_MS) {
    return { ok: false, error: `the window cannot exceed ${MAX_WINDOW_DAYS} days` };
  }

  return { ok: true, from, to };
}

// ---------------------------------------------------------------------------
// The candidate query (plan §5.2)
// ---------------------------------------------------------------------------

export type CandidateFilterInput = {
  // Already resolved by the permission gate — never a raw client id.
  calendarIds: number[];
  from: Date;
  to: Date;
  // Null only for DEVELOPER, who belongs to no tenant; the calendar id list is
  // then the whole gate. Everyone else carries the second filter of §11.1.
  companyId: number | null;
  projectId?: number | null;
  employeeId?: number | null;
};

// Which stored rows could possibly produce an occurrence inside the window.
//
// A one-off event is selected by plain overlap. A RECURRING event is selected
// by its pruning column: recurrenceEndsAt is the last occurrence's END,
// computed at write time, and NULL means the rule is infinite — which the
// filter reads as "always a candidate". This is the whole reason the column
// exists: without it, answering "what is in March?" means expanding every
// recurring rule in the tenant just to discover which ones reach March.
export function windowCandidateFilter(input: CandidateFilterInput): Prisma.CalendarEventWhereInput {
  const where: Prisma.CalendarEventWhereInput = {
    calendarId: { in: input.calendarIds },
    // A series cannot produce an occurrence before its own start.
    startsAt: { lte: input.to },
    OR: [
      // One-off (or a series' own first span) overlapping the window.
      { endsAt: { gte: input.from } },
      // Recurring candidate, pruned by recurrenceEndsAt.
      {
        recurrenceRule: { not: null },
        OR: [{ recurrenceEndsAt: null }, { recurrenceEndsAt: { gte: input.from } }],
      },
    ],
  };

  // §11.1 — the tenant filter is carried by the query, alongside the permission
  // filter, rather than being trusted to follow from it.
  if (input.companyId !== null) where.companyId = input.companyId;

  if (input.projectId != null) where.projectId = input.projectId;
  if (input.employeeId != null) where.employeeId = input.employeeId;

  return where;
}

// ---------------------------------------------------------------------------
// The two select shapes (R4 — rule 1 of this module)
// ---------------------------------------------------------------------------

// Everything the detail serialiser needs, and nothing more. Explicit rather
// than a bare findMany, so adding a column to the schema cannot silently start
// shipping it.
export const EVENT_DETAIL_SELECT = {
  id: true,
  calendarId: true,
  companyId: true,
  title: true,
  description: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  timezone: true,
  recurrenceRule: true,
  recurrenceEndsAt: true,
  status: true,
  visibility: true,
  createdByUserId: true,
  projectId: true,
  customerId: true,
  employeeId: true,
  shiftId: true,
  location: true,
  latitude: true,
  longitude: true,
  metadata: true,
  occurrences: {
    select: {
      id: true,
      originalStartsAt: true,
      cancelled: true,
      startsAt: true,
      endsAt: true,
      title: true,
      location: true,
    },
  },
} as const;

// The free/busy select. Compare it with the one above: title, description,
// location, latitude, longitude, metadata and every source reference are
// ABSENT, and so are the title and location OVERRIDES on the exception rows —
// an occurrence override is just as much event content as the series' own
// title.
//
// visibility and createdByUserId ARE selected: they are not content, and both
// are needed to decide whether a `confidential` row may be shown at all.
export const EVENT_FREE_BUSY_SELECT = {
  id: true,
  calendarId: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  timezone: true,
  recurrenceRule: true,
  status: true,
  visibility: true,
  createdByUserId: true,
  occurrences: {
    select: {
      id: true,
      originalStartsAt: true,
      cancelled: true,
      startsAt: true,
      endsAt: true,
    },
  },
} as const;

// The shapes those selects produce. Declared by hand (the calendars.routes.ts
// pattern) so the serialisers below cannot be handed a row that happens to
// carry more than the level allows.
//
// DetailEventRow is written out in full rather than as
// `FreeBusyEventRow & { … }`: intersecting two object types that both declare
// `occurrences` gives an intersection of two ARRAY types, and indexing that
// resolves to the first member — so the detail row's own title and location
// overrides would be invisible to the compiler exactly where they are used.
type SharedEventColumns = {
  id: number;
  calendarId: number;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  timezone: string | null;
  recurrenceRule: string | null;
  status: string;
  visibility: string;
  createdByUserId: number;
};

export type FreeBusyEventRow = SharedEventColumns & {
  occurrences: Array<{
    id: number;
    originalStartsAt: Date;
    cancelled: boolean;
    startsAt: Date | null;
    endsAt: Date | null;
  }>;
};

export type DetailEventRow = SharedEventColumns & {
  companyId: number;
  title: string;
  description: string | null;
  recurrenceEndsAt: Date | null;
  projectId: number | null;
  customerId: number | null;
  employeeId: number | null;
  shiftId: number | null;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  metadata: string | null;
  occurrences: Array<{
    id: number;
    originalStartsAt: Date;
    cancelled: boolean;
    startsAt: Date | null;
    endsAt: Date | null;
    title: string | null;
    location: string | null;
  }>;
};

// ---------------------------------------------------------------------------
// Access level and event visibility (plan §4.7)
// ---------------------------------------------------------------------------

export type EventAccessLevel = "details" | "free_busy";

// What the CALENDAR grant allows. view_details implies view_free_busy (never
// the reverse — CAL1.3), so the order here is the whole decision.
export function accessLevelFor(
  permissions: ReadonlySet<CalendarPermission>
): EventAccessLevel | null {
  if (permissions.has("view_details")) return "details";
  if (permissions.has("view_free_busy")) return "free_busy";
  return null;
}

export type EventView = "details" | "busy" | "hidden";

// What THIS actor may see of THIS event, once the event's own visibility is
// layered on top of the calendar grant.
//
// Participants are CAL2.1 and the table is empty throughout CAL1, so "creator
// or participant" reduces to "creator" here. When CAL2.1 lands it widens this
// one predicate rather than the callers.
//
// Note the allow-list on `visibility`: only the literal "default" defers to the
// calendar level. CalendarEvent.visibility is an unconstrained TEXT column, and
// a value this function does not recognise must reveal LESS, not more — the
// same failing-closed rule the permission preset lookup follows.
export function eventViewFor(
  event: { visibility: string; createdByUserId: number },
  actorId: number,
  level: EventAccessLevel
): EventView {
  const isCreator = event.createdByUserId === actorId;

  // The slot itself is hidden: to anyone else the time looks free.
  if (event.visibility === "confidential") return isCreator ? "details" : "hidden";

  // The calendar grant decides, and nothing further.
  if (event.visibility === "default") return level === "details" ? "details" : "busy";

  // "private", and every unrecognised value: the slot is blocked, the content
  // is not shown.
  return isCreator ? "details" : "busy";
}

// ---------------------------------------------------------------------------
// Location resolution (R5, plan §6.5)
// ---------------------------------------------------------------------------

export type LocationSource = "event" | "project" | "customer";

export type ResolvedLocation = {
  // Which level answered. Present so the UI can say "at the project site"
  // rather than repeating an address the user already knows.
  source: LocationSource | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
};

const NO_LOCATION: ResolvedLocation = {
  source: null,
  address: null,
  latitude: null,
  longitude: null,
};

export type LocationReferences = {
  project?: { address: string | null; latitude: number | null; longitude: number | null } | null;
  customer?: { address: string | null } | null;
};

// The one place the §6.5 order is written down:
//
//   1. the event's OWN location/latitude/longitude   — an ad-hoc venue
//   2. the project's address and geofence            — if projectId is set
//   3. the customer's address                        — if customerId is set
//   4. nothing
//
// A level that holds no data at all falls THROUGH rather than answering with
// nulls: an event on a project that has never had an address recorded should
// still show the customer's, which is the address the technician needs.
//
// The event's own field is an OVERRIDE, not a copy. Left null, the address
// follows the project when the project moves — which is the entire point of
// referencing rather than denormalising.
export function resolveEventLocation(
  event: { location: string | null; latitude: number | null; longitude: number | null },
  references: LocationReferences = {}
): ResolvedLocation {
  if (event.location !== null || event.latitude !== null || event.longitude !== null) {
    return {
      source: "event",
      address: event.location,
      latitude: event.latitude,
      longitude: event.longitude,
    };
  }

  const project = references.project;
  if (project && (project.address !== null || project.latitude !== null || project.longitude !== null)) {
    return {
      source: "project",
      address: project.address,
      latitude: project.latitude,
      longitude: project.longitude,
    };
  }

  const customer = references.customer;
  if (customer && customer.address !== null) {
    return { source: "customer", address: customer.address, latitude: null, longitude: null };
  }

  return { ...NO_LOCATION };
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

export type BusyOccurrenceDto = {
  id: number;
  calendarId: number;
  originalStartsAt: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  recurring: boolean;
  overridden: boolean;
  // The marker plan §8.5 asks for. There is deliberately no `title: null` or
  // `location: null` alongside it: an absent key cannot be un-redacted by a
  // careless client, and a test asserts the keys are missing rather than empty.
  busy: true;
};

export type DetailOccurrenceDto = {
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
  status: string;
  visibility: string;
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

export type OccurrenceDto = BusyOccurrenceDto | DetailOccurrenceDto;

export function serializeBusyOccurrence(
  event: Pick<FreeBusyEventRow, "id" | "calendarId" | "allDay" | "recurrenceRule">,
  occurrence: Occurrence
): BusyOccurrenceDto {
  return {
    id: event.id,
    calendarId: event.calendarId,
    originalStartsAt: occurrence.originalStartsAt.toISOString(),
    startsAt: occurrence.startsAt.toISOString(),
    endsAt: occurrence.endsAt.toISOString(),
    allDay: event.allDay,
    recurring: Boolean(event.recurrenceRule),
    overridden: occurrence.overridden,
    busy: true,
  };
}

export function serializeDetailOccurrence(
  event: DetailEventRow,
  occurrence: Occurrence,
  location: ResolvedLocation
): DetailOccurrenceDto {
  return {
    id: event.id,
    calendarId: event.calendarId,
    companyId: event.companyId,
    originalStartsAt: occurrence.originalStartsAt.toISOString(),
    startsAt: occurrence.startsAt.toISOString(),
    endsAt: occurrence.endsAt.toISOString(),
    allDay: event.allDay,
    timezone: event.timezone,
    // An exception row may rename or move a single occurrence; when it has not,
    // the series' own values stand.
    title: occurrence.title ?? event.title,
    description: event.description,
    status: event.status,
    visibility: event.visibility,
    recurring: Boolean(event.recurrenceRule),
    recurrenceRule: event.recurrenceRule,
    overridden: occurrence.overridden,
    createdByUserId: event.createdByUserId,
    projectId: event.projectId,
    customerId: event.customerId,
    employeeId: event.employeeId,
    shiftId: event.shiftId,
    // An occurrence-level location override outranks the resolution order: it
    // is the most specific statement about where THIS instance happens.
    location:
      occurrence.location != null
        ? { source: "event", address: occurrence.location, latitude: null, longitude: null }
        : location,
    metadata: parseMetadata(event.metadata),
    busy: false,
  };
}

// --- The series DEFINITION, as opposed to one expanded occurrence -----------
//
// GET /:id answers with the stored series, not with its expansion: that is what
// an edit form needs, and it is the only response in which recurrenceRule and
// the stored exception rows are meaningful.

export type BusyEventDefinitionDto = {
  id: number;
  calendarId: number;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  recurring: boolean;
  busy: true;
};

export type EventDefinitionDto = {
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
  status: string;
  visibility: string;
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

export function serializeBusyDefinition(
  event: Pick<FreeBusyEventRow, "id" | "calendarId" | "startsAt" | "endsAt" | "allDay" | "recurrenceRule">
): BusyEventDefinitionDto {
  return {
    id: event.id,
    calendarId: event.calendarId,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    allDay: event.allDay,
    recurring: Boolean(event.recurrenceRule),
    busy: true,
  };
}

export function serializeEventDefinition(
  event: DetailEventRow,
  location: ResolvedLocation
): EventDefinitionDto {
  return {
    id: event.id,
    calendarId: event.calendarId,
    companyId: event.companyId,
    title: event.title,
    description: event.description,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    allDay: event.allDay,
    timezone: event.timezone,
    recurrenceRule: event.recurrenceRule,
    recurrenceEndsAt: event.recurrenceEndsAt ? event.recurrenceEndsAt.toISOString() : null,
    status: event.status,
    visibility: event.visibility,
    createdByUserId: event.createdByUserId,
    projectId: event.projectId,
    customerId: event.customerId,
    employeeId: event.employeeId,
    shiftId: event.shiftId,
    location,
    metadata: parseMetadata(event.metadata),
    exceptions: event.occurrences
      .slice()
      .sort((a, b) => a.originalStartsAt.getTime() - b.originalStartsAt.getTime())
      .map((row) => ({
        originalStartsAt: row.originalStartsAt.toISOString(),
        cancelled: row.cancelled,
        startsAt: row.startsAt ? row.startsAt.toISOString() : null,
        endsAt: row.endsAt ? row.endsAt.toISOString() : null,
        title: row.title,
        location: row.location,
      })),
    busy: false,
  };
}

// Stored JSON is a String? column (schema-wide convention). Unreadable content
// degrades to null rather than throwing a 500 out of a list endpoint.
export function parseMetadata(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    console.warn("[calendar/events] unparseable metadata — returning null");
    return null;
  }
}

// The exception rows an expansion needs, from whichever select shape was used.
// At free/busy level the title/location overrides were never fetched, so they
// are simply not there to leak — the optional properties below are the type
// system saying exactly that.
export function exceptionsOf(event: {
  occurrences: ReadonlyArray<{
    originalStartsAt: Date;
    cancelled: boolean;
    startsAt: Date | null;
    endsAt: Date | null;
    title?: string | null;
    location?: string | null;
  }>;
}): OccurrenceException[] {
  return event.occurrences.map((row) => ({
    originalStartsAt: row.originalStartsAt,
    cancelled: row.cancelled,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    title: row.title ?? null,
    location: row.location ?? null,
  }));
}

// ---------------------------------------------------------------------------
// All-day normalisation
// ---------------------------------------------------------------------------

// An all-day event's stored instants are local midnight to the NEXT local
// midnight after its last day — never 00:00–23:59Z, and never start + 24h.
//
// Whatever a client sends for an all-day event, only the DATES it names are
// meaningful, so both ends are snapped in the calendar's zone. Storing the raw
// instants instead would put a Hungarian all-day event on two days for anyone
// reading in UTC, and would be an hour wrong on each of the two transition days
// (2026-03-29 is a 23-hour day in Budapest, 2026-10-25 a 25-hour one).
export function allDayRange(startsAt: Date, endsAt: Date, zone: string): { startsAt: Date; endsAt: Date } {
  const firstDay = civilDateInZone(startsAt, zone);

  // The end is EXCLUSIVE once snapped, so the last covered day is the civil
  // date one millisecond before it. Without the step back, an event already
  // stored as "midnight to midnight" would gain a day on every re-save.
  const endProbe = new Date(Math.max(endsAt.getTime() - 1, startsAt.getTime()));
  const lastDay: CivilDate = civilDateInZone(endProbe, zone);

  return {
    startsAt: allDayBoundsUtc(firstDay, zone).startsAt,
    endsAt: allDayBoundsUtc(lastDay, zone).endsAt,
  };
}

// ---------------------------------------------------------------------------
// Recurrence rules: re-serialisation and the `following` split
// ---------------------------------------------------------------------------

function formatUntil(instant: Date): string {
  const iso = instant.toISOString();
  // 2026-12-31T23:00:00.000Z → 20261231T230000Z
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

// A parsed rule back to the stored string form. Round-trips through
// parseRecurrenceRule by construction: it emits only the five parts that
// grammar accepts, in RFC 5545's own order.
export function formatRecurrenceRule(rule: ParsedRecurrenceRule): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byDay.length > 0) {
    parts.push(`BYDAY=${RECURRENCE_WEEKDAYS.filter((day) => rule.byDay.includes(day)).join(",")}`);
  }
  if (rule.count !== null) parts.push(`COUNT=${rule.count}`);
  if (rule.until !== null) parts.push(`UNTIL=${formatUntil(rule.until)}`);
  return parts.join(";");
}

export type SeriesSplit = {
  // The rule the ORIGINAL event keeps: everything strictly before the split.
  head: string;
  // The rule the NEW series carries from the split onwards.
  tail: string;
};

// "This and the following" — the standard split every calendar implements, and
// the one the scope names explicitly: the original rule's UNTIL is cut at the
// split point and a NEW series opens there.
//
// COUNT needs care rather than copying. A COUNT rule counts OCCURRENCES, so
// leaving COUNT on the head would let the head keep producing past the split,
// and leaving it on the tail would restart the count from scratch — the series
// would gain occurrences it never had. The head therefore trades COUNT for an
// UNTIL (which is exactly what "cut the UNTIL" means for a counted rule), and
// the tail keeps COUNT minus what the head already produced.
export function splitRecurrenceRule(
  rule: ParsedRecurrenceRule,
  splitAt: Date,
  headOccurrenceCount: number
): SeriesSplit {
  // One second before the split: UNTIL is inclusive in RFC 5545, and the
  // grammar's UNTIL has second resolution.
  const headUntil = new Date(splitAt.getTime() - 1000);

  const head: ParsedRecurrenceRule = { ...rule, count: null, until: headUntil };

  const tail: ParsedRecurrenceRule = {
    ...rule,
    count: rule.count === null ? null : Math.max(1, rule.count - headOccurrenceCount),
  };

  return { head: formatRecurrenceRule(head), tail: formatRecurrenceRule(tail) };
}

// How many occurrences the series produces strictly BEFORE the split point.
//
// Exceptions are deliberately ignored: COUNT counts the rule's occurrences, and
// a cancelled instance still consumed one of them.
export function countOccurrencesBefore(
  series: { rule: string | ParsedRecurrenceRule; startsAt: Date; endsAt: Date; allDay: boolean; zone: string },
  splitAt: Date
): number {
  const occurrences = expandOccurrences({
    rule: series.rule,
    startsAt: series.startsAt,
    endsAt: series.endsAt,
    allDay: series.allDay,
    zone: series.zone,
    // One millisecond BEFORE the series start. CAL1.2's overlap test is strict
    // (occ.endsAt > windowStart), so a window opening exactly at the start
    // would drop a zero-length first occurrence — and undercounting the head by
    // one hands the tail an extra occurrence the series never had.
    windowStart: new Date(series.startsAt.getTime() - 1),
    windowEnd: splitAt,
    exceptions: [],
    // Matches the parser's own COUNT ceiling, so a legal rule can never be
    // undercounted by this bound.
    limit: MAX_RECURRENCE_COUNT,
  });

  return occurrences.filter((occurrence) => occurrence.originalStartsAt.getTime() < splitAt.getTime()).length;
}

// Whether `instant` is genuinely one of the series' computed starts.
//
// Checked against the rule with NO exceptions applied, because the answer must
// be about the series' own instants: `?scope=this` addresses an occurrence by
// its ORIGINAL start, which stays the join key even after that occurrence has
// been moved somewhere else entirely.
//
// The ±1ms window is what makes a zero-length event findable — CAL1.2's overlap
// test is strict on both ends, so a window that starts exactly at the instant
// would miss an occurrence whose end equals its start.
export function isSeriesInstant(
  series: { rule: string | ParsedRecurrenceRule | null; startsAt: Date; endsAt: Date; allDay: boolean; zone: string },
  instant: Date
): boolean {
  if (!isValidInstant(instant)) return false;

  const occurrences = expandOccurrences({
    rule: series.rule,
    startsAt: series.startsAt,
    endsAt: series.endsAt,
    allDay: series.allDay,
    zone: series.zone,
    windowStart: new Date(instant.getTime() - 1),
    windowEnd: new Date(instant.getTime() + 1),
    exceptions: [],
    limit: DEFAULT_OCCURRENCE_LIMIT,
  });

  return occurrences.some(
    (occurrence) => occurrence.originalStartsAt.getTime() === instant.getTime()
  );
}

// Validation shared by POST and PATCH. Returns the parsed rule so the caller
// can split or re-serialise it without parsing twice.
export function validateRecurrenceRule(
  raw: string | null
): { ok: true; rule: ParsedRecurrenceRule | null } | { ok: false; error: string } {
  if (raw === null || raw.trim() === "") return { ok: true, rule: null };

  const parsed = parseRecurrenceRule(raw);
  if (!parsed.ok) return { ok: false, error: `recurrenceRule: ${parsed.error}` };
  return { ok: true, rule: parsed.rule };
}

// ---------------------------------------------------------------------------
// Series scopes
// ---------------------------------------------------------------------------

// plan §5.2 — the three modes every familiar calendar offers.
export const EVENT_SERIES_SCOPES = ["this", "following", "series"] as const;
export type EventSeriesScope = (typeof EVENT_SERIES_SCOPES)[number];

export function isEventSeriesScope(value: unknown): value is EventSeriesScope {
  return typeof value === "string" && (EVENT_SERIES_SCOPES as readonly string[]).includes(value);
}

// The four columns CalendarEventOccurrence can override. A `?scope=this` edit
// can change these and nothing else — anything else would have to live on the
// series, where it would silently apply to every other instance too.
export const OCCURRENCE_OVERRIDABLE_FIELDS = ["startsAt", "endsAt", "title", "location"] as const;

// Every field a write endpoint accepts. Its one job is to let `?scope=this`
// REFUSE a series-level field rather than accept the request and drop it: a
// silently ignored `visibility` on a single-occurrence edit reads to the caller
// as "the event is private now", and it is not.
export const EVENT_WRITABLE_FIELDS = [
  "title",
  "description",
  "startsAt",
  "endsAt",
  "allDay",
  "timezone",
  "recurrenceRule",
  "status",
  "visibility",
  "location",
  "latitude",
  "longitude",
  "metadata",
  "projectId",
  "customerId",
  "employeeId",
  "shiftId",
] as const;

// ---------------------------------------------------------------------------
// Timezone screening
// ---------------------------------------------------------------------------

// A client-supplied zone reaches Intl inside the expander, which throws on a
// bad name. Screened at the API boundary so it is a 400 naming the field rather
// than a 500 from three calls deeper.
export function validateTimeZone(raw: unknown): { ok: true; zone: string | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === "") return { ok: true, zone: null };
  if (typeof raw !== "string" || !isValidTimeZone(raw)) {
    return { ok: false, error: "timezone must be a valid IANA time zone name" };
  }
  return { ok: true, zone: raw };
}
