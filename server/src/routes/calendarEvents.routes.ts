import { Router, Request, Response } from "express";
import type { Prisma } from "@prisma/client";
import prisma from "../database/prisma";
import { createRateLimiter } from "../middleware/rateLimit.middleware";
import { RATE_LIMITS } from "../constants/rateLimits";
import {
  DEFAULT_EVENT_STATUS,
  DEFAULT_EVENT_VISIBILITY,
  isEventStatus,
  isEventVisibility,
} from "../constants/calendarEvents";
import { CALENDAR_AUDIT_ACTIONS } from "../constants/calendarAuditActions";
import type { CalendarPermission } from "../constants/calendarPermissions";
import {
  type CalendarActor,
  type CalendarSubject,
  resolveCalendarAccess,
  visibleCalendarFilter,
} from "../services/calendar/permissions";
import {
  type CalendarAuditChanges,
  auditSourceForRequest,
  diffChanges,
  writeCalendarAudit,
} from "../services/calendar/audit";
import { resolveCalendarTimeZone } from "../services/calendar/timezone";
import {
  DEFAULT_OCCURRENCE_LIMIT,
  type ParsedRecurrenceRule,
  computeRecurrenceEndsAt,
  expandOccurrences,
} from "../services/calendar/recurrence";
import {
  EVENT_DETAIL_SELECT,
  EVENT_FREE_BUSY_SELECT,
  EVENT_WRITABLE_FIELDS,
  MAX_CANDIDATE_EVENTS,
  MAX_WINDOW_OCCURRENCES,
  OCCURRENCE_OVERRIDABLE_FIELDS,
  type DetailEventRow,
  type EventAccessLevel,
  type FreeBusyEventRow,
  type LocationReferences,
  type OccurrenceDto,
  type ResolvedLocation,
  accessLevelFor,
  allDayRange,
  countOccurrencesBefore,
  eventViewFor,
  exceptionsOf,
  formatRecurrenceRule,
  isEventSeriesScope,
  isSeriesInstant,
  parseWindow,
  resolveEventLocation,
  serializeBusyDefinition,
  serializeBusyOccurrence,
  serializeDetailOccurrence,
  serializeEventDefinition,
  splitRecurrenceRule,
  validateRecurrenceRule,
  validateTimeZone,
  windowCandidateFilter,
} from "../services/calendar/events";

const router = Router();

// CAL1.5 — the event API. See docs/calendar-system-plan.md §8 and
// docs/calendar-cal1-scope.md §2 (CAL1.5).
//
// Mounted through `tenantWrite` in app.ts, so a read-only (lapsed) company
// inherits the write block automatically — GET/HEAD/OPTIONS always pass.
//
// STILL NO UI. The calendar becomes visible at CAL1.6; these endpoints exist so
// the data, permission and audit layers are exercised for real before anything
// is rendered. Rollback is removing the one mount line in app.ts.
//
// FIVE RULES EVERY HANDLER HERE FOLLOWS:
//
//   1. No handler reads a CalendarEvent without first resolving the CALENDAR
//      through services/calendar/permissions.ts. The event's own row carries no
//      authorisation; its container does.
//   2. from/to are mandatory and bounded (Q7: 366 days). An unbounded window is
//      an unbounded recurrence expansion, in this process, inside one request.
//   3. At view_free_busy level the SELECT itself omits title, description and
//      location. Not the serialiser — the query.
//   4. Every id arriving in the body — projectId, customerId, employeeId,
//      shiftId — is re-resolved under the CALENDAR's tenant before it is
//      stored, the shifts.routes.ts pattern (§11.2).
//   5. Every mutation writes its audit row in the SAME transaction (D13). If
//      the audit insert fails, the mutation rolls back.
//
// 404 vs 403, the CAL1.4 convention continued:
//   * cannot see the calendar (or the event's existence is hidden) → 404
//   * can see it but lacks the specific permission                 → 403

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

// A bucket of its own rather than sharing CAL1.4's "calendar-writes" key.
// Same budget, different counter: reorganising a calendar's sharing and working
// through a day's events are different activities, and one must not be able to
// lock the other out. The limit VALUE stays the single CALENDAR_WRITES entry in
// constants/rateLimits.ts (plan §8, rule 4).
const eventWriteLimiter = createRateLimiter({
  name: "calendar-event-writes",
  ...RATE_LIMITS.CALENDAR_WRITES,
  keyGenerator: (req) => (req.user ? String(req.user.userId) : req.ip ?? "unknown"),
});

function actorFrom(req: Request): CalendarActor {
  return {
    id: req.user!.userId,
    companyId: req.user!.companyId,
    role: req.user!.role,
    employeeId: req.user!.employeeId,
  };
}

// Every audit row this router writes derives its source HERE, from the
// authentication path — never from a header or the body (§6.6).
function auditBase(req: Request) {
  return {
    actorUserId: req.user!.userId,
    source: auditSourceForRequest(req),
    requestId: req.id ?? null,
  };
}

// The calendar shape the event routes need: the permission gate's inputs, plus
// the two columns that decide an event's time zone.
//
// Deliberately a LOCAL loader rather than an import from calendars.routes.ts.
// That file belongs to CAL1.4 and this milestone does not modify it; a router
// exporting helpers to another router would also invert the dependency (routes
// are the outermost layer here, not a shared one).
type LoadedCalendar = Omit<CalendarSubject, "members"> & {
  id: number;
  timezone: string | null;
  company: { timezone: string | null };
  members: Array<{
    principalType: string;
    principalId: string;
    preset: string;
    permissions: string | null;
  }>;
};

const CALENDAR_SELECT = {
  id: true,
  companyId: true,
  type: true,
  ownerUserId: true,
  archivedAt: true,
  timezone: true,
  company: { select: { timezone: true } },
  members: {
    select: { principalType: true, principalId: true, preset: true, permissions: true },
  },
} as const;

