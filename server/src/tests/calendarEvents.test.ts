import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import prisma from "../database/prisma";
import { AUDIT_ACTIONS } from "../constants/auditActions";
import { READ_ONLY_ERROR } from "../middleware/readOnly.middleware";
import {
  EVENT_DETAIL_SELECT,
  EVENT_FREE_BUSY_SELECT,
  MAX_WINDOW_DAYS,
  MAX_WINDOW_OCCURRENCES,
} from "../services/calendar/events";
import {
  authHeader,
  createCalendarEvent,
  createDeveloper,
  createEmployeeUser,
  createShift,
  createTenant,
} from "./helpers/factories";

// CAL1.5 — the event API.
//
// No UI reaches these endpoints (the calendar appears at CAL1.6), so what these
// tests exist for is the handful of properties that cannot be retro-fitted:
// what leaves the server at free/busy level, what the three series scopes
// actually do to the stored rows, and the audit row that has to outlive the
// event it describes.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Fixed dates, deliberately clear of both Hungarian DST transitions
// (2026-03-29 and 2026-10-25) — those belong to calendarTimezone.test.ts and
// calendarRecurrence.test.ts, which own the conversion itself.
const WINDOW_FROM = "2026-09-01T00:00:00.000Z";
const WINDOW_TO = "2026-10-31T00:00:00.000Z";
const FIRST_MONDAY = "2026-09-07T09:00:00.000Z";

