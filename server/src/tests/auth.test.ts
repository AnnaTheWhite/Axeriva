import { describe, expect, it } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app";
import prisma from "../database/prisma";
import { hashToken } from "../utils/tokenHash";
import { signAuthToken } from "../utils/authToken";
import { PASSWORD_POLICY_MESSAGE } from "../utils/passwordPolicy";
import {
  TEST_PASSWORD,
  authHeader,
  createCompany,
  createTenant,
  createUser,
} from "./helpers/factories";

const VALID_SIGNUP = {
  companyName: "Villanyszerelő Kft",
  email: "owner@example.com",
  password: TEST_PASSWORD,
};

describe("POST /auth/register", () => {
  it("creates the company and owner, and starts the Starter trial", async () => {
    const res = await request(app).post("/auth/register").send(VALID_SIGNUP);

    expect(res.status).toBe(201);

    const user = await prisma.user.findUnique({
      where: { email: VALID_SIGNUP.email },
      include: { company: true },
    });

    expect(user).not.toBeNull();
    expect(user!.role).toBe("BUSINESS_OWNER");
    expect(user!.emailVerified).toBe(false);
    expect(user!.company!.plan).toBe("starter");
    expect(user!.company!.subscriptionStatus).toBe("trialing");
    expect(user!.company!.subscriptionEndsAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("never returns a session token (login is a separate step)", async () => {
    const res = await request(app).post("/auth/register").send(VALID_SIGNUP);

    expect(res.body.token).toBeUndefined();
  });

  it("stores only the HASH of the verification token", async () => {
    await request(app).post("/auth/register").send(VALID_SIGNUP);

    const user = await prisma.user.findUnique({ where: { email: VALID_SIGNUP.email } });

    // 64 hex chars = sha256; the raw 32-byte token only ever exists in the
    // emailed link.
    expect(user!.emailVerificationToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a missing field", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ email: VALID_SIGNUP.email, password: TEST_PASSWORD });

    expect(res.status).toBe(400);
  });

  it("rejects a password that fails the policy", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ ...VALID_SIGNUP, password: "short" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(PASSWORD_POLICY_MESSAGE);
  });

  it("rejects a malformed email", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ ...VALID_SIGNUP, email: "not-an-email" });

    expect(res.status).toBe(400);
  });

  it("answers a duplicate email with the SAME generic success (no enumeration)", async () => {
    const first = await request(app).post("/auth/register").send(VALID_SIGNUP);
    const second = await request(app).post("/auth/register").send(VALID_SIGNUP);

    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);

    // ...and no second account or company was created behind that success.
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.company.count()).toBe(1);
  });
});

describe("POST /auth/login", () => {
  it("returns a token and the user payload for valid credentials", async () => {
    const company = await createCompany();
    const user = await createUser({ companyId: company.id, email: "owner@example.com" });

    const res = await request(app)
      .post("/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.user).toMatchObject({
      id: user.id,
      email: user.email,
      role: "BUSINESS_OWNER",
      companyId: company.id,
    });
  });

  it("never returns the password hash", async () => {
    const company = await createCompany();
    const user = await createUser({ companyId: company.id });

    const res = await request(app)
      .post("/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });

    expect(JSON.stringify(res.body)).not.toContain("$2");
    expect(res.body.user.password).toBeUndefined();
  });

  it("records lastLoginAt", async () => {
    const company = await createCompany();
    const user = await createUser({ companyId: company.id });
    expect(user.lastLoginAt).toBeNull();

    await request(app).post("/auth/login").send({ email: user.email, password: TEST_PASSWORD });

    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(after!.lastLoginAt).not.toBeNull();
  });

  it("gives an unknown email and a wrong password the IDENTICAL response", async () => {
    const company = await createCompany();
    const user = await createUser({ companyId: company.id });

    const wrongPassword = await request(app)
      .post("/auth/login")
      .send({ email: user.email, password: "Wr0ng!Passw0rd" });

    const unknownEmail = await request(app)
      .post("/auth/login")
      .send({ email: "nobody@example.com", password: TEST_PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(wrongPassword.status);
    expect(unknownEmail.body).toEqual(wrongPassword.body);
  });

  it("refuses a soft-deleted user with the same generic error", async () => {
    const company = await createCompany();
    const user = await createUser({ companyId: company.id, active: false });

    const res = await request(app)
      .post("/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid credentials");
  });

  it("refuses a member of a deactivated company", async () => {
    const company = await createCompany({ active: false });
    const user = await createUser({ companyId: company.id });

    const res = await request(app)
      .post("/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });

    expect(res.status).toBe(401);
  });

  it("rate-limits repeated failures for one email with a Retry-After header", async () => {
    const company = await createCompany();
    const user = await createUser({ companyId: company.id });

    let last = await request(app)
      .post("/auth/login")
      .send({ email: user.email, password: "Wr0ng!Passw0rd" });

    // LOGIN_PER_EMAIL allows 5 per window; the 6th must be refused.
    for (let attempt = 2; attempt <= 6; attempt += 1) {
      last = await request(app)
        .post("/auth/login")
        .send({ email: user.email, password: "Wr0ng!Passw0rd" });
    }

    expect(last.status).toBe(429);
    expect(last.headers["retry-after"]).toBeDefined();
  });
});

describe("auth middleware", () => {
  it("rejects a request with no Authorization header", async () => {
    const res = await request(app).get("/employees");
    expect(res.status).toBe(401);
  });

  it("rejects a malformed token", async () => {
    const res = await request(app).get("/employees").set(authHeader("not.a.jwt"));
    expect(res.status).toBe(401);
  });

  it("rejects a well-signed token whose user was soft-deleted", async () => {
    const tenant = await createTenant();
    await prisma.user.update({ where: { id: tenant.owner.id }, data: { active: false } });

    const res = await request(app).get("/employees").set(authHeader(tenant.token));
    expect(res.status).toBe(401);
  });

  it("rejects a token whose COMPANY was deactivated", async () => {
    const tenant = await createTenant();
    await prisma.company.update({ where: { id: tenant.company.id }, data: { active: false } });

    const res = await request(app).get("/employees").set(authHeader(tenant.token));
    expect(res.status).toBe(401);
  });

  it("rejects a token issued before tokenVersion was bumped", async () => {
    const tenant = await createTenant();
    await prisma.user.update({
      where: { id: tenant.owner.id },
      data: { tokenVersion: { increment: 1 } },
    });

    const res = await request(app).get("/employees").set(authHeader(tenant.token));
    expect(res.status).toBe(401);
  });
});

describe("POST /auth/logout", () => {
  it("invalidates every outstanding session for that user", async () => {
    const tenant = await createTenant();

    const before = await request(app).get("/employees").set(authHeader(tenant.token));
    expect(before.status).toBe(200);

    const logout = await request(app).post("/auth/logout").set(authHeader(tenant.token));
    expect(logout.status).toBe(200);

    const after = await request(app).get("/employees").set(authHeader(tenant.token));
    expect(after.status).toBe(401);
  });
});

describe("GET /auth/verify-email/:token", () => {
  it("marks the account verified and consumes the token", async () => {
    const company = await createCompany();
    const raw = crypto.randomBytes(32).toString("hex");
    const user = await createUser({
      companyId: company.id,
      emailVerified: false,
    });
    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationToken: hashToken(raw),
        emailVerificationExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    const res = await request(app).get(`/auth/verify-email/${raw}`);

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);

    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(after!.emailVerified).toBe(true);
    expect(after!.emailVerificationToken).toBeNull();
  });

  it("rejects an unknown token", async () => {
    const res = await request(app).get(`/auth/verify-email/${"a".repeat(64)}`);
    expect(res.status).toBe(400);
  });

  it("rejects an expired token", async () => {
    const company = await createCompany();
    const raw = crypto.randomBytes(32).toString("hex");
    const user = await createUser({ companyId: company.id, emailVerified: false });
    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationToken: hashToken(raw),
        emailVerificationExpiresAt: new Date(Date.now() - 1_000),
      },
    });

    const res = await request(app).get(`/auth/verify-email/${raw}`);
    expect(res.status).toBe(400);
  });
});