// Returns null when the caller may not see the calendar at all — the 404 case.
// The lookup is deliberately not tenant-filtered: resolveCalendarAccess applies
// tenant isolation before consulting any grant, so a foreign-tenant row
// resolves to an empty permission set and becomes the same 404 as a
// non-existent id.
async function loadCalendarFor(
  actor: CalendarActor,
  calendarId: number
): Promise<{ calendar: LoadedCalendar; permissions: Set<CalendarPermission> } | null> {
  if (!Number.isInteger(calendarId)) return null;

  const calendar = (await prisma.calendar.findUnique({
    where: { id: calendarId },
    select: CALENDAR_SELECT,
  })) as LoadedCalendar | null;

  if (!calendar) return null;

  const permissions = resolveCalendarAccess(actor, calendar);
  if (permissions.size === 0) return null;

  return { calendar, permissions };
}

// The four-level order lives in CAL1.2; this only supplies the sources.
function zoneFor(calendar: LoadedCalendar, eventTimeZone: string | null): string {
  return resolveCalendarTimeZone({
    eventTimeZone,
    calendarTimeZone: calendar.timezone,
    companyTimeZone: calendar.company.timezone,
  });
}

function parseInstant(raw: unknown): Date | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

// ---------------------------------------------------------------------------
// Body parsing and validation
// ---------------------------------------------------------------------------

type FieldParse =
  | { ok: true; updates: Record<string, unknown>; rule: ParsedRecurrenceRule | null; ruleProvided: boolean }
  | { ok: false; error: string };

// Reads ONLY the keys the caller actually sent. The distinction matters
// throughout: an absent key means "leave it alone", an explicit null means
// "clear it", and the audit diff depends on telling those apart.
//
// The four source references are NOT handled here — they need a database round
// trip under the tenant scope, which happens in resolveReferences().
function parseEventFields(body: Record<string, unknown>): FieldParse {
  const updates: Record<string, unknown> = {};

  if ("title" in body) {
    const title = body.title;
    if (typeof title !== "string" || !title.trim()) {
      return { ok: false, error: "title cannot be empty" };
    }
    updates.title = title.trim();
  }

  if ("description" in body) {
    const value = body.description;
    if (value !== null && typeof value !== "string") {
      return { ok: false, error: "description must be a string or null" };
    }
    updates.description = value;
  }

  for (const field of ["startsAt", "endsAt"] as const) {
    if (!(field in body)) continue;
    const instant = parseInstant(body[field]);
    if (!instant) return { ok: false, error: `${field} must be an ISO-8601 instant` };
    updates[field] = instant;
  }

  if ("allDay" in body) {
    if (typeof body.allDay !== "boolean") return { ok: false, error: "allDay must be a boolean" };
    updates.allDay = body.allDay;
  }

  if ("timezone" in body) {
    const zone = validateTimeZone(body.timezone);
    if (!zone.ok) return { ok: false, error: zone.error };
    updates.timezone = zone.zone;
  }

  let rule: ParsedRecurrenceRule | null = null;
  let ruleProvided = false;
  if ("recurrenceRule" in body) {
    const raw = body.recurrenceRule;
    if (raw !== null && typeof raw !== "string") {
      return { ok: false, error: "recurrenceRule must be a string or null" };
    }
    const validated = validateRecurrenceRule(raw);
    if (!validated.ok) return { ok: false, error: validated.error };
    rule = validated.rule;
    ruleProvided = true;
    // Stored in canonical form. The `following` split re-serialises rules, and
    // a head and tail written in a different dialect from the original would
    // make the audit trail read as a change nobody made.
    updates.recurrenceRule = rule ? formatRecurrenceRule(rule) : null;
  }

  if ("status" in body) {
    if (!isEventStatus(body.status)) {
      return { ok: false, error: "status must be one of confirmed, tentative, cancelled" };
    }
    updates.status = body.status;
  }

  if ("visibility" in body) {
    if (!isEventVisibility(body.visibility)) {
      return { ok: false, error: "visibility must be one of default, private, confidential" };
    }
    updates.visibility = body.visibility;
  }

  if ("location" in body) {
    const value = body.location;
    if (value !== null && typeof value !== "string") {
      return { ok: false, error: "location must be a string or null" };
    }
    updates.location = value;
  }

  for (const field of ["latitude", "longitude"] as const) {
    if (!(field in body)) continue;
    const value = body[field];
    if (value === null) {
      updates[field] = null;
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { ok: false, error: `${field} must be a number or null` };
    }
    const bound = field === "latitude" ? 90 : 180;
    if (Math.abs(value) > bound) return { ok: false, error: `${field} is out of range` };
    updates[field] = value;
  }

  if ("metadata" in body) {
    const value = body.metadata;
    if (value === null) updates.metadata = null;
    else if (typeof value === "object") updates.metadata = JSON.stringify(value);
    else return { ok: false, error: "metadata must be an object or null" };
  }

  return { ok: true, updates, rule, ruleProvided };
}

type ReferenceResolution =
  | { ok: true; references: Record<string, number | null> }
  | { ok: false; status: number; error: string };

// Rule 4 — every id in the body is re-resolved under the CALENDAR's tenant.
//
// The scope comes from the calendar rather than from companyScope(req) on
// purpose: companyScope() hands a DEVELOPER an empty where-clause, so a
// platform operator writing an event onto a tenant's calendar could otherwise
// attach another tenant's project to it. The calendar's own companyId is the
// only correct tenant for its events.
async function resolveReferences(
  companyId: number,
  body: Record<string, unknown>
): Promise<ReferenceResolution> {
  const references: Record<string, number | null> = {};

  const lookups: Array<[string, string, (id: number) => Promise<unknown>]> = [
    ["projectId", "Project", (id) => prisma.project.findFirst({ where: { id, companyId }, select: { id: true } })],
    ["customerId", "Customer", (id) => prisma.customer.findFirst({ where: { id, companyId }, select: { id: true } })],
    ["employeeId", "Employee", (id) => prisma.employee.findFirst({ where: { id, companyId }, select: { id: true } })],
    // Shift carries no companyId of its own — the tenant is reached through the
    // employee it belongs to, exactly as every other Shift read in the repo
    // does it.
    ["shiftId", "Shift", (id) => prisma.shift.findFirst({ where: { id, employee: { companyId } }, select: { id: true } })],
  ];

  for (const [field, label, find] of lookups) {
    if (!(field in body)) continue;

    const raw = body[field];
    if (raw === null || raw === "" || raw === undefined) {
      references[field] = null;
      continue;
    }

    const id = Number(raw);
    // A foreign or malformed id answers 404 — the same answer a non-existent
    // one gets, so the endpoint is not an existence oracle across tenants.
    if (!Number.isInteger(id)) return { ok: false, status: 404, error: `${label} not found` };

    const found = await find(id);
    if (!found) return { ok: false, status: 404, error: `${label} not found` };

    references[field] = id;
  }

  return { ok: true, references };
}

