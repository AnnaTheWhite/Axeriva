import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import prisma from "../database/prisma";
import { LIMITS } from "../constants/limits";
import { authHeader, createTenant } from "./helpers/factories";

// S2.2 — the Limit Registry is the single source of plan ceilings, so these
// tests read the expected numbers FROM the registry rather than hardcoding
// them. Changing a limit in constants/limits.ts must not silently break the
// suite (or silently pass it): the test follows the registry, and what it
// really asserts is that the ceiling is enforced at all, on the right plan,
// at creation time only.

const STARTER_PROJECTS = LIMITS.projects.starter;
const STARTER_EMPLOYEES = LIMITS.employees.starter;

// Seeds rows directly so a limit test doesn't spend 25 HTTP round-trips
// getting to the interesting request.
async function fillProjects(companyId: number, count: number) {
  await prisma.project.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      name: `Seeded project ${i}`,
      companyId,
    })),
  });
}

async function fillEmployees(companyId: number, count: number) {
  await prisma.employee.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      firstName: "Seeded",
      lastName: `Employee ${i}`,
      companyId,
    })),
  });
}

describe("project creation limit", () => {
  it("allows creation while the company is under its plan ceiling", async () => {
    const t = await createTenant({ plan: "starter" });
    // createTenant already made one project.
    await fillProjects(t.company.id, STARTER_PROJECTS - 2);

    const res = await request(app)
      .post("/projects")
      .set(authHeader(t.token))
      .send({ name: "One below the ceiling" });

    expect(res.status).toBe(201);
  });

  it("refuses creation once the ceiling is reached", async () => {
    const t = await createTenant({ plan: "starter" });
    await fillProjects(t.company.id, STARTER_PROJECTS - 1);
    expect(await prisma.project.count({ where: { companyId: t.company.id } })).toBe(
      STARTER_PROJECTS
    );

    const res = await request(app)
      .post("/projects")
      .set(authHeader(t.token))
      .send({ name: "One too many" });

    expect(res.status).toBe(403);
    expect(await prisma.project.count({ where: { companyId: t.company.id } })).toBe(
      STARTER_PROJECTS
    );
  });

  it("counts only the caller's own company towards the ceiling", async () => {
    const t = await createTenant({ plan: "starter" });
    const other = await createTenant({ plan: "starter" });
    await fillProjects(other.company.id, STARTER_PROJECTS + 10);

    const res = await request(app)
      .post("/projects")
      .set(authHeader(t.token))
      .send({ name: "Unaffected by the neighbour" });

    expect(res.status).toBe(201);
  });

  it("gives a higher plan a higher ceiling", async () => {
    const t = await createTenant({ plan: "professional" });
    await fillProjects(t.company.id, STARTER_PROJECTS + 5);

    const res = await request(app)
      .post("/projects")
      .set(authHeader(t.token))
      .send({ name: "Past the starter ceiling" });

    expect(res.status).toBe(201);
  });

  it("treats the hidden founder plan as unlimited", async () => {
    const t = await createTenant({ plan: "founder" });
    await fillProjects(t.company.id, LIMITS.projects.business + 1);

    const res = await request(app)
      .post("/projects")
      .set(authHeader(t.token))
      .send({ name: "Founder is unlimited" });

    expect(res.status).toBe(201);
  });

  it("keeps the legacy 'pro' plan unlimited until the data migration runs", async () => {
    const t = await createTenant({ plan: "pro" });
    await fillProjects(t.company.id, LIMITS.projects.professional + 1);

    const res = await request(app)
      .post("/projects")
      .set(authHeader(t.token))
      .send({ name: "Legacy pro keeps working" });

    expect(res.status).toBe(201);
  });

  it("resolves the legacy 'free' plan to starter's ceiling", async () => {
    const t = await createTenant({ plan: "free" });
    await fillProjects(t.company.id, STARTER_PROJECTS - 1);

    const res = await request(app)
      .post("/projects")
      .set(authHeader(t.token))
      .send({ name: "One too many" });

    expect(res.status).toBe(403);
  });

  it("never deletes existing rows when a company is over the ceiling (creation-time only)", async () => {
    const t = await createTenant({ plan: "professional" });
    await fillProjects(t.company.id, LIMITS.projects.professional + 5);
    const before = await prisma.project.count({ where: { companyId: t.company.id } });

    // Simulate a downgrade to a plan whose ceiling is already exceeded.
    await prisma.company.update({ where: { id: t.company.id }, data: { plan: "starter" } });

    const create = await request(app)
      .post("/projects")
      .set(authHeader(t.token))
      .send({ name: "Blocked" });
    expect(create.status).toBe(403);

    // Reads and existing data are untouched.
    const list = await request(app).get("/projects").set(authHeader(t.token));
    expect(list.status).toBe(200);
    expect(await prisma.project.count({ where: { companyId: t.company.id } })).toBe(before);
  });
});

describe("employee invitation limit", () => {
  it("allows an invite while under the ceiling", async () => {
    const t = await createTenant({ plan: "starter" });
    await fillEmployees(t.company.id, STARTER_EMPLOYEES - 2);

    const res = await request(app)
      .post("/invites")
      .set(authHeader(t.token))
      .send({ email: "newhire@example.com" });

    expect(res.status).toBeLessThan(400);
  });

  it("refuses an invite once the employee ceiling is reached", async () => {
    const t = await createTenant({ plan: "starter" });
    await fillEmployees(t.company.id, STARTER_EMPLOYEES - 1);

    const res = await request(app)
      .post("/invites")
      .set(authHeader(t.token))
      .send({ email: "onetoomany@example.com" });

    expect(res.status).toBe(403);
    expect(await prisma.invitation.count({ where: { companyId: t.company.id } })).toBe(0);
  });

  it("is enforced against the inviting company only", async () => {
    const t = await createTenant({ plan: "starter" });
    const other = await createTenant({ plan: "starter" });
    await fillEmployees(other.company.id, STARTER_EMPLOYEES + 5);

    const res = await request(app)
      .post("/invites")
      .set(authHeader(t.token))
      .send({ email: "unaffected@example.com" });

    expect(res.status).toBeLessThan(400);
  });
});
