import crypto from "crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import prisma from "../database/prisma";
import { createTenant } from "./helpers/factories";

// N1.6 — Resend delivery events.
//
// Like the Stripe webhook suite, these run against REAL signature
// verification: payloads are signed with the same secret the app is
// configured with (vitest.config.ts) and resend.webhooks.verify() runs
// unmocked. Nothing here touches the network.

const SECRET = "whsec_YXhlcml2YS10ZXN0LXdlYmhvb2stc2VjcmV0";

// Svix signs `${id}.${timestamp}.${body}` with the base64-decoded secret and
// sends it base64 as `v1,<sig>`.
function sign(id: string, timestamp: number, body: string, secret = SECRET): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signature = crypto
    .createHmac("sha256", key)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return `v1,${signature}`;
}

let eventCounter = 0;

function post(
  event: Record<string, unknown>,
  options: { id?: string; secret?: string; timestamp?: number } = {}
) {
  const body = JSON.stringify(event);
  const id = options.id ?? `msg_${Date.now()}_${eventCounter++}`;
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);

  return request(app)
    .post("/notifications/webhook/resend")
    .set("svix-id", id)
    .set("svix-timestamp", String(timestamp))
    .set("svix-signature", sign(id, timestamp, body, options.secret))
    .set("Content-Type", "application/json")
    .send(body);
}

function emailEvent(type: string, data: Record<string, unknown> = {}) {
  return {
    type,
    created_at: new Date().toISOString(),
    data: {
      email_id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794",
      from: "Axeriva <noreply@axeriva.com>",
      to: ["owner@example.com"],
      subject: "Test",
      created_at: new Date().toISOString(),
      ...data,
    },
  };
}

// A delivery row for the events to correlate against.
async function seedDelivery(overrides: Record<string, unknown> = {}) {
  const tenant = await createTenant();
  const event = await prisma.notificationEvent.create({
    data: {
      type: "billing.subscription_created",
      companyId: tenant.company.id,
      status: "fanned_out",
    },
  });
  const delivery = await prisma.notificationDelivery.create({
    data: {
      eventId: event.id,
      companyId: tenant.company.id,
      channel: "EMAIL",
      recipientUserId: tenant.owner.id,
      recipientAddress: "owner@example.com",
      locale: "en",
      status: "sent",
      providerMessageId: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794",
      sentAt: new Date(),
      ...overrides,
    },
  });
  return { tenant, delivery };
}

