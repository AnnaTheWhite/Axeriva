import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import prisma from "../database/prisma";
import { startQueue, stopQueue } from "../services/queue";
import { notify, redactEventContextIfSettled } from "../services/notifications/notify";
import {
  dispatchEvent,
  recordDeadLetter,
  sweepPendingDeliveries,
} from "../services/notifications/dispatcher";
import { deliverEmail } from "../services/notifications/channels/email.channel";
import { evaluateGates } from "../services/notifications/gates";
import { ensureNotificationQueues } from "../services/notifications/workers";
import { authHeader, createDeveloper, createTenant } from "./helpers/factories";

// N1.7.1 — regression cover for the Critical/High findings of the N1.1–N1.7
// architecture review, driven DIRECTLY rather than through workers.
//
// Same split as notifications.test.ts and for the same reason: a background
// worker polling while these tests hand-drive dispatch and delivery would make
// every assertion depend on timing luck. The end-to-end proof that a real job
// reaches a real handler lives in notificationPipeline.test.ts, which is a
// separate FILE precisely so its workers cannot leak into this one.

beforeAll(async () => {
  await startQueue();
  // Queues so enqueue() resolves; no workers.
  await ensureNotificationQueues();
}, 60_000);

afterAll(async () => {
  await stopQueue();
});

describe("N1.7.1 — C1: provider message id", () => {
  it("threads a stable idempotency key so a retried send cannot duplicate", async () => {
    // H4 — config.ts sizes the whole retry policy around Resend's 24-hour
    // idempotency window, but no key was ever sent, so a retry after a partial
    // failure delivered a second copy to the customer. The mock derives its id
    // from the key, which makes the property observable: same delivery retried
    // => same message id, never a second distinct send.
    const tenant = await createTenant();
    await notify({
      type: "billing.subscription_created",
      companyId: tenant.company.id,
      context: { companyName: "X", planName: "Starter" },
    });
    const event = (await prisma.notificationEvent.findFirst({ orderBy: { id: "desc" } }))!;
    await dispatchEvent(event.id);

    const delivery = (await prisma.notificationDelivery.findFirst({
      where: { eventId: event.id, channel: "EMAIL" },
    }))!;

    await deliverEmail(delivery.id);
    const first = await prisma.notificationDelivery.findUnique({ where: { id: delivery.id } });

    // A redelivered job is a no-op (status is no longer pending), so the id
    // must be untouched rather than replaced by a second send's id.
    await deliverEmail(delivery.id);
    const second = await prisma.notificationDelivery.findUnique({ where: { id: delivery.id } });

    expect(first!.providerMessageId).not.toBeNull();
    expect(second!.providerMessageId).toBe(first!.providerMessageId);
    expect(second!.attempts).toBe(1);
  });
});

describe("N1.7.1 — H1: sensitive context is not kept after the send", () => {
  it("drops the reset link once every delivery for the event has settled", async () => {
    const tenant = await createTenant();

    await notify({
      type: "auth.password_reset",
      companyId: tenant.company.id,
      context: { email: tenant.owner.email, resetLink: "https://axeriva.com/reset/SECRET-TOKEN" },
    });
    const event = (await prisma.notificationEvent.findFirst({ orderBy: { id: "desc" } }))!;

    // Before the send the raw link is necessarily present — an outbox renders
    // later than it decides, so the token has to survive until the worker runs.
    expect(event.context).toContain("SECRET-TOKEN");

    await dispatchEvent(event.id);
    const delivery = (await prisma.notificationDelivery.findFirst({
      where: { eventId: event.id, channel: "EMAIL" },
    }))!;
    await deliverEmail(delivery.id);

    const after = await prisma.notificationEvent.findUnique({ where: { id: event.id } });
    // The token is gone; the non-sensitive context survives so the event stays
    // useful for support and analytics.
    expect(after!.context).not.toContain("SECRET-TOKEN");
    expect(after!.context).not.toContain("resetLink");
    expect(after!.context).toContain(tenant.owner.email);
  });

  it("keeps the link while another delivery for the same event is still pending", async () => {
    // Redacting on the first settled delivery would break a multi-recipient
    // event: the second worker would find the token gone and fail permanently.
    const tenant = await createTenant();

    const event = await prisma.notificationEvent.create({
      data: {
        type: "employees.invitation",
        companyId: tenant.company.id,
        context: JSON.stringify({
          email: "invitee@example.com",
          inviteLink: "https://axeriva.com/invite/STILL-NEEDED",
          companyName: "X",
        }),
        status: "fanned_out",
      },
    });

    await prisma.notificationDelivery.create({
      data: {
        eventId: event.id,
        companyId: tenant.company.id,
        channel: "EMAIL",
        recipientAddress: "invitee@example.com",
        locale: "en",
        status: "pending",
      },
    });

    await redactEventContextIfSettled(event.id);

    const after = await prisma.notificationEvent.findUnique({ where: { id: event.id } });
    expect(after!.context).toContain("STILL-NEEDED");
  });
});

