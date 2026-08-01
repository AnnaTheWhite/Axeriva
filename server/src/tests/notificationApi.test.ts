import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import prisma from "../database/prisma";
import { ROLES } from "../constants/roles";
import { signAuthToken } from "../utils/authToken";
import {
  authHeader,
  createDeveloper,
  createEmployeeUser,
  createReadOnlyCompany,
  createTenant,
  createUser,
} from "./helpers/factories";

// N1.7 — the bell's API and the preference screen behind it.
//
// These are integration tests against the real router and a real database:
// what needs pinning is the SCOPE of every query (a feed is one user's, not
// one company's), the resolution order of the three preference levels, and
// which of these writes read-only mode is allowed to stop.

// Notifications hang off a NotificationEvent, so one event carries a whole
// batch here — the feed does not care how many events produced its rows.
async function seedNotifications(
  companyId: number | null,
  userId: number,
  count: number,
  options: { read?: boolean; titlePrefix?: string } = {}
) {
  const event = await prisma.notificationEvent.create({
    data: { type: "billing.subscription_created", companyId, context: "{}" },
  });

  await prisma.notification.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      eventId: event.id,
      companyId,
      userId,
      type: "billing.subscription_created",
      severity: "info",
      title: `${options.titlePrefix ?? "n"}${index}`,
      body: "body",
      readAt: options.read ? new Date() : null,
    })),
  });
}

function categoryOf(body: { categories: { category: string }[] }, category: string) {
  return body.categories.find((entry) => entry.category === category)!;
}

describe("GET /notifications — the feed", () => {
  it("rejects an unauthenticated caller", async () => {
    const res = await request(app).get("/notifications");
    expect(res.status).toBe(401);
  });

  it("returns the caller's own notifications, newest first", async () => {
    const tenant = await createTenant();
    await seedNotifications(tenant.company.id, tenant.owner.id, 3, { titlePrefix: "own" });

    const res = await request(app).get("/notifications").set(authHeader(tenant.token));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(3);
    expect(res.body.items[0].title).toBe("own2");
    expect(res.body.nextCursor).toBeNull();
  });

  it("never returns a colleague's notifications", async () => {
    // The sharpest case: same company, so a companyId-only scope would leak.
    // The feed is per USER, and this is what proves it.
    const tenant = await createTenant();
    const colleague = await createEmployeeUser(tenant.company.id, tenant.employee.id);
    await seedNotifications(tenant.company.id, colleague.user.id, 2, { titlePrefix: "theirs" });
    await seedNotifications(tenant.company.id, tenant.owner.id, 1, { titlePrefix: "mine" });

    const res = await request(app).get("/notifications").set(authHeader(tenant.token));

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].title).toBe("mine0");
  });

  it("includes a company-less notification addressed to the caller", async () => {
    // NotificationEvent.companyId is nullable by design, so a notification can
    // legitimately belong to a user and to no tenant. A company-only scope
    // would drop it into a gap where the user is never told.
    const tenant = await createTenant();
    await seedNotifications(null, tenant.owner.id, 1, { titlePrefix: "platform" });

    const res = await request(app).get("/notifications").set(authHeader(tenant.token));

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].title).toBe("platform0");
  });

  it("never leaks internal columns", async () => {
    const tenant = await createTenant();
    await seedNotifications(tenant.company.id, tenant.owner.id, 1);

    const [item] = (await request(app).get("/notifications").set(authHeader(tenant.token)))
      .body.items;

    expect(Object.keys(item).sort()).toEqual(
      ["body", "createdAt", "ctaLabel", "ctaPath", "id", "readAt", "severity", "title", "type"]
    );
  });

  it("pages with a keyset cursor and never repeats a row", async () => {
    const tenant = await createTenant();
    await seedNotifications(tenant.company.id, tenant.owner.id, 5);

    const first = await request(app)
      .get("/notifications?limit=2")
      .set(authHeader(tenant.token));
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toBe(first.body.items[1].id);

    const second = await request(app)
      .get(`/notifications?limit=2&cursor=${first.body.nextCursor}`)
      .set(authHeader(tenant.token));

    const firstIds = first.body.items.map((i: { id: number }) => i.id);
    const secondIds = second.body.items.map((i: { id: number }) => i.id);
    expect(secondIds.some((id: number) => firstIds.includes(id))).toBe(false);

    const third = await request(app)
      .get(`/notifications?limit=2&cursor=${second.body.nextCursor}`)
      .set(authHeader(tenant.token));
    expect(third.body.items).toHaveLength(1);
    expect(third.body.nextCursor).toBeNull();
  });

  it("clamps the page size so one request cannot pull the whole table", async () => {
    const tenant = await createTenant();
    await seedNotifications(tenant.company.id, tenant.owner.id, 55);

    const res = await request(app)
      .get("/notifications?limit=999")
      .set(authHeader(tenant.token));

    expect(res.body.items).toHaveLength(50);
    expect(res.body.nextCursor).not.toBeNull();
  });

  it("filters to unread on request", async () => {
    const tenant = await createTenant();
    await seedNotifications(tenant.company.id, tenant.owner.id, 2, { read: true });
    await seedNotifications(tenant.company.id, tenant.owner.id, 1, { titlePrefix: "new" });

    const res = await request(app)
      .get("/notifications?unreadOnly=true")
      .set(authHeader(tenant.token));

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].title).toBe("new0");
  });
});