describe("password reset", () => {
  it("answers forgot-password identically for a known and an unknown address", async () => {
    const company = await createCompany();
    const user = await createUser({ companyId: company.id });

    const known = await request(app).post("/auth/forgot-password").send({ email: user.email });
    const unknown = await request(app)
      .post("/auth/forgot-password")
      .send({ email: "nobody@example.com" });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
  });

  it("issues no reset token at all for a deactivated company", async () => {
    const company = await createCompany({ active: false });
    const user = await createUser({ companyId: company.id });

    await request(app).post("/auth/forgot-password").send({ email: user.email });

    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(after!.passwordResetToken).toBeNull();
  });

  it("changes the password and kills existing sessions", async () => {
    const tenant = await createTenant();
    const raw = crypto.randomBytes(32).toString("hex");
    await prisma.user.update({
      where: { id: tenant.owner.id },
      data: {
        passwordResetToken: hashToken(raw),
        passwordResetExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    const newPassword = "Brand!NewPass99";
    const res = await request(app)
      .post(`/auth/reset-password/${raw}`)
      .send({ password: newPassword });

    expect(res.status).toBe(200);

    // The pre-reset token must be dead.
    const withOldToken = await request(app).get("/employees").set(authHeader(tenant.token));
    expect(withOldToken.status).toBe(401);

    // The new password works, the old one does not.
    const withNew = await request(app)
      .post("/auth/login")
      .send({ email: tenant.owner.email, password: newPassword });
    expect(withNew.status).toBe(200);

    const withOld = await request(app)
      .post("/auth/login")
      .send({ email: tenant.owner.email, password: TEST_PASSWORD });
    expect(withOld.status).toBe(401);
  });

  it("enforces the password policy on the NEW password", async () => {
    const tenant = await createTenant();
    const raw = crypto.randomBytes(32).toString("hex");
    await prisma.user.update({
      where: { id: tenant.owner.id },
      data: {
        passwordResetToken: hashToken(raw),
        passwordResetExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    const res = await request(app).post(`/auth/reset-password/${raw}`).send({ password: "weak" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(PASSWORD_POLICY_MESSAGE);
  });

  it("refuses to reuse a consumed reset token", async () => {
    const tenant = await createTenant();
    const raw = crypto.randomBytes(32).toString("hex");
    await prisma.user.update({
      where: { id: tenant.owner.id },
      data: {
        passwordResetToken: hashToken(raw),
        passwordResetExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    const first = await request(app)
      .post(`/auth/reset-password/${raw}`)
      .send({ password: "Brand!NewPass99" });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/auth/reset-password/${raw}`)
      .send({ password: "Another!Pass123" });
    expect(second.status).toBe(400);
  });

  it("rejects a reset token that belongs to nobody", async () => {
    const res = await request(app)
      .post(`/auth/reset-password/${"b".repeat(64)}`)
      .send({ password: "Brand!NewPass99" });

    expect(res.status).toBe(400);
  });
});

describe("JWT trust boundary", () => {
  it("refuses a token signed with the wrong secret", async () => {
    const tenant = await createTenant();
    const forged = signAuthToken(tenant.owner).slice(0, -4) + "AAAA";

    const res = await request(app).get("/employees").set(authHeader(forged));
    expect(res.status).toBe(401);
  });
});