describe("N1.7.1 — H2: a spam complaint must not become an account lockout", () => {
  async function gateFor(
    email: string,
    definition: { category: "security" | "billing" | "marketing"; mandatory: boolean }
  ) {
    const tenant = await createTenant();
    return evaluateGates({
      definition: {
        category: definition.category,
        severity: "info",
        mandatory: definition.mandatory,
        recipients: "EMAIL",
        channels: ["EMAIL"],
      },
      channel: "EMAIL",
      companyId: tenant.company.id,
      userId: tenant.owner.id,
      email,
    });
  }

  it("still delivers a password reset to an address that once clicked spam", async () => {
    await prisma.emailSuppression.create({
      data: { email: "locked@example.com", reason: "complained" },
    });

    const decision = await gateFor("locked@example.com", {
      category: "security",
      mandatory: true,
    });

    expect(decision).toEqual({ allowed: true });
  });

  it("still refuses a HARD BOUNCE, even for security mail", async () => {
    // The mailbox does not exist — sending cannot reach anyone, and repeatedly
    // mailing a dead address is what actually damages the shared domain.
    await prisma.emailSuppression.create({
      data: { email: "gone@example.com", reason: "bounced" },
    });

    const decision = await gateFor("gone@example.com", {
      category: "security",
      mandatory: true,
    });

    expect(decision).toEqual({ allowed: false, reason: "suppression_list" });
  });

  it("does not extend the exemption to billing, which is also mandatory", async () => {
    await prisma.emailSuppression.create({
      data: { email: "complainer@example.com", reason: "complained" },
    });

    // `billing` is mandatory exactly like `security`, so this isolates the one
    // thing the exemption turns on: the CATEGORY. Only security mail survives.
    expect(
      await gateFor("complainer@example.com", { category: "billing", mandatory: true })
    ).toEqual({ allowed: false, reason: "suppression_list" });
  });

  it("blocks opt-in marketing before suppression is even consulted", async () => {
    // Not the exemption — the gate ORDER. A non-mandatory type in an opt-in
    // category is refused at the preference step (`not_opted_in`) and never
    // reaches the suppression check at all. Asserting `suppression_list` here
    // would have been asserting the wrong mechanism, which is worth pinning
    // precisely because the two produce the same user-visible outcome.
    await prisma.emailSuppression.create({
      data: { email: "complainer@example.com", reason: "complained" },
    });

    expect(
      await gateFor("complainer@example.com", { category: "marketing", mandatory: false })
    ).toEqual({ allowed: false, reason: "not_opted_in" });
  });
});

