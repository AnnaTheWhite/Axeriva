import { describe, expect, it } from "vitest";
import prisma from "../database/prisma";
import { resetDatabase } from "./helpers/db";
import {
  createCalendar,
  createCalendarEvent,
  createCompany,
  createShift,
  createTenant,
  createUser,
} from "./helpers/factories";
import { CALENDAR_AUDIT_ACTIONS } from "../constants/calendarAuditActions";

// CAL1.1 — the calendar module's data foundation.
//
// Nothing in the application reads or writes these nine tables yet (the
// permission layer is CAL1.3, the first endpoints are CAL1.4/CAL1.5), so what
// is worth testing now is exactly the set of database guarantees the later
// milestones will BUILD ON. Same reasoning as notificationSchema.test.ts: if
// one of these silently stopped holding, the failure would surface much later —
// as a duplicated permission grant, a recurrence exception that applied twice,
// or an audit trail with holes — a long way from its cause.

describe("CalendarMember — one grant per principal", () => {
  it("refuses a second grant for the same principal on the same calendar", async () => {
    // THE guarantee the permission resolver rests on. Two grants for one
    // principal would make "what may this user do here?" depend on row order,
    // and the resolution chain in CAL1.3 stops at the first match — so the
    // answer would quietly depend on which row Postgres returned first.
    const company = await createCompany();
    const calendar = await createCalendar(company.id);

    const grant = {
      calendarId: calendar.id,
      companyId: company.id,
      principalType: "USER",
      principalId: "42",
      preset: "VIEWER",
    };
    await prisma.calendarMember.create({ data: grant });

    await expect(
      prisma.calendarMember.create({ data: { ...grant, preset: "MANAGER" } })
    ).rejects.toMatchObject({ code: "P2002" });

    expect(await prisma.calendarMember.count()).toBe(1);
  });
});

describe("CalendarEventOccurrence — one exception per occurrence", () => {
  it("refuses a second exception for the same original start", async () => {
    // An occurrence row means "this instance of the series differs". Two rows
    // for the same instant would mean it differs in two contradictory ways, and
    // the expander applies whichever it happens to read.
    const tenant = await createTenant();
    const calendar = await createCalendar(tenant.company.id);
    const event = await createCalendarEvent(calendar.id, tenant.company.id, {
      recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
    });

    const originalStartsAt = new Date("2026-08-10T07:00:00.000Z");
    await prisma.calendarEventOccurrence.create({
      data: { eventId: event.id, originalStartsAt, cancelled: true },
    });

    await expect(
      prisma.calendarEventOccurrence.create({
        data: { eventId: event.id, originalStartsAt, title: "Moved" },
      })
    ).rejects.toMatchObject({ code: "P2002" });

    expect(await prisma.calendarEventOccurrence.count()).toBe(1);
  });
});

describe("Calendar — not over-constrained", () => {
  it("allows two PERSONAL calendars for two users in the same company", async () => {
    // Pinned deliberately. An earlier draft of the design proposed a composite
    // unique over (companyId, type, ownerUserId, projectId, employeeId); the
    // approved schema has NO such constraint, and this test is what would fail
    // if one were added later without thinking it through. Every employee has
    // their own personal calendar — that is the normal case, not a collision.
    const company = await createCompany();
    const alice = await createUser({ companyId: company.id });
    const bob = await createUser({ companyId: company.id });

    await createCalendar(company.id, { type: "PERSONAL", ownerUserId: alice.id });
    await createCalendar(company.id, { type: "PERSONAL", ownerUserId: bob.id });

    expect(await prisma.calendar.count({ where: { companyId: company.id, type: "PERSONAL" } })).toBe(2);
  });
});

