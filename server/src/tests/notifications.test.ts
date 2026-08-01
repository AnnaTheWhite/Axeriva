import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "../database/prisma";
import { startQueue, stopQueue } from "../services/queue";
import { notify } from "../services/notifications/notify";
import { dispatchEvent, sweepPendingEvents } from "../services/notifications/dispatcher";
import { deliverEmail } from "../services/notifications/channels/email.channel";
import { isTombstonedEmail } from "../services/notifications/recipients";
import { ensureNotificationQueues } from "../services/notifications/workers";
import { createCompany, createTenant, createUser } from "./helpers/factories";
import { ROLES } from "../constants/roles";

// N1.5 — the notification pipeline end to end.
//
// The queue is started so notify() can enqueue, but the tests drive dispatch
// and delivery DIRECTLY rather than waiting for workers. That is deliberate:
// what needs pinning is the decision logic (who, which channel, suppressed or
// not, in which language), and polling for a worker would make every
// assertion slower and flakier without testing anything extra. The
// worker/queue plumbing itself is already covered by queue.test.ts.

beforeAll(async () => {
  await startQueue();
  // Queues only — no workers. The tests drive dispatch and delivery directly,
  // and a background worker racing them would make every assertion depend on
  // polling luck.
  await ensureNotificationQueues();
}, 60_000);

afterAll(async () => {
  await stopQueue();
});

async function eventFor(companyId: number | null, type: string, context: object) {
  await notify({ type: type as never, companyId, context: context as never });
  const event = await prisma.notificationEvent.findFirst({ orderBy: { id: "desc" } });
  return event!;
}

async function deliveriesFor(eventId: number) {
  return prisma.notificationDelivery.findMany({
    where: { eventId },
    orderBy: { id: "asc" },
  });
}

describe("notify() — the outbox write", () => {
  it("records an event without sending anything", async () => {
    const tenant = await createTenant();

    await notify({
      type: "auth.welcome",
      companyId: tenant.company.id,
      context: { email: tenant.owner.email, companyName: tenant.company.name },
    });

    const events = await prisma.notificationEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("pending");
    // Nothing is fanned out until the dispatcher runs.
    expect(await prisma.notificationDelivery.count()).toBe(0);
  });

  it("drops a duplicate dedupeKey silently", async () => {
    const tenant = await createTenant();
    const input = {
      type: "billing.subscription_created" as const,
      companyId: tenant.company.id,
      dedupeKey: "billing.subscription_created/evt_1",
      context: { companyName: "X", planName: "Professional" },
    };

    await notify(input);
    await notify(input);

    expect(await prisma.notificationEvent.count()).toBe(1);
  });

  it("never throws, even on an unusable payload", async () => {
    // The contract every call site depends on: a notification failure must
    // not fail the operation it describes.
    await expect(
      notify({ type: "auth.welcome", companyId: 999_999, context: {} })
    ).resolves.toBeUndefined();
  });

  it("accepts a null company (platform operators have none)", async () => {
    const developer = await createUser({ role: ROLES.DEVELOPER, companyId: null });

    await notify({
      type: "auth.password_reset",
      companyId: null,
      context: { email: developer.email, resetLink: "https://axeriva.com/reset/x" },
    });

    const event = await prisma.notificationEvent.findFirst();
    expect(event!.companyId).toBeNull();
  });
});

describe("dispatch — recipient resolution", () => {
  it("addresses OWNER notifications to the business owner", async () => {
    const tenant = await createTenant();
    // An employee of the same company must NOT receive an owner notification.
    await createUser({ companyId: tenant.company.id, role: ROLES.EMPLOYEE });

    const event = await eventFor(tenant.company.id, "billing.subscription_created", {
      companyName: tenant.company.name,
      planName: "Professional",
    });
    await dispatchEvent(event.id);

    const emails = (await deliveriesFor(event.id)).filter((d) => d.channel === "EMAIL");
    expect(emails).toHaveLength(1);
    expect(emails[0].recipientAddress).toBe(tenant.owner.email);
  });

  it("never sends to a deleted account's tombstoned address", async () => {
    // POST /account/delete rewrites the address to
    // `deleted+<id>+<epoch>__<original>` — a string that looks like a valid
    // address and would genuinely be delivered to.
    expect(isTombstonedEmail("deleted+12+1750000000__real@example.com")).toBe(true);
    expect(isTombstonedEmail("real@example.com")).toBe(false);

    const company = await createCompany();
    const owner = await createUser({ companyId: company.id, role: ROLES.BUSINESS_OWNER });
    await prisma.user.update({
      where: { id: owner.id },
      data: { email: `deleted+${owner.id}+${Date.now()}__${owner.email}` },
    });

    const event = await eventFor(company.id, "billing.subscription_created", {
      companyName: "X",
      planName: "Starter",
    });
    await dispatchEvent(event.id);

    expect(await deliveriesFor(event.id)).toHaveLength(0);
  });

  it("skips users of an archived company", async () => {
    const tenant = await createTenant();
    await prisma.company.update({
      where: { id: tenant.company.id },
      data: { active: false },
    });

    const event = await eventFor(tenant.company.id, "billing.subscription_created", {
      companyName: "X",
      planName: "Starter",
    });
    await dispatchEvent(event.id);

    expect(await deliveriesFor(event.id)).toHaveLength(0);
  });

  it("skips deactivated logins", async () => {
    const tenant = await createTenant();
    await prisma.user.update({ where: { id: tenant.owner.id }, data: { active: false } });

    const event = await eventFor(tenant.company.id, "billing.subscription_created", {
      companyName: "X",
      planName: "Starter",
    });
    await dispatchEvent(event.id);

    expect(await deliveriesFor(event.id)).toHaveLength(0);
  });
});

