import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import prisma from "../database/prisma";
import { authHeader, createEmployee, createTenant } from "./helpers/factories";

// The core promise of a multi-tenant SaaS: company A can neither read nor
// write anything belonging to company B. Every test here builds two complete
// tenants and has A aim at B's rows.
//
// Data for the "other" tenant is always created through Prisma, never through
// the API — otherwise a broken endpoint could hide its own bug by refusing to
// create the fixture in the first place.

describe("read scoping", () => {
  it("GET /employees returns only the caller's employees", async () => {
    const a = await createTenant();
    const b = await createTenant();

    const res = await request(app).get("/employees").set(authHeader(a.token));

    expect(res.status).toBe(200);
    const ids = res.body.map((e: { id: number }) => e.id);
    expect(ids).toContain(a.employee.id);
    expect(ids).not.toContain(b.employee.id);
  });

  it("GET /customers returns only the caller's customers", async () => {
    const a = await createTenant();
    const b = await createTenant();

    const res = await request(app).get("/customers").set(authHeader(a.token));

    expect(res.status).toBe(200);
    const ids = res.body.map((c: { id: number }) => c.id);
    expect(ids).toContain(a.customer.id);
    expect(ids).not.toContain(b.customer.id);
  });

  it("GET /projects returns only the caller's projects", async () => {
    const a = await createTenant();
    const b = await createTenant();

    const res = await request(app).get("/projects").set(authHeader(a.token));

    expect(res.status).toBe(200);
    const ids = res.body.map((p: { id: number }) => p.id);
    expect(ids).toContain(a.project.id);
    expect(ids).not.toContain(b.project.id);
  });

  it("GET /customers/:id 404s for another tenant's customer", async () => {
    const a = await createTenant();
    const b = await createTenant();

    const res = await request(app)
      .get(`/customers/${b.customer.id}`)
      .set(authHeader(a.token));

    expect(res.status).toBe(404);
  });

  it("GET /companies/:id 404s for another tenant's company", async () => {
    const a = await createTenant();
    const b = await createTenant();

    const res = await request(app).get(`/companies/${b.company.id}`).set(authHeader(a.token));

    expect(res.status).toBe(404);
  });
});

describe("write scoping", () => {
  it("PUT /customers/:id cannot modify another tenant's customer", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const originalName = b.customer.name;

    await request(app)
      .put(`/customers/${b.customer.id}`)
      .set(authHeader(a.token))
      .send({ name: "Hijacked" });

    const after = await prisma.customer.findUnique({ where: { id: b.customer.id } });
    expect(after!.name).toBe(originalName);
  });

  it("DELETE /customers/:id cannot delete another tenant's customer", async () => {
    const a = await createTenant();
    const b = await createTenant();

    await request(app).delete(`/customers/${b.customer.id}`).set(authHeader(a.token));

    expect(await prisma.customer.findUnique({ where: { id: b.customer.id } })).not.toBeNull();
  });

  it("PUT /projects/:id cannot modify another tenant's project", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const originalName = b.project.name;

    await request(app)
      .put(`/projects/${b.project.id}`)
      .set(authHeader(a.token))
      .send({ name: "Hijacked" });

    const after = await prisma.project.findUnique({ where: { id: b.project.id } });
    expect(after!.name).toBe(originalName);
  });

  it("DELETE /projects/:id cannot delete another tenant's project", async () => {
    const a = await createTenant();
    const b = await createTenant();

    const res = await request(app)
      .delete(`/projects/${b.project.id}`)
      .set(authHeader(a.token));

    expect(res.status).toBe(404);
    expect(await prisma.project.findUnique({ where: { id: b.project.id } })).not.toBeNull();
  });

  it("DELETE /employees/:id cannot delete another tenant's employee", async () => {
    const a = await createTenant();
    const b = await createTenant();

    await request(app).delete(`/employees/${b.employee.id}`).set(authHeader(a.token));

    expect(await prisma.employee.findUnique({ where: { id: b.employee.id } })).not.toBeNull();
  });
});