describe("CalendarEvent — the four source references (R5)", () => {
  it("stores all four references at once and resolves them back", async () => {
    // R5: the event POINTS AT its sources. This proves all four relations are
    // live — and, by only ever storing ids, that there is nowhere for a stale
    // copy of a customer address or a shift time to live.
    const tenant = await createTenant();
    const calendar = await createCalendar(tenant.company.id);
    const shift = await createShift(tenant.employee.id, { projectId: tenant.project.id });

    const event = await createCalendarEvent(calendar.id, tenant.company.id, {
      projectId: tenant.project.id,
      customerId: tenant.customer.id,
      employeeId: tenant.employee.id,
      shiftId: shift.id,
    });

    const loaded = await prisma.calendarEvent.findUnique({
      where: { id: event.id },
      include: { project: true, customer: true, employee: true, shift: true },
    });

    expect(loaded!.project!.id).toBe(tenant.project.id);
    expect(loaded!.customer!.id).toBe(tenant.customer.id);
    expect(loaded!.employee!.id).toBe(tenant.employee.id);
    expect(loaded!.shift!.id).toBe(shift.id);
  });

  it("accepts an event with none of them (all four are genuinely optional)", async () => {
    // The plain "meeting at 10" case. If any of the four had slipped in as
    // required, the most ordinary event in the product would be impossible.
    const tenant = await createTenant();
    const calendar = await createCalendar(tenant.company.id);

    const event = await createCalendarEvent(calendar.id, tenant.company.id);

    expect(event.projectId).toBeNull();
    expect(event.customerId).toBeNull();
    expect(event.employeeId).toBeNull();
    expect(event.shiftId).toBeNull();
    // The location override is likewise empty — it is filled in only when the
    // event is somewhere OTHER than its project/customer address (plan §6.5).
    expect(event.location).toBeNull();
  });
});

describe("CalendarAudit — what it must outlive (D13)", () => {
  it("keeps the row after the acting user is deleted", async () => {
    // actorUserId is a SCALAR, not a relation, for exactly this reason. If it
    // were a relation, deleting an account would either block on the audit
    // trail or take it down — and "who changed these permissions?" would become
    // unanswerable precisely for the departed account most worth asking about.
    const company = await createCompany();
    const calendar = await createCalendar(company.id);
    const actor = await createUser({ companyId: company.id });

    await prisma.calendarAudit.create({
      data: {
        companyId: company.id,
        calendarId: calendar.id,
        targetType: "MEMBER",
        targetId: 1,
        action: CALENDAR_AUDIT_ACTIONS.MEMBER_GRANTED,
        actorUserId: actor.id,
        source: "WEB",
        changes: JSON.stringify({ preset: { from: null, to: "VIEWER" } }),
      },
    });

    await prisma.user.delete({ where: { id: actor.id } });

    const surviving = await prisma.calendarAudit.findFirst({ where: { actorUserId: actor.id } });
    expect(surviving).not.toBeNull();
    expect(surviving!.action).toBe("MEMBER_GRANTED");
    // Still attributable to the person who acted, even though the account is
    // gone — the id is retained rather than nulled.
    expect(surviving!.actorUserId).toBe(actor.id);
  });

  it("keeps the row after the event it describes is deleted", async () => {
    // targetId carries NO foreign key. That is what makes "who created the
    // thing that was later deleted?" answerable at all — the question the audit
    // table exists for, and the reason EVENT_CREATED is recorded here despite
    // constants/auditActions.ts saying creations need no audit row.
    const tenant = await createTenant();
    const calendar = await createCalendar(tenant.company.id);
    const event = await createCalendarEvent(calendar.id, tenant.company.id, {
      createdByUserId: tenant.owner.id,
    });

    await prisma.calendarAudit.create({
      data: {
        companyId: tenant.company.id,
        calendarId: calendar.id,
        targetType: "EVENT",
        targetId: event.id,
        action: CALENDAR_AUDIT_ACTIONS.EVENT_CREATED,
        actorUserId: tenant.owner.id,
        source: "WEB",
      },
    });

    await prisma.calendarEvent.delete({ where: { id: event.id } });

    const surviving = await prisma.calendarAudit.findFirst({
      where: { targetType: "EVENT", targetId: event.id },
    });
    expect(surviving).not.toBeNull();
    expect(surviving!.action).toBe("EVENT_CREATED");
    expect(await prisma.calendarEvent.count()).toBe(0);
  });
});

