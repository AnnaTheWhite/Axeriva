import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import prisma from "../database/prisma";
import { ROLES } from "../constants/roles";
import { AUDIT_ACTIONS } from "../constants/auditActions";
import { READ_ONLY_ERROR } from "../middleware/readOnly.middleware";
import {
  authHeader,
  createDeveloper,
  createEmployeeUser,
  createTenant,
  createUser,
} from "./helpers/factories";

// CAL1.4 — the calendar module's first write surface.
//
// The endpoints are unreachable from any UI (the calendar appears at CAL1.6),
// so what these tests exist for is the two things that CANNOT be retro-fitted:
// the authorisation gate on every route, and the audit trail behind every
// permission change.

const lapsed = () =>
  createTenant({
    subscriptionStatus: "trialing",
    subscriptionEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
  });

async function personalCalendarFor(companyId: number, userId: number, name = "Mine") {
  return prisma.calendar.create({
    data: { companyId, type: "PERSONAL", name, ownerUserId: userId },
  });
}

async function auditRows(calendarId: number) {
  return prisma.calendarAudit.findMany({ where: { calendarId }, orderBy: { id: "asc" } });
}

// ---------------------------------------------------------------------------
// Tenant isolation — every endpoint
// ---------------------------------------------------------------------------

describe("tenant isolation answers 404, never 403", () => {
  it("hides another tenant's calendar from every endpoint", async () => {
    // §11.2: a foreign calendarId must be indistinguishable from a
    // non-existent one. A 403 would confirm the calendar exists, which is an
    // enumeration oracle across tenants.
    const a = await createTenant();
    const b = await createTenant();
    const foreign = await prisma.calendar.create({
      data: { companyId: b.company.id, type: "COMPANY", name: "B company" },
    });

    const head = authHeader(a.token);
    const cases: [string, () => request.Test][] = [
      ["GET one", () => request(app).get(`/calendars/${foreign.id}`).set(head)],
      ["PATCH", () => request(app).patch(`/calendars/${foreign.id}`).set(head).send({ name: "x" })],
      ["DELETE", () => request(app).delete(`/calendars/${foreign.id}`).set(head)],
      ["GET members", () => request(app).get(`/calendars/${foreign.id}/members`).set(head)],
      [
        "POST members",
        () =>
          request(app)
            .post(`/calendars/${foreign.id}/members`)
            .set(head)
            .send({ principalType: "USER", principalId: "1", preset: "VIEWER" }),
      ],
      ["PATCH member", () => request(app).patch(`/calendars/${foreign.id}/members/1`).set(head).send({ preset: "VIEWER" })],
      ["DELETE member", () => request(app).delete(`/calendars/${foreign.id}/members/1`).set(head)],
      ["GET share-level", () => request(app).get(`/calendars/${foreign.id}/share-level`).set(head)],
      [
        "PUT share-level",
        () => request(app).put(`/calendars/${foreign.id}/share-level`).set(head).send({ shareLevel: "PRIVATE" }),
      ],
    ];

    for (const [label, call] of cases) {
      const res = await call();
      expect(res.status, label).toBe(404);
    }

    // And nothing was written to the other tenant.
    expect(await prisma.calendar.count({ where: { companyId: b.company.id } })).toBe(1);
    expect(await prisma.calendarAudit.count()).toBe(0);
  });

  it("does not list another tenant's calendars", async () => {
    const a = await createTenant();
    const b = await createTenant();
    await prisma.calendar.create({ data: { companyId: a.company.id, type: "COMPANY", name: "A" } });
    await prisma.calendar.create({ data: { companyId: b.company.id, type: "COMPANY", name: "B" } });

    const res = await request(app).get("/calendars").set(authHeader(a.token));
    expect(res.status).toBe(200);
    expect(res.body.map((c: { name: string }) => c.name)).toEqual(["A"]);
  });
});

// ---------------------------------------------------------------------------
// R2 / R3 / R4 — the share-level authority
// ---------------------------------------------------------------------------