describe("N1.7.1 — H3: fan-out is all-or-nothing", () => {
  it("writes every delivery row in one transaction with the claim", async () => {
    const tenant = await createTenant();
    await notify({
      type: "billing.subscription_created",
      companyId: tenant.company.id,
      context: { companyName: "X", planName: "Starter" },
    });
    const event = (await prisma.notificationEvent.findFirst({ orderBy: { id: "desc" } }))!;

    await dispatchEvent(event.id);

    const after = await prisma.notificationEvent.findUnique({ where: { id: event.id } });
    const deliveries = await prisma.notificationDelivery.findMany({
      where: { eventId: event.id },
    });

    // The invariant the crash-safety rests on: an event is NEVER observed as
    // fanned_out with an incomplete set of deliveries.
    expect(after!.status).toBe("fanned_out");
    expect(deliveries).toHaveLength(2);
  });

  it("leaves the event claimable when the fan-out fails partway", async () => {
    // THE regression for H3, and it discriminates precisely between the old
    // code and the new one.
    //
    // A corrupt context makes JSON.parse throw. In the old dispatcher the claim
    // was its own committed statement executed BEFORE that parse, so the event
    // was left `fanned_out` with zero deliveries — and sweepPendingEvents only
    // ever looks for `pending`, so nothing was coming back for it: those
    // recipients were lost silently and permanently. Now every read happens
    // before the transaction and the claim commits with the rows or not at all,
    // so the event is still `pending` and the sweep will retry it.
    const tenant = await createTenant();
    const event = await prisma.notificationEvent.create({
      data: {
        type: "billing.subscription_created",
        companyId: tenant.company.id,
        context: "{ this is not valid json",
      },
    });

    await expect(dispatchEvent(event.id)).rejects.toThrow();

    const after = await prisma.notificationEvent.findUnique({ where: { id: event.id } });
    expect(after!.status).toBe("pending");
    expect(await prisma.notificationDelivery.count({ where: { eventId: event.id } })).toBe(0);
  });

  it("does not fan out twice when two dispatchers race", async () => {
    const tenant = await createTenant();
    await notify({
      type: "billing.subscription_created",
      companyId: tenant.company.id,
      context: { companyName: "X", planName: "Starter" },
    });
    const event = (await prisma.notificationEvent.findFirst({ orderBy: { id: "desc" } }))!;

    await Promise.all([
      dispatchEvent(event.id),
      dispatchEvent(event.id),
      dispatchEvent(event.id),
    ]);

    expect(await prisma.notificationDelivery.count({ where: { eventId: event.id } })).toBe(2);
  });
});

