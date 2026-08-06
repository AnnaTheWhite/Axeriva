import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import app from "../app";
import prisma from "../database/prisma";
import { emailService } from "../services/email";
import { startQueue, stopQueue } from "../services/queue";
import { notify, redactEventContextIfSettled } from "../services/notifications/notify";
import {
  dispatchEvent,
  recordDeadLetter,
  sweepPendingDeliveries,
} from "../services/notifications/dispatcher";
import { deliverEmail } from "../services/notifications/channels/email.channel";
import { evaluateGates } from "../services/notifications/gates";
import { NOTIFICATION_TYPES } from "../services/notifications/registry";
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

describe("N1.7.3 — registry invariants the pipeline silently depends on", () => {
  it("gives every IN_APP type its in-app copy", () => {
    // `inApp` is optional in the type, so a registry entry can list IN_APP in
    // `channels` with no copy — and N1.8/N1.9 are queued to add exactly the
    // kinds of types that would. deliverInApp then throws deterministically on
    // every attempt. Before N1.7.3 that was an infinite loop: the dispatcher
    // swallows the throw (so pg-boss never retries or dead-letters), and the
    // sweep re-selected the row forever. Cheaper to make it impossible here.
    const broken = Object.entries(NOTIFICATION_TYPES)
      .filter(([, d]) => (d.channels as readonly string[]).includes("IN_APP"))
      .filter(([, d]) => !(d as { inApp?: unknown }).inApp)
      .map(([key]) => key);

    expect(broken).toEqual([]);
  });

  it("keeps the billing category/mandatory table the plan settled", () => {
    // N1.8 Slice 3. docs/notification-n18-plan.md §4 splits billing in two:
    //   `billing`          — critical, NOT switchable  -> mandatory: true
    //   `billing_receipts` — courtesies, switchable    -> mandatory: false
    //
    // Neither half is observable through the gate on its own. A mandatory type
    // ignores preferences whatever its category, so mutating `billing` to
    // `billing_receipts` on billing.invoice_failed changes no delivery outcome
    // and no behavioural test can see it — while quietly moving a critical
    // warning into the bucket the preference screen offers to switch off, the
    // day someone relaxes `mandatory`.
    //
    // So the TABLE is the invariant, and it is asserted as a pair: a category
    // change alone now fails here, and so does a mandatory change alone.
    const wrong = Object.entries(NOTIFICATION_TYPES)
      .filter(([, d]) => d.category === "billing" || d.category === "billing_receipts")
      .filter(([, d]) => d.mandatory !== (d.category === "billing"))
      .map(([key, d]) => `${key} (${d.category}, mandatory: ${d.mandatory})`);

    expect(wrong).toEqual([]);

    // And the split is populated on both sides — an empty filter above would
    // also produce [] and prove nothing.
    const byCategory = Object.entries(NOTIFICATION_TYPES)
      .filter(([, d]) => d.category === "billing" || d.category === "billing_receipts")
      .map(([key, d]) => [key, d.category]);
    expect(byCategory).toContainEqual(["billing.invoice_failed", "billing"]);
    expect(byCategory).toContainEqual(["billing.subscription_renewed", "billing_receipts"]);
    expect(byCategory).toContainEqual(["billing.renewal_upcoming", "billing_receipts"]);
  });

  it("gives every EMAIL type a template branch in the channel", async () => {
    // The compile-time exhaustiveness guard in email.channel.ts catches a type
    // with no case, but only if someone runs tsc. This is the runtime twin.
    const { deliverEmail } = await import("../services/notifications/channels/email.channel");
    expect(typeof deliverEmail).toBe("function");

    const emailTypes = Object.entries(NOTIFICATION_TYPES)
      .filter(([, d]) => (d.channels as readonly string[]).includes("EMAIL"))
      .map(([key]) => key);

    // The assertion exists so ADDING one is a deliberate act that updates this
    // list and the switch together — and it did its job on N1.8 Slice 1, which
    // is why billing.subscription_renewed is here. Eight today; N1.8 takes it
    // to sixteen, one slice at a time.
    expect(emailTypes.sort()).toEqual([
      "auth.password_reset",
      "auth.verify_email",
      "auth.welcome",
      "billing.invoice_failed",
      "billing.invoice_paid",
      "billing.renewal_upcoming",
      "billing.subscription_created",
      "billing.subscription_renewed",
      "employees.invitation",
    ]);
  });
});