describe("mass assignment", () => {
  it("PUT /companies/:id cannot raise the caller's own plan or subscription status", async () => {
    const a = await createTenant();

    await request(app)
      .put(`/companies/${a.company.id}`)
      .set(authHeader(a.token))
      .send({
        name: "Legit rename",
        plan: "enterprise",
        subscriptionStatus: "active",
        stripeCustomerId: "cus_attacker",
      });

    const after = await prisma.company.findUnique({ where: { id: a.company.id } });
    expect(after!.name).toBe("Legit rename");
    expect(after!.plan).toBe(a.company.plan);
    expect(after!.subscriptionStatus).toBe(a.company.subscriptionStatus);
    expect(after!.stripeCustomerId).toBeNull();
  });

  it("PUT /company/settings cannot write logoUrl (server-derived, not client input)", async () => {
    const t = await createTenant();
    await prisma.company.update({
      where: { id: t.company.id },
      data: { logoUrl: "/uploads/logos/real.png" },
    });

    const res = await request(app)
      .put("/company/settings")
      .set(authHeader(t.token))
      .send({ name: "Legit rename", logoUrl: "/uploads/logos/someone-elses.png" });

    expect(res.status).toBeLessThan(400);

    const after = await prisma.company.findUnique({ where: { id: t.company.id } });
    expect(after!.name).toBe("Legit rename");
    // Only POST/DELETE /company/logo may touch this column.
    expect(after!.logoUrl).toBe("/uploads/logos/real.png");
  });

  it("PUT /companies/:id cannot write logoUrl either (same shared allow-list)", async () => {
    const t = await createTenant();
    await prisma.company.update({
      where: { id: t.company.id },
      data: { logoUrl: "/uploads/logos/real.png" },
    });

    await request(app)
      .put(`/companies/${t.company.id}`)
      .set(authHeader(t.token))
      .send({ logoUrl: "https://evil.example/tracker.png" });

    const after = await prisma.company.findUnique({ where: { id: t.company.id } });
    expect(after!.logoUrl).toBe("/uploads/logos/real.png");
  });

  it("PUT /employees/:id cannot move an employee into another company", async () => {
    const a = await createTenant();
    const b = await createTenant();

    await request(app)
      .put(`/employees/${a.employee.id}`)
      .set(authHeader(a.token))
      .send({ firstName: "Renamed", companyId: b.company.id });

    const after = await prisma.employee.findUnique({ where: { id: a.employee.id } });
    expect(after!.companyId).toBe(a.company.id);
  });
});

describe("cross-tenant linking", () => {
  it("POST /projects/:id/assign refuses another tenant's project", async () => {
    const a = await createTenant();
    const b = await createTenant();

    const res = await request(app)
      .post(`/projects/${b.project.id}/assign`)
      .set(authHeader(a.token))
      .send({ employeeId: a.employee.id });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(
      await prisma.projectAssignment.findFirst({
        where: { projectId: b.project.id, employeeId: a.employee.id },
      })
    ).toBeNull();
  });

  it("POST /projects/:id/assign refuses another tenant's employee", async () => {
    const a = await createTenant();
    const b = await createTenant();

    const res = await request(app)
      .post(`/projects/${a.project.id}/assign`)
      .set(authHeader(a.token))
      .send({ employeeId: b.employee.id });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(
      await prisma.projectAssignment.findFirst({
        where: { projectId: a.project.id, employeeId: b.employee.id },
      })
    ).toBeNull();
  });

  it("DELETE /projects/:id/assign/:employeeId cannot unassign in another tenant", async () => {
    const a = await createTenant();
    const b = await createTenant();
    await prisma.projectAssignment.create({
      data: { projectId: b.project.id, employeeId: b.employee.id },
    });

    await request(app)
      .delete(`/projects/${b.project.id}/assign/${b.employee.id}`)
      .set(authHeader(a.token));

    expect(
      await prisma.projectAssignment.findFirst({
        where: { projectId: b.project.id, employeeId: b.employee.id },
      })
    ).not.toBeNull();
  });

  it("POST /shifts refuses to link another tenant's project", async () => {
    const a = await createTenant();
    const b = await createTenant();

    const res = await request(app)
      .post("/shifts")
      .set(authHeader(a.token))
      .send({
        employeeId: a.employee.id,
        projectId: b.project.id,
        start: new Date().toISOString(),
      });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.shift.findFirst({ where: { projectId: b.project.id } })).toBeNull();
  });

  it("POST /shifts refuses another tenant's employee", async () => {
    const a = await createTenant();
    const b = await createTenant();

    const res = await request(app)
      .post("/shifts")
      .set(authHeader(a.token))
      .send({ employeeId: b.employee.id, start: new Date().toISOString() });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.shift.findFirst({ where: { employeeId: b.employee.id } })).toBeNull();
  });

  it("PUT /shifts/:id refuses to reassign a shift to another tenant's employee", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const shift = await prisma.shift.create({
      data: { employeeId: a.employee.id, start: new Date() },
    });

    await request(app)
      .put(`/shifts/${shift.id}`)
      .set(authHeader(a.token))
      .send({ employeeId: b.employee.id, start: new Date().toISOString() });

    const after = await prisma.shift.findUnique({ where: { id: shift.id } });
    expect(after!.employeeId).toBe(a.employee.id);
  });

  it("DELETE /shifts/:id cannot delete another tenant's shift", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const shift = await prisma.shift.create({
      data: { employeeId: b.employee.id, start: new Date() },
    });

    await request(app).delete(`/shifts/${shift.id}`).set(authHeader(a.token));

    expect(await prisma.shift.findUnique({ where: { id: shift.id } })).not.toBeNull();
  });
});

