import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import prisma from "../database/prisma";
import { READ_ONLY_ERROR } from "../middleware/readOnly.middleware";
import {
  authHeader,
  createDeveloper,
  createTenant,
} from "./helpers/factories";

// S2.7 — a company whose trial or subscription has lapsed keeps full READ
// access and loses WRITE access. The guard is mounted per-router in app.ts,
// so these tests deliberately probe several different routers: the point is
// that enforcement comes from the mount, not from per-controller checks.

// A tenant whose trial ended yesterday.
const lapsed = () =>
  createTenant({
    subscriptionStatus: "trialing",
    subscriptionEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
  });

describe("reads stay available in read-only mode", () => {
  it("GET /employees still works", async () => {
    const t = await lapsed();
    const res = await request(app).get("/employees").set(authHeader(t.token));
    expect(res.status).toBe(200);
  });

  it("GET /projects still works", async () => {
    const t = await lapsed();
    const res = await request(app).get("/projects").set(authHeader(t.token));
    expect(res.status).toBe(200);
  });

  it("GET /customers still works", async () => {
    const t = await lapsed();
    const res = await request(app).get("/customers").set(authHeader(t.token));
    expect(res.status).toBe(200);
  });
});

describe("writes are refused in read-only mode", () => {
  it("POST /customers is refused with READ_ONLY_MODE", async () => {
    const t = await lapsed();

    const res = await request(app)
      .post("/customers")
      .set(authHeader(t.token))
      .send({ name: "New customer" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe(READ_ONLY_ERROR);
    expect(await prisma.customer.count({ where: { companyId: t.company.id } })).toBe(1);
  });

  it("POST /projects is refused", async () => {
    const t = await lapsed();

    const res = await request(app)
      .post("/projects")
      .set(authHeader(t.token))
      .send({ name: "New project" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe(READ_ONLY_ERROR);
  });

  it("PUT /customers/:id is refused", async () => {
    const t = await lapsed();

    const res = await request(app)
      .put(`/customers/${t.customer.id}`)
      .set(authHeader(t.token))
      .send({ name: "Renamed" });

    expect(res.status).toBe(403);
  });

  it("DELETE /projects/:id is refused", async () => {
    const t = await lapsed();

    const res = await request(app)
      .delete(`/projects/${t.project.id}`)
      .set(authHeader(t.token));

    expect(res.status).toBe(403);
    expect(await prisma.project.findUnique({ where: { id: t.project.id } })).not.toBeNull();
  });

  it("PUT /company/settings is refused", async () => {
    const t = await lapsed();

    const res = await request(app)
      .put("/company/settings")
      .set(authHeader(t.token))
      .send({ name: "Renamed Co" });

    expect(res.status).toBe(403);
  });

  it("POST /owner-notes is refused", async () => {
    const t = await lapsed();

    const res = await request(app)
      .post("/owner-notes")
      .set(authHeader(t.token))
      .send({ title: "Note", content: "Body" });

    expect(res.status).toBe(403);
  });
});

describe("escape hatches stay open", () => {
  it("an active trial is NOT read-only", async () => {
    const t = await createTenant();

    const res = await request(app)
      .post("/customers")
      .set(authHeader(t.token))
      .send({ name: "New customer" });

    expect(res.status).toBeLessThan(400);
  });

  it("/subscription stays reachable so the owner can resubscribe", async () => {
    const t = await lapsed();

    const res = await request(app).get("/subscription").set(authHeader(t.token));

    expect(res.status).toBe(200);
  });

  it("/access/read-only reports the state to the frontend", async () => {
    const t = await lapsed();

    const res = await request(app).get("/access/read-only").set(authHeader(t.token));

    expect(res.status).toBe(200);
    expect(res.body.readOnly).toBe(true);
  });

  it("a DEVELOPER (no company) is never read-only", async () => {
    const developer = await createDeveloper();

    const res = await request(app).get("/admin/analytics/overview").set(authHeader(developer.token));

    expect(res.status).toBe(200);
  });
});

describe("manually managed plans are never read-only", () => {
  it("a founder company can still write with an elapsed period", async () => {
    const t = await createTenant({
      plan: "founder",
      subscriptionStatus: "canceled",
      subscriptionEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });

    const res = await request(app)
      .post("/customers")
      .set(authHeader(t.token))
      .send({ name: "Founder customer" });

    expect(res.status).toBeLessThan(400);
  });

  it("an enterprise company can still write with an elapsed period", async () => {
    const t = await createTenant({
      plan: "enterprise",
      subscriptionStatus: "inactive",
      subscriptionEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });

    const res = await request(app)
      .post("/customers")
      .set(authHeader(t.token))
      .send({ name: "Enterprise customer" });

    expect(res.status).toBeLessThan(400);
  });
});

describe("lapse conditions", () => {
  it("an inactive subscription (never subscribed, no trial) is read-only", async () => {
    const t = await createTenant({
      subscriptionStatus: "inactive",
      subscriptionEndsAt: null,
    });

    const res = await request(app)
      .post("/customers")
      .set(authHeader(t.token))
      .send({ name: "Nope" });

    expect(res.status).toBe(403);
  });

  it("a past_due subscription is read-only", async () => {
    const t = await createTenant({
      subscriptionStatus: "past_due",
      subscriptionEndsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const res = await request(app)
      .post("/customers")
      .set(authHeader(t.token))
      .send({ name: "Nope" });

    expect(res.status).toBe(403);
  });

  it("an active subscription with no end date is NOT read-only", async () => {
    const t = await createTenant({
      subscriptionStatus: "active",
      subscriptionEndsAt: null,
    });

    const res = await request(app)
      .post("/customers")
      .set(authHeader(t.token))
      .send({ name: "Allowed" });

    expect(res.status).toBeLessThan(400);
  });
});