describe("share level is the employee's decision, not the company owner's", () => {
  it("refuses the company owner on an employee's personal calendar, with 404", async () => {
    // R2 + R3 together: the owner governs business calendars, the user governs
    // their own personal one. A 403 here would confirm the calendar exists —
    // so the owner must not even be able to detect it.
    const tenant = await createTenant();
    const employee = await createEmployeeUser(tenant.company.id, tenant.employee.id);
    const personal = await personalCalendarFor(tenant.company.id, employee.user.id);

    const read = await request(app)
      .get(`/calendars/${personal.id}/share-level`)
      .set(authHeader(tenant.token));
    expect(read.status).toBe(404);

    const write = await request(app)
      .put(`/calendars/${personal.id}/share-level`)
      .set(authHeader(tenant.token))
      .send({ shareLevel: "DETAILS" });
    expect(write.status).toBe(404);

    // The owner cannot read the calendar itself either.
    expect((await request(app).get(`/calendars/${personal.id}`).set(authHeader(tenant.token))).status).toBe(404);
  });

  it("lets the owner of the calendar move PRIVATE → FREE_BUSY → DETAILS → PRIVATE", async () => {
    const tenant = await createTenant();
    const employee = await createEmployeeUser(tenant.company.id, tenant.employee.id);
    const personal = await personalCalendarFor(tenant.company.id, employee.user.id);
    const head = authHeader(employee.token);

    // Default is PRIVATE, and it is the ABSENCE of a grant row — not a column.
    const initial = await request(app).get(`/calendars/${personal.id}/share-level`).set(head);
    expect(initial.body).toEqual({ shareLevel: "PRIVATE" });
    expect(await prisma.calendarMember.count({ where: { calendarId: personal.id } })).toBe(0);

    for (const [level, preset] of [
      ["FREE_BUSY", "FREE_BUSY"],
      ["DETAILS", "VIEWER"],
    ] as const) {
      const res = await request(app)
        .put(`/calendars/${personal.id}/share-level`)
        .set(head)
        .send({ shareLevel: level });
      expect(res.status, level).toBe(200);

      const grant = await prisma.calendarMember.findFirst({
        where: { calendarId: personal.id, principalType: "COMPANY" },
      });
      expect(grant?.preset, level).toBe(preset);
    }

    // At DETAILS the company owner can now read it — through the grant, which
    // is the only route into a personal calendar.
    const ownerView = await request(app).get(`/calendars/${personal.id}`).set(authHeader(tenant.token));
    expect(ownerView.status).toBe(200);
    expect(ownerView.body.permissions).toContain("view_details");

    // Back to PRIVATE deletes the row rather than storing a value.
    await request(app).put(`/calendars/${personal.id}/share-level`).set(head).send({ shareLevel: "PRIVATE" });
    expect(await prisma.calendarMember.count({ where: { calendarId: personal.id } })).toBe(0);
    expect((await request(app).get(`/calendars/${personal.id}`).set(authHeader(tenant.token))).status).toBe(404);
  });

  it("FREE_BUSY really is content-free", async () => {
    // R4: the company learns WHEN, never WHAT.
    const tenant = await createTenant();
    const employee = await createEmployeeUser(tenant.company.id, tenant.employee.id);
    const personal = await personalCalendarFor(tenant.company.id, employee.user.id);

    await request(app)
      .put(`/calendars/${personal.id}/share-level`)
      .set(authHeader(employee.token))
      .send({ shareLevel: "FREE_BUSY" });

    const ownerView = await request(app).get(`/calendars/${personal.id}`).set(authHeader(tenant.token));
    expect(ownerView.status).toBe(200);
    expect(ownerView.body.permissions).toEqual(["view_free_busy"]);
    expect(ownerView.body.permissions).not.toContain("view_details");
  });
});

// ---------------------------------------------------------------------------
// Privilege escalation
// ---------------------------------------------------------------------------

