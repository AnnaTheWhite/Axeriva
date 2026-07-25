import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import prisma from "../database/prisma";
import { createTenant, authHeader } from "./helpers/factories";

// Proves the harness itself works: the app mounts without listening, the
// throwaway database is migrated and reachable, and the factories produce a
// tenant whose token the real auth middleware accepts.
describe("test harness", () => {
  it("serves /health without auth or a database", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.environment).toBe("test");
  });

  it("runs against a migrated, empty database", async () => {
    expect(await prisma.company.count()).toBe(0);
    expect(await prisma.user.count()).toBe(0);
  });

  it("mints tokens the real auth middleware accepts", async () => {
    const tenant = await createTenant();

    const res = await request(app).get("/employees").set(authHeader(tenant.token));

    expect(res.status).toBe(200);
  });

  it("rejects an unauthenticated request to a protected route", async () => {
    const res = await request(app).get("/employees");

    expect(res.status).toBe(401);
  });
});
