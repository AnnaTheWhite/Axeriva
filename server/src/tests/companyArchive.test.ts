import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import prisma from "../database/prisma";
import { RATE_LIMITS } from "../constants/rateLimits";
import { AUDIT_ACTIONS } from "../constants/auditActions";
import {
  authHeader,
  createEmployeeUser,
  createTenant,
  TEST_PASSWORD,
} from "./helpers/factories";

// B2 — POST /company/archive. The first tests this route has ever had.
//
// The route sets Company.active=false, which auth.middleware.ts turns into a
// blanket 401 for every user of the company on every request — including
// /subscription/cancel and /subscription/portal, so archiving with a live
// Stripe subscription would leave the customer being billed with no in-app
// way to stop it. These tests pin the guard that prevents that, the password
// throttle (same oracle as /account/delete), and the basic auth gates.

const MAX = RATE_LIMITS.COMPANY_ARCHIVE.max;

const ARCHIVE_BODY = { password: TEST_PASSWORD, confirmation: "ARCHIVE" };

// A company whose subscription is genuinely billed: an "alive" status AND a
// Stripe subscription behind it. The factory default leaves
// stripeSubscriptionId null (like every real company before its first
// Checkout), so billed fixtures must set it explicitly.
const billedTenant = (subscriptionStatus: string) =>
  createTenant({
    subscriptionStatus,
    stripeSubscriptionId: `sub_test_${subscriptionStatus}`,
  });

// A tenant whose subscription is over — the guard must not block this one.
const archivableTenant = () =>
  createTenant({
    subscriptionStatus: "canceled",
    subscriptionEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
  });

describe("POST /company/archive — subscription guard (B2)", () => {
  it("refuses to archive a company with an active billed subscription and leaves it active", async () => {
    const t = await billedTenant("active");

    const res = await request(app)
      .post("/company/archive")
      .set(authHeader(t.token))
      .send(ARCHIVE_BODY);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/subscription/i);

    // The status code alone is not the point — the company must be untouched.
    const company = await prisma.company.findUnique({ where: { id: t.company.id } });
    expect(company!.active).toBe(true);
    expect(company!.deletedAt).toBeNull();
  });

  it("refuses past_due — a failed renewal is still being billed", async () => {
    // This is exactly the case readOnly.ts's hasActiveSubscription() would
    // wrongly let through (it omits past_due); the guard must not be built
    // on that helper. This test pins the decision.
    const t = await billedTenant("past_due");

    const res = await request(app)
      .post("/company/archive")
      .set(authHeader(t.token))
      .send(ARCHIVE_BODY);

    expect(res.status).toBe(409);

    const company = await prisma.company.findUnique({ where: { id: t.company.id } });
    expect(company!.active).toBe(true);
  });

  it("refuses a Stripe-backed trial — it will charge at period end", async () => {
    const t = await billedTenant("trialing");

    const res = await request(app)
      .post("/company/archive")
      .set(authHeader(t.token))
      .send(ARCHIVE_BODY);

    expect(res.status).toBe(409);
  });

  it("archives a registration trial — no Stripe subscription, nothing will ever charge", async () => {
    // Factory default: subscriptionStatus "trialing", stripeSubscriptionId
    // null — the state every company is in right after registration.
    const t = await createTenant();

    const res = await request(app)
      .post("/company/archive")
      .set(authHeader(t.token))
      .send(ARCHIVE_BODY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ archived: true });

    const company = await prisma.company.findUnique({ where: { id: t.company.id } });
    expect(company!.active).toBe(false);
    expect(company!.deletedAt).not.toBeNull();
  });

  it("archives a company whose subscription is canceled and elapsed", async () => {
    const t = await archivableTenant();

    const res = await request(app)
      .post("/company/archive")
      .set(authHeader(t.token))
      .send(ARCHIVE_BODY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ archived: true });

    const company = await prisma.company.findUnique({ where: { id: t.company.id } });
    expect(company!.active).toBe(false);
  });

  it("writes an audit entry for the blocked attempt", async () => {
    const t = await billedTenant("active");

    await request(app)
      .post("/company/archive")
      .set(authHeader(t.token))
      .send(ARCHIVE_BODY);

    const entry = await prisma.auditLog.findFirst({
      where: {
        action: AUDIT_ACTIONS.COMPANY_ARCHIVE_BLOCKED_SUBSCRIPTION,
        companyId: t.company.id,
      },
    });

    expect(entry).not.toBeNull();
    expect(entry!.userId).toBe(t.owner.id);
    expect(JSON.parse(entry!.metadata!)).toEqual({ subscriptionStatus: "active" });
  });

  it("checks the password BEFORE the subscription state, so the endpoint is no subscription oracle", async () => {
    const t = await billedTenant("active");

    const res = await request(app)
      .post("/company/archive")
      .set(authHeader(t.token))
      .send({ password: "Wr0ng!Guess", confirmation: "ARCHIVE" });

    // 401, not 409 — a caller with a stolen token but no password learns
    // nothing about the subscription.
    expect(res.status).toBe(401);
  });
});

describe("POST /company/archive — throttling and auth gates", () => {
  it("refuses further password guesses once the limit is spent, per USER", async () => {
    const victim = await billedTenant("active");
    const other = await billedTenant("active");

    let last;
    for (let attempt = 1; attempt <= MAX + 1; attempt += 1) {
      last = await request(app)
        .post("/company/archive")
        .set(authHeader(victim.token))
        .send({ password: `Wr0ng!Guess${attempt}`, confirmation: "ARCHIVE" });
    }

    expect(last!.status).toBe(429);
    expect(last!.headers["retry-after"]).toBeDefined();

    // Same process, same IP — a per-IP limiter would have blocked this too.
    const unaffected = await request(app)
      .post("/company/archive")
      .set(authHeader(other.token))
      .send({ password: "Wr0ng!Guess", confirmation: "ARCHIVE" });

    expect(unaffected.status).toBe(401);
  });

  it("refuses an EMPLOYEE", async () => {
    const t = await archivableTenant();
    const { token } = await createEmployeeUser(t.company.id, t.employee.id);

    const res = await request(app)
      .post("/company/archive")
      .set(authHeader(token))
      .send(ARCHIVE_BODY);

    expect(res.status).toBe(403);
  });

  it("still requires authentication", async () => {
    const res = await request(app).post("/company/archive").send(ARCHIVE_BODY);

    expect(res.status).toBe(401);
  });

  it("locks the owner's existing token out after a successful archive", async () => {
    // This is WHY the guard matters: after archiving, no authMiddleware
    // route answers anymore — /subscription/cancel and /portal included.
    const t = await archivableTenant();

    const archived = await request(app)
      .post("/company/archive")
      .set(authHeader(t.token))
      .send(ARCHIVE_BODY);
    expect(archived.status).toBe(200);

    const afterwards = await request(app)
      .get("/subscription")
      .set(authHeader(t.token));

    expect(afterwards.status).toBe(401);
  });
});