describe("dispatch — locale", () => {
  it("prefers the recipient's own language over the company's", async () => {
    const tenant = await createTenant();
    await prisma.company.update({
      where: { id: tenant.company.id },
      data: { language: "en" },
    });
    await prisma.user.update({ where: { id: tenant.owner.id }, data: { language: "hu" } });

    const event = await eventFor(tenant.company.id, "billing.subscription_created", {
      companyName: "X",
      planName: "Starter",
    });
    await dispatchEvent(event.id);

    const deliveries = await deliveriesFor(event.id);
    expect(deliveries.every((d) => d.locale === "hu")).toBe(true);
  });

  it("falls back to the company language", async () => {
    const tenant = await createTenant();
    await prisma.company.update({
      where: { id: tenant.company.id },
      data: { language: "hu" },
    });

    const event = await eventFor(tenant.company.id, "billing.subscription_created", {
      companyName: "X",
      planName: "Starter",
    });
    await dispatchEvent(event.id);

    expect((await deliveriesFor(event.id))[0].locale).toBe("hu");
  });
});

describe("gates — the Company toggles finally do something", () => {
  // Until N1.5 these three columns were dead configuration: editable in the
  // UI, returned by the API, and read by no sending path at all.

  it("blocks every channel when notificationsEnabled is off", async () => {
    const tenant = await createTenant();
    await prisma.company.update({
      where: { id: tenant.company.id },
      data: { notificationsEnabled: false },
    });

    // A non-mandatory type is required to see the gate; the five shipped types
    // are all mandatory, so this exercises the gate directly.
    const { evaluateGates } = await import("../services/notifications/gates");
    const decision = await evaluateGates({
      definition: {
        category: "projects",
        severity: "info",
        mandatory: false,
        recipients: "OWNER",
        channels: ["EMAIL"],
      },
      channel: "EMAIL",
      companyId: tenant.company.id,
      userId: tenant.owner.id,
      email: tenant.owner.email,
    });

    expect(decision).toEqual({ allowed: false, reason: "company_notifications_off" });
  });

  it("blocks only email when emailNotificationsEnabled is off", async () => {
    const tenant = await createTenant();
    await prisma.company.update({
      where: { id: tenant.company.id },
      data: { emailNotificationsEnabled: false },
    });

    const { evaluateGates } = await import("../services/notifications/gates");
    const base = {
      definition: {
        category: "projects" as const,
        severity: "info" as const,
        mandatory: false,
        recipients: "OWNER" as const,
        channels: ["EMAIL" as const],
      },
      companyId: tenant.company.id,
      userId: tenant.owner.id,
      email: tenant.owner.email,
    };

    expect(await evaluateGates({ ...base, channel: "EMAIL" })).toEqual({
      allowed: false,
      reason: "company_channel_off",
    });
    // The in-app feed is unaffected by an EMAIL switch.
    expect(await evaluateGates({ ...base, channel: "IN_APP" })).toEqual({ allowed: true });
  });

  it("lets a mandatory type through every preference", async () => {
    // Security and critical billing must reach the recipient (Q2): silencing
    // a password reset is an account lockout, not a preference.
    const tenant = await createTenant();
    await prisma.company.update({
      where: { id: tenant.company.id },
      data: { notificationsEnabled: false, emailNotificationsEnabled: false },
    });
    await prisma.notificationPreference.create({
      data: {
        companyId: tenant.company.id,
        userId: tenant.owner.id,
        category: "billing",
        channel: "EMAIL",
        enabled: false,
      },
    });

    const event = await eventFor(tenant.company.id, "billing.subscription_created", {
      companyName: "X",
      planName: "Starter",
    });
    await dispatchEvent(event.id);

    const email = (await deliveriesFor(event.id)).find((d) => d.channel === "EMAIL");
    expect(email!.status).toBe("pending");
    expect(email!.suppressionReason).toBeNull();
  });

  it("stops a suppressed address even for a mandatory type", async () => {
    // The one gate mandatory does not bypass: mailing a hard-bounced or
    // complained address damages the sending domain for every tenant.
    const tenant = await createTenant();
    await prisma.emailSuppression.create({
      data: { email: tenant.owner.email, reason: "complained" },
    });

    const event = await eventFor(tenant.company.id, "billing.subscription_created", {
      companyName: "X",
      planName: "Starter",
    });
    await dispatchEvent(event.id);

    const email = (await deliveriesFor(event.id)).find((d) => d.channel === "EMAIL");
    expect(email!.status).toBe("suppressed");
    expect(email!.suppressionReason).toBe("suppression_list");
  });

  it("records a user preference override with its own reason", async () => {
    const tenant = await createTenant();
    const { evaluateGates } = await import("../services/notifications/gates");

    await prisma.notificationPreference.create({
      data: {
        companyId: tenant.company.id,
        userId: tenant.owner.id,
        category: "projects",
        channel: "EMAIL",
        enabled: false,
      },
    });

    const decision = await evaluateGates({
      definition: {
        category: "projects",
        severity: "info",
        mandatory: false,
        recipients: "OWNER",
        channels: ["EMAIL"],
      },
      channel: "EMAIL",
      companyId: tenant.company.id,
      userId: tenant.owner.id,
      email: tenant.owner.email,
    });

    expect(decision).toEqual({ allowed: false, reason: "user_preference" });
  });

  it("keeps an opt-in category silent until someone opts in", async () => {
    // N1.7 regression. gates.ts documented a registry default from N1.5 —
    // "categories that are opt-in default to off" — but the code returned
    // ALLOWED whenever no preference row existed, for every category. Nothing
    // shipped in `digest` or `marketing` yet, so the bug was unreachable; the
    // first digest type (N1.9) would have mailed everyone who had never been
    // asked, and for `marketing` that is a consent failure, not a preference.
    const tenant = await createTenant();
    const { evaluateGates } = await import("../services/notifications/gates");

    const base = {
      definition: {
        category: "marketing" as const,
        severity: "info" as const,
        mandatory: false,
        recipients: "OWNER" as const,
        channels: ["EMAIL" as const],
      },
      channel: "EMAIL" as const,
      companyId: tenant.company.id,
      userId: tenant.owner.id,
      email: tenant.owner.email,
    };

    expect(await evaluateGates(base)).toEqual({ allowed: false, reason: "not_opted_in" });

    // And the opposite: an explicit yes is honoured.
    await prisma.notificationPreference.create({
      data: {
        companyId: tenant.company.id,
        userId: tenant.owner.id,
        category: "marketing",
        channel: "EMAIL",
        enabled: true,
      },
    });

    expect(await evaluateGates(base)).toEqual({ allowed: true });
  });

  it("still defaults a normal category ON with no rows at all", async () => {
    // The other half of the same fix: only OPT_IN_CATEGORIES flip to off.
    const tenant = await createTenant();
    const { evaluateGates } = await import("../services/notifications/gates");

    const decision = await evaluateGates({
      definition: {
        category: "projects",
        severity: "info",
        mandatory: false,
        recipients: "OWNER",
        channels: ["EMAIL"],
      },
      channel: "EMAIL",
      companyId: tenant.company.id,
      userId: tenant.owner.id,
      email: tenant.owner.email,
    });

    expect(decision).toEqual({ allowed: true });
  });

  it("lets a user override the company default back ON", async () => {
    const tenant = await createTenant();
    const { evaluateGates } = await import("../services/notifications/gates");

    await prisma.notificationPreference.createMany({
      data: [
        {
          companyId: tenant.company.id,
          userId: null,
          category: "projects",
          channel: "EMAIL",
          enabled: false,
        },
        {
          companyId: tenant.company.id,
          userId: tenant.owner.id,
          category: "projects",
          channel: "EMAIL",
          enabled: true,
        },
      ],
    });

    const decision = await evaluateGates({
      definition: {
        category: "projects",
        severity: "info",
        mandatory: false,
        recipients: "OWNER",
        channels: ["EMAIL"],
      },
      channel: "EMAIL",
      companyId: tenant.company.id,
      userId: tenant.owner.id,
      email: tenant.owner.email,
    });

    expect(decision).toEqual({ allowed: true });
  });
});