// startsAt/endsAt as they are actually stored, once all-day semantics apply.
function resolveTimes(
  startsAt: Date,
  endsAt: Date,
  allDay: boolean,
  zone: string
): { ok: true; startsAt: Date; endsAt: Date } | { ok: false; error: string } {
  if (allDay) {
    // Only the DATES an all-day event names are meaningful, so both ends are
    // snapped to local midnight in the calendar's zone (CAL1.2). An end before
    // the start collapses to a single day rather than being rejected: for an
    // all-day entry the pair is a date range, and "one day" is the only sane
    // reading of a reversed one.
    return { ok: true, ...allDayRange(startsAt, endsAt, zone) };
  }

  if (endsAt.getTime() < startsAt.getTime()) {
    return { ok: false, error: "endsAt cannot be before startsAt" };
  }
  return { ok: true, startsAt, endsAt };
}

// ---------------------------------------------------------------------------
// Location resolution for a set of events (R5)
// ---------------------------------------------------------------------------

// Loads the referenced projects and customers ONCE for a whole response rather
// than per event. Only detail-level rows ever reach here: at free/busy level
// there is no address in the response to resolve.
async function loadLocationReferences(
  events: DetailEventRow[]
): Promise<(event: DetailEventRow) => ResolvedLocation> {
  const projectIds = [...new Set(events.map((event) => event.projectId).filter((id): id is number => id !== null))];
  const customerIds = [...new Set(events.map((event) => event.customerId).filter((id): id is number => id !== null))];

  const [projects, customers] = await Promise.all([
    projectIds.length
      ? prisma.project.findMany({
          where: { id: { in: projectIds } },
          select: { id: true, address: true, latitude: true, longitude: true },
        })
      : Promise.resolve([]),
    customerIds.length
      ? prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, address: true } })
      : Promise.resolve([]),
  ]);

  const projectById = new Map(projects.map((project) => [project.id, project]));
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));

  return (event: DetailEventRow) => {
    const references: LocationReferences = {
      project: event.projectId === null ? null : projectById.get(event.projectId) ?? null,
      customer: event.customerId === null ? null : customerById.get(event.customerId) ?? null,
    };
    return resolveEventLocation(event, references);
  };
}

// ---------------------------------------------------------------------------
// GET /calendar/events — the window query
// ---------------------------------------------------------------------------

function parseIdList(raw: unknown): number[] | null | "invalid" {
  if (raw === undefined || raw === "") return null;
  if (typeof raw !== "string") return "invalid";

  const ids = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map(Number);

  if (ids.length === 0 || ids.some((id) => !Number.isInteger(id))) return "invalid";
  return ids;
}

function parseOptionalId(raw: unknown): number | null | "invalid" {
  if (raw === undefined || raw === "") return null;
  const id = Number(raw);
  return Number.isInteger(id) ? id : "invalid";
}

