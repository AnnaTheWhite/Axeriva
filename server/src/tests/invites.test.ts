import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import { PASSWORD_POLICY_MESSAGE } from "../utils/passwordPolicy";
import { authHeader, createTenant, TEST_PASSWORD } from "./helpers/factories";

// B3 — the POST /invites/:token/accept password-policy contract. The
// frontend (AcceptInvitePage via invites.service.ts) now surfaces this
// response's `error` field verbatim, so its status code, shape and text are
// load-bearing: this is the message the user actually reads when the
// client-side mirror ever drifts from the server's policy.

// POST /invites echoes the RAW token (the stored one is a hash) — the owner
// UI builds the invite link from it, and so do we.
async function createInviteToken(ownerToken: string): Promise<string> {
  const res = await request(app)
    .post("/invites")
    .set(authHeader(ownerToken))
    .send({ email: "newhire@example.com" });

  expect(res.status).toBe(201);
  return res.body.token;
}

describe("POST /invites/:token/accept password policy", () => {
  it("rejects a password that fails the policy with the canonical message", async () => {
    const t = await createTenant();
    const inviteToken = await createInviteToken(t.token);

    const res = await request(app)
      .post(`/invites/${inviteToken}/accept`)
      .send({ firstName: "New", lastName: "Hire", password: "short" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(PASSWORD_POLICY_MESSAGE);
  });

  it("accepts a policy-compliant password and returns a session", async () => {
    const t = await createTenant();
    const inviteToken = await createInviteToken(t.token);

    const res = await request(app)
      .post(`/invites/${inviteToken}/accept`)
      .send({ firstName: "New", lastName: "Hire", password: TEST_PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe("newhire@example.com");
  });
});