describe("GET /notifications/unread-count — the badge", () => {
  it("counts only the caller's unread rows", async () => {
    const tenant = await createTenant();
    const colleague = await createEmployeeUser(tenant.company.id, tenant.employee.id);

    await seedNotifications(tenant.company.id, tenant.owner.id, 3);
    await seedNotifications(tenant.company.id, tenant.owner.id, 2, { read: true });
    await seedNotifications(tenant.company.id, colleague.user.id, 7);

    const res = await request(app)
      .get("/notifications/unread-count")
      .set(authHeader(tenant.token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ unread: 3 });
  });
});

describe("POST /notifications/:id/read", () => {
  it("marks one notification read and stays idempotent", async () => {
    const tenant = await createTenant();
    await seedNotifications(tenant.company.id, tenant.owner.id, 1);
    const notification = (await prisma.notification.findFirst())!;

    const first = await request(app)
      .post(`/notifications/${notification.id}/read`)
      .set(authHeader(tenant.token));

    expect(first.status).toBe(200);
    expect(first.body.readAt).not.toBeNull();

    // A double click must not move the timestamp — the read moment is a fact
    // about the user, not about how many times the button was pressed.
    const second = await request(app)
      .post(`/notifications/${notification.id}/read`)
      .set(authHeader(tenant.token));

    expect(second.status).toBe(200);
    expect(second.body.readAt).toBe(first.body.readAt);
  });

  it("404s on a colleague's notification without touching it", async () => {
    const tenant = await createTenant();
    const colleague = await createEmployeeUser(tenant.company.id, tenant.employee.id);
    await seedNotifications(tenant.company.id, colleague.user.id, 1);
    const theirs = (await prisma.notification.findFirst())!;

    const res = await request(app)
      .post(`/notifications/${theirs.id}/read`)
      .set(authHeader(tenant.token));

    expect(res.status).toBe(404);
    const after = await prisma.notification.findUnique({ where: { id: theirs.id } });
    expect(after!.readAt).toBeNull();
  });

  it("rejects a non-numeric id", async () => {
    const tenant = await createTenant();
    const res = await request(app)
      .post("/notifications/not-a-number/read")
      .set(authHeader(tenant.token));

    expect(res.status).toBe(400);
  });
});

describe("POST /notifications/read-all", () => {
  it("clears the caller's badge and nobody else's", async () => {
    const tenant = await createTenant();
    const colleague = await createEmployeeUser(tenant.company.id, tenant.employee.id);
    await seedNotifications(tenant.company.id, tenant.owner.id, 4);
    await seedNotifications(tenant.company.id, colleague.user.id, 2);

    const res = await request(app)
      .post("/notifications/read-all")
      .set(authHeader(tenant.token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 4 });

    expect(
      await prisma.notification.count({ where: { userId: tenant.owner.id, readAt: null } })
    ).toBe(0);
    expect(
      await prisma.notification.count({ where: { userId: colleague.user.id, readAt: null } })
    ).toBe(2);
  });
});