describe("N1.7.3 — a deterministically failing in-app delivery terminates", () => {
  it("stops retrying and marks the row failed instead of looping forever", async () => {
    // The exact scenario: an IN_APP delivery whose type has no in-app copy.
    // Simulated with a type that is EMAIL-only in the registry, which makes
    // deliverInApp throw "has no in-app copy" every single time.
    const tenant = await createTenant();
    const event = await prisma.notificationEvent.create({
      data: {
        type: "auth.welcome",
        companyId: tenant.company.id,
        context: JSON.stringify({ companyName: "X" }),
        status: "fanned_out",
      },
    });
    const delivery = await prisma.notificationDelivery.create({
      data: {
        eventId: event.id,
        companyId: tenant.company.id,
        channel: "IN_APP",
        recipientUserId: tenant.owner.id,
        recipientAddress: tenant.owner.email,
        locale: "en",
        status: "pending",
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });

    // Four sweeps: three real attempts, then the give-up.
    for (let i = 0; i < 4; i++) await sweepPendingDeliveries();

    const after = await prisma.notificationDelivery.findUnique({ where: { id: delivery.id } });
    expect(after!.status).toBe("failed");
    expect(after!.lastError).toContain("gave up");

    // And it is no longer selected, so the loop is genuinely over.
    expect(await sweepPendingDeliveries()).toBe(0);
  });

  it("never shows one event to one user twice, whatever the interleaving", async () => {
    // N1.7.3 final round. The attempts compare-and-set is a TICKET, not a
    // lease: the row stays `pending` through the render and insert, so a caller
    // that reads AFTER the increment gets its own valid ticket and also reaches
    // notification.create. Two overlapping sweep runs can do exactly that (the
    // sweep is cron'd every minute and works through batches of 100), and the
    // user saw the same bell item twice. Email survives the identical
    // interleaving only because Resend deduplicates on the per-delivery
    // idempotency key; in-app had no backstop.
    //
    // Fixed with @@unique([eventId, userId]) rather than a longer lock, so it
    // holds under interleavings nobody has enumerated. Two delivery rows for
    // one (event, user) is the shape that reproduces it deterministically.
    const tenant = await createTenant();
    const event = await prisma.notificationEvent.create({
      data: {
        type: "billing.subscription_created",
        companyId: tenant.company.id,
        context: JSON.stringify({ companyName: "X", planName: "Starter" }),
        status: "fanned_out",
      },
    });

    const rows = await Promise.all(
      [0, 1].map(() =>
        prisma.notificationDelivery.create({
          data: {
            eventId: event.id,
            companyId: tenant.company.id,
            channel: "IN_APP",
            recipientUserId: tenant.owner.id,
            recipientAddress: tenant.owner.email,
            locale: "en",
            status: "pending",
          },
        })
      )
    );

    const { deliverInApp } = await import(
      "../services/notifications/channels/inApp.channel"
    );
    await deliverInApp(rows[0].id);
    // The loser must NOT throw — throwing would burn its retry budget and
    // eventually mark a delivery failed for a notification the user has.
    await expect(deliverInApp(rows[1].id)).resolves.toBeUndefined();

    expect(
      await prisma.notification.count({
        where: { eventId: event.id, userId: tenant.owner.id },
      })
    ).toBe(1);

    // Both deliveries settle, so neither is swept forever.
    for (const row of rows) {
      const after = await prisma.notificationDelivery.findUnique({ where: { id: row.id } });
      expect(after!.status).toBe("delivered");
    }
  });

  it("still retries an in-app delivery that failed transiently", async () => {
    // The bound must not turn every in-app hiccup into a permanent failure.
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
        channel: "IN_APP",
        recipientUserId: tenant.owner.id,
        recipientAddress: tenant.owner.email,
        locale: "en",
        status: "pending",
        attempts: 1,
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });

    expect(await sweepPendingDeliveries()).toBe(1);

    const after = await prisma.notificationDelivery.findUnique({ where: { id: delivery.id } });
    expect(after!.status).toBe("delivered");
  });
});