describe("N1.7.1 — H5 / M4: nothing is left stranded", () => {
  it("re-queues a delivery whose enqueue never landed", async () => {
    const tenant = await createTenant();
    const event = await prisma.notificationEvent.create({
      data: {
        type: "billing.subscription_created",
        companyId: tenant.company.id,
        context: JSON.stringify({ companyName: "X", planName: "Starter" }),
        status: "fanned_out",
      },
    });

    const delivery = await prisma.notificationDelivery.create({
      data: {
        eventId: event.id,
        companyId: tenant.company.id,
        channel: "EMAIL",
        recipientUserId: tenant.owner.id,
        recipientAddress: tenant.owner.email,
        locale: "en",
        status: "pending",
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    });

    expect(await sweepPendingDeliveries()).toBe(1);

    // Still pending — the sweep enqueues, the worker delivers.
    const after = await prisma.notificationDelivery.findUnique({ where: { id: delivery.id } });
    expect(after!.status).toBe("pending");
  });

  it("never re-queues a delivery a worker is already retrying", async () => {
    // attempts > 0 means a worker has had it. Re-queuing there would run a
    // second copy alongside pg-boss's own retry and mail the customer twice.
    const tenant = await createTenant();
    const event = await prisma.notificationEvent.create({
      data: {
        type: "billing.subscription_created",
        companyId: tenant.company.id,
        context: JSON.stringify({ companyName: "X", planName: "Starter" }),
        status: "fanned_out",
      },
    });

    await prisma.notificationDelivery.create({
      data: {
        eventId: event.id,
        companyId: tenant.company.id,
        channel: "EMAIL",
        recipientAddress: tenant.owner.email,
        locale: "en",
        status: "pending",
        attempts: 2,
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    });

    expect(await sweepPendingDeliveries()).toBe(0);
  });

  it("does not overwrite a status the provider already reported", async () => {
    // A late dead-letter must not turn a `bounced` delivery back into `failed`
    // and lose the more specific diagnosis.
    const tenant = await createTenant();
    const event = await prisma.notificationEvent.create({
      data: {
        type: "billing.subscription_created",
        companyId: tenant.company.id,
        context: "{}",
        status: "fanned_out",
      },
    });

    const delivery = await prisma.notificationDelivery.create({
      data: {
        eventId: event.id,
        companyId: tenant.company.id,
        channel: "EMAIL",
        recipientAddress: tenant.owner.email,
        locale: "en",
        status: "bounced",
      },
    });

    await recordDeadLetter({ deliveryId: delivery.id });

    const after = await prisma.notificationDelivery.findUnique({ where: { id: delivery.id } });
    expect(after!.status).toBe("bounced");
  });

  it("marks a dead-lettered dispatch job's event failed", async () => {
    const tenant = await createTenant();
    const event = await prisma.notificationEvent.create({
      data: {
        type: "billing.subscription_created",
        companyId: tenant.company.id,
        context: "{}",
        status: "fanned_out",
      },
    });

    await recordDeadLetter({ eventId: event.id });

    const after = await prisma.notificationEvent.findUnique({ where: { id: event.id } });
    expect(after!.status).toBe("failed");
  });

  it("survives a dead-lettered payload it does not recognise", async () => {
    await expect(recordDeadLetter({ something: "else" })).resolves.toBeUndefined();
    await expect(recordDeadLetter(null)).resolves.toBeUndefined();
  });

});

describe("N1.7.1 — the operator recovery path for suppression", () => {
  it("lets a DEVELOPER lift a suppression, and the gate opens again", async () => {
    const developer = await createDeveloper();
    await prisma.emailSuppression.create({
      data: { email: "recovered@example.com", reason: "bounced" },
    });

    // Blocked to begin with.
    const tenant = await createTenant();
    const blocked = await evaluateGates({
      definition: {
        category: "billing",
        severity: "info",
        mandatory: true,
        recipients: "EMAIL",
        channels: ["EMAIL"],
      },
      channel: "EMAIL",
      companyId: tenant.company.id,
      userId: tenant.owner.id,
      email: "recovered@example.com",
    });
    expect(blocked).toEqual({ allowed: false, reason: "suppression_list" });

    const res = await request(app)
      .delete(`/notifications/suppressions/${encodeURIComponent("recovered@example.com")}`)
      .set(authHeader(developer.token));

    expect(res.status).toBe(200);

    // ...and the address can be mailed again. This is the whole point: before
    // N1.7.1 the list was write-only and this state was unreachable.
    const after = await evaluateGates({
      definition: {
        category: "billing",
        severity: "info",
        mandatory: true,
        recipients: "EMAIL",
        channels: ["EMAIL"],
      },
      channel: "EMAIL",
      companyId: tenant.company.id,
      userId: tenant.owner.id,
      email: "recovered@example.com",
    });
    expect(after).toEqual({ allowed: true });
  });

  it("refuses a tenant owner — lifting a suppression is an operator decision", async () => {
    const tenant = await createTenant();
    await prisma.emailSuppression.create({
      data: { email: "blocked@example.com", reason: "complained" },
    });

    const res = await request(app)
      .delete(`/notifications/suppressions/${encodeURIComponent("blocked@example.com")}`)
      .set(authHeader(tenant.token));

    expect(res.status).toBe(403);
    expect(
      await prisma.emailSuppression.findUnique({ where: { email: "blocked@example.com" } })
    ).not.toBeNull();
  });

  it("404s for an address that is not suppressed", async () => {
    const developer = await createDeveloper();

    const res = await request(app)
      .delete(`/notifications/suppressions/${encodeURIComponent("nobody@example.com")}`)
      .set(authHeader(developer.token));

    expect(res.status).toBe(404);
  });
});