router.get("/", async (req: Request, res: Response) => {
  const actor = actorFrom(req);
  const query = req.query as Record<string, unknown>;

  const window = parseWindow(query);
  if (!window.ok) return res.status(400).json({ error: window.error });

  const requestedCalendarIds = parseIdList(query.calendarIds);
  if (requestedCalendarIds === "invalid") {
    return res.status(400).json({ error: "calendarIds must be a comma-separated list of integers" });
  }

  const projectId = parseOptionalId(query.projectId);
  if (projectId === "invalid") return res.status(400).json({ error: "projectId must be an integer" });

  const employeeId = parseOptionalId(query.employeeId);
  if (employeeId === "invalid") return res.status(400).json({ error: "employeeId must be an integer" });

  // Step 1 — which calendars, and at what level. The permission filter is in
  // the query (§11.1); the resolver then has the final word, because SQL cannot
  // read inside a CUSTOM grant's stored permission list.
  const calendars = (await prisma.calendar.findMany({
    where: visibleCalendarFilter(actor),
    select: CALENDAR_SELECT,
  })) as LoadedCalendar[];

  const requested = requestedCalendarIds === null ? null : new Set(requestedCalendarIds);
  const detailIds: number[] = [];
  const freeBusyIds: number[] = [];
  const calendarById = new Map<number, LoadedCalendar>();

  for (const calendar of calendars) {
    if (requested && !requested.has(calendar.id)) continue;

    const level = accessLevelFor(resolveCalendarAccess(actor, calendar));
    if (level === null) continue;

    calendarById.set(calendar.id, calendar);
    (level === "details" ? detailIds : freeBusyIds).push(calendar.id);
  }

  if (detailIds.length === 0 && freeBusyIds.length === 0) {
    return res.json({ from: window.from.toISOString(), to: window.to.toISOString(), truncated: false, occurrences: [] });
  }

  const candidateFilter = (calendarIds: number[]): Prisma.CalendarEventWhereInput =>
    windowCandidateFilter({
      calendarIds,
      from: window.from,
      to: window.to,
      companyId: actor.companyId,
      projectId,
      employeeId,
    });

  // Step 2 — TWO queries, because the two levels are two different SELECTs
  // (rule 3). This is the same index, just a narrower projection.
  const [detailRows, freeBusyRows] = await Promise.all([
    detailIds.length
      ? (prisma.calendarEvent.findMany({
          where: candidateFilter(detailIds),
          select: EVENT_DETAIL_SELECT,
          orderBy: { startsAt: "asc" },
          take: MAX_CANDIDATE_EVENTS,
        }) as unknown as Promise<DetailEventRow[]>)
      : Promise.resolve([] as DetailEventRow[]),
    freeBusyIds.length
      ? (prisma.calendarEvent.findMany({
          where: candidateFilter(freeBusyIds),
          select: EVENT_FREE_BUSY_SELECT,
          orderBy: { startsAt: "asc" },
          take: MAX_CANDIDATE_EVENTS,
        }) as unknown as Promise<FreeBusyEventRow[]>)
      : Promise.resolve([] as FreeBusyEventRow[]),
  ]);

  let truncated =
    detailRows.length >= MAX_CANDIDATE_EVENTS || freeBusyRows.length >= MAX_CANDIDATE_EVENTS;
  let budget = MAX_WINDOW_OCCURRENCES;
  const occurrences: OccurrenceDto[] = [];

  const locationFor = await loadLocationReferences(detailRows);

  // Step 3 — expand. The per-series ceiling is CAL1.2's; the response-wide one
  // is this module's, and both are reported rather than applied silently. A
  // truncated calendar that does not say so is a calendar that lies.
  const expandInto = (
    row: DetailEventRow | FreeBusyEventRow,
    level: EventAccessLevel
  ): boolean => {
    const calendar = calendarById.get(row.calendarId);
    if (!calendar) return true;

    const view = eventViewFor(row, actor.id, level);
    // `confidential`, and not the creator: the slot must look free (§4.7).
    if (view === "hidden") return true;

    if (budget <= 0) {
      truncated = true;
      return false;
    }

    const limit = Math.min(DEFAULT_OCCURRENCE_LIMIT, budget);
    const expanded = expandOccurrences({
      rule: row.recurrenceRule,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      allDay: row.allDay,
      zone: zoneFor(calendar, row.timezone),
      windowStart: window.from,
      windowEnd: window.to,
      exceptions: exceptionsOf(row),
      limit,
    });

    // Hitting the ceiling exactly may or may not mean something was dropped;
    // reporting it as truncated is the safe direction of that uncertainty.
    if (expanded.length >= limit) truncated = true;
    budget -= expanded.length;

    for (const occurrence of expanded) {
      if (view === "details" && level === "details") {
        const detail = row as DetailEventRow;
        occurrences.push(serializeDetailOccurrence(detail, occurrence, locationFor(detail)));
      } else {
        // Everything else is a busy block: a `private` event the caller did not
        // create, or a calendar they only hold free/busy on. In the latter case
        // the content was never loaded, so there is nothing here to drop.
        occurrences.push(serializeBusyOccurrence(row, occurrence));
      }
    }

    return true;
  };

  for (const row of detailRows) if (!expandInto(row, "details")) break;
  for (const row of freeBusyRows) if (!expandInto(row, "free_busy")) break;

  occurrences.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id - b.id);

  res.json({
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    truncated,
    occurrences,
  });
});

// ---------------------------------------------------------------------------
// Loading one event, with its calendar and the caller's rights on it
// ---------------------------------------------------------------------------

type LoadedEvent = {
  calendar: LoadedCalendar;
  permissions: Set<CalendarPermission>;
  level: EventAccessLevel;
  event: DetailEventRow;
  zone: string;
};

// Returns null for every case that must answer 404: no such event, a calendar
// the caller cannot see, a calendar they hold no read permission on, or a
// `confidential` event they did not create.
//
// Loads the FULL row regardless of level. That is not a contradiction of
// rule 3: a mutation has to diff against the stored values to audit them, and
// nothing here is serialised without going back through the level check.
async function loadEventFor(actor: CalendarActor, eventId: number): Promise<LoadedEvent | null> {
  if (!Number.isInteger(eventId)) return null;

  const stub = await prisma.calendarEvent.findUnique({
    where: { id: eventId },
    select: { calendarId: true },
  });
  if (!stub) return null;

  const loaded = await loadCalendarFor(actor, stub.calendarId);
  if (!loaded) return null;

  const level = accessLevelFor(loaded.permissions);
  if (level === null) return null;

  const event = (await prisma.calendarEvent.findUnique({
    where: { id: eventId },
    select: EVENT_DETAIL_SELECT,
  })) as DetailEventRow | null;
  if (!event) return null;

  if (eventViewFor(event, actor.id, level) === "hidden") return null;

  return {
    calendar: loaded.calendar,
    permissions: loaded.permissions,
    level,
    event,
    zone: zoneFor(loaded.calendar, event.timezone),
  };
}

// The response for a single event, at whatever level the caller has earned.
async function respondWithEvent(res: Response, actor: CalendarActor, loaded: LoadedEvent) {
  const view = eventViewFor(loaded.event, actor.id, loaded.level);
  if (view !== "details" || loaded.level !== "details") {
    return res.json(serializeBusyDefinition(loaded.event));
  }

  const locationFor = await loadLocationReferences([loaded.event]);
  return res.json(serializeEventDefinition(loaded.event, locationFor(loaded.event)));
}

// ---------------------------------------------------------------------------
// GET /calendar/events/:id — the series definition
// ---------------------------------------------------------------------------

router.get("/:id", async (req: Request, res: Response) => {
  const actor = actorFrom(req);
  const loaded = await loadEventFor(actor, Number(req.params.id));
  if (!loaded) return res.status(404).json({ error: "Event not found" });

  return respondWithEvent(res, actor, loaded);
});

// ---------------------------------------------------------------------------
// POST /calendar/events
// ---------------------------------------------------------------------------