describe("dispatch — idempotency and fan-out", () => {
  it("dispatches an event exactly once, however many times it is asked to", async () => {
    // Both the immediate job and the sweep can target the same event, and
    // pg-boss is at-least-once — so the claim has to be atomic.
    const tenant = await createTenant();
    const event = await eventFor(tenant.company.id, "billing.subscription_created", {
      companyName: "X",
      planName: "Starter",
    });

    await Promise.all([
      dispatchEvent(event.id),
      dispatchEvent(event.id),
      dispatchEvent(event.id),
    ]);

    const deliveries = await deliveriesFor(event.id);
    // One EMAIL + one IN_APP, not three of each.
    expect(deliveries).toHaveLength(2);
    expect(new Set(deliveries.map((d) => d.channel))).toEqual(new Set(["EMAIL", "IN_APP"]));
  });

  it("writes the in-app row in the recipient's language and leaves it unread", async () => {
    const tenant = await createTenant();
    await prisma.user.update({ where: { id: tenant.owner.id }, data: { language: "hu" } });

    const event = await eventFor(tenant.company.id, "billing.subscription_created", {
      companyName: "Teszt Kft",
      planName: "Professional",
    });
    await dispatchEvent(event.id);

    const notification = await prisma.notification.findFirst({ where: { eventId: event.id } });
    expect(notification!.userId).toBe(tenant.owner.id);
    expect(notification!.readAt).toBeNull();
    expect(notification!.title).toContain("Professional");
    // Hungarian copy, and the interpolation actually happened.
    expect(notification!.body).toContain("Teszt Kft");
    expect(notification!.ctaPath).toBe("/subscription");

    const inApp = (await deliveriesFor(event.id)).find((d) => d.channel === "IN_APP");
    expect(inApp!.status).toBe("delivered");
  });
});