describe("owner notes are private to their tenant", () => {
  it("GET /owner-notes never returns another tenant's notes", async () => {
    const a = await createTenant();
    const b = await createTenant();
    await prisma.ownerNote.create({
      data: {
        title: "B secret",
        content: "confidential",
        companyId: b.company.id,
        userId: b.owner.id,
      },
    });

    const res = await request(app).get("/owner-notes").set(authHeader(a.token));

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("B secret");
  });

  it("PUT /owner-notes/:id cannot modify another tenant's note", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const note = await prisma.ownerNote.create({
      data: {
        title: "B secret",
        content: "confidential",
        companyId: b.company.id,
        userId: b.owner.id,
      },
    });

    await request(app)
      .put(`/owner-notes/${note.id}`)
      .set(authHeader(a.token))
      .send({ title: "Hijacked" });

    const after = await prisma.ownerNote.findUnique({ where: { id: note.id } });
    expect(after!.title).toBe("B secret");
  });

  it("DELETE /owner-notes/:id cannot delete another tenant's note", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const note = await prisma.ownerNote.create({
      data: {
        title: "B secret",
        content: "confidential",
        companyId: b.company.id,
        userId: b.owner.id,
      },
    });

    await request(app).delete(`/owner-notes/${note.id}`).set(authHeader(a.token));

    expect(await prisma.ownerNote.findUnique({ where: { id: note.id } })).not.toBeNull();
  });
});

describe("notifications are private to their recipient", () => {
  // N1.7. The feed is scoped one level TIGHTER than every other router here:
  // by user, not by company. A colleague inside the same tenant must not see
  // these rows either — covered in notificationApi.test.ts. What this file
  // pins is the tenant boundary itself.
  async function seedNotification(companyId: number, userId: number, title: string) {
    const event = await prisma.notificationEvent.create({
      data: { type: "billing.subscription_created", companyId, context: "{}" },
    });

    return prisma.notification.create({
      data: {
        eventId: event.id,
        companyId,
        userId,
        type: "billing.subscription_created",
        severity: "info",
        title,
        body: "confidential",
      },
    });
  }

  it("GET /notifications never returns another tenant's notifications", async () => {
    const a = await createTenant();
    const b = await createTenant();
    await seedNotification(b.company.id, b.owner.id, "B secret");

    const res = await request(app).get("/notifications").set(authHeader(a.token));

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("B secret");
  });

  it("GET /notifications/unread-count never counts another tenant's rows", async () => {
    const a = await createTenant();
    const b = await createTenant();
    await seedNotification(b.company.id, b.owner.id, "B secret");

    const res = await request(app)
      .get("/notifications/unread-count")
      .set(authHeader(a.token));

    expect(res.body).toEqual({ unread: 0 });
  });

  it("POST /notifications/:id/read cannot mark another tenant's notification", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const theirs = await seedNotification(b.company.id, b.owner.id, "B secret");

    const res = await request(app)
      .post(`/notifications/${theirs.id}/read`)
      .set(authHeader(a.token));

    expect(res.status).toBe(404);
    const after = await prisma.notification.findUnique({ where: { id: theirs.id } });
    expect(after!.readAt).toBeNull();
  });

  it("POST /notifications/read-all cannot clear another tenant's badge", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const theirs = await seedNotification(b.company.id, b.owner.id, "B secret");

    await request(app).post("/notifications/read-all").set(authHeader(a.token));

    const after = await prisma.notification.findUnique({ where: { id: theirs.id } });
    expect(after!.readAt).toBeNull();
  });

  it("GET /notifications/preferences ignores a companyId aimed at another tenant", async () => {
    const a = await createTenant();
    const b = await createTenant();
    await prisma.notificationPreference.create({
      data: {
        companyId: b.company.id,
        userId: null,
        category: "projects",
        channel: "EMAIL",
        enabled: false,
      },
    });

    const res = await request(app)
      .get(`/notifications/preferences?companyId=${b.company.id}`)
      .set(authHeader(a.token));

    expect(res.status).toBe(200);
    // A's own company has no rows, so B's "off" must not show through.
    const projects = res.body.categories.find(
      (c: { category: string }) => c.category === "projects"
    );
    expect(projects.channels.EMAIL.company).toBeNull();
    expect(projects.channels.EMAIL.effective).toBe(true);
  });

  it("PUT /notifications/preferences/defaults cannot write into another tenant", async () => {
    const a = await createTenant();
    const b = await createTenant();

    const res = await request(app)
      .put(`/notifications/preferences/defaults?companyId=${b.company.id}`)
      .set(authHeader(a.token))
      .send({ preferences: [{ category: "projects", channel: "EMAIL", enabled: false }] });

    expect(res.status).toBe(200);
    expect(
      await prisma.notificationPreference.count({ where: { companyId: b.company.id } })
    ).toBe(0);
    expect(
      await prisma.notificationPreference.count({ where: { companyId: a.company.id } })
    ).toBe(1);
  });
});

describe("role boundaries", () => {
  it("an EMPLOYEE cannot create a project", async () => {
    const a = await createTenant();
    const employee = await createEmployee(a.company.id);
    const { token } = await import("./helpers/factories").then((m) =>
      m.createEmployeeUser(a.company.id, employee.id)
    );

    const res = await request(app)
      .post("/projects")
      .set(authHeader(token))
      .send({ name: "Not allowed" });

    expect(res.status).toBe(403);
  });

  it("a BUSINESS_OWNER cannot reach the admin analytics dashboard", async () => {
    const a = await createTenant();

    const res = await request(app).get("/admin/analytics/overview").set(authHeader(a.token));

    expect(res.status).toBe(403);
  });
});