describe("GET /notifications/preferences — the three-level view", () => {
  it("shows every configurable category, mandatory ones locked on, ops never", async () => {
    const tenant = await createTenant();

    const res = await request(app)
      .get("/notifications/preferences")
      .set(authHeader(tenant.token));

    expect(res.status).toBe(200);
    expect(res.body.channels).toEqual(["EMAIL", "IN_APP"]);

    const categories = res.body.categories.map((c: { category: string }) => c.category);
    // ops is DEVELOPER-internal and must never appear on a tenant screen.
    expect(categories).not.toContain("ops");
    expect(categories).toContain("security");
    expect(categories).toContain("marketing");

    const security = categoryOf(res.body, "security");
    expect(security.mandatory).toBe(true);
    expect(security.channels.EMAIL.effective).toBe(true);
  });

  it("reports an opt-in category as off before anyone opts in", async () => {
    const tenant = await createTenant();

    const res = await request(app)
      .get("/notifications/preferences")
      .set(authHeader(tenant.token));

    const marketing = categoryOf(res.body, "marketing");
    expect(marketing.optIn).toBe(true);
    expect(marketing.channels.EMAIL).toMatchObject({
      effective: false,
      user: null,
      company: null,
      registry: false,
    });
  });

  it("surfaces the company kill switch as a block, without rewriting the chain", async () => {
    const tenant = await createTenant();
    await prisma.company.update({
      where: { id: tenant.company.id },
      data: { notificationsEnabled: false },
    });

    const res = await request(app)
      .get("/notifications/preferences")
      .set(authHeader(tenant.token));

    const projects = categoryOf(res.body, "projects");
    // The preference itself still resolves to "on" — the company toggle is a
    // separate gate in front of it, and conflating the two would hide which
    // switch the user has to flip.
    expect(projects.channels.EMAIL.effective).toBe(true);
    expect(projects.channels.EMAIL.blockedBy).toBe("company_notifications_off");
    expect(res.body.company.notificationsEnabled).toBe(false);
  });

  it("marks an owner as able to edit the company default, an employee not", async () => {
    const tenant = await createTenant();
    const employee = await createEmployeeUser(tenant.company.id, tenant.employee.id);

    const asOwner = await request(app)
      .get("/notifications/preferences")
      .set(authHeader(tenant.token));
    const asEmployee = await request(app)
      .get("/notifications/preferences")
      .set(authHeader(employee.token));

    expect(asOwner.body.canEditDefaults).toBe(true);
    expect(asEmployee.body.canEditDefaults).toBe(false);
  });

  it("answers for a DEVELOPER, who belongs to no company", async () => {
    const developer = await createDeveloper();

    const res = await request(app)
      .get("/notifications/preferences")
      .set(authHeader(developer.token));

    expect(res.status).toBe(200);
    expect(res.body.company).toBeNull();
    expect(res.body.canEditDefaults).toBe(false);
  });

  it("treats a junk companyId as absent rather than passing NaN to the database", async () => {
    const developer = await createDeveloper();

    for (const query of ["?companyId=abc", "?companyId=", "?companyId=1&companyId=2"]) {
      const res = await request(app)
        .get(`/notifications/preferences${query}`)
        .set(authHeader(developer.token));

      expect(res.status).toBe(200);
      expect(res.body.company).toBeNull();
    }
  });
});