router.post("/", eventWriteLimiter, async (req: Request, res: Response) => {
  const actor = actorFrom(req);
  const body = (req.body ?? {}) as Record<string, unknown>;

  const loaded = await loadCalendarFor(actor, Number(body.calendarId));
  if (!loaded) return res.status(404).json({ error: "Calendar not found" });
  if (!loaded.permissions.has("event.create")) {
    return res.status(403).json({ error: "You cannot create events in this calendar" });
  }

  const parsed = parseEventFields(body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  if (typeof parsed.updates.title !== "string") {
    return res.status(400).json({ error: "title is required" });
  }
  if (!(parsed.updates.startsAt instanceof Date) || !(parsed.updates.endsAt instanceof Date)) {
    return res.status(400).json({ error: "startsAt and endsAt are required ISO-8601 instants" });
  }

  const references = await resolveReferences(loaded.calendar.companyId, body);
  if (!references.ok) return res.status(references.status).json({ error: references.error });

  const allDay = parsed.updates.allDay === true;
  const zone = zoneFor(loaded.calendar, (parsed.updates.timezone as string | null) ?? null);
  const times = resolveTimes(parsed.updates.startsAt, parsed.updates.endsAt, allDay, zone);
  if (!times.ok) return res.status(400).json({ error: times.error });

  const recurrenceRule = (parsed.updates.recurrenceRule as string | null) ?? null;

  const data = {
    calendarId: loaded.calendar.id,
    // The tenant comes from the CALENDAR, never from the caller's token: it is
    // the calendar that decides who may read the event, so the two must agree
    // by construction.
    companyId: loaded.calendar.companyId,
    title: parsed.updates.title,
    description: (parsed.updates.description as string | null) ?? null,
    startsAt: times.startsAt,
    endsAt: times.endsAt,
    allDay,
    timezone: (parsed.updates.timezone as string | null) ?? null,
    recurrenceRule,
    // The pruning column, computed at WRITE time (plan §5.2). NULL means the
    // rule is infinite, which the window query reads as "always a candidate".
    recurrenceEndsAt: computeRecurrenceEndsAt({
      rule: recurrenceRule,
      startsAt: times.startsAt,
      endsAt: times.endsAt,
      allDay,
      zone,
    }),
    status: (parsed.updates.status as string | undefined) ?? DEFAULT_EVENT_STATUS,
    visibility: (parsed.updates.visibility as string | undefined) ?? DEFAULT_EVENT_VISIBILITY,
    // Scalar, from the JWT — never from the body.
    createdByUserId: actor.id,
    projectId: references.references.projectId ?? null,
    customerId: references.references.customerId ?? null,
    employeeId: references.references.employeeId ?? null,
    shiftId: references.references.shiftId ?? null,
    location: (parsed.updates.location as string | null) ?? null,
    latitude: (parsed.updates.latitude as number | null) ?? null,
    longitude: (parsed.updates.longitude as number | null) ?? null,
    metadata: (parsed.updates.metadata as string | null) ?? null,
  };

  const created = await prisma.$transaction(async (tx) => {
    const event = await tx.calendarEvent.create({ data });

    // D13 — EVENT_CREATED is a deliberate departure from the repo's "creation
    // is derivable from createdAt" rule: events ARE deleted, and the deletion
    // takes createdAt and createdByUserId with it. The audit row outlives it.
    //
    // diffChanges against an empty before gives from:null for every field that
    // was actually set, and omits the ones left null — a compact record of what
    // was created rather than a full-row snapshot (§6.6).
    await writeCalendarAudit(tx, {
      ...auditBase(req),
      companyId: loaded.calendar.companyId,
      calendarId: loaded.calendar.id,
      targetType: "EVENT",
      targetId: event.id,
      action: CALENDAR_AUDIT_ACTIONS.EVENT_CREATED,
      changes: diffChanges({} as Record<string, unknown>, data as Record<string, unknown>),
    });

    return event;
  });

  const reloaded = await loadEventFor(actor, created.id);
  if (!reloaded) return res.status(201).json({ id: created.id });

  res.status(201);
  return respondWithEvent(res, actor, reloaded);
});

// ---------------------------------------------------------------------------
// Series scope resolution, shared by PATCH and DELETE
// ---------------------------------------------------------------------------

type ScopeResolution =
  | { ok: true; scope: "series"; occurrenceStart: null }
  | { ok: true; scope: "this" | "following"; occurrenceStart: Date }
  | { ok: false; status: number; error: string };

// A non-recurring event has exactly one occurrence, so every scope collapses to
// `series` on it and occurrenceStart is not required. A `following` split at
// (or before) the series' own start is likewise the whole series — there is no
// head to keep.
function resolveScope(loaded: LoadedEvent, query: Record<string, unknown>): ScopeResolution {
  const raw = query.scope === undefined ? "series" : query.scope;
  if (!isEventSeriesScope(raw)) {
    return { ok: false, status: 400, error: "scope must be one of this, following, series" };
  }

  if (raw === "series" || !loaded.event.recurrenceRule) {
    return { ok: true, scope: "series", occurrenceStart: null };
  }

  const occurrenceStart = parseInstant(query.occurrenceStart);
  if (!occurrenceStart) {
    return {
      ok: false,
      status: 400,
      error: "occurrenceStart is required for scope=this and scope=following",
    };
  }

  // Proven against the RULE, with no exceptions applied: `?scope=this`
  // addresses an occurrence by its ORIGINAL computed start, which stays the
  // join key even after that instance has been moved elsewhere. Without this
  // check an exception row could be written for an instant the series never
  // produces — a ghost override nothing would ever match.
  const series = {
    rule: loaded.event.recurrenceRule,
    startsAt: loaded.event.startsAt,
    endsAt: loaded.event.endsAt,
    allDay: loaded.event.allDay,
    zone: loaded.zone,
  };
  if (!isSeriesInstant(series, occurrenceStart)) {
    return { ok: false, status: 400, error: "occurrenceStart is not an occurrence of this series" };
  }

  if (raw === "following" && occurrenceStart.getTime() <= loaded.event.startsAt.getTime()) {
    return { ok: true, scope: "series", occurrenceStart: null };
  }

  return { ok: true, scope: raw, occurrenceStart };
}

// The head/tail rules for a `following` split, plus the head's new pruning
// value. Shared by the PATCH (which opens a new series) and the DELETE (which
// only keeps the head).
function splitAt(loaded: LoadedEvent, occurrenceStart: Date) {
  const parsed = validateRecurrenceRule(loaded.event.recurrenceRule);
  // Unreachable in practice: the rule was validated when it was written, and a
  // non-recurring event never reaches a `following` scope. Falling back to a
  // whole-series operation is the safe reading if stored data is broken.
  if (!parsed.ok || parsed.rule === null) return null;

  const series = {
    rule: parsed.rule,
    startsAt: loaded.event.startsAt,
    endsAt: loaded.event.endsAt,
    allDay: loaded.event.allDay,
    zone: loaded.zone,
  };
  const headCount = countOccurrencesBefore(series, occurrenceStart);
  const split = splitRecurrenceRule(parsed.rule, occurrenceStart, headCount);

  return {
    ...split,
    headRecurrenceEndsAt: computeRecurrenceEndsAt({
      rule: split.head,
      startsAt: loaded.event.startsAt,
      endsAt: loaded.event.endsAt,
      allDay: loaded.event.allDay,
      zone: loaded.zone,
    }),
  };
}

// ---------------------------------------------------------------------------
// PATCH /calendar/events/:id?scope=this|following|series
// ---------------------------------------------------------------------------

router.patch("/:id", eventWriteLimiter, async (req: Request, res: Response) => {
  const actor = actorFrom(req);
  const loaded = await loadEventFor(actor, Number(req.params.id));
  if (!loaded) return res.status(404).json({ error: "Event not found" });

  const isCreator = loaded.event.createdByUserId === actor.id;
  const mayEdit =
    loaded.permissions.has("event.edit_any") || (isCreator && loaded.permissions.has("event.edit_own"));
  if (!mayEdit) return res.status(403).json({ error: "You cannot edit this event" });

  const scope = resolveScope(loaded, req.query as Record<string, unknown>);
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const parsed = parseEventFields(body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  if ("calendarId" in body) {
    // Moving an event between calendars moves it between PERMISSION DOMAINS —
    // a personal event could be handed to the company owner in a single PATCH.
    // Same reasoning that makes Calendar.type immutable in CAL1.4.
    return res.status(400).json({ error: "calendarId cannot be changed" });
  }

  if (scope.scope === "this") {
    return patchSingleOccurrence(req, res, actor, loaded, body, parsed.updates, scope.occurrenceStart);
  }
  if (scope.scope === "following") return patchFollowing(req, res, actor, loaded, body, parsed, scope.occurrenceStart);
  return patchSeries(req, res, actor, loaded, body, parsed);
});

type ParsedFields = Extract<FieldParse, { ok: true }>;

// --- scope=series -----------------------------------------------------------

async function patchSeries(
  req: Request,
  res: Response,
  actor: CalendarActor,
  loaded: LoadedEvent,
  body: Record<string, unknown>,
  parsed: ParsedFields
) {
  const references = await resolveReferences(loaded.calendar.companyId, body);
  if (!references.ok) return res.status(references.status).json({ error: references.error });

  const updates: Record<string, unknown> = { ...parsed.updates, ...references.references };

  const allDay = "allDay" in updates ? updates.allDay === true : loaded.event.allDay;
  const zone = zoneFor(
    loaded.calendar,
    ("timezone" in updates ? (updates.timezone as string | null) : loaded.event.timezone) ?? null
  );
  const startsAt = (updates.startsAt as Date | undefined) ?? loaded.event.startsAt;
  const endsAt = (updates.endsAt as Date | undefined) ?? loaded.event.endsAt;

  const times = resolveTimes(startsAt, endsAt, allDay, zone);
  if (!times.ok) return res.status(400).json({ error: times.error });

  // Any of these five changes the shape of the series, so the pruning column
  // has to be recomputed — a stale recurrenceEndsAt either hides a series from
  // the window query or keeps expanding one that has ended.
  const shapeChanged =
    "startsAt" in updates ||
    "endsAt" in updates ||
    "allDay" in updates ||
    "timezone" in updates ||
    parsed.ruleProvided;

  if (shapeChanged) {
    updates.startsAt = times.startsAt;
    updates.endsAt = times.endsAt;
    updates.recurrenceEndsAt = computeRecurrenceEndsAt({
      rule: parsed.ruleProvided
        ? (updates.recurrenceRule as string | null)
        : loaded.event.recurrenceRule,
      startsAt: times.startsAt,
      endsAt: times.endsAt,
      allDay,
      zone,
    });
  }

  const changes = diffChanges(loaded.event as unknown as Record<string, unknown>, updates);
  if (!changes) {
    // A no-op PATCH writes NO audit row — the log must not fill with false
    // from/to pairs (§6.6).
    return respondWithEvent(res, actor, loaded);
  }

  await prisma.$transaction(async (tx) => {
    await tx.calendarEvent.update({
      where: { id: loaded.event.id },
      data: updates as Prisma.CalendarEventUpdateInput,
    });
    await writeCalendarAudit(tx, {
      ...auditBase(req),
      companyId: loaded.calendar.companyId,
      calendarId: loaded.calendar.id,
      targetType: "EVENT",
      targetId: loaded.event.id,
      action: CALENDAR_AUDIT_ACTIONS.EVENT_UPDATED,
      changes,
    });
  });

  const reloaded = await loadEventFor(actor, loaded.event.id);
  if (!reloaded) return res.status(404).json({ error: "Event not found" });
  return respondWithEvent(res, actor, reloaded);
}

// --- scope=this -------------------------------------------------------------

// One instance, expressed as a CalendarEventOccurrence row. Only the four
// columns that table carries can be overridden; anything else would have to be
// written on the series, where it would silently change every other instance.
async function patchSingleOccurrence(
  req: Request,
  res: Response,
  actor: CalendarActor,
  loaded: LoadedEvent,
  body: Record<string, unknown>,
  updates: Record<string, unknown>,
  occurrenceStart: Date
) {
  // Checked against the RAW BODY, not against the parsed updates: the four
  // source references never enter `updates` at all, so a projectId sent with
  // scope=this would otherwise be accepted and silently discarded.
  const disallowed = Object.keys(body).filter(
    (field) =>
      (EVENT_WRITABLE_FIELDS as readonly string[]).includes(field) &&
      !(OCCURRENCE_OVERRIDABLE_FIELDS as readonly string[]).includes(field)
  );
  if (disallowed.length > 0) {
    return res.status(400).json({
      error: `scope=this can only override ${OCCURRENCE_OVERRIDABLE_FIELDS.join(", ")} — got ${disallowed.sort().join(", ")}`,
    });
  }

  const existing = loaded.event.occurrences.find(
    (row) => row.originalStartsAt.getTime() === occurrenceStart.getTime()
  );

  const before: Record<string, unknown> = existing
    ? { startsAt: existing.startsAt, endsAt: existing.endsAt, title: existing.title, location: existing.location }
    : {};

  const changes = diffChanges(before, updates);
  if (!changes) return respondWithEvent(res, actor, loaded);

  await prisma.$transaction(async (tx) => {
    await tx.calendarEventOccurrence.upsert({
      where: {
        eventId_originalStartsAt: { eventId: loaded.event.id, originalStartsAt: occurrenceStart },
      },
      create: {
        eventId: loaded.event.id,
        originalStartsAt: occurrenceStart,
        cancelled: false,
        ...updates,
      },
      update: updates,
    });

    await writeCalendarAudit(tx, {
      ...auditBase(req),
      companyId: loaded.calendar.companyId,
      calendarId: loaded.calendar.id,
      // The audit vocabulary's target types are CALENDAR/EVENT/MEMBER/
      // PARTICIPANT (CAL1.1) — an exception row is part of its event, so the
      // row is filed against the event and names the instance in `changes`.
      targetType: "EVENT",
      targetId: loaded.event.id,
      action: CALENDAR_AUDIT_ACTIONS.EVENT_UPDATED,
      changes: { occurrenceStart: { from: null, to: occurrenceStart.toISOString() }, ...changes },
    });
  });

  const reloaded = await loadEventFor(actor, loaded.event.id);
  if (!reloaded) return res.status(404).json({ error: "Event not found" });
  return respondWithEvent(res, actor, reloaded);
}

// --- scope=following --------------------------------------------------------

// "This and the following": the original rule's UNTIL is cut at the split point
// and a NEW series opens there carrying the edit. The stored exceptions move
// with the half they belong to — leaving them behind would silently resurrect
// cancellations against occurrences that no longer exist.
async function patchFollowing(
  req: Request,
  res: Response,
  actor: CalendarActor,
  loaded: LoadedEvent,
  body: Record<string, unknown>,
  parsed: ParsedFields,
  occurrenceStart: Date
) {
  const split = splitAt(loaded, occurrenceStart);
  if (!split) return res.status(400).json({ error: "This event has no usable recurrence rule" });

  const references = await resolveReferences(loaded.calendar.companyId, body);
  if (!references.ok) return res.status(references.status).json({ error: references.error });

  const updates = { ...parsed.updates, ...references.references };

  const allDay = "allDay" in updates ? updates.allDay === true : loaded.event.allDay;
  const zone = zoneFor(
    loaded.calendar,
    ("timezone" in updates ? (updates.timezone as string | null) : loaded.event.timezone) ?? null
  );

  // The tail starts at the split unless the edit moves it, and keeps the
  // series' own duration unless the edit changes that too.
  const durationMs = loaded.event.endsAt.getTime() - loaded.event.startsAt.getTime();
  const tailStart = (updates.startsAt as Date | undefined) ?? occurrenceStart;
  const tailEnd = (updates.endsAt as Date | undefined) ?? new Date(tailStart.getTime() + durationMs);

  const times = resolveTimes(tailStart, tailEnd, allDay, zone);
  if (!times.ok) return res.status(400).json({ error: times.error });

  // The tail inherits everything the head had, then the edit is applied on top.
  const tailRule = parsed.ruleProvided ? (updates.recurrenceRule as string | null) : split.tail;

  const tailData = {
    calendarId: loaded.calendar.id,
    companyId: loaded.calendar.companyId,
    title: (updates.title as string | undefined) ?? loaded.event.title,
    description: "description" in updates ? (updates.description as string | null) : loaded.event.description,
    startsAt: times.startsAt,
    endsAt: times.endsAt,
    allDay,
    timezone: "timezone" in updates ? (updates.timezone as string | null) : loaded.event.timezone,
    recurrenceRule: tailRule,
    recurrenceEndsAt: computeRecurrenceEndsAt({
      rule: tailRule,
      startsAt: times.startsAt,
      endsAt: times.endsAt,
      allDay,
      zone,
    }),
    status: (updates.status as string | undefined) ?? loaded.event.status,
    visibility: (updates.visibility as string | undefined) ?? loaded.event.visibility,
    // The person splitting the series authored the new one. The head keeps its
    // original author, so "who created what" stays answerable for both halves.
    createdByUserId: actor.id,
    projectId: "projectId" in updates ? (updates.projectId as number | null) : loaded.event.projectId,
    customerId: "customerId" in updates ? (updates.customerId as number | null) : loaded.event.customerId,
    employeeId: "employeeId" in updates ? (updates.employeeId as number | null) : loaded.event.employeeId,
    shiftId: "shiftId" in updates ? (updates.shiftId as number | null) : loaded.event.shiftId,
    location: "location" in updates ? (updates.location as string | null) : loaded.event.location,
    latitude: "latitude" in updates ? (updates.latitude as number | null) : loaded.event.latitude,
    longitude: "longitude" in updates ? (updates.longitude as number | null) : loaded.event.longitude,
    metadata: "metadata" in updates ? (updates.metadata as string | null) : loaded.event.metadata,
  };

  const headUpdates = { recurrenceRule: split.head, recurrenceEndsAt: split.headRecurrenceEndsAt };
  const headChanges = diffChanges(loaded.event as unknown as Record<string, unknown>, headUpdates);

  const created = await prisma.$transaction(async (tx) => {
    await tx.calendarEvent.update({ where: { id: loaded.event.id }, data: headUpdates });

    const tail = await tx.calendarEvent.create({ data: tailData });

    // Exceptions at or after the split describe instances of the TAIL now.
    await tx.calendarEventOccurrence.updateMany({
      where: { eventId: loaded.event.id, originalStartsAt: { gte: occurrenceStart } },
      data: { eventId: tail.id },
    });

    await writeCalendarAudit(tx, {
      ...auditBase(req),
      companyId: loaded.calendar.companyId,
      calendarId: loaded.calendar.id,
      targetType: "EVENT",
      targetId: loaded.event.id,
      action: CALENDAR_AUDIT_ACTIONS.EVENT_UPDATED,
      changes: {
        ...(headChanges ?? {}),
        splitAt: { from: null, to: occurrenceStart.toISOString() },
      },
    });

    await writeCalendarAudit(tx, {
      ...auditBase(req),
      companyId: loaded.calendar.companyId,
      calendarId: loaded.calendar.id,
      targetType: "EVENT",
      targetId: tail.id,
      action: CALENDAR_AUDIT_ACTIONS.EVENT_CREATED,
      changes: {
        ...(diffChanges({} as Record<string, unknown>, tailData as Record<string, unknown>) ?? {}),
        splitFromEventId: { from: null, to: loaded.event.id },
      },
    });

    return tail;
  });

  const reloaded = await loadEventFor(actor, created.id);
  if (!reloaded) return res.status(404).json({ error: "Event not found" });
  return respondWithEvent(res, actor, reloaded);
}

// ---------------------------------------------------------------------------
// DELETE /calendar/events/:id?scope=this|following|series
// ---------------------------------------------------------------------------

router.delete("/:id", eventWriteLimiter, async (req: Request, res: Response) => {
  const actor = actorFrom(req);
  const loaded = await loadEventFor(actor, Number(req.params.id));
  if (!loaded) return res.status(404).json({ error: "Event not found" });

  const isCreator = loaded.event.createdByUserId === actor.id;
  const mayDelete =
    loaded.permissions.has("event.delete_any") ||
    (isCreator && loaded.permissions.has("event.delete_own"));
  if (!mayDelete) return res.status(403).json({ error: "You cannot delete this event" });

  const scope = resolveScope(loaded, req.query as Record<string, unknown>);
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error });

  const audit = (changes: CalendarAuditChanges) => ({
    ...auditBase(req),
    companyId: loaded.calendar.companyId,
    calendarId: loaded.calendar.id,
    targetType: "EVENT" as const,
    targetId: loaded.event.id,
    action: CALENDAR_AUDIT_ACTIONS.EVENT_DELETED,
    changes,
  });

  if (scope.scope === "this") {
    // One instance off: a cancellation row, not a delete. The series is intact
    // and the cancelled instance stays addressable.
    await prisma.$transaction(async (tx) => {
      await tx.calendarEventOccurrence.upsert({
        where: {
          eventId_originalStartsAt: {
            eventId: loaded.event.id,
            originalStartsAt: scope.occurrenceStart,
          },
        },
        create: { eventId: loaded.event.id, originalStartsAt: scope.occurrenceStart, cancelled: true },
        update: { cancelled: true },
      });

      await writeCalendarAudit(
        tx,
        audit({ cancelledOccurrence: { from: null, to: scope.occurrenceStart.toISOString() } })
      );
    });

    return res.status(204).send();
  }

  if (scope.scope === "following") {
    const split = splitAt(loaded, scope.occurrenceStart);
    if (!split) return res.status(400).json({ error: "This event has no usable recurrence rule" });

    await prisma.$transaction(async (tx) => {
      await tx.calendarEvent.update({
        where: { id: loaded.event.id },
        data: { recurrenceRule: split.head, recurrenceEndsAt: split.headRecurrenceEndsAt },
      });

      // The exceptions beyond the cut describe occurrences that no longer
      // exist; left behind they would be dead rows blocking the unique
      // constraint if the series were ever extended back over them.
      await tx.calendarEventOccurrence.deleteMany({
        where: { eventId: loaded.event.id, originalStartsAt: { gte: scope.occurrenceStart } },
      });

      await writeCalendarAudit(
        tx,
        audit({
          recurrenceRule: { from: loaded.event.recurrenceRule, to: split.head },
          deletedFrom: { from: null, to: scope.occurrenceStart.toISOString() },
        })
      );
    });

    return res.status(204).send();
  }

  // scope=series — the row really goes.
  //
  // A physical delete, unlike DELETE /calendars/:id which archives. §6.6 is
  // explicit that events are deleted and that the deletion takes createdAt and
  // createdByUserId with it: that is precisely why EVENT_CREATED and
  // EVENT_DELETED exist, and why CalendarAudit.targetId carries NO foreign key.
  // The audit row below outlives the event it describes.
  //
  // ⚠️ SCOPE BOUNDARY, stated rather than papered over: only the exception rows
  // are cleared here. CalendarParticipant, CalendarEventAttachment,
  // CalendarEventComment and CalendarEventReminder also reference the event
  // with ON DELETE RESTRICT, but NOTHING writes them in CAL1 — they have no
  // API until CAL2.1/CAL2.4. Deleting them blind would be wrong anyway:
  // attachments own stored files and participants need to be told the event is
  // off. Whichever milestone adds a writer owns this delete path too.
  await prisma.$transaction(async (tx) => {
    await tx.calendarEventOccurrence.deleteMany({ where: { eventId: loaded.event.id } });
    await tx.calendarEvent.delete({ where: { id: loaded.event.id } });

    await writeCalendarAudit(
      tx,
      audit({
        title: { from: loaded.event.title, to: null },
        startsAt: { from: loaded.event.startsAt.toISOString(), to: null },
        // Kept because the row that held it is going: "who created the thing
        // that was later removed?" is the one question the audit exists for.
        createdByUserId: { from: loaded.event.createdByUserId, to: null },
      })
    );
  });

  res.status(204).send();
});

export default router;
