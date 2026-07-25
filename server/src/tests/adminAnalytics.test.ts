import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import prisma from "../database/prisma";
import { authHeader, createCompany, createDeveloper, createUser } from "./helpers/factories";

// Regression cover for the one behavioural difference the SQLite -> PostgreSQL
// migration changed in application output rather than in SQL syntax.
//
// `lastLoginAt` is nullable and null means "never signed in". SQLite orders
// NULL as the SMALLEST value (first on ASC, last on DESC); PostgreSQL orders
// it as the LARGEST (last on ASC, first on DESC). Sorting the admin users
// table by "Last login" descending therefore inverted on the switch: every
// never-logged-in account jumped to the top of page 1, pushing the actually
// recent logins out of view.
//
// These tests only diverge between the two engines once null and non-null
// rows coexist, which is why nothing caught it before.

const DAY = 24 * 60 * 60 * 1000;

// Three users: two that have signed in (at different times) and one that never
// has. Emails encode the expectation so a failure message is readable.
async function seedUsersWithMixedLogins() {
  const company = await createCompany();

  const recent = await createUser({ companyId: company.id, email: "recent@example.com" });
  const older = await createUser({ companyId: company.id, email: "older@example.com" });
  const never = await createUser({ companyId: company.id, email: "never@example.com" });

  await prisma.user.update({
    where: { id: recent.id },
    data: { lastLoginAt: new Date(Date.now() - 1 * DAY) },
  });
  await prisma.user.update({
    where: { id: older.id },
    data: { lastLoginAt: new Date(Date.now() - 10 * DAY) },
  });
  // `never` keeps lastLoginAt = null.

  return { company, recent, older, never };
}

// The DEVELOPER doing the querying has never logged in either (the factory
// does not set lastLoginAt), so it is a second null row — which makes the
// ordering assertions stricter, not weaker.
function emailsOf(body: { users: { email: string; lastLoginAt: string | null }[] }) {
  return body.users.map((u) => u.email);
}

describe("GET /admin/analytics/users — lastLoginAt null ordering", () => {
  it("puts never-logged-in users LAST when sorting by last login descending", async () => {
    await seedUsersWithMixedLogins();
    const developer = await createDeveloper();

    const res = await request(app)
      .get("/admin/analytics/users?sortBy=lastLoginAt&sortDir=desc")
      .set(authHeader(developer.token));

    expect(res.status).toBe(200);

    const emails = emailsOf(res.body);
    // Most recent first, then the older login, then everyone who never signed in.
    expect(emails[0]).toBe("recent@example.com");
    expect(emails[1]).toBe("older@example.com");
    expect(emails.slice(2)).toContain("never@example.com");
  });

  it("also puts them last when sorting ascending", async () => {
    await seedUsersWithMixedLogins();
    const developer = await createDeveloper();

    const res = await request(app)
      .get("/admin/analytics/users?sortBy=lastLoginAt&sortDir=asc")
      .set(authHeader(developer.token));

    expect(res.status).toBe(200);

    const emails = emailsOf(res.body);
    expect(emails[0]).toBe("older@example.com");
    expect(emails[1]).toBe("recent@example.com");
    expect(emails.slice(2)).toContain("never@example.com");
  });

  it("never reports a non-null lastLoginAt after a null one", async () => {
    await seedUsersWithMixedLogins();
    const developer = await createDeveloper();

    const res = await request(app)
      .get("/admin/analytics/users?sortBy=lastLoginAt&sortDir=desc")
      .set(authHeader(developer.token));

    const values = res.body.users.map((u: { lastLoginAt: string | null }) => u.lastLoginAt);
    const firstNull = values.findIndex((v: string | null) => v === null);

    if (firstNull !== -1) {
      // Everything after the first null must also be null.
      expect(values.slice(firstNull).every((v: string | null) => v === null)).toBe(true);
    }
  });

  it("leaves sorting by a NON-nullable column unaffected", async () => {
    await seedUsersWithMixedLogins();
    const developer = await createDeveloper();

    const res = await request(app)
      .get("/admin/analytics/users?sortBy=email&sortDir=asc")
      .set(authHeader(developer.token));

    expect(res.status).toBe(200);

    const emails = emailsOf(res.body);
    expect(emails).toEqual([...emails].sort());
  });

  it("applies the same ordering to the export endpoint", async () => {
    await seedUsersWithMixedLogins();
    const developer = await createDeveloper();

    const res = await request(app)
      .get("/admin/analytics/users/export?sortBy=lastLoginAt&sortDir=desc")
      .set(authHeader(developer.token));

    expect(res.status).toBe(200);

    const rows = Array.isArray(res.body) ? res.body : res.body.users;
    const values = rows.map((u: { lastLoginAt: string | null }) => u.lastLoginAt);
    const firstNull = values.findIndex((v: string | null) => v === null);

    if (firstNull !== -1) {
      expect(values.slice(firstNull).every((v: string | null) => v === null)).toBe(true);
    }
  });
});

describe("GET /admin/analytics/overview on an empty database", () => {
  // Production starts from a completely empty PostgreSQL, so the very first
  // thing an operator loads is this dashboard with zero rows everywhere.
  it("returns zeroes rather than failing on empty aggregates", async () => {
    const developer = await createDeveloper();

    const res = await request(app)
      .get("/admin/analytics/overview")
      .set(authHeader(developer.token));

    expect(res.status).toBe(200);
    expect(res.body.companies).toBe(0);
    expect(res.body.projects).toBe(0);
    // The DEVELOPER itself is the only user.
    expect(res.body.totalUsers).toBe(1);
    expect(Array.isArray(res.body.planBreakdown)).toBe(true);
  });

  it("serves the storage endpoint with no attachments at all", async () => {
    const developer = await createDeveloper();

    const res = await request(app)
      .get("/admin/analytics/storage")
      .set(authHeader(developer.token));

    expect(res.status).toBe(200);
    expect(res.body.totalBytes).toBe(0);
    // Guards the divide-by-zero path: companyCount is 0 here.
    expect(res.body.avgBytesPerCompany).toBe(0);
    expect(res.body.topCompanies).toEqual([]);
  });

  it("serves the charts endpoint with almost nothing to group", async () => {
    const developer = await createDeveloper();

    const res = await request(app)
      .get("/admin/analytics/charts")
      .set(authHeader(developer.token));

    expect(res.status).toBe(200);

    // No companies and no projects have ever existed → genuinely empty series.
    expect(res.body.companyGrowth).toEqual([]);
    expect(res.body.projectCreations).toEqual([]);

    // The DEVELOPER account is itself a registration inside the 30-day window,
    // so this series has exactly one bucket. Asserting its SHAPE is the point:
    // `date` must be a plain YYYY-MM-DD string (to_char), not a serialized
    // Date, and `count` a number rather than the BigInt Postgres returns for
    // COUNT(*) — both are exactly what the SQLite -> Postgres port had to
    // preserve.
    expect(res.body.userRegistrations).toHaveLength(1);
    expect(res.body.userRegistrations[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof res.body.userRegistrations[0].count).toBe("number");
    expect(res.body.userRegistrations[0].count).toBe(1);
  });
});
