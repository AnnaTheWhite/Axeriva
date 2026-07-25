import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import prisma from "../database/prisma";
import { AUDIT_ACTIONS } from "../constants/auditActions";
import { READ_ONLY_ERROR } from "../middleware/readOnly.middleware";
import {
  authHeader,
  createEmployee,
  createEmployeeUser,
  createShift,
  createTenant,
  TEST_PASSWORD,
} from "./helpers/factories";

// B1 — offboarding via POST /employee-access/:id/revoke. The revoke flips
// User.active and bumps tokenVersion (both already enforced by
// auth.middleware.ts on every request), tombstones the email so the person
// can be re-invited, and leaves the Employee row, its status and the shift
// history completely untouched. These are the first tests of the whole
// offboarding path.

const REVOKE_BODY = { confirmation: "REVOKE" };

// createTenant()'s employee has NO login (factories create bare Employee
// rows); attach one the way production does — one EMPLOYEE-role User bound
// to the Employee.
async function tenantWithLogin() {
  const t = await createTenant();
  const login = await createEmployeeUser(t.company.id, t.employee.id);
  return { ...t, login };
}

// A tenant whose trial ended yesterday → read-only mode
// (readOnlyMode.test.ts's lapsed() pattern).
const lapsed = () =>
  createTenant({
    subscriptionStatus: "trialing",
    subscriptionEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
  });