describe("resetDatabase — DELETE_ORDER covers the calendar module", () => {
  it("empties all nine tables from a fully populated database without an FK error", async () => {
    // The one test that protects every OTHER test file. A calendar row
    // references Company, Project, Employee and Shift with required or optional
    // FKs, all of which the repo generates as ON DELETE RESTRICT — so a missing
    // entry in DELETE_ORDER does not fail here, it fails in whatever unrelated
    // file happens to run next, with a P2003 naming a table that file has never
    // heard of.
    const tenant = await createTenant();
    const shift = await createShift(tenant.employee.id);
    const calendar = await createCalendar(tenant.company.id, {
      type: "PROJECT",
      projectId: tenant.project.id,
    });
    const event = await createCalendarEvent(calendar.id, tenant.company.id, {
      projectId: tenant.project.id,
      customerId: tenant.customer.id,
      employeeId: tenant.employee.id,
      shiftId: shift.id,
      createdByUserId: tenant.owner.id,
    });

    // Populate every remaining table, so the ordering is exercised in full
    // rather than only on the two or three tables CAL1 will use first.
    await prisma.calendarMember.create({
      data: {
        calendarId: calendar.id,
        companyId: tenant.company.id,
        principalType: "COMPANY",
        principalId: String(tenant.company.id),
        preset: "VIEWER",
        grantedByUserId: tenant.owner.id,
      },
    });
    await prisma.calendarEventOccurrence.create({
      data: { eventId: event.id, originalStartsAt: new Date("2026-08-17T07:00:00.000Z"), cancelled: true },
    });
    await prisma.calendarParticipant.create({
      data: { eventId: event.id, userId: tenant.owner.id, isOrganizer: true },
    });
    await prisma.calendarEventAttachment.create({
      data: {
        eventId: event.id,
        userId: tenant.owner.id,
        fileName: "plan.pdf",
        fileType: "application/pdf",
        fileSize: 1024,
        fileUrl: "uploads/plan.pdf",
      },
    });
    await prisma.calendarEventComment.create({
      data: { eventId: event.id, userId: tenant.owner.id, content: "Bringing the ladder." },
    });
    await prisma.calendarEventReminder.create({
      data: { eventId: event.id, userId: tenant.owner.id, minutesBefore: 30, channel: "EMAIL" },
    });
    await prisma.calendarAudit.create({
      data: {
        companyId: tenant.company.id,
        calendarId: calendar.id,
        targetType: "CALENDAR",
        targetId: calendar.id,
        action: CALENDAR_AUDIT_ACTIONS.CALENDAR_CREATED,
        actorUserId: tenant.owner.id,
        source: "WEB",
      },
    });

    await resetDatabase();

    expect(await prisma.calendarAudit.count()).toBe(0);
    expect(await prisma.calendarEventOccurrence.count()).toBe(0);
    expect(await prisma.calendarParticipant.count()).toBe(0);
    expect(await prisma.calendarEventAttachment.count()).toBe(0);
    expect(await prisma.calendarEventComment.count()).toBe(0);
    expect(await prisma.calendarEventReminder.count()).toBe(0);
    expect(await prisma.calendarEvent.count()).toBe(0);
    expect(await prisma.calendarMember.count()).toBe(0);
    expect(await prisma.calendar.count()).toBe(0);
    // And the parents it was blocking are gone too — which is the actual
    // failure this ordering prevents.
    expect(await prisma.company.count()).toBe(0);
    expect(await prisma.shift.count()).toBe(0);
  });
});

describe("Calendar — tenant relation", () => {
  it("does not surface another tenant's calendars under a companyId filter", async () => {
    // companyId is REQUIRED on Calendar (unlike the nullable one on Project and
    // Employee), so every calendar is attributable to exactly one tenant and
    // the scoped filter every read will use has something to bite on.
    const a = await createTenant();
    const b = await createTenant();

    await createCalendar(a.company.id, { name: "Tenant A calendar" });
    await createCalendar(b.company.id, { name: "Tenant B calendar" });

    const visibleToA = await prisma.calendar.findMany({ where: { companyId: a.company.id } });

    expect(visibleToA).toHaveLength(1);
    expect(visibleToA[0]!.name).toBe("Tenant A calendar");
    expect(await prisma.calendar.count()).toBe(2);
  });
});