describe("N1.7.2 — H4: the idempotency key actually reaches the transport", () => {
  // The N1.7.1 test for this asserted that two deliverEmail() calls produced
  // the same providerMessageId — which passes whether or not a key is sent,
  // because the second call short-circuits on status !== "pending" and never
  // sends at all. Deleting the entire H4 fix left all 20 tests green; verified
  // by doing exactly that. These tests inspect the argument handed to the
  // transport, which is the only thing that can discriminate.
  async function keyPassedTo(deliveryId: number): Promise<string | undefined> {
    const spy = vi.spyOn(emailService, "sendSubscriptionConfirmedEmail");
    try {
      await deliverEmail(deliveryId);
      expect(spy).toHaveBeenCalledTimes(1);
      return spy.mock.calls[0][3]?.idempotencyKey;
    } finally {
      spy.mockRestore();
    }
  }

  async function deliveryFor(companyName: string): Promise<number> {
    const tenant = await createTenant();
    await notify({
      type: "billing.subscription_created",
      companyId: tenant.company.id,
      context: { companyName, planName: "Starter" },
    });
    const event = (await prisma.notificationEvent.findFirst({ orderBy: { id: "desc" } }))!;
    await dispatchEvent(event.id);
    const delivery = (await prisma.notificationDelivery.findFirst({
      where: { eventId: event.id, channel: "EMAIL" },
    }))!;
    return delivery.id;
  }

  it("hands the transport a key derived from the delivery id", async () => {
    const deliveryId = await deliveryFor("X");

    // Remove the plumbing and this assertion fails — which the previous
    // version of this test did not.
    expect(await keyPassedTo(deliveryId)).toBe(`notif-delivery-${deliveryId}`);
  });

  it("gives two recipients of the SAME event different keys", async () => {
    // N1.7.3 rewrote this. The N1.7.2 version compared two deliveries from two
    // different TENANTS — i.e. two different events — so it passed unchanged
    // when the key was derived from the event id, which is the precise mutation
    // it claimed to forbid. Verified: the old assertion held under that change.
    //
    // Two deliveries of ONE event is the only shape that discriminates. If the
    // key came from the event id these would collide in Resend's idempotency
    // window and the second recipient would silently never get their copy.
    const tenant = await createTenant();
    const event = await prisma.notificationEvent.create({
      data: {
        type: "billing.subscription_created",
        companyId: tenant.company.id,
        context: JSON.stringify({ companyName: "X", planName: "Starter" }),
        status: "fanned_out",
      },
    });

    const [first, second] = await Promise.all(
      ["a@example.com", "b@example.com"].map((address) =>
        prisma.notificationDelivery.create({
          data: {
            eventId: event.id,
            companyId: tenant.company.id,
            channel: "EMAIL",
            recipientAddress: address,
            locale: "en",
            status: "pending",
          },
        })
      )
    );

    const keyA = await keyPassedTo(first.id);
    const keyB = await keyPassedTo(second.id);

    expect(keyA).toBe(`notif-delivery-${first.id}`);
    expect(keyB).toBe(`notif-delivery-${second.id}`);
    expect(keyA).not.toBe(keyB);
  });
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

  it("drops the link when every delivery was SUPPRESSED and no worker ever ran", async () => {
    // N1.7.2. Redaction was called from exactly one place — the email channel,
    // after a successful send — so a delivery the gate refused was never
    // redacted by anything. Concrete path: the address hard-bounced once, so
    // it is on the suppression list; the user then requests a password reset;
    // H2 correctly keeps blocking a `bounced` address, the delivery is written
    // `suppressed`, no worker touches it, and the plaintext reset link sits in
    // the table permanently. That is the original K2.1.4 bypass, intact.
    const tenant = await createTenant();
    await prisma.emailSuppression.create({
      data: { email: tenant.owner.email, reason: "bounced" },
    });

    await notify({
      type: "auth.password_reset",
      companyId: tenant.company.id,
      context: { email: tenant.owner.email, resetLink: "https://axeriva.com/reset/LEAKED" },
    });
    const event = (await prisma.notificationEvent.findFirst({ orderBy: { id: "desc" } }))!;

    await dispatchEvent(event.id);

    const delivery = await prisma.notificationDelivery.findFirst({
      where: { eventId: event.id, channel: "EMAIL" },
    });
    expect(delivery!.status).toBe("suppressed");

    const after = await prisma.notificationEvent.findUnique({ where: { id: event.id } });
    expect(after!.context).not.toContain("LEAKED");
  });

  it("drops the link when the event resolves no recipients at all", async () => {
    const tenant = await createTenant();
    await prisma.user.update({ where: { id: tenant.owner.id }, data: { active: false } });

    await notify({
      type: "billing.subscription_created",
      companyId: tenant.company.id,
      context: { companyName: "X", planName: "S", inviteLink: "https://axeriva.com/i/LEAKED" },
    });
    const event = (await prisma.notificationEvent.findFirst({ orderBy: { id: "desc" } }))!;

    await dispatchEvent(event.id);

    const after = await prisma.notificationEvent.findUnique({ where: { id: event.id } });
    expect(after!.context).not.toContain("LEAKED");
  });

  it("drops the link when the delivery fails permanently and dead-letters", async () => {
    const tenant = await createTenant();
    const event = await prisma.notificationEvent.create({
      data: {
        type: "employees.invitation",
        companyId: tenant.company.id,
        context: JSON.stringify({
          email: "x@example.com",
          inviteLink: "https://axeriva.com/invite/LEAKED",
          companyName: "X",
        }),
        status: "fanned_out",
      },
    });
    const delivery = await prisma.notificationDelivery.create({
      data: {
        eventId: event.id,
        companyId: tenant.company.id,
        channel: "EMAIL",
        recipientAddress: "x@example.com",
        locale: "en",
        status: "pending",
      },
    });

    await recordDeadLetter({ deliveryId: delivery.id });

    const after = await prisma.notificationEvent.findUnique({ where: { id: event.id } });
    expect(after!.context).not.toContain("LEAKED");
  });

  it("drops the link when the event fails before it ever dispatches", async () => {
    // markFailed's redaction call (unknown type / corrupt context) had no test —
    // deleting that one line left the suite green.
    const tenant = await createTenant();
    const event = await prisma.notificationEvent.create({
      data: {
        type: "auth.not_a_real_type",
        companyId: tenant.company.id,
        context: JSON.stringify({ resetLink: "https://axeriva.com/reset/LEAKED" }),
      },
    });

    await dispatchEvent(event.id);

    const after = await prisma.notificationEvent.findUnique({ where: { id: event.id } });
    expect(after!.status).toBe("failed");
    expect(after!.context).not.toContain("LEAKED");
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
    definition: {
      category: "security" | "billing" | "marketing";
      mandatory: boolean;
      bypassesComplaintSuppression?: boolean;
    }
  ) {
    const tenant = await createTenant();
    return evaluateGates({
      definition: {
        category: definition.category,
        severity: "info",
        mandatory: definition.mandatory,
        ...(definition.bypassesComplaintSuppression
          ? { bypassesComplaintSuppression: true }
          : {}),
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
      bypassesComplaintSuppression: true,
    });

    expect(decision).toEqual({ allowed: true });
  });

  it("does NOT extend the exemption to other security mail (N1.7.2)", async () => {
    // The N1.7.1 predicate was `category === "security" && mandatory`, which is
    // also true of auth.welcome — a courtesy mail overriding someone who
    // explicitly marked us as spam. The flag is now declared per type, so a
    // security-category type without it stays blocked.
    await prisma.emailSuppression.create({
      data: { email: "spamclicker@example.com", reason: "complained" },
    });

    expect(
      await gateFor("spamclicker@example.com", { category: "security", mandatory: true })
    ).toEqual({ allowed: false, reason: "suppression_list" });
  });

  it("carries the flag on auth.password_reset and on nothing else", async () => {
    // Pins the registry itself, so adding the flag to a new type is a
    // deliberate act that fails this test rather than a quiet inheritance.
    const flagged = Object.entries(NOTIFICATION_TYPES)
      .filter(([, d]) => (d as { bypassesComplaintSuppression?: boolean }).bypassesComplaintSuppression)
      .map(([key]) => key);

    expect(flagged).toEqual(["auth.password_reset"]);
  });

  it("still refuses a HARD BOUNCE, even for the exempt type", async () => {
    // The mailbox does not exist — sending cannot reach anyone, and repeatedly
    // mailing a dead address is what actually damages the shared domain.
    await prisma.emailSuppression.create({
      data: { email: "gone@example.com", reason: "bounced" },
    });

    const decision = await gateFor("gone@example.com", {
      category: "security",
      mandatory: true,
      bypassesComplaintSuppression: true,
    });

    expect(decision).toEqual({ allowed: false, reason: "suppression_list" });
  });

  it("matches a suppression regardless of address casing", async () => {
    // N1.7.2 — the column is a plain @unique String, so "User@x.com" and
    // "user@x.com" were two rows: a suppression written from one casing did
    // not block the other, and the operator removal path could not lift it.
    await prisma.emailSuppression.create({
      data: { email: "mixed@example.com", reason: "bounced" },
    });

    expect(
      await gateFor("MiXeD@Example.COM", { category: "billing", mandatory: true })
    ).toEqual({ allowed: false, reason: "suppression_list" });
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
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });

    expect(await sweepPendingDeliveries()).toBe(1);

    // Still pending — the sweep enqueues, the worker delivers.
    const after = await prisma.notificationDelivery.findUnique({ where: { id: delivery.id } });
    expect(after!.status).toBe("pending");
  });

  it("counts the attempt BEFORE the send, so the sweep cannot duplicate it", async () => {
    // H5's actual fix, which the re-verification found had no test. The
    // discriminating property: after deliverEmail runs, `attempts` must already
    // have been incremented by the CLAIM — under N1.7.1 it was incremented only
    // after the provider call resolved, so a row read attempts=0 for the whole
    // duration of the request and the sweep could enqueue a duplicate beneath
    // an in-flight send.
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
        recipientAddress: tenant.owner.email,
        locale: "en",
        status: "pending",
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });

    // Observe `attempts` from inside the send, i.e. exactly the window the
    // sweep used to be able to look into.
    let attemptsDuringSend = -1;
    const spy = vi
      .spyOn(emailService, "sendSubscriptionConfirmedEmail")
      .mockImplementation(async () => {
        const row = await prisma.notificationDelivery.findUnique({
          where: { id: delivery.id },
        });
        attemptsDuringSend = row!.attempts;
        return { messageId: "mock_probe" };
      });

    try {
      await deliverEmail(delivery.id);
    } finally {
      spy.mockRestore();
    }

    expect(attemptsDuringSend).toBe(1);
  });

  it("lets only one of two concurrent workers actually send", async () => {
    // The claim is a compare-and-set, so a redelivered job racing the original
    // must not produce a second send.
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
        recipientAddress: tenant.owner.email,
        locale: "en",
        status: "pending",
      },
    });

    const spy = vi.spyOn(emailService, "sendSubscriptionConfirmedEmail");
    try {
      await Promise.all([deliverEmail(delivery.id), deliverEmail(delivery.id)]);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }

    const after = await prisma.notificationDelivery.findUnique({ where: { id: delivery.id } });
    expect(after!.attempts).toBe(1);
  });

  it("never touches a delivery that has already settled, on either channel", async () => {
    // N1.7.3 replaced the sweep's flat filter with an OR over the two channels.
    // If Prisma composed that OR as a REPLACEMENT for the sibling conditions
    // rather than ANDing them, the sweep would select rows of any status and
    // re-send mail that had already gone out — the worst possible failure for a
    // recovery mechanism. Verified empirically before writing this; pinned here
    // because the consequence of it silently changing is severe.
    const tenant = await createTenant();
    const event = await prisma.notificationEvent.create({
      data: {
        type: "billing.subscription_created",
        companyId: tenant.company.id,
        context: JSON.stringify({ companyName: "X", planName: "Starter" }),
        status: "fanned_out",
      },
    });
    const old = new Date(Date.now() - 60 * 60 * 1000);

    for (const [channel, status] of [
      ["EMAIL", "sent"],
      ["EMAIL", "delivered"],
      ["EMAIL", "suppressed"],
      ["EMAIL", "failed"],
      ["IN_APP", "delivered"],
      ["IN_APP", "suppressed"],
      ["IN_APP", "failed"],
    ] as const) {
      await prisma.notificationDelivery.create({
        data: {
          eventId: event.id,
          companyId: tenant.company.id,
          channel,
          recipientUserId: tenant.owner.id,
          recipientAddress: tenant.owner.email,
          locale: "en",
          status,
          createdAt: old,
        },
      });
    }

    expect(await sweepPendingDeliveries()).toBe(0);
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
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
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
        // `pending` — a dispatch job that dead-lettered never completed its
        // fan-out, so this is the state it is actually in.
        status: "pending",
      },
    });

    await recordDeadLetter({ eventId: event.id });

    const after = await prisma.notificationEvent.findUnique({ where: { id: event.id } });
    expect(after!.status).toBe("failed");
  });

  it("never downgrades a successfully fanned-out event to failed", async () => {
    // N1.7.2. The N1.7.1 guard was `status: { not: "failed" }`, which overwrote
    // `fanned_out` — the SUCCESS terminal state — and the original version of
    // the test above PINNED that by seeding a fanned_out event and asserting it
    // became failed. A dispatch job can dead-letter after the emails have gone
    // out (a persistently throwing in-app delivery, say); reporting that event
    // as failed misrepresents a successful send in the support record forever.
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
    expect(after!.status).toBe("fanned_out");
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