describe("POST /employee-access/:id/revoke", () => {
  it("revokes the login: active=false, deletedAt set, tokenVersion bumped, email tombstoned", async () => {
    const t = await tenantWithLogin();

    const res = await request(app)
      .post(`/employee-access/${t.employee.id}/revoke`)
      .set(authHeader(t.token))
      .send(REVOKE_BODY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ revoked: true });

    const user = await prisma.user.findUnique({ where: { id: t.login.user.id } });
    expect(user!.active).toBe(false);
    expect(user!.deletedAt).not.toBeNull();
    expect(user!.tokenVersion).toBe(1);
    expect(user!.email).not.toBe(t.login.user.email);
    expect(user!.email.startsWith("revoked+")).toBe(true);
  });

  it("kills the outstanding token immediately", async () => {
    const t = await tenantWithLogin();

    // Sanity: the employee's token works before the revoke.
    const before = await request(app)
      .get("/shifts/me")
      .set(authHeader(t.login.token));
    expect(before.status).toBe(200);

    await request(app)
      .post(`/employee-access/${t.employee.id}/revoke`)
      .set(authHeader(t.token))
      .send(REVOKE_BODY);

    const after = await request(app)
      .get("/shifts/me")
      .set(authHeader(t.login.token));
    expect(after.status).toBe(401);
  });

  it("blocks a fresh login too", async () => {
    const t = await tenantWithLogin();
    const originalEmail = t.login.user.email;

    await request(app)
      .post(`/employee-access/${t.employee.id}/revoke`)
      .set(authHeader(t.token))
      .send(REVOKE_BODY);

    const login = await request(app)
      .post("/auth/login")
      .send({ email: originalEmail, password: TEST_PASSWORD });

    expect(login.status).toBe(401);
    expect(login.body.error).toBe("Invalid credentials");
  });

  it("frees the original email for a re-invite (tombstone)", async () => {
    const t = await tenantWithLogin();
    const originalEmail = t.login.user.email;

    await request(app)
      .post(`/employee-access/${t.employee.id}/revoke`)
      .set(authHeader(t.token))
      .send(REVOKE_BODY);

    // This is exactly the lookup invites.routes.ts uses for its
    // "Email already in use" 409 — finding nothing means re-inviting works.
    const collision = await prisma.user.findUnique({
      where: { email: originalEmail },
    });
    expect(collision).toBeNull();
  });

  it("refuses a missing or wrong-case confirmation and changes nothing", async () => {
    const t = await tenantWithLogin();

    const missing = await request(app)
      .post(`/employee-access/${t.employee.id}/revoke`)
      .set(authHeader(t.token))
      .send({});
    expect(missing.status).toBe(400);

    const lowercase = await request(app)
      .post(`/employee-access/${t.employee.id}/revoke`)
      .set(authHeader(t.token))
      .send({ confirmation: "revoke" });
    expect(lowercase.status).toBe(400);

    const user = await prisma.user.findUnique({ where: { id: t.login.user.id } });
    expect(user!.active).toBe(true);
    expect(user!.tokenVersion).toBe(0);
  });

  it("returns 409 (not 500) for an employee with no login", async () => {
    const t = await createTenant();
    const loginless = await createEmployee(t.company.id);

    const res = await request(app)
      .post(`/employee-access/${loginless.id}/revoke`)
      .set(authHeader(t.token))
      .send(REVOKE_BODY);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/no login/i);
  });

  it("is idempotence-guarded: second call is 409 and tokenVersion stays 1", async () => {
    const t = await tenantWithLogin();

    const first = await request(app)
      .post(`/employee-access/${t.employee.id}/revoke`)
      .set(authHeader(t.token))
      .send(REVOKE_BODY);
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/employee-access/${t.employee.id}/revoke`)
      .set(authHeader(t.token))
      .send(REVOKE_BODY);
    expect(second.status).toBe(409);

    const user = await prisma.user.findUnique({ where: { id: t.login.user.id } });
    expect(user!.tokenVersion).toBe(1);
  });

  it("is tenant-isolated: another company's owner gets 404 and changes nothing", async () => {
    const a = await createTenant();
    const b = await tenantWithLogin();

    const res = await request(app)
      .post(`/employee-access/${b.employee.id}/revoke`)
      .set(authHeader(a.token))
      .send(REVOKE_BODY);

    expect(res.status).toBe(404);

    const user = await prisma.user.findUnique({ where: { id: b.login.user.id } });
    expect(user!.active).toBe(true);
  });

  it("refuses an EMPLOYEE caller", async () => {
    const t = await tenantWithLogin();

    const res = await request(app)
      .post(`/employee-access/${t.employee.id}/revoke`)
      .set(authHeader(t.login.token))
      .send(REVOKE_BODY);

    expect(res.status).toBe(403);
  });

  it("works in a read-only (lapsed subscription) company", async () => {
    const t = await lapsed();
    const login = await createEmployeeUser(t.company.id, t.employee.id);

    const res = await request(app)
      .post(`/employee-access/${t.employee.id}/revoke`)
      .set(authHeader(t.token))
      .send(REVOKE_BODY);

    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { id: login.user.id } });
    expect(user!.active).toBe(false);
  });

  it("does NOT lift the read-only guard off /employees (regression)", async () => {
    // The revoke endpoint lives on its own mount precisely so /employees
    // keeps its write guard — this pins that the guard is still there.
    const t = await lapsed();

    const res = await request(app)
      .put(`/employees/${t.employee.id}/status`)
      .set(authHeader(t.token))
      .send({ status: "Sick" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe(READ_ONLY_ERROR);
  });

  it("writes the audit entry with employeeId and revokedUserId", async () => {
    const t = await tenantWithLogin();

    await request(app)
      .post(`/employee-access/${t.employee.id}/revoke`)
      .set(authHeader(t.token))
      .send(REVOKE_BODY);

    const entry = await prisma.auditLog.findFirst({
      where: {
        action: AUDIT_ACTIONS.EMPLOYEE_ACCESS_REVOKED,
        companyId: t.company.id,
      },
    });

    expect(entry).not.toBeNull();
    expect(entry!.userId).toBe(t.owner.id);
    expect(JSON.parse(entry!.metadata!)).toEqual({
      employeeId: t.employee.id,
      revokedUserId: t.login.user.id,
    });
  });
});

describe("GET /employees accessRevoked field", () => {
  it("derives accessRevoked per row and never leaks the user object", async () => {
    const t = await tenantWithLogin();

    // A second employee with a live login and a third with none.
    const active = await createEmployee(t.company.id);
    await createEmployeeUser(t.company.id, active.id);
    const loginless = await createEmployee(t.company.id);

    await request(app)
      .post(`/employee-access/${t.employee.id}/revoke`)
      .set(authHeader(t.token))
      .send(REVOKE_BODY);

    const res = await request(app).get("/employees").set(authHeader(t.token));
    expect(res.status).toBe(200);

    const byId = new Map(
      (res.body as Array<{ id: number; accessRevoked: boolean }>).map((row) => [
        row.id,
        row,
      ])
    );

    expect(byId.get(t.employee.id)!.accessRevoked).toBe(true);
    expect(byId.get(active.id)!.accessRevoked).toBe(false);
    expect(byId.get(loginless.id)!.accessRevoked).toBe(false);

    for (const row of res.body) {
      expect(row).not.toHaveProperty("user");
    }
  });
});

describe("what the revoke must NOT touch", () => {
  it("leaves the Employee row, its status and the shift history intact", async () => {
    const t = await tenantWithLogin();
    await createShift(t.employee.id);
    await createShift(t.employee.id);

    await request(app)
      .post(`/employee-access/${t.employee.id}/revoke`)
      .set(authHeader(t.token))
      .send(REVOKE_BODY);

    const employee = await prisma.employee.findUnique({
      where: { id: t.employee.id },
    });
    expect(employee).not.toBeNull();
    expect(employee!.status).toBe("Active");

    const shifts = await prisma.shift.count({
      where: { employeeId: t.employee.id },
    });
    expect(shifts).toBe(2);
  });

  it("the delete-refusal message now points at the revoke action", async () => {
    const t = await tenantWithLogin();
    await createShift(t.employee.id);

    const res = await request(app)
      .delete(`/employees/${t.employee.id}`)
      .set(authHeader(t.token));

    expect(res.status).toBe(409);
    expect(res.body.error).not.toContain("Set their status");
    expect(res.body.error).toContain("Revoke");
  });

  it("dashboard activeEmployees drops the revoked login but keeps login-less employees", async () => {
    const t = await tenantWithLogin();
    // A second, login-less employee — must stay counted throughout.
    await createEmployee(t.company.id);

    const before = await request(app)
      .get("/dashboard")
      .set(authHeader(t.token));
    expect(before.status).toBe(200);
    expect(before.body.kpis.activeEmployees).toBe(2);

    await request(app)
      .post(`/employee-access/${t.employee.id}/revoke`)
      .set(authHeader(t.token))
      .send(REVOKE_BODY);

    const after = await request(app)
      .get("/dashboard")
      .set(authHeader(t.token));
    expect(after.body.kpis.activeEmployees).toBe(1);
  });
});