function windowQuery(from = WINDOW_FROM, to = WINDOW_TO) {
  return `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}

async function companyCalendar(companyId: number, name = "Company") {
  return prisma.calendar.create({ data: { companyId, type: "COMPANY", name } });
}

async function personalCalendar(companyId: number, ownerUserId: number) {
  return prisma.calendar.create({
    data: { companyId, type: "PERSONAL", name: "Mine", ownerUserId },
  });
}

async function grant(
  calendarId: number,
  companyId: number,
  principalType: string,
  principalId: string,
  preset: string
) {
  return prisma.calendarMember.create({
    data: { calendarId, companyId, principalType, principalId, preset },
  });
}

async function listEvents(token: string, query = windowQuery()) {
  return request(app).get(`/calendar/events?${query}`).set(authHeader(token));
}

async function auditRows(calendarId: number) {
  return prisma.calendarAudit.findMany({ where: { calendarId }, orderBy: { id: "asc" } });
}

// ---------------------------------------------------------------------------
// The window contract (Q7)
// ---------------------------------------------------------------------------

describe("the query window is mandatory and bounded", () => {
  it("refuses a missing, reversed or oversized window", async () => {
    const tenant = await createTenant();
    const head = authHeader(tenant.token);

    const cases: [string, string][] = [
      ["no window at all", ""],
      ["only from", `from=${WINDOW_FROM}`],
      ["only to", `to=${WINDOW_TO}`],
      ["unparseable", "from=yesterday&to=tomorrow"],
      ["reversed", windowQuery(WINDOW_TO, WINDOW_FROM)],
      ["zero width", windowQuery(WINDOW_FROM, WINDOW_FROM)],
      [
        "one day past the ceiling",
        windowQuery(
          "2026-01-01T00:00:00.000Z",
          new Date(Date.parse("2026-01-01T00:00:00.000Z") + (MAX_WINDOW_DAYS + 1) * DAY_MS).toISOString()
        ),
      ],
    ];

    for (const [label, query] of cases) {
      const res = await request(app).get(`/calendar/events?${query}`).set(head);
      expect(res.status, label).toBe(400);
    }
  });

  it("accepts exactly the ceiling — a full leap year", async () => {
    // 366 rather than 365 on purpose: "1 January to 31 December" of a leap year
    // has to fit, and 2028 is one.
    const tenant = await createTenant();
    const from = "2028-01-01T00:00:00.000Z";
    const to = new Date(Date.parse(from) + MAX_WINDOW_DAYS * DAY_MS).toISOString();

    const res = await listEvents(tenant.token, windowQuery(from, to));
    expect(res.status).toBe(200);
    expect(res.body.occurrences).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// R4 — free/busy really is content-free ON THE WIRE
// ---------------------------------------------------------------------------

describe("free/busy serialisation", () => {
  // The keys a free/busy caller must never receive. Asserted as ABSENT keys,
  // not as null values: a key that is present and empty is one refactor away
  // from being populated, and the whole point of R4 is that the server never
  // sends the content at all.
  const FORBIDDEN_KEYS = [
    "title",
    "description",
    "location",
    "metadata",
    "status",
    "visibility",
    "createdByUserId",
    "projectId",
    "customerId",
    "employeeId",
    "shiftId",
    "timezone",
  ];

  async function personalWithSecret(shareLevelPreset: string) {
    const tenant = await createTenant();
    const employee = await createEmployeeUser(tenant.company.id, tenant.employee.id);
    const calendar = await personalCalendar(tenant.company.id, employee.user.id);
    await grant(
      calendar.id,
      tenant.company.id,
      "COMPANY",
      String(tenant.company.id),
      shareLevelPreset
    );

    const startsAt = new Date(FIRST_MONDAY);
    await createCalendarEvent(calendar.id, tenant.company.id, {
      title: "Dentist",
      description: "Root canal, second visit",
      location: "Budapest, Fo utca 1.",
      startsAt,
      endsAt: new Date(startsAt.getTime() + HOUR_MS),
      createdByUserId: employee.user.id,
    });

    return { tenant, employee, calendar };
  }

  it("omits the content from the SELECT itself, not merely from the response", async () => {
    // R4 as the plan states it (§8.5): "the serialiser drops them ON THE
    // SERVER". A field that is fetched and then discarded is one refactor away
    // from being sent, so the guarantee is asserted against the query shape.
    for (const key of ["title", "description", "location", "latitude", "longitude", "metadata"]) {
      expect(Object.keys(EVENT_FREE_BUSY_SELECT), key).not.toContain(key);
      // …including the per-occurrence overrides, which are event content too.
      expect(Object.keys(EVENT_FREE_BUSY_SELECT.occurrences.select), `occurrence ${key}`).not.toContain(key);
    }
    // And the detail select does carry them, or the comparison proves nothing.
    expect(Object.keys(EVENT_DETAIL_SELECT)).toContain("title");
    expect(Object.keys(EVENT_DETAIL_SELECT.occurrences.select)).toContain("title");
  });

  it("sends the slot and nothing else — the content never reaches the wire", async () => {
    const { tenant } = await personalWithSecret("FREE_BUSY");

    const res = await listEvents(tenant.token);
    expect(res.status).toBe(200);
    expect(res.body.occurrences).toHaveLength(1);

    const occurrence = res.body.occurrences[0];
    expect(occurrence.busy).toBe(true);
    expect(occurrence.startsAt).toBe(FIRST_MONDAY);

    for (const key of FORBIDDEN_KEYS) {
      expect(Object.keys(occurrence), key).not.toContain(key);
    }

    // And the belt-and-braces check the scope asks for: nothing anywhere in the
    // response body carries the content, however it might have been nested.
    expect(res.text).not.toContain("Dentist");
    expect(res.text).not.toContain("Root canal");
    expect(res.text).not.toContain("Fo utca");
  });

  it("gives the same caller the details once the level is DETAILS", async () => {
    const { tenant } = await personalWithSecret("VIEWER");

    const res = await listEvents(tenant.token);
    expect(res.body.occurrences).toHaveLength(1);
    expect(res.body.occurrences[0].busy).toBe(false);
    expect(res.body.occurrences[0].title).toBe("Dentist");
  });

  it("redacts the single-event endpoint too, not just the list", async () => {
    const { tenant, calendar } = await personalWithSecret("FREE_BUSY");
    const event = await prisma.calendarEvent.findFirstOrThrow({ where: { calendarId: calendar.id } });

    const res = await request(app).get(`/calendar/events/${event.id}`).set(authHeader(tenant.token));
    expect(res.status).toBe(200);
    expect(res.body.busy).toBe(true);
    expect(Object.keys(res.body)).not.toContain("title");
    expect(res.text).not.toContain("Dentist");
  });

  it("shows the owner of the personal calendar their own content", async () => {
    const { employee } = await personalWithSecret("FREE_BUSY");

    const res = await listEvents(employee.token);
    expect(res.body.occurrences[0].busy).toBe(false);
    expect(res.body.occurrences[0].title).toBe("Dentist");
  });
});

// ---------------------------------------------------------------------------
// Event-level visibility (plan §4.7)
// ---------------------------------------------------------------------------

describe("per-event visibility sits above the calendar permission", () => {
  async function eventOnSharedCalendar(visibility: string) {
    const tenant = await createTenant();
    const employee = await createEmployeeUser(tenant.company.id, tenant.employee.id);
    const calendar = await companyCalendar(tenant.company.id);
    await grant(calendar.id, tenant.company.id, "ROLE", "EMPLOYEE", "MEMBER");

    const startsAt = new Date(FIRST_MONDAY);
    const event = await createCalendarEvent(calendar.id, tenant.company.id, {
      title: "Appraisal",
      visibility,
      startsAt,
      endsAt: new Date(startsAt.getTime() + HOUR_MS),
      createdByUserId: employee.user.id,
    });

    return { tenant, employee, calendar, event };
  }

  it("shows a `private` event as a busy block to everyone but its creator", async () => {
    const { tenant, employee } = await eventOnSharedCalendar("private");

    // The company owner holds view_details on a COMPANY calendar and still gets
    // no content: `private` blocks the slot without revealing what it is.
    const owner = await listEvents(tenant.token);
    expect(owner.body.occurrences).toHaveLength(1);
    expect(owner.body.occurrences[0].busy).toBe(true);
    expect(owner.text).not.toContain("Appraisal");

    const creator = await listEvents(employee.token);
    expect(creator.body.occurrences[0].busy).toBe(false);
    expect(creator.body.occurrences[0].title).toBe("Appraisal");
  });

  it("hides a `confidential` event entirely — the slot looks free", async () => {
    const { tenant, employee, event } = await eventOnSharedCalendar("confidential");

    const owner = await listEvents(tenant.token);
    expect(owner.body.occurrences).toEqual([]);

    // Not even its existence: the single-event endpoint answers 404, the same
    // answer a non-existent id gets.
    const direct = await request(app).get(`/calendar/events/${event.id}`).set(authHeader(tenant.token));
    expect(direct.status).toBe(404);

    const creator = await listEvents(employee.token);
    expect(creator.body.occurrences).toHaveLength(1);
  });

  it("treats an unrecognised stored visibility as private, not as public", async () => {
    // CalendarEvent.visibility is unconstrained TEXT. A value the serialiser
    // does not know must reveal LESS, never more.
    const { tenant } = await eventOnSharedCalendar("SOMETHING_NEW");

    const res = await listEvents(tenant.token);
    expect(res.body.occurrences).toHaveLength(1);
    expect(res.body.occurrences[0].busy).toBe(true);
    expect(res.text).not.toContain("Appraisal");
  });
});

// ---------------------------------------------------------------------------
// Tenant isolation and DEVELOPER access (§11.2, §11.3)
// ---------------------------------------------------------------------------

describe("tenant isolation answers 404, never 403", () => {
  it("hides another tenant's event from every endpoint", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const foreignCalendar = await companyCalendar(b.company.id, "B company");
    const foreignEvent = await createCalendarEvent(foreignCalendar.id, b.company.id, {
      startsAt: new Date(FIRST_MONDAY),
    });

    const head = authHeader(a.token);
    const cases: [string, () => request.Test][] = [
      ["GET one", () => request(app).get(`/calendar/events/${foreignEvent.id}`).set(head)],
      [
        "PATCH",
        () => request(app).patch(`/calendar/events/${foreignEvent.id}`).set(head).send({ title: "x" }),
      ],
      ["DELETE", () => request(app).delete(`/calendar/events/${foreignEvent.id}`).set(head)],
    ];

    for (const [label, call] of cases) {
      const res = await call();
      expect(res.status, label).toBe(404);
    }

    // POST onto their calendar is the same 404 — the calendar is invisible.
    const post = await request(app)
      .post("/calendar/events")
      .set(head)
      .send({ calendarId: foreignCalendar.id, title: "x", startsAt: FIRST_MONDAY, endsAt: FIRST_MONDAY });
    expect(post.status).toBe(404);

    // And the list never crosses the boundary.
    expect((await listEvents(a.token)).body.occurrences).toEqual([]);
    expect(await prisma.calendarEvent.count()).toBe(1);
    expect(await prisma.calendarAudit.count()).toBe(0);
  });

  it("keeps a DEVELOPER out of every tenant's PERSONAL calendar (D12/R2)", async () => {
    const tenant = await createTenant();
    const developer = await createDeveloper();
    const employee = await createEmployeeUser(tenant.company.id, tenant.employee.id);

    const personal = await personalCalendar(tenant.company.id, employee.user.id);
    const business = await companyCalendar(tenant.company.id);

    const startsAt = new Date(FIRST_MONDAY);
    const privateEvent = await createCalendarEvent(personal.id, tenant.company.id, {
      title: "Therapy",
      startsAt,
      endsAt: new Date(startsAt.getTime() + HOUR_MS),
      createdByUserId: employee.user.id,
    });
    await createCalendarEvent(business.id, tenant.company.id, {
      title: "Standup",
      startsAt,
      endsAt: new Date(startsAt.getTime() + HOUR_MS),
    });

    const res = await listEvents(developer.token);
    expect(res.status).toBe(200);
    // The support need on business calendars is preserved; the personal one is
    // not reachable at all, not even as a busy block.
    expect(res.body.occurrences.map((o: { title: string }) => o.title)).toEqual(["Standup"]);
    expect(res.text).not.toContain("Therapy");

    const direct = await request(app)
      .get(`/calendar/events/${privateEvent.id}`)
      .set(authHeader(developer.token));
    expect(direct.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Body ids are re-resolved under the calendar's tenant (§11.2, rule 4)
// ---------------------------------------------------------------------------

describe("cross-tenant reference injection", () => {
  it("refuses a foreign projectId, customerId, employeeId and shiftId alike", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const foreignShift = await createShift(b.employee.id, { start: new Date(FIRST_MONDAY) });
    const calendar = await companyCalendar(a.company.id);

    const base = {
      calendarId: calendar.id,
      title: "Injected",
      startsAt: FIRST_MONDAY,
      endsAt: "2026-09-07T10:00:00.000Z",
    };

    const injections: [string, Record<string, number>][] = [
      ["projectId", { projectId: b.project.id }],
      ["customerId", { customerId: b.customer.id }],
      ["employeeId", { employeeId: b.employee.id }],
      ["shiftId", { shiftId: foreignShift.id }],
    ];

    for (const [label, injection] of injections) {
      const res = await request(app)
        .post("/calendar/events")
        .set(authHeader(a.token))
        .send({ ...base, ...injection });
      expect(res.status, label).toBe(404);
    }

    expect(await prisma.calendarEvent.count()).toBe(0);

    // The same guard on the update path — the row being edited being ours is
    // not enough.
    const event = await createCalendarEvent(calendar.id, a.company.id, { startsAt: new Date(FIRST_MONDAY) });
    const patched = await request(app)
      .patch(`/calendar/events/${event.id}`)
      .set(authHeader(a.token))
      .send({ projectId: b.project.id });
    expect(patched.status).toBe(404);
    expect((await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event.id } })).projectId).toBeNull();
  });

  it("accepts the caller's own references and stores them", async () => {
    const tenant = await createTenant();
    const shift = await createShift(tenant.employee.id, { start: new Date(FIRST_MONDAY) });
    const calendar = await companyCalendar(tenant.company.id);

    const res = await request(app)
      .post("/calendar/events")
      .set(authHeader(tenant.token))
      .send({
        calendarId: calendar.id,
        title: "Site visit",
        startsAt: FIRST_MONDAY,
        endsAt: "2026-09-07T10:00:00.000Z",
        projectId: tenant.project.id,
        customerId: tenant.customer.id,
        employeeId: tenant.employee.id,
        shiftId: shift.id,
      });

    expect(res.status).toBe(201);
    expect(res.body.projectId).toBe(tenant.project.id);
    expect(res.body.shiftId).toBe(shift.id);

    // The update path stores them too — a separate Prisma write shape from the
    // create, so it needs its own assertion rather than being assumed.
    const cleared = await request(app)
      .patch(`/calendar/events/${res.body.id}`)
      .set(authHeader(tenant.token))
      .send({ projectId: null, customerId: tenant.customer.id });

    expect(cleared.status).toBe(200);
    expect(cleared.body.projectId).toBeNull();
    expect(cleared.body.customerId).toBe(tenant.customer.id);
  });
});

// ---------------------------------------------------------------------------
// R5 — the event references, it never copies (§6.5)
// ---------------------------------------------------------------------------

describe("location resolution follows the reference, all four branches", () => {
  async function eventWith(overrides: Record<string, unknown>) {
    const tenant = await createTenant();
    const calendar = await companyCalendar(tenant.company.id);
    const startsAt = new Date(FIRST_MONDAY);

    await prisma.project.update({
      where: { id: tenant.project.id },
      data: { address: "Project Road 5", latitude: 47.5, longitude: 19.05 },
    });
    await prisma.customer.update({
      where: { id: tenant.customer.id },
      data: { address: "Customer Street 9" },
    });

    await createCalendarEvent(calendar.id, tenant.company.id, {
      startsAt,
      endsAt: new Date(startsAt.getTime() + HOUR_MS),
      ...overrides,
    });

    const res = await listEvents(tenant.token);
    expect(res.status).toBe(200);
    return { tenant, location: res.body.occurrences[0].location };
  }

  it("1 — the event's own location wins when it is filled in", async () => {
    const { tenant, location } = await eventWith({ location: "Ad-hoc Square 1" });
    expect(location).toEqual({
      source: "event",
      address: "Ad-hoc Square 1",
      latitude: null,
      longitude: null,
    });
    expect(tenant).toBeTruthy();
  });

  it("2 — otherwise the project's address and geofence", async () => {
    const tenant = await createTenant();
    await prisma.project.update({
      where: { id: tenant.project.id },
      data: { address: "Project Road 5", latitude: 47.5, longitude: 19.05 },
    });
    const calendar = await companyCalendar(tenant.company.id);
    const startsAt = new Date(FIRST_MONDAY);
    await createCalendarEvent(calendar.id, tenant.company.id, {
      startsAt,
      endsAt: new Date(startsAt.getTime() + HOUR_MS),
      projectId: tenant.project.id,
    });

    const res = await listEvents(tenant.token);
    expect(res.body.occurrences[0].location).toEqual({
      source: "project",
      address: "Project Road 5",
      latitude: 47.5,
      longitude: 19.05,
    });
  });

  it("3 — then the customer's, including when the project has no address at all", async () => {
    const tenant = await createTenant();
    await prisma.customer.update({
      where: { id: tenant.customer.id },
      data: { address: "Customer Street 9" },
    });
    const calendar = await companyCalendar(tenant.company.id);
    const startsAt = new Date(FIRST_MONDAY);
    // The project is referenced but holds nothing, so the level FALLS THROOUGH
    // rather than answering with nulls — the technician still gets an address.
    await createCalendarEvent(calendar.id, tenant.company.id, {
      startsAt,
      endsAt: new Date(startsAt.getTime() + HOUR_MS),
      projectId: tenant.project.id,
      customerId: tenant.customer.id,
    });

    const res = await listEvents(tenant.token);
    expect(res.body.occurrences[0].location).toEqual({
      source: "customer",
      address: "Customer Street 9",
      latitude: null,
      longitude: null,
    });
  });

  it("4 — and nothing when there is nothing to resolve", async () => {
    const tenant = await createTenant();
    const calendar = await companyCalendar(tenant.company.id);
    const startsAt = new Date(FIRST_MONDAY);
    await createCalendarEvent(calendar.id, tenant.company.id, {
      startsAt,
      endsAt: new Date(startsAt.getTime() + HOUR_MS),
    });

    const res = await listEvents(tenant.token);
    expect(res.body.occurrences[0].location).toEqual({
      source: null,
      address: null,
      latitude: null,
      longitude: null,
    });
  });

  it("follows the project when the project moves — the address was never copied", async () => {
    // The defect this rule exists to prevent: a copied address keeps sending
    // the technician to where the customer used to be.
    const tenant = await createTenant();
    await prisma.project.update({
      where: { id: tenant.project.id },
      data: { address: "Old Road 1" },
    });
    const calendar = await companyCalendar(tenant.company.id);
    const startsAt = new Date(FIRST_MONDAY);
    await createCalendarEvent(calendar.id, tenant.company.id, {
      startsAt,
      endsAt: new Date(startsAt.getTime() + HOUR_MS),
      projectId: tenant.project.id,
    });

    await prisma.project.update({ where: { id: tenant.project.id }, data: { address: "New Road 2" } });

    const res = await listEvents(tenant.token);
    expect(res.body.occurrences[0].location.address).toBe("New Road 2");
    // And nothing was written onto the event itself.
    const stored = await prisma.calendarEvent.findFirstOrThrow({ where: { calendarId: calendar.id } });
    expect(stored.location).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Recurrence: expansion, pruning, and the bomb guard
// ---------------------------------------------------------------------------

async function weeklySeries(count = 6) {
  const tenant = await createTenant();
  const calendar = await companyCalendar(tenant.company.id);

  const created = await request(app)
    .post("/calendar/events")
    .set(authHeader(tenant.token))
    .send({
      calendarId: calendar.id,
      title: "Weekly standup",
      startsAt: FIRST_MONDAY,
      endsAt: "2026-09-07T10:00:00.000Z",
      recurrenceRule: `FREQ=WEEKLY;COUNT=${count}`,
    });

  expect(created.status).toBe(201);
  return { tenant, calendar, event: created.body };
}

describe("recurrence", () => {
  it("expands a series over the window with the CAL1.2 engine", async () => {
    const { tenant } = await weeklySeries();

    const res = await listEvents(tenant.token);
    expect(res.status).toBe(200);
    expect(res.body.occurrences).toHaveLength(6);
    expect(res.body.occurrences.map((o: { startsAt: string }) => o.startsAt)).toEqual([
      "2026-09-07T09:00:00.000Z",
      "2026-09-14T09:00:00.000Z",
      "2026-09-21T09:00:00.000Z",
      "2026-09-28T09:00:00.000Z",
      "2026-10-05T09:00:00.000Z",
      "2026-10-12T09:00:00.000Z",
    ]);
    expect(res.body.occurrences.every((o: { recurring: boolean }) => o.recurring)).toBe(true);
  });

  it("writes recurrenceEndsAt at save time, and leaves it NULL for an endless rule", async () => {
    const { event } = await weeklySeries();
    const stored = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event.id } });
    // The last occurrence's END, not its start — that is what the pruning
    // predicate compares against the window opening.
    expect(stored.recurrenceEndsAt?.toISOString()).toBe("2026-10-12T10:00:00.000Z");

    const tenant = await createTenant();
    const calendar = await companyCalendar(tenant.company.id);
    const endless = await request(app)
      .post("/calendar/events")
      .set(authHeader(tenant.token))
      .send({
        calendarId: calendar.id,
        title: "Forever",
        startsAt: FIRST_MONDAY,
        endsAt: "2026-09-07T10:00:00.000Z",
        recurrenceRule: "FREQ=WEEKLY",
      });
    const stored2 = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: endless.body.id } });
    expect(stored2.recurrenceEndsAt).toBeNull();
  });

  it("prunes a finished series out of a later window", async () => {
    const { tenant } = await weeklySeries();

    const later = await listEvents(
      tenant.token,
      windowQuery("2027-01-01T00:00:00.000Z", "2027-02-01T00:00:00.000Z")
    );
    expect(later.body.occurrences).toEqual([]);
  });

  it("rejects a rule the grammar cannot express rather than silently narrowing it", async () => {
    const tenant = await createTenant();
    const calendar = await companyCalendar(tenant.company.id);

    for (const rule of ["FREQ=HOURLY", "FREQ=MONTHLY;BYSETPOS=-1", "FREQ=WEEKLY;BYDAY=-1FR", "nonsense"]) {
      const res = await request(app)
        .post("/calendar/events")
        .set(authHeader(tenant.token))
        .send({
          calendarId: calendar.id,
          title: "Bad rule",
          startsAt: FIRST_MONDAY,
          endsAt: "2026-09-07T10:00:00.000Z",
          recurrenceRule: rule,
        });
      expect(res.status, rule).toBe(400);
    }
    expect(await prisma.calendarEvent.count()).toBe(0);
  });

  it("caps the expansion and SAYS SO instead of truncating silently", async () => {
    // The recurrence bomb (§11.2). Fourteen endless daily series over a
    // full-year window is ~5100 occurrences against a 5000 ceiling: the guard
    // has to fire, and the response has to admit it did.
    const tenant = await createTenant();
    const calendar = await companyCalendar(tenant.company.id);
    const startsAt = new Date("2026-01-01T09:00:00.000Z");

    for (let index = 0; index < 14; index += 1) {
      await createCalendarEvent(calendar.id, tenant.company.id, {
        title: `Daily ${index}`,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR_MS),
        recurrenceRule: "FREQ=DAILY",
        recurrenceEndsAt: null,
      });
    }

    const res = await listEvents(
      tenant.token,
      windowQuery("2026-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z")
    );

    expect(res.status).toBe(200);
    expect(res.body.truncated).toBe(true);
    // Exactly the ceiling, not merely "at most": a guard that answered with
    // nothing would also satisfy `<= 5000`, and that is a different bug.
    expect(res.body.occurrences.length).toBe(MAX_WINDOW_OCCURRENCES);
  });

  it("does not claim truncation when the window fits", async () => {
    const { tenant } = await weeklySeries();
    const res = await listEvents(tenant.token);
    expect(res.body.truncated).toBe(false);
    expect(res.body.occurrences).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// The three series scopes
// ---------------------------------------------------------------------------

const THIRD = "2026-09-21T09:00:00.000Z";
const FOURTH = "2026-09-28T09:00:00.000Z";

describe("scope=this", () => {
  it("overrides one instance and leaves the rest alone", async () => {
    const { tenant, event } = await weeklySeries();

    const res = await request(app)
      .patch(`/calendar/events/${event.id}?scope=this&occurrenceStart=${encodeURIComponent(THIRD)}`)
      .set(authHeader(tenant.token))
      .send({ title: "Moved to the boardroom", location: "Boardroom" });
    expect(res.status).toBe(200);

    const list = await listEvents(tenant.token);
    const titles = list.body.occurrences.map((o: { title: string }) => o.title);
    expect(titles).toEqual([
      "Weekly standup",
      "Weekly standup",
      "Moved to the boardroom",
      "Weekly standup",
      "Weekly standup",
      "Weekly standup",
    ]);

    const overridden = list.body.occurrences[2];
    expect(overridden.overridden).toBe(true);
    expect(overridden.location).toEqual({
      source: "event",
      address: "Boardroom",
      latitude: null,
      longitude: null,
    });

    // One exception row, and the series itself is untouched.
    expect(await prisma.calendarEventOccurrence.count({ where: { eventId: event.id } })).toBe(1);
    expect(await prisma.calendarEvent.count()).toBe(1);
  });

  it("cancels one instance on DELETE, keeping the series intact", async () => {
    const { tenant, event } = await weeklySeries();

    const res = await request(app)
      .delete(`/calendar/events/${event.id}?scope=this&occurrenceStart=${encodeURIComponent(THIRD)}`)
      .set(authHeader(tenant.token));
    expect(res.status).toBe(204);

    const list = await listEvents(tenant.token);
    expect(list.body.occurrences).toHaveLength(5);
    expect(list.body.occurrences.map((o: { startsAt: string }) => o.startsAt)).not.toContain(THIRD);
    expect(await prisma.calendarEvent.count()).toBe(1);
  });

  it("refuses an occurrenceStart the series never produces", async () => {
    const { tenant, event } = await weeklySeries();

    for (const [label, query] of [
      ["missing", "scope=this"],
      ["not an occurrence", `scope=this&occurrenceStart=${encodeURIComponent("2026-09-22T09:00:00.000Z")}`],
      ["right day, wrong time", `scope=this&occurrenceStart=${encodeURIComponent("2026-09-21T10:00:00.000Z")}`],
    ]) {
      const res = await request(app)
        .patch(`/calendar/events/${event.id}?${query}`)
        .set(authHeader(tenant.token))
        .send({ title: "Ghost" });
      expect(res.status, label).toBe(400);
    }

    expect(await prisma.calendarEventOccurrence.count()).toBe(0);
  });

  it("refuses to write a series-level field through a single occurrence", async () => {
    const { tenant, event } = await weeklySeries();

    const res = await request(app)
      .patch(`/calendar/events/${event.id}?scope=this&occurrenceStart=${encodeURIComponent(THIRD)}`)
      .set(authHeader(tenant.token))
      // projectId is the interesting one: it never reaches the parsed updates
      // (references are resolved separately), so a check on those alone would
      // have accepted the request and dropped the field without a word.
      .send({ description: "only this one", visibility: "private", projectId: tenant.project.id });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("description");
    expect(res.body.error).toContain("visibility");
    expect(res.body.error).toContain("projectId");
    expect(await prisma.calendarEventOccurrence.count()).toBe(0);
  });
});

describe("scope=following", () => {
  it("cuts the original rule and opens a new series carrying the edit", async () => {
    const { tenant, calendar, event } = await weeklySeries();

    const res = await request(app)
      .patch(`/calendar/events/${event.id}?scope=following&occurrenceStart=${encodeURIComponent(FOURTH)}`)
      .set(authHeader(tenant.token))
      .send({ title: "Renamed standup" });
    expect(res.status).toBe(200);

    const events = await prisma.calendarEvent.findMany({
      where: { calendarId: calendar.id },
      orderBy: { id: "asc" },
    });
    expect(events).toHaveLength(2);

    const [head, tail] = events;
    // The head trades its COUNT for an UNTIL at the cut — "cut the UNTIL" is
    // exactly what a counted rule needs to stop producing past the split.
    expect(head!.recurrenceRule).toBe("FREQ=WEEKLY;UNTIL=20260928T085959Z");
    expect(head!.title).toBe("Weekly standup");
    // The tail keeps what the head has not already produced: 6 - 3 = 3.
    expect(tail!.recurrenceRule).toBe("FREQ=WEEKLY;COUNT=3");
    expect(tail!.title).toBe("Renamed standup");
    expect(tail!.startsAt.toISOString()).toBe(FOURTH);

    const list = await listEvents(tenant.token);
    expect(list.body.occurrences.map((o: { title: string }) => o.title)).toEqual([
      "Weekly standup",
      "Weekly standup",
      "Weekly standup",
      "Renamed standup",
      "Renamed standup",
      "Renamed standup",
    ]);
  });

  it("truncates the series on DELETE without opening a new one", async () => {
    const { tenant, calendar, event } = await weeklySeries();

    const res = await request(app)
      .delete(`/calendar/events/${event.id}?scope=following&occurrenceStart=${encodeURIComponent(FOURTH)}`)
      .set(authHeader(tenant.token));
    expect(res.status).toBe(204);

    expect(await prisma.calendarEvent.count({ where: { calendarId: calendar.id } })).toBe(1);

    const list = await listEvents(tenant.token);
    expect(list.body.occurrences.map((o: { startsAt: string }) => o.startsAt)).toEqual([
      "2026-09-07T09:00:00.000Z",
      "2026-09-14T09:00:00.000Z",
      "2026-09-21T09:00:00.000Z",
    ]);
  });

  it("moves the stored exceptions to the half they now belong to", async () => {
    const { tenant, calendar, event } = await weeklySeries();

    // One exception before the cut, one after.
    await request(app)
      .patch(`/calendar/events/${event.id}?scope=this&occurrenceStart=${encodeURIComponent(THIRD)}`)
      .set(authHeader(tenant.token))
      .send({ title: "Before the cut" });
    await request(app)
      .patch(
        `/calendar/events/${event.id}?scope=this&occurrenceStart=${encodeURIComponent("2026-10-05T09:00:00.000Z")}`
      )
      .set(authHeader(tenant.token))
      .send({ title: "After the cut" });

    await request(app)
      .patch(`/calendar/events/${event.id}?scope=following&occurrenceStart=${encodeURIComponent(FOURTH)}`)
      .set(authHeader(tenant.token))
      .send({ title: "Renamed standup" });

    const events = await prisma.calendarEvent.findMany({
      where: { calendarId: calendar.id },
      orderBy: { id: "asc" },
    });
    const [head, tail] = events;

    expect(await prisma.calendarEventOccurrence.count({ where: { eventId: head!.id } })).toBe(1);
    expect(await prisma.calendarEventOccurrence.count({ where: { eventId: tail!.id } })).toBe(1);

    // Both overrides still land on the right instances.
    const list = await listEvents(tenant.token);
    expect(list.body.occurrences.map((o: { title: string }) => o.title)).toEqual([
      "Weekly standup",
      "Weekly standup",
      "Before the cut",
      "Renamed standup",
      "After the cut",
      "Renamed standup",
    ]);
  });

  it("splitting at the series' own start is the whole series, not an empty head", async () => {
    const { tenant, calendar, event } = await weeklySeries();

    const res = await request(app)
      .patch(`/calendar/events/${event.id}?scope=following&occurrenceStart=${encodeURIComponent(FIRST_MONDAY)}`)
      .set(authHeader(tenant.token))
      .send({ title: "All of it" });
    expect(res.status).toBe(200);

    // No orphan head with a rule that can never fire.
    expect(await prisma.calendarEvent.count({ where: { calendarId: calendar.id } })).toBe(1);
    const list = await listEvents(tenant.token);
    expect(list.body.occurrences).toHaveLength(6);
    expect(list.body.occurrences.every((o: { title: string }) => o.title === "All of it")).toBe(true);
  });
});

describe("scope=series", () => {
  it("changes every occurrence, and is the default", async () => {
    const { tenant, event } = await weeklySeries();

    const res = await request(app)
      .patch(`/calendar/events/${event.id}`)
      .set(authHeader(tenant.token))
      .send({ title: "Renamed everywhere" });
    expect(res.status).toBe(200);

    const list = await listEvents(tenant.token);
    expect(list.body.occurrences).toHaveLength(6);
    expect(list.body.occurrences.every((o: { title: string }) => o.title === "Renamed everywhere")).toBe(true);
  });

  it("recomputes the pruning column when the series shape changes", async () => {
    const { tenant, event } = await weeklySeries();

    await request(app)
      .patch(`/calendar/events/${event.id}`)
      .set(authHeader(tenant.token))
      .send({ recurrenceRule: "FREQ=WEEKLY;COUNT=2" });

    const stored = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(stored.recurrenceEndsAt?.toISOString()).toBe("2026-09-14T10:00:00.000Z");
    expect((await listEvents(tenant.token)).body.occurrences).toHaveLength(2);
  });

  it("deletes the row outright, unlike a calendar which is archived", async () => {
    const { tenant, event } = await weeklySeries();

    const res = await request(app).delete(`/calendar/events/${event.id}`).set(authHeader(tenant.token));
    expect(res.status).toBe(204);
    expect(await prisma.calendarEvent.count()).toBe(0);
  });

  it("rejects an unknown scope and a calendar move", async () => {
    const { tenant, calendar, event } = await weeklySeries();
    const other = await companyCalendar(tenant.company.id, "Other");

    const badScope = await request(app)
      .patch(`/calendar/events/${event.id}?scope=everything`)
      .set(authHeader(tenant.token))
      .send({ title: "x" });
    expect(badScope.status).toBe(400);

    const moved = await request(app)
      .patch(`/calendar/events/${event.id}`)
      .set(authHeader(tenant.token))
      .send({ calendarId: other.id });
    expect(moved.status).toBe(400);
    expect((await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event.id } })).calendarId).toBe(
      calendar.id
    );
  });
});

// ---------------------------------------------------------------------------
// All-day semantics
// ---------------------------------------------------------------------------

describe("all-day events", () => {
  it("snaps to local midnight in the calendar's zone, not to 00:00Z", async () => {
    const tenant = await createTenant();
    const calendar = await prisma.calendar.create({
      data: { companyId: tenant.company.id, type: "COMPANY", name: "Budapest", timezone: "Europe/Budapest" },
    });

    const res = await request(app)
      .post("/calendar/events")
      .set(authHeader(tenant.token))
      .send({
        calendarId: calendar.id,
        title: "Company holiday",
        allDay: true,
        startsAt: "2026-09-10T13:37:00.000Z",
        endsAt: "2026-09-10T18:00:00.000Z",
      });
    expect(res.status).toBe(201);

    const stored = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: res.body.id } });
    // Budapest is UTC+2 in September, so the local day runs 22:00Z to 22:00Z.
    expect(stored.startsAt.toISOString()).toBe("2026-09-09T22:00:00.000Z");
    expect(stored.endsAt.toISOString()).toBe("2026-09-10T22:00:00.000Z");
  });

  it("does not gain a day when an already-snapped event is saved again", async () => {
    const tenant = await createTenant();
    const calendar = await prisma.calendar.create({
      data: { companyId: tenant.company.id, type: "COMPANY", name: "Budapest", timezone: "Europe/Budapest" },
    });

    const created = await request(app)
      .post("/calendar/events")
      .set(authHeader(tenant.token))
      .send({
        calendarId: calendar.id,
        title: "Holiday",
        allDay: true,
        startsAt: "2026-09-10T00:00:00.000Z",
        endsAt: "2026-09-10T23:59:00.000Z",
      });

    const first = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: created.body.id } });

    await request(app)
      .patch(`/calendar/events/${created.body.id}`)
      .set(authHeader(tenant.token))
      .send({ startsAt: first.startsAt.toISOString(), endsAt: first.endsAt.toISOString() });

    const second = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(second.startsAt.toISOString()).toBe(first.startsAt.toISOString());
    expect(second.endsAt.toISOString()).toBe(first.endsAt.toISOString());
  });
});

// ---------------------------------------------------------------------------
// Authorisation on the write paths
// ---------------------------------------------------------------------------

describe("write permissions", () => {
  async function calendarWithEmployeePreset(preset: string) {
    const tenant = await createTenant();
    const employee = await createEmployeeUser(tenant.company.id, tenant.employee.id);
    const calendar = await companyCalendar(tenant.company.id);
    await grant(calendar.id, tenant.company.id, "USER", String(employee.user.id), preset);
    return { tenant, employee, calendar };
  }

  it("refuses creation without event.create", async () => {
    const { employee, calendar } = await calendarWithEmployeePreset("VIEWER");

    const res = await request(app)
      .post("/calendar/events")
      .set(authHeader(employee.token))
      .send({ calendarId: calendar.id, title: "Nope", startsAt: FIRST_MONDAY, endsAt: FIRST_MONDAY });

    expect(res.status).toBe(403);
    expect(await prisma.calendarEvent.count()).toBe(0);
  });

  it("separates edit_own from edit_any", async () => {
    // MEMBER holds edit_own and delete_own only.
    const { tenant, employee, calendar } = await calendarWithEmployeePreset("MEMBER");
    const startsAt = new Date(FIRST_MONDAY);

    const mine = await createCalendarEvent(calendar.id, tenant.company.id, {
      startsAt,
      endsAt: new Date(startsAt.getTime() + HOUR_MS),
      createdByUserId: employee.user.id,
    });
    const theirs = await createCalendarEvent(calendar.id, tenant.company.id, {
      startsAt,
      endsAt: new Date(startsAt.getTime() + HOUR_MS),
      createdByUserId: tenant.owner.id,
    });

    const own = await request(app)
      .patch(`/calendar/events/${mine.id}`)
      .set(authHeader(employee.token))
      .send({ title: "Mine, renamed" });
    expect(own.status).toBe(200);

    const other = await request(app)
      .patch(`/calendar/events/${theirs.id}`)
      .set(authHeader(employee.token))
      .send({ title: "Not mine" });
    expect(other.status).toBe(403);

    const deleteOther = await request(app)
      .delete(`/calendar/events/${theirs.id}`)
      .set(authHeader(employee.token));
    expect(deleteOther.status).toBe(403);

    expect((await prisma.calendarEvent.findUniqueOrThrow({ where: { id: theirs.id } })).title).not.toBe(
      "Not mine"
    );
  });

  it("blocks every write for a lapsed company but keeps reads working", async () => {
    const tenant = await createTenant({
      subscriptionStatus: "trialing",
      subscriptionEndsAt: new Date(Date.now() - DAY_MS),
    });
    const calendar = await companyCalendar(tenant.company.id);
    const startsAt = new Date(FIRST_MONDAY);
    const event = await createCalendarEvent(calendar.id, tenant.company.id, {
      startsAt,
      endsAt: new Date(startsAt.getTime() + HOUR_MS),
    });
    const head = authHeader(tenant.token);

    expect((await listEvents(tenant.token)).status).toBe(200);
    expect((await request(app).get(`/calendar/events/${event.id}`).set(head)).status).toBe(200);

    const writes = [
      request(app)
        .post("/calendar/events")
        .set(head)
        .send({ calendarId: calendar.id, title: "x", startsAt: FIRST_MONDAY, endsAt: FIRST_MONDAY }),
      request(app).patch(`/calendar/events/${event.id}`).set(head).send({ title: "x" }),
      request(app).delete(`/calendar/events/${event.id}`).set(head),
    ];

    for (const write of writes) {
      const res = await write;
      expect(res.status).toBe(403);
      expect(res.body.error).toBe(READ_ONLY_ERROR);
    }

    expect(await prisma.calendarEvent.count()).toBe(1);
    expect(await prisma.calendarAudit.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The audit trail (D13)
// ---------------------------------------------------------------------------

describe("every event mutation is audited, with real values", () => {
  it("records create, update and delete", async () => {
    const tenant = await createTenant();
    const calendar = await companyCalendar(tenant.company.id);
    const head = authHeader(tenant.token);

    const created = await request(app)
      .post("/calendar/events")
      .set(head)
      .send({
        calendarId: calendar.id,
        title: "Kickoff",
        startsAt: FIRST_MONDAY,
        endsAt: "2026-09-07T10:00:00.000Z",
      });
    expect(created.status).toBe(201);

    await request(app).patch(`/calendar/events/${created.body.id}`).set(head).send({ title: "Kickoff v2" });
    await request(app).delete(`/calendar/events/${created.body.id}`).set(head);

    const rows = await auditRows(calendar.id);
    expect(rows.map((row) => row.action)).toEqual(["EVENT_CREATED", "EVENT_UPDATED", "EVENT_DELETED"]);

    for (const row of rows) {
      expect(row.targetType).toBe("EVENT");
      expect(row.targetId).toBe(created.body.id);
      expect(row.actorUserId).toBe(tenant.owner.id);
      expect(row.source).toBe("WEB");
      expect(row.companyId).toBe(tenant.company.id);
    }
  });

  it("records ONLY the fields that actually changed", async () => {
    const tenant = await createTenant();
    const calendar = await companyCalendar(tenant.company.id);
    const head = authHeader(tenant.token);

    const created = await request(app)
      .post("/calendar/events")
      .set(head)
      .send({
        calendarId: calendar.id,
        title: "Kickoff",
        description: "The long description nobody wants copied on every edit",
        startsAt: FIRST_MONDAY,
        endsAt: "2026-09-07T10:00:00.000Z",
      });

    await request(app)
      .patch(`/calendar/events/${created.body.id}`)
      .set(head)
      // description is re-sent UNCHANGED, and startsAt is re-sent identically.
      .send({
        title: "Kickoff v2",
        description: "The long description nobody wants copied on every edit",
        startsAt: FIRST_MONDAY,
      });

    const rows = await auditRows(calendar.id);
    const update = JSON.parse(rows[1]!.changes!);

    expect(update).toEqual({ title: { from: "Kickoff", to: "Kickoff v2" } });
    // Not a whole-row snapshot (§6.6).
    expect(update.description).toBeUndefined();
    expect(update.startsAt).toBeUndefined();
  });

  it("writes NO audit row for a PATCH that changes nothing", async () => {
    const tenant = await createTenant();
    const calendar = await companyCalendar(tenant.company.id);
    const head = authHeader(tenant.token);

    const created = await request(app)
      .post("/calendar/events")
      .set(head)
      .send({
        calendarId: calendar.id,
        title: "Kickoff",
        startsAt: FIRST_MONDAY,
        endsAt: "2026-09-07T10:00:00.000Z",
      });

    const res = await request(app)
      .patch(`/calendar/events/${created.body.id}`)
      .set(head)
      .send({ title: "Kickoff" });

    expect(res.status).toBe(200);
    expect(await auditRows(calendar.id)).toHaveLength(1);
  });

  it("keeps the audit row after the event it describes is gone", async () => {
    // The whole reason EVENT_CREATED exists despite the repo's "creation is
    // derivable from createdAt" rule: deletion takes createdAt and
    // createdByUserId with it, and "who created the thing that was later
    // removed?" must still be answerable.
    const tenant = await createTenant();
    const calendar = await companyCalendar(tenant.company.id);
    const head = authHeader(tenant.token);

    const created = await request(app)
      .post("/calendar/events")
      .set(head)
      .send({
        calendarId: calendar.id,
        title: "Kickoff",
        startsAt: FIRST_MONDAY,
        endsAt: "2026-09-07T10:00:00.000Z",
      });

    await request(app).delete(`/calendar/events/${created.body.id}`).set(head);

    expect(await prisma.calendarEvent.count()).toBe(0);

    const rows = await auditRows(calendar.id);
    expect(rows).toHaveLength(2);
    const deletion = JSON.parse(rows[1]!.changes!);
    expect(deletion.title).toEqual({ from: "Kickoff", to: null });
    expect(deletion.createdByUserId).toEqual({ from: tenant.owner.id, to: null });
    // Still readable, still pointing at an id that no longer resolves — which
    // is exactly why CalendarAudit.targetId carries no foreign key.
    expect(rows[1]!.targetId).toBe(created.body.id);
  });

  it("derives `source` server-side and ignores spoofing attempts", async () => {
    const tenant = await createTenant();
    const calendar = await companyCalendar(tenant.company.id);

    const res = await request(app)
      .post("/calendar/events")
      .set(authHeader(tenant.token))
      .set("X-Audit-Source", "SYSTEM")
      .send({
        calendarId: calendar.id,
        title: "Kickoff",
        startsAt: FIRST_MONDAY,
        endsAt: "2026-09-07T10:00:00.000Z",
        source: "SYSTEM",
        actorUserId: 999999,
        createdByUserId: 999999,
        companyId: 999999,
      });
    expect(res.status).toBe(201);

    const rows = await auditRows(calendar.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe("WEB");
    expect(rows[0]!.actorUserId).toBe(tenant.owner.id);

    const stored = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored.createdByUserId).toBe(tenant.owner.id);
    expect(stored.companyId).toBe(tenant.company.id);
  });

  it("does NOT mirror event mutations into the global AuditLog", async () => {
    // §6.6, the two-level write: permission changes are security events and go
    // to /admin/logs; event mutations would bury a log that sees a handful of
    // rows a day.
    const tenant = await createTenant();
    const calendar = await companyCalendar(tenant.company.id);
    const head = authHeader(tenant.token);

    const created = await request(app)
      .post("/calendar/events")
      .set(head)
      .send({
        calendarId: calendar.id,
        title: "Kickoff",
        startsAt: FIRST_MONDAY,
        endsAt: "2026-09-07T10:00:00.000Z",
      });
    await request(app).patch(`/calendar/events/${created.body.id}`).set(head).send({ title: "v2" });
    await request(app).delete(`/calendar/events/${created.body.id}`).set(head);

    expect(
      await prisma.auditLog.count({ where: { action: AUDIT_ACTIONS.CALENDAR_PERMISSION_CHANGED } })
    ).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
    expect(await auditRows(calendar.id)).toHaveLength(3);
  });

  it("audits both halves of a `following` split", async () => {
    const { tenant, calendar, event } = await weeklySeries();

    await request(app)
      .patch(`/calendar/events/${event.id}?scope=following&occurrenceStart=${encodeURIComponent(FOURTH)}`)
      .set(authHeader(tenant.token))
      .send({ title: "Renamed standup" });

    const rows = await auditRows(calendar.id);
    expect(rows.map((row) => row.action)).toEqual(["EVENT_CREATED", "EVENT_UPDATED", "EVENT_CREATED"]);

    const headChange = JSON.parse(rows[1]!.changes!);
    expect(headChange.recurrenceRule.to).toContain("UNTIL=");
    expect(headChange.splitAt.to).toBe(FOURTH);

    const tailChange = JSON.parse(rows[2]!.changes!);
    expect(tailChange.splitFromEventId.to).toBe(event.id);
  });
});