describe("nobody grants themselves more than they hold", () => {
  async function calendarWhereActorIsAdmin() {
    const tenant = await createTenant();
    const employee = await createEmployeeUser(tenant.company.id, tenant.employee.id);
    const calendar = await prisma.calendar.create({
      data: { companyId: tenant.company.id, type: "PROJECT", name: "Project" },
    });
    // ADMIN carries `share` but not `manage`.
    const narrowing = await prisma.calendarMember.create({
      data: {
        calendarId: calendar.id,
        companyId: tenant.company.id,
        principalType: "USER",
        principalId: String(employee.user.id),
        preset: "ADMIN",
      },
    });
    return { tenant, employee, calendar, narrowing };
  }

  it("refuses a grant conferring a permission the granter lacks", async () => {
    const { employee, calendar } = await calendarWhereActorIsAdmin();

    const res = await request(app)
      .post(`/calendars/${calendar.id}/members`)
      .set(authHeader(employee.token))
      .send({ principalType: "USER", principalId: "424242", preset: "OWNER" });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("manage");
    expect(await prisma.calendarMember.count({ where: { calendarId: calendar.id } })).toBe(1);
  });

  it("refuses the same escalation through PATCH", async () => {
    const { employee, calendar, tenant } = await calendarWhereActorIsAdmin();
    const other = await prisma.calendarMember.create({
      data: {
        calendarId: calendar.id,
        companyId: tenant.company.id,
        principalType: "USER",
        principalId: "424242",
        preset: "VIEWER",
      },
    });

    const res = await request(app)
      .patch(`/calendars/${calendar.id}/members/${other.id}`)
      .set(authHeader(employee.token))
      .send({ preset: "OWNER" });

    expect(res.status).toBe(403);
    expect((await prisma.calendarMember.findUnique({ where: { id: other.id } }))?.preset).toBe("VIEWER");
  });

  it("refuses escalation by REVOKING one's own narrowing grant", async () => {
    // Found by the CAL1.4 review. Resolution stops at the first matching
    // principal and never unions, so deleting the row that NARROWS you promotes
    // you to the broader one underneath. Here the actor is ADMIN by a USER
    // grant, with a company-wide OWNER grant beneath it: revoking their own row
    // would hand them `manage`, the exact escalation POST and PATCH refuse.
    const { employee, calendar, tenant, narrowing } = await calendarWhereActorIsAdmin();
    await prisma.calendarMember.create({
      data: {
        calendarId: calendar.id,
        companyId: tenant.company.id,
        principalType: "COMPANY",
        principalId: String(tenant.company.id),
        preset: "OWNER",
      },
    });

    const res = await request(app)
      .delete(`/calendars/${calendar.id}/members/${narrowing.id}`)
      .set(authHeader(employee.token));

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("manage");
    expect(await prisma.calendarMember.findUnique({ where: { id: narrowing.id } })).not.toBeNull();
  });

  it("still allows a revoke that widens nobody", async () => {
    // The guard must not block ordinary sharing hygiene.
    const tenant = await createTenant();
    const calendar = await prisma.calendar.create({
      data: { companyId: tenant.company.id, type: "COMPANY", name: "Company" },
    });
    const grant = await prisma.calendarMember.create({
      data: {
        calendarId: calendar.id,
        companyId: tenant.company.id,
        principalType: "USER",
        principalId: "424242",
        preset: "VIEWER",
      },
    });

    const res = await request(app)
      .delete(`/calendars/${calendar.id}/members/${grant.id}`)
      .set(authHeader(tenant.token));
    expect(res.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// Read-only mode — inherited from the tenantWrite mount
// ---------------------------------------------------------------------------

describe("a lapsed company can read its calendars but not change them", () => {
  it("passes reads and blocks every write", async () => {
    const tenant = await lapsed();
    const calendar = await prisma.calendar.create({
      data: { companyId: tenant.company.id, type: "COMPANY", name: "Company" },
    });
    const head = authHeader(tenant.token);

    expect((await request(app).get("/calendars").set(head)).status).toBe(200);
    expect((await request(app).get(`/calendars/${calendar.id}`).set(head)).status).toBe(200);

    const writes = [
      request(app).post("/calendars").set(head).send({ type: "COMPANY", name: "New" }),
      request(app).patch(`/calendars/${calendar.id}`).set(head).send({ name: "Renamed" }),
      request(app).delete(`/calendars/${calendar.id}`).set(head),
      request(app)
        .post(`/calendars/${calendar.id}/members`)
        .set(head)
        .send({ principalType: "USER", principalId: "1", preset: "VIEWER" }),
    ];

    for (const write of writes) {
      const res = await write;
      expect(res.status).toBe(403);
      expect(res.body.error).toBe(READ_ONLY_ERROR);
    }

    // Nothing was written, and no audit row was produced either.
    expect(await prisma.calendar.count({ where: { companyId: tenant.company.id } })).toBe(1);
    expect(await prisma.calendarAudit.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Creation — validation, authority, and the lazy find-then-create
// ---------------------------------------------------------------------------

describe("POST /calendars", () => {
  it("rejects a calendar type outside the vocabulary", async () => {
    // The validation CAL1.3 deferred here. Calendar.type is unconstrained TEXT
    // and the permission gate branches on it, so an unvalidated value is a
    // permission question rather than a data-quality one.
    const tenant = await createTenant();
    for (const type of ["personal", "TEAM", "", "PERSONAL "]) {
      const res = await request(app)
        .post("/calendars")
        .set(authHeader(tenant.token))
        .send({ type, name: "x" });
      expect(res.status, type).toBe(400);
    }
    expect(await prisma.calendar.count()).toBe(0);
  });

  it("is idempotent — first use may happen twice (lazy creation)", async () => {
    const tenant = await createTenant();
    const employee = await createEmployeeUser(tenant.company.id, tenant.employee.id);

    const first = await request(app)
      .post("/calendars")
      .set(authHeader(employee.token))
      .send({ type: "PERSONAL" });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/calendars")
      .set(authHeader(employee.token))
      .send({ type: "PERSONAL" });
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);

    expect(await prisma.calendar.count({ where: { type: "PERSONAL" } })).toBe(1);
    // The idempotent hit is not a second creation, so it writes no audit row.
    expect(await prisma.calendarAudit.count()).toBe(1);
  });

  it("never creates a personal calendar for somebody else", async () => {
    // R2 at the create path: the ownerUserId is always the caller's own,
    // whatever the body says.
    const tenant = await createTenant();
    const employee = await createEmployeeUser(tenant.company.id, tenant.employee.id);

    const res = await request(app)
      .post("/calendars")
      .set(authHeader(employee.token))
      .send({ type: "PERSONAL", ownerUserId: tenant.owner.id, name: "Not yours" });

    expect(res.status).toBe(201);
    expect(res.body.ownerUserId).toBe(employee.user.id);
  });

  it("lets only the company owner create business calendars", async () => {
    const tenant = await createTenant();
    const employee = await createEmployeeUser(tenant.company.id, tenant.employee.id);

    const denied = await request(app)
      .post("/calendars")
      .set(authHeader(employee.token))
      .send({ type: "COMPANY", name: "Company" });
    expect(denied.status).toBe(403);

    const allowed = await request(app)
      .post("/calendars")
      .set(authHeader(tenant.token))
      .send({ type: "COMPANY", name: "Company" });
    expect(allowed.status).toBe(201);
  });

  it("re-resolves a body projectId under the caller's tenant", async () => {
    // The shifts.routes.ts pattern (§11.2): a foreign id must 404, not attach.
    const a = await createTenant();
    const b = await createTenant();

    const res = await request(app)
      .post("/calendars")
      .set(authHeader(a.token))
      .send({ type: "PROJECT", projectId: b.project.id, name: "Theirs" });

    expect(res.status).toBe(404);
    expect(await prisma.calendar.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The audit trail (D13)
// ---------------------------------------------------------------------------

describe("every permission change is audited exactly once, with real values", () => {
  it("records grant, update and revoke with true from/to", async () => {
    const tenant = await createTenant();
    const calendar = await prisma.calendar.create({
      data: { companyId: tenant.company.id, type: "COMPANY", name: "Company" },
    });
    const head = authHeader(tenant.token);

    const granted = await request(app)
      .post(`/calendars/${calendar.id}/members`)
      .set(head)
      .send({ principalType: "USER", principalId: "424242", preset: "VIEWER" });
    expect(granted.status).toBe(201);

    await request(app)
      .patch(`/calendars/${calendar.id}/members/${granted.body.id}`)
      .set(head)
      .send({ preset: "MANAGER" });

    await request(app).delete(`/calendars/${calendar.id}/members/${granted.body.id}`).set(head);

    const rows = await auditRows(calendar.id);
    expect(rows.map((row) => row.action)).toEqual([
      "MEMBER_GRANTED",
      "MEMBER_UPDATED",
      "MEMBER_REVOKED",
    ]);

    expect(JSON.parse(rows[0]!.changes!)).toEqual({ preset: { from: null, to: "VIEWER" } });
    expect(JSON.parse(rows[1]!.changes!)).toEqual({ preset: { from: "VIEWER", to: "MANAGER" } });
    expect(JSON.parse(rows[2]!.changes!)).toEqual({ preset: { from: "MANAGER", to: null } });

    for (const row of rows) {
      expect(row.actorUserId).toBe(tenant.owner.id);
      expect(row.source).toBe("WEB");
      expect(row.targetType).toBe("MEMBER");
      expect(row.companyId).toBe(tenant.company.id);
    }
  });

  it("records a CUSTOM permission-list change, not a from===to no-op", async () => {
    // Found by the CAL1.4 review: auditing only `preset` made a CUSTOM → CUSTOM
    // rewrite — the widest privilege change this endpoint can make — look like
    // nothing had happened.
    const tenant = await createTenant();
    const calendar = await prisma.calendar.create({
      data: { companyId: tenant.company.id, type: "COMPANY", name: "Company" },
    });
    const head = authHeader(tenant.token);

    const granted = await request(app)
      .post(`/calendars/${calendar.id}/members`)
      .set(head)
      .send({
        principalType: "USER",
        principalId: "424242",
        preset: "CUSTOM",
        permissions: ["view_free_busy"],
      });
    expect(granted.status).toBe(201);

    const updated = await request(app)
      .patch(`/calendars/${calendar.id}/members/${granted.body.id}`)
      .set(head)
      .send({ preset: "CUSTOM", permissions: ["view_details", "event.create"] });
    expect(updated.status).toBe(200);

    const rows = await auditRows(calendar.id);
    const grantChanges = JSON.parse(rows[0]!.changes!);
    const updateChanges = JSON.parse(rows[1]!.changes!);

    // The list is recorded when granted...
    expect(grantChanges.permissions.to).toContain("view_free_busy");
    // ...and the real delta when changed, with no false preset pair.
    expect(updateChanges.preset).toBeUndefined();
    expect(updateChanges.permissions.from).toContain("view_free_busy");
    expect(updateChanges.permissions.to).toContain("event.create");
  });

  it("writes NO audit row for a PATCH that changes nothing", async () => {
    const tenant = await createTenant();
    const calendar = await prisma.calendar.create({
      data: { companyId: tenant.company.id, type: "COMPANY", name: "Company" },
    });

    const res = await request(app)
      .patch(`/calendars/${calendar.id}`)
      .set(authHeader(tenant.token))
      .send({ name: "Company" });

    expect(res.status).toBe(200);
    expect(await auditRows(calendar.id)).toHaveLength(0);
  });

  it("derives `source` server-side and ignores client spoofing attempts", async () => {
    // §6.6: a client-settable source would make the table lie about exactly the
    // field an investigation starts from.
    const tenant = await createTenant();
    const calendar = await prisma.calendar.create({
      data: { companyId: tenant.company.id, type: "COMPANY", name: "Company" },
    });

    const res = await request(app)
      .post(`/calendars/${calendar.id}/members`)
      .set(authHeader(tenant.token))
      .set("X-Audit-Source", "SYSTEM")
      .set("X-Source", "SYSTEM")
      .send({
        principalType: "USER",
        principalId: "424242",
        preset: "VIEWER",
        source: "SYSTEM",
        actorUserId: 999999,
      });
    expect(res.status).toBe(201);

    const rows = await auditRows(calendar.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe("WEB");
    expect(rows[0]!.actorUserId).toBe(tenant.owner.id);
  });

  it("mirrors permission changes to the global AuditLog, but not calendar mutations", async () => {
    const tenant = await createTenant();

    // A calendar create/update/archive is audited in CalendarAudit only.
    const created = await request(app)
      .post("/calendars")
      .set(authHeader(tenant.token))
      .send({ type: "COMPANY", name: "Company" });
    await request(app)
      .patch(`/calendars/${created.body.id}`)
      .set(authHeader(tenant.token))
      .send({ name: "Renamed" });

    expect(
      await prisma.auditLog.count({ where: { action: AUDIT_ACTIONS.CALENDAR_PERMISSION_CHANGED } })
    ).toBe(0);

    // A permission change reaches both.
    await request(app)
      .post(`/calendars/${created.body.id}/members`)
      .set(authHeader(tenant.token))
      .send({ principalType: "USER", principalId: "424242", preset: "VIEWER" });

    const mirrored = await prisma.auditLog.findMany({
      where: { action: AUDIT_ACTIONS.CALENDAR_PERMISSION_CHANGED },
    });
    expect(mirrored).toHaveLength(1);
    expect(mirrored[0]!.companyId).toBe(tenant.company.id);
    expect(mirrored[0]!.userId).toBe(tenant.owner.id);
    expect(JSON.parse(mirrored[0]!.metadata!).calendarAction).toBe("MEMBER_GRANTED");
  });

  it("audits archiving, and an archived calendar then denies everyone", async () => {
    const tenant = await createTenant();
    const calendar = await prisma.calendar.create({
      data: { companyId: tenant.company.id, type: "COMPANY", name: "Company" },
    });

    expect((await request(app).delete(`/calendars/${calendar.id}`).set(authHeader(tenant.token))).status).toBe(204);

    const rows = await auditRows(calendar.id);
    expect(rows.map((r) => r.action)).toEqual(["CALENDAR_ARCHIVED"]);
    expect(JSON.parse(rows[0]!.changes!).archivedAt.from).toBeNull();

    // Archived is closed to everyone — including the company owner (CAL1.3).
    expect((await request(app).get(`/calendars/${calendar.id}`).set(authHeader(tenant.token))).status).toBe(404);
    const list = await request(app).get("/calendars").set(authHeader(tenant.token));
    expect(list.body).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The last-owner guard
// ---------------------------------------------------------------------------

describe("the last owner grant", () => {
  it("is removable while the calendar still has a standing owner", async () => {
    // A PERSONAL calendar's ownerUserId is a standing owner (§4.6 step 2), so
    // an OWNER grant handed to a second person is NOT the last owner and may be
    // taken back. Blocking it would make the first grant ever written permanent.
    const tenant = await createTenant();
    const employee = await createEmployeeUser(tenant.company.id, tenant.employee.id);
    const personal = await personalCalendarFor(tenant.company.id, employee.user.id);

    const granted = await request(app)
      .post(`/calendars/${personal.id}/members`)
      .set(authHeader(employee.token))
      .send({ principalType: "USER", principalId: String(tenant.owner.id), preset: "OWNER" });
    expect(granted.status).toBe(201);

    const revoked = await request(app)
      .delete(`/calendars/${personal.id}/members/${granted.body.id}`)
      .set(authHeader(employee.token));
    expect(revoked.status).toBe(204);
  });

  it("is protected when it is genuinely the only owner", async () => {
    // No ownerUserId and a type outside the business-authority list: the OWNER
    // grants really are the last authority, so the guard must fire.
    const tenant = await createTenant();
    const calendar = await prisma.calendar.create({
      data: { companyId: tenant.company.id, type: "PERSONAL", name: "Ownerless" },
    });
    const developer = await createDeveloper();
    const grant = await prisma.calendarMember.create({
      data: {
        calendarId: calendar.id,
        companyId: tenant.company.id,
        principalType: "ROLE",
        principalId: ROLES.BUSINESS_OWNER,
        preset: "OWNER",
      },
    });

    const res = await request(app)
      .delete(`/calendars/${calendar.id}/members/${grant.id}`)
      .set(authHeader(tenant.token));

    expect(res.status).toBe(409);
    expect(await prisma.calendarMember.findUnique({ where: { id: grant.id } })).not.toBeNull();
    // The DEVELOPER cannot reach a PERSONAL calendar to work around it.
    expect(
      (await request(app).get(`/calendars/${calendar.id}`).set(authHeader(developer.token))).status
    ).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DEVELOPER
// ---------------------------------------------------------------------------

describe("DEVELOPER access", () => {
  it("crosses tenants for business calendars but never personal ones", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const developer = await createDeveloper();

    await prisma.calendar.create({ data: { companyId: a.company.id, type: "COMPANY", name: "A company" } });
    await prisma.calendar.create({ data: { companyId: b.company.id, type: "PROJECT", name: "B project" } });
    const owner = await createUser({ companyId: a.company.id });
    const personal = await personalCalendarFor(a.company.id, owner.id, "A personal");

    const list = await request(app).get("/calendars").set(authHeader(developer.token));
    expect(list.body.map((c: { name: string }) => c.name).sort()).toEqual(["A company", "B project"]);

    expect(
      (await request(app).get(`/calendars/${personal.id}`).set(authHeader(developer.token))).status
    ).toBe(404);
  });
});