describe("PUT /notifications/preferences — my own overrides", () => {
  it("writes the user level and leaves the company level alone", async () => {
    const tenant = await createTenant();

    const res = await request(app)
      .put("/notifications/preferences")
      .set(authHeader(tenant.token))
      .send({ preferences: [{ category: "projects", channel: "EMAIL", enabled: false }] });

    expect(res.status).toBe(200);
    expect(categoryOf(res.body, "projects").channels.EMAIL).toMatchObject({
      effective: false,
      user: false,
      company: null,
    });

    const rows = await prisma.notificationPreference.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(tenant.owner.id);
  });

  it("clears an override with null, falling back to the company default", async () => {
    const tenant = await createTenant();
    await prisma.notificationPreference.createMany({
      data: [
        {
          companyId: tenant.company.id,
          userId: null,
          category: "projects",
          channel: "EMAIL",
          enabled: false,
        },
        {
          companyId: tenant.company.id,
          userId: tenant.owner.id,
          category: "projects",
          channel: "EMAIL",
          enabled: true,
        },
      ],
    });

    const res = await request(app)
      .put("/notifications/preferences")
      .set(authHeader(tenant.token))
      .send({ preferences: [{ category: "projects", channel: "EMAIL", enabled: null }] });

    expect(res.status).toBe(200);
    // "Inherit" is a real state: the user row is gone and the company default
    // is back in charge.
    expect(categoryOf(res.body, "projects").channels.EMAIL).toMatchObject({
      effective: false,
      user: null,
      company: false,
    });
    expect(
      await prisma.notificationPreference.count({ where: { userId: tenant.owner.id } })
    ).toBe(0);
  });

  it("refuses to switch off a mandatory category", async () => {
    // Q2: silencing a security or critical billing notice harms the recipient.
    // Refused rather than clamped — a stored row saying enabled=false that the
    // gate ignores would be a lie in the database.
    const tenant = await createTenant();

    for (const category of ["security", "billing"]) {
      const res = await request(app)
        .put("/notifications/preferences")
        .set(authHeader(tenant.token))
        .send({ preferences: [{ category, channel: "EMAIL", enabled: false }] });

      expect(res.status).toBe(400);
    }

    expect(await prisma.notificationPreference.count()).toBe(0);
  });

  it("refuses categories and channels outside the allow-list", async () => {
    const tenant = await createTenant();

    const bodies = [
      { preferences: [{ category: "ops", channel: "EMAIL", enabled: false }] },
      { preferences: [{ category: "nonsense", channel: "EMAIL", enabled: false }] },
      // PUSH is in the column vocabulary but has no transport — a switch
      // wired to nothing must not be storable.
      { preferences: [{ category: "projects", channel: "PUSH", enabled: false }] },
      { preferences: [{ category: "projects", channel: "EMAIL", enabled: "no" }] },
      { preferences: [] },
      { preferences: "everything-off" },
      {},
    ];

    for (const body of bodies) {
      const res = await request(app)
        .put("/notifications/preferences")
        .set(authHeader(tenant.token))
        .send(body);

      expect(res.status).toBe(400);
    }

    expect(await prisma.notificationPreference.count()).toBe(0);
  });

  it("rejects the whole batch when one entry is invalid", async () => {
    // Partial application would leave the screen and the database disagreeing
    // about what was saved.
    const tenant = await createTenant();

    const res = await request(app)
      .put("/notifications/preferences")
      .set(authHeader(tenant.token))
      .send({
        preferences: [
          { category: "projects", channel: "EMAIL", enabled: false },
          { category: "security", channel: "EMAIL", enabled: false },
        ],
      });

    expect(res.status).toBe(400);
    expect(await prisma.notificationPreference.count()).toBe(0);
  });

  it("lets an EMPLOYEE set their own preferences", async () => {
    // Level 3 exists precisely because a mixed team is not one preference.
    const tenant = await createTenant();
    const employee = await createEmployeeUser(tenant.company.id, tenant.employee.id);

    const res = await request(app)
      .put("/notifications/preferences")
      .set(authHeader(employee.token))
      .send({ preferences: [{ category: "employees", channel: "EMAIL", enabled: false }] });

    expect(res.status).toBe(200);
    const rows = await prisma.notificationPreference.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(employee.user.id);
  });

  it("400s for a user with no company at all", async () => {
    const developer = await createDeveloper();

    const res = await request(app)
      .put("/notifications/preferences")
      .set(authHeader(developer.token))
      .send({ preferences: [{ category: "projects", channel: "EMAIL", enabled: false }] });

    expect(res.status).toBe(400);
  });
});