describe("email delivery", () => {
  it("marks the delivery sent and does not re-send on a redelivered job", async () => {
    // pg-boss is at-least-once, so the handler has to be idempotent itself.
    const tenant = await createTenant();
    const event = await eventFor(tenant.company.id, "billing.subscription_created", {
      companyName: "X",
      planName: "Starter",
    });
    await dispatchEvent(event.id);

    const delivery = (await deliveriesFor(event.id)).find((d) => d.channel === "EMAIL")!;
    await deliverEmail(delivery.id);

    const after = await prisma.notificationDelivery.findUnique({ where: { id: delivery.id } });
    expect(after!.status).toBe("sent");
    expect(after!.attempts).toBe(1);

    // Second run: no second send, no second attempt.
    await deliverEmail(delivery.id);
    const again = await prisma.notificationDelivery.findUnique({ where: { id: delivery.id } });
    expect(again!.attempts).toBe(1);
  });

  it("records the error and rethrows so the queue can retry", async () => {
    const tenant = await createTenant();
    // Missing `planName` — a permanent context error.
    const event = await eventFor(tenant.company.id, "billing.subscription_created", {
      companyName: "X",
    });
    await dispatchEvent(event.id);

    const delivery = (await deliveriesFor(event.id)).find((d) => d.channel === "EMAIL")!;
    await expect(deliverEmail(delivery.id)).rejects.toThrow(/planName/);

    const after = await prisma.notificationDelivery.findUnique({ where: { id: delivery.id } });
    expect(after!.attempts).toBe(1);
    expect(after!.lastError).toMatch(/planName/);
    // Still pending: the queue owns the retry decision, not this row.
    expect(after!.status).toBe("pending");
  });
});

describe("outbox sweep", () => {
  it("re-queues an event stranded by a crash between insert and enqueue", async () => {
    const tenant = await createTenant();
    const event = await prisma.notificationEvent.create({
      data: {
        type: "billing.subscription_created",
        companyId: tenant.company.id,
        context: JSON.stringify({ companyName: "X", planName: "Starter" }),
        createdAt: new Date(Date.now() - 5 * 60 * 1000),
      },
    });

    expect(await sweepPendingEvents()).toBe(1);
    // Still pending — the sweep enqueues, the dispatcher claims.
    const after = await prisma.notificationEvent.findUnique({ where: { id: event.id } });
    expect(after!.status).toBe("pending");
  });

  it("leaves a just-created event to its own dispatch job", async () => {
    const tenant = await createTenant();
    await eventFor(tenant.company.id, "billing.subscription_created", {
      companyName: "X",
      planName: "Starter",
    });

    // The age filter is what keeps the sweep from racing the in-flight job.
    expect(await sweepPendingEvents()).toBe(0);
  });
});
