import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import { RATE_LIMITS } from "../constants/rateLimits";
import { authHeader, createTenant, TEST_PASSWORD } from "./helpers/factories";

// R1.5 — POST /account/delete re-checks the caller's password, which makes it
// a password oracle for anyone holding a stolen JWT: the attacker already has
// a session, so authentication is no protection. These tests pin the throttle
// that closes it.

const MAX = RATE_LIMITS.ACCOUNT_DELETE.max;

// A tenant whose subscription is already over, so the delete path is not
// short-circuited by the "active subscription" guard before reaching the
// password check.
const deletableTenant = () =>
  createTenant({
    subscriptionStatus: "canceled",
    subscriptionEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
  });

describe("POST /account/delete throttling", () => {
  it("refuses further password guesses once the limit is spent", async () => {
    const t = await deletableTenant();

    let last;
    for (let attempt = 1; attempt <= MAX + 1; attempt += 1) {
      last = await request(app)
        .post("/account/delete")
        .set(authHeader(t.token))
        .send({ password: `Wr0ng!Guess${attempt}`, confirmation: "DELETE" });
    }

    expect(last!.status).toBe(429);
    expect(last!.headers["retry-after"]).toBeDefined();
  });

  it("allows a legitimate attempt well within the limit", async () => {
    const t = await deletableTenant();

    const wrong = await request(app)
      .post("/account/delete")
      .set(authHeader(t.token))
      .send({ password: "Wr0ng!Guess", confirmation: "DELETE" });
    expect(wrong.status).toBe(401);

    const correct = await request(app)
      .post("/account/delete")
      .set(authHeader(t.token))
      .send({ password: TEST_PASSWORD, confirmation: "DELETE" });

    expect(correct.status).toBeLessThan(400);
  });

  it("throttles per USER, so one victim's budget is not another's", async () => {
    const victim = await deletableTenant();
    const other = await deletableTenant();

    for (let attempt = 1; attempt <= MAX + 1; attempt += 1) {
      await request(app)
        .post("/account/delete")
        .set(authHeader(victim.token))
        .send({ password: `Wr0ng!Guess${attempt}`, confirmation: "DELETE" });
    }

    // Same process, same IP — a per-IP limiter would have blocked this too.
    const unaffected = await request(app)
      .post("/account/delete")
      .set(authHeader(other.token))
      .send({ password: "Wr0ng!Guess", confirmation: "DELETE" });

    expect(unaffected.status).toBe(401);
  });

  it("still requires authentication", async () => {
    const res = await request(app)
      .post("/account/delete")
      .send({ password: TEST_PASSWORD, confirmation: "DELETE" });

    expect(res.status).toBe(401);
  });
});