describe("signature verification", () => {
  it("rejects a payload signed with the WRONG secret", async () => {
    const res = await post(emailEvent("email.delivered"), {
      secret: "whsec_d3Jvbmctc2VjcmV0LXZhbHVlLWhlcmU=",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid signature");
  });

  it("rejects a tampered payload that keeps a valid-looking signature", async () => {
    const original = JSON.stringify(emailEvent("email.delivered"));
    const id = "msg_tampered";
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = sign(id, timestamp, original);

    const res = await request(app)
      .post("/notifications/webhook/resend")
      .set("svix-id", id)
      .set("svix-timestamp", String(timestamp))
      .set("svix-signature", signature)
      .set("Content-Type", "application/json")
      .send(original.replace("email.delivered", "email.bounced"));

    expect(res.status).toBe(400);
  });

  it("rejects a request with no signature headers", async () => {
    const res = await request(app)
      .post("/notifications/webhook/resend")
      .set("Content-Type", "application/json")
      .send(JSON.stringify(emailEvent("email.delivered")));

    expect(res.status).toBe(400);
  });

  it("rejects a replayed old timestamp", async () => {
    // Svix's own staleness window — the first line of replay defence, before
    // the event-id primary key.
    const res = await post(emailEvent("email.delivered"), {
      timestamp: Math.floor(Date.now() / 1000) - 60 * 60,
    });

    expect(res.status).toBe(400);
  });

  it("answers a GET with 404 instead of falling through to an authed router", async () => {
    const res = await request(app).get("/notifications/webhook/resend");
    expect(res.status).toBe(404);
  });
});

describe("delivery status", () => {
  it("marks a delivery delivered", async () => {
    const { delivery } = await seedDelivery();

    const res = await post(emailEvent("email.delivered"));
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("applied");

    const after = await prisma.notificationDelivery.findUnique({ where: { id: delivery.id } });
    expect(after!.status).toBe("delivered");
    expect(after!.deliveredAt).not.toBeNull();
  });

  it("does NOT treat email.sent as delivered", async () => {
    // Resend's docs are explicit: email.sent means the API call succeeded.
    // Showing it to a user as "delivered" would be a lie, so it maps to
    // nothing — our row is already "sent" from the send call itself.
    const { delivery } = await seedDelivery();

    await post(emailEvent("email.sent"));

    const after = await prisma.notificationDelivery.findUnique({ where: { id: delivery.id } });
    expect(after!.status).toBe("sent");
    expect(after!.deliveredAt).toBeNull();
  });

  it("records an event for a message we did not send, without failing", async () => {
    // Resend delivers events for anything sent from the account — including
    // the N1.3 manual test-send script.
    const res = await post(
      emailEvent("email.delivered", { email_id: "unknown-message-id" })
    );

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("unmatched");

    const stored = await prisma.emailEvent.findFirst({ where: { type: "email.delivered" } });
    expect(stored!.deliveryId).toBeNull();
  });
});

describe("replay protection", () => {
  it("stores an event once, however many times it is delivered", async () => {
    await seedDelivery();
    const id = "msg_evt_replayed";
    const event = emailEvent("email.delivered");

    const first = await post(event, { id });
    const second = await post(event, { id });

    expect(first.body.outcome).toBe("applied");
    expect(second.body.outcome).toBe("duplicate");
    expect(await prisma.emailEvent.count()).toBe(1);
  });
});

describe("suppression", () => {
  it("blocks an address after a permanent bounce", async () => {
    const { delivery } = await seedDelivery();

    await post(
      emailEvent("email.bounced", {
        bounce: { type: "Permanent", subType: "General", message: "mailbox does not exist" },
      })
    );

    const suppressed = await prisma.emailSuppression.findUnique({
      where: { email: "owner@example.com" },
    });
    expect(suppressed!.reason).toBe("bounced");

    const after = await prisma.notificationDelivery.findUnique({ where: { id: delivery.id } });
    expect(after!.status).toBe("bounced");
  });

  it("does NOT block on a transient bounce", async () => {
    // A full mailbox is not a dead address. Suppressing it forever would
    // punish a customer for their mail server having a bad afternoon.
    await seedDelivery();

    await post(
      emailEvent("email.bounced", {
        bounce: { type: "Transient", subType: "MailboxFull", message: "mailbox full" },
      })
    );

    expect(
      await prisma.emailSuppression.findUnique({ where: { email: "owner@example.com" } })
    ).toBeNull();
  });

  it("blocks immediately on a spam complaint", async () => {
    await seedDelivery();

    await post(emailEvent("email.complained"));

    const suppressed = await prisma.emailSuppression.findUnique({
      where: { email: "owner@example.com" },
    });
    expect(suppressed!.reason).toBe("complained");
  });

  it("suppresses globally — a second tenant's send to the same address is blocked too", async () => {
    // The reputational damage of mailing a complained address is to the
    // sending DOMAIN, which every tenant shares.
    await seedDelivery();
    await post(emailEvent("email.complained"));

    const other = await createTenant();
    const { evaluateGates } = await import("../services/notifications/gates");
    const decision = await evaluateGates({
      definition: {
        // N1.7.1: `billing`, not `security`. Both are mandatory categories, so
        // this still proves the original point — a mandatory type does not
        // bypass the suppression list — but it stays clear of the one narrow
        // exemption added in N1.7.1 and narrowed in N1.7.2, where a type
        // carrying `bypassesComplaintSuppression` (today only
        // auth.password_reset) survives a `complained` suppression so a spam
        // click cannot lock a user out of their account. That exemption has its
        // own tests, both directions, in notificationRecovery.test.ts.
        category: "billing",
        severity: "info",
        mandatory: true,
        recipients: "EMAIL",
        channels: ["EMAIL"],
      },
      channel: "EMAIL",
      companyId: other.company.id,
      userId: other.owner.id,
      email: "owner@example.com",
    });

    // Even a mandatory type is stopped by the suppression list.
    expect(decision).toEqual({ allowed: false, reason: "suppression_list" });
  });

  it("tolerates the same address bouncing for several tenants", async () => {
    await seedDelivery();
    await post(emailEvent("email.bounced", { bounce: { type: "Permanent", subType: "", message: "" } }));
    await post(emailEvent("email.bounced", { bounce: { type: "Permanent", subType: "", message: "" } }));

    expect(await prisma.emailSuppression.count({ where: { email: "owner@example.com" } })).toBe(1);
  });
});