describe("PUT /notifications/preferences/defaults — the company level", () => {
  it("writes a company default an employee then inherits", async () => {
    const tenant = await createTenant();
    const employee = await createEmployeeUser(tenant.company.id, tenant.employee.id);

    const saved = await request(app)
      .put("/notifications/preferences/defaults")
      .set(authHeader(tenant.token))
      .send({ preferences: [{ category: "projects", channel: "EMAIL", enabled: false }] });

    expect(saved.status).toBe(200);

    const asEmployee = await request(app)
      .get("/notifications/preferences")
      .set(authHeader(employee.token));

    expect(categoryOf(asEmployee.body, "projects").channels.EMAIL).toMatchObject({
      effective: false,
      user: null,
      company: false,
    });
  });

  it("refuses an EMPLOYEE", async () => {
    const tenant = await createTenant();
    const employee = await createEmployeeUser(tenant.company.id, tenant.employee.id);

    const res = await request(app)
      .put("/notifications/preferences/defaults")
      .set(authHeader(employee.token))
      .send({ preferences: [{ category: "projects", channel: "EMAIL", enabled: false }] });

    expect(res.status).toBe(403);
    expect(await prisma.notificationPreference.count()).toBe(0);
  });

  it("keeps exactly one row per slot however many times it is saved", async () => {
    // The composite unique does NOT cover company-default rows: PostgreSQL
    // treats NULLs in a unique index as distinct (the N1.1 known limitation),
    // so nothing in the schema stops a second row. The write path is
    // delete-then-create for exactly this reason.
    const tenant = await createTenant();

    for (const enabled of [false, true, false]) {
      const res = await request(app)
        .put("/notifications/preferences/defaults")
        .set(authHeader(tenant.token))
        .send({ preferences: [{ category: "projects", channel: "EMAIL", enabled }] });
      expect(res.status).toBe(200);
    }

    const rows = await prisma.notificationPreference.findMany({
      where: { companyId: tenant.company.id, userId: null, category: "projects", channel: "EMAIL" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].enabled).toBe(false);
  });

  it("collapses duplicates a previous race left behind", async () => {
    const tenant = await createTenant();
    // Two contradictory company defaults for the same slot — impossible to
    // create through the API, possible in the database, and until now
    // impossible to clean up from the UI.
    await prisma.notificationPreference.createMany({
      data: [
        { companyId: tenant.company.id, userId: null, category: "digest", channel: "EMAIL", enabled: true },
        { companyId: tenant.company.id, userId: null, category: "digest", channel: "EMAIL", enabled: false },
      ],
    });

    await request(app)
      .put("/notifications/preferences/defaults")
      .set(authHeader(tenant.token))
      .send({ preferences: [{ category: "digest", channel: "EMAIL", enabled: true }] });

    const rows = await prisma.notificationPreference.findMany({
      where: { companyId: tenant.company.id, userId: null, category: "digest" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].enabled).toBe(true);
  });

  it("ignores a companyId smuggled in the body", async () => {
    // resolveCompanyId only consults the body for a DEVELOPER, who has no
    // company of their own. A tenant owner is pinned to their JWT's company.
    const a = await createTenant();
    const b = await createTenant();

    const res = await request(app)
      .put("/notifications/preferences/defaults")
      .set(authHeader(a.token))
      .send({
        companyId: b.company.id,
        preferences: [{ category: "projects", channel: "EMAIL", enabled: false }],
      });

    expect(res.status).toBe(200);
    expect(await prisma.notificationPreference.count({ where: { companyId: b.company.id } })).toBe(0);
    expect(await prisma.notificationPreference.count({ where: { companyId: a.company.id } })).toBe(1);
  });
});

describe("read-only mode", () => {
  // Read-only is a BILLING state: it stops a lapsed company from editing its
  // data. It must not stop a user from reading and clearing the very notices
  // that explain why they are in it.
  it("still lets a read-only company's owner clear their notifications", async () => {
    const company = await createReadOnlyCompany();
    const owner = await createUser({ companyId: company.id, role: ROLES.BUSINESS_OWNER });
    const token = signAuthToken(owner);
    await seedNotifications(company.id, owner.id, 2);
    const notification = (await prisma.notification.findFirst())!;

    const one = await request(app)
      .post(`/notifications/${notification.id}/read`)
      .set(authHeader(token));
    expect(one.status).toBe(200);

    const all = await request(app).post("/notifications/read-all").set(authHeader(token));
    expect(all.status).toBe(200);
    expect(await prisma.notification.count({ where: { userId: owner.id, readAt: null } })).toBe(0);
  });

  it("still lets them change their own notification preferences", async () => {
    const company = await createReadOnlyCompany();
    const owner = await createUser({ companyId: company.id, role: ROLES.BUSINESS_OWNER });

    const res = await request(app)
      .put("/notifications/preferences")
      .set(authHeader(signAuthToken(owner)))
      .send({ preferences: [{ category: "projects", channel: "EMAIL", enabled: false }] });

    expect(res.status).toBe(200);
  });

  it("blocks the COMPANY default, which is tenant configuration", async () => {
    const company = await createReadOnlyCompany();
    const owner = await createUser({ companyId: company.id, role: ROLES.BUSINESS_OWNER });

    const res = await request(app)
      .put("/notifications/preferences/defaults")
      .set(authHeader(signAuthToken(owner)))
      .send({ preferences: [{ category: "projects", channel: "EMAIL", enabled: false }] });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("READ_ONLY_MODE");
    expect(await prisma.notificationPreference.count()).toBe(0);
  });
});
