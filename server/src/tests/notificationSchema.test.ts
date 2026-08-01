import { describe, expect, it } from "vitest";
import prisma from "../database/prisma";
import { createCompany, createTenant } from "./helpers/factories";
import {
  CONFIGURABLE_CATEGORIES,
  DEFAULT_NOTIFICATION_LOCALE,
  MANDATORY_CATEGORIES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_LOCALES,
  OPT_IN_CATEGORIES,
  isNotificationChannel,
  isNotificationLocale,
} from "../constants/notifications";

// N1.1 — the notification module's data foundation.
//
// Nothing in the application reads or writes these tables yet (the pipeline
// lands at N1.5), so what is worth testing now is exactly the set of database
// guarantees the later milestones will BUILD ON. If one of these silently
// stopped holding, the failure would surface much later as a double-sent
// email or a non-deterministic preference lookup — far from its cause.

async function seedEvent(companyId: number, overrides: Record<string, unknown> = {}) {
  return prisma.notificationEvent.create({
    data: {
      type: "billing.trial_ending",
      companyId,
      ...overrides,
    },
  });
}

describe("NotificationEvent — the idempotency backbone", () => {
  it("refuses a second event with the same dedupeKey", async () => {
    // This is THE guarantee the whole design rests on: a daily sweep may run
    // any number of times, and a Stripe webhook may be re-delivered, without
    // ever producing a second notification.
    const company = await createCompany();
    await seedEvent(company.id, { dedupeKey: "billing.trial_ending/1/3d" });

    await expect(
      seedEvent(company.id, { dedupeKey: "billing.trial_ending/1/3d" })
    ).rejects.toMatchObject({ code: "P2002" });

    expect(await prisma.notificationEvent.count()).toBe(1);
  });

  it("scopes the dedupeKey per company, not globally", async () => {
    // Two tenants hitting the same threshold on the same day must both be
    // notified — the key embeds the scope id for exactly this reason.
    const a = await createCompany();
    const b = await createCompany();

    await seedEvent(a.id, { dedupeKey: `billing.trial_ending/${a.id}/3d` });
    await seedEvent(b.id, { dedupeKey: `billing.trial_ending/${b.id}/3d` });

    expect(await prisma.notificationEvent.count()).toBe(2);
  });

  it("allows unlimited events with no dedupeKey (deliberately repeatable ones)", async () => {
    // Password resets must be re-sendable; they carry no key.
    const company = await createCompany();
    await seedEvent(company.id, { type: "auth.password_reset" });
    await seedEvent(company.id, { type: "auth.password_reset" });

    expect(await prisma.notificationEvent.count()).toBe(2);
  });

  it("defaults to the pending status the outbox drainer looks for", async () => {
    const company = await createCompany();
    const event = await seedEvent(company.id);

    expect(event.status).toBe("pending");
    expect(event.processedAt).toBeNull();
  });

  it("requires a real company (tenant integrity)", async () => {
    await expect(seedEvent(999_999)).rejects.toMatchObject({ code: "P2003" });
  });
});

describe("Notification — the in-app feed", () => {
  it("stores already-rendered text and an unread marker", async () => {
    const tenant = await createTenant();
    const event = await seedEvent(tenant.company.id);

    const notification = await prisma.notification.create({
      data: {
        eventId: event.id,
        companyId: tenant.company.id,
        userId: tenant.owner.id,
        type: "billing.trial_ending",
        severity: "warning",
        title: "A próbaidőszakod 3 nap múlva lejár",
        body: "Válassz csomagot, hogy ne veszítsd el a hozzáférést.",
        ctaLabel: "Csomagok",
        ctaPath: "/subscription",
      },
    });

    // Unread by default — the badge counts exactly these.
    expect(notification.readAt).toBeNull();

    const unread = await prisma.notification.count({
      where: { userId: tenant.owner.id, readAt: null },
    });
    expect(unread).toBe(1);
  });

  it("keeps the event → notification link (feed items are traceable to a cause)", async () => {
    const tenant = await createTenant();
    const event = await seedEvent(tenant.company.id, { dedupeKey: "x/1/1" });
    await prisma.notification.create({
      data: {
        eventId: event.id,
        companyId: tenant.company.id,
        userId: tenant.owner.id,
        type: "billing.trial_ending",
        title: "t",
        body: "b",
      },
    });

    const withNotifications = await prisma.notificationEvent.findUnique({
      where: { id: event.id },
      include: { notifications: true },
    });
    expect(withNotifications!.notifications).toHaveLength(1);
  });
});

describe("NotificationDelivery — the ledger that answers 'why not?'", () => {
  it("records a suppressed delivery WITH its reason and never a provider id", async () => {
    // The support question is "why didn't my customer get it?". A suppressed
    // row is the answer, so the reason must be storable alongside the attempt.
    const tenant = await createTenant();
    const event = await seedEvent(tenant.company.id);

    const delivery = await prisma.notificationDelivery.create({
      data: {
        eventId: event.id,
        companyId: tenant.company.id,
        channel: "EMAIL",
        recipientUserId: tenant.owner.id,
        recipientAddress: tenant.owner.email,
        locale: "hu",
        status: "suppressed",
        suppressionReason: "company_notifications_off",
      },
    });

    expect(delivery.status).toBe("suppressed");
    expect(delivery.suppressionReason).toBe("company_notifications_off");
    expect(delivery.providerMessageId).toBeNull();
    expect(delivery.attempts).toBe(0);
  });

  it("is findable by provider message id (the webhook join key)", async () => {
    const tenant = await createTenant();
    const event = await seedEvent(tenant.company.id);
    await prisma.notificationDelivery.create({
      data: {
        eventId: event.id,
        companyId: tenant.company.id,
        channel: "EMAIL",
        recipientAddress: tenant.owner.email,
        locale: "en",
        status: "sent",
        providerMessageId: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794",
        sentAt: new Date(),
      },
    });

    const found = await prisma.notificationDelivery.findFirst({
      where: { providerMessageId: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" },
    });
    expect(found).not.toBeNull();
    expect(found!.channel).toBe("EMAIL");
  });

  it("carries one row per channel for the same event", async () => {
    const tenant = await createTenant();
    const event = await seedEvent(tenant.company.id);

    for (const channel of ["EMAIL", "IN_APP"]) {
      await prisma.notificationDelivery.create({
        data: {
          eventId: event.id,
          companyId: tenant.company.id,
          channel,
          recipientAddress: tenant.owner.email,
          locale: "en",
        },
      });
    }

    expect(await prisma.notificationDelivery.count({ where: { eventId: event.id } })).toBe(2);
  });
});

describe("EmailEvent — provider replay protection", () => {
  it("uses the provider event id as the primary key, so a re-delivery collides", async () => {
    // Same trick as ProcessedStripeEvent: the second write of an event we have
    // already stored is a PK violation, not a duplicate row.
    const tenant = await createTenant();
    const event = await seedEvent(tenant.company.id);
    const delivery = await prisma.notificationDelivery.create({
      data: {
        eventId: event.id,
        companyId: tenant.company.id,
        channel: "EMAIL",
        recipientAddress: tenant.owner.email,
        locale: "en",
        providerMessageId: "msg_1",
      },
    });

    const payload = {
      id: "msg_evt_abc123",
      deliveryId: delivery.id,
      type: "email.delivered",
      occurredAt: new Date(),
    };
    await prisma.emailEvent.create({ data: payload });

    await expect(prisma.emailEvent.create({ data: payload })).rejects.toMatchObject({
      code: "P2002",
    });
    expect(await prisma.emailEvent.count()).toBe(1);
  });

  it("accepts an event for an unknown message (null delivery) instead of throwing", async () => {
    // A webhook must never 500 just because we cannot correlate it.
    await prisma.emailEvent.create({
      data: { id: "msg_evt_orphan", type: "email.bounced", occurredAt: new Date() },
    });

    const orphan = await prisma.emailEvent.findUnique({ where: { id: "msg_evt_orphan" } });
    expect(orphan!.deliveryId).toBeNull();
  });
});

describe("NotificationPreference — scoping", () => {
  it("refuses a duplicate USER preference for the same category+channel", async () => {
    const tenant = await createTenant();
    const row = {
      companyId: tenant.company.id,
      userId: tenant.owner.id,
      category: "projects",
      channel: "EMAIL",
      enabled: false,
    };
    await prisma.notificationPreference.create({ data: row });

    await expect(prisma.notificationPreference.create({ data: row })).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("lets a company default and a user override coexist", async () => {
    const tenant = await createTenant();
    await prisma.notificationPreference.create({
      data: {
        companyId: tenant.company.id,
        userId: null,
        category: "projects",
        channel: "EMAIL",
        enabled: false,
      },
    });
    await prisma.notificationPreference.create({
      data: {
        companyId: tenant.company.id,
        userId: tenant.owner.id,
        category: "projects",
        channel: "EMAIL",
        enabled: true,
      },
    });

    expect(await prisma.notificationPreference.count()).toBe(2);
  });

  it("KNOWN LIMIT: the composite unique does not cover company defaults (NULL userId)", async () => {
    // PostgreSQL treats NULLs as distinct in a unique index, so two
    // company-default rows for the same category+channel are NOT blocked by
    // the constraint. Pinned deliberately rather than assumed: N1.5's
    // preference service must therefore write company defaults through a
    // find-then-update path, not a bare create. Documented in
    // docs/notification-milestones.md as a known limit of N1.1.
    const company = await createCompany();
    const row = {
      companyId: company.id,
      userId: null,
      category: "projects",
      channel: "EMAIL",
      enabled: false,
    };
    await prisma.notificationPreference.create({ data: row });
    await prisma.notificationPreference.create({ data: row });

    expect(await prisma.notificationPreference.count()).toBe(2);
  });
});

describe("EmailSuppression — the global do-not-email gate", () => {
  it("holds one row per address, regardless of tenant", async () => {
    // The block is global on purpose: emailing a complained address damages
    // the sending domain's reputation for every tenant, not just one.
    const company = await createCompany();
    await prisma.emailSuppression.create({
      data: { email: "bounced@example.com", reason: "bounced", companyId: company.id },
    });

    await expect(
      prisma.emailSuppression.create({ data: { email: "bounced@example.com", reason: "complained" } })
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("survives without a company (provider-level suppression)", async () => {
    await prisma.emailSuppression.create({
      data: { email: "complained@example.com", reason: "complained" },
    });

    const row = await prisma.emailSuppression.findUnique({
      where: { email: "complained@example.com" },
    });
    expect(row!.companyId).toBeNull();
  });
});

describe("User.language (Q6)", () => {
  it("defaults to null so the company language can be inherited", async () => {
    const tenant = await createTenant();
    expect(tenant.owner.language).toBeNull();
  });

  it("stores a per-user override", async () => {
    const tenant = await createTenant();
    const updated = await prisma.user.update({
      where: { id: tenant.owner.id },
      data: { language: "hu" },
    });
    expect(updated.language).toBe("hu");
  });
});

describe("notification constants", () => {
  it("keeps every mandatory and opt-in category inside the master list", async () => {
    for (const category of [...MANDATORY_CATEGORIES, ...OPT_IN_CATEGORIES]) {
      expect(NOTIFICATION_CATEGORIES).toContain(category);
    }
  });

  it("excludes mandatory and operator-only categories from the configurable set", async () => {
    // What the preference API may expose. Silencing a security notice or a
    // critical billing warning is not a user-configurable choice (Q2).
    for (const category of MANDATORY_CATEGORIES) {
      expect(CONFIGURABLE_CATEGORIES).not.toContain(category);
    }
    expect(CONFIGURABLE_CATEGORIES).not.toContain("ops");
    expect(CONFIGURABLE_CATEGORIES).toContain("projects");
  });

  it("mirrors the frontend's language list", async () => {
    // src/i18n/index.tsx LANGUAGES = ["en", "hu"]. A cross-package import is
    // not possible from the server tsconfig, so the parity is pinned here.
    expect([...NOTIFICATION_LOCALES]).toEqual(["en", "hu"]);
    expect(NOTIFICATION_LOCALES).toContain(DEFAULT_NOTIFICATION_LOCALE);
  });

  it("validates channels and locales", async () => {
    expect(isNotificationChannel("EMAIL")).toBe(true);
    expect(isNotificationChannel("email")).toBe(false);
    expect(isNotificationChannel("CARRIER_PIGEON")).toBe(false);
    expect(isNotificationLocale("hu")).toBe(true);
    expect(isNotificationLocale("de")).toBe(false);
    // PUSH and SMS are vocabulary from day one so no column widening is
    // needed when those channels ship.
    expect(NOTIFICATION_CHANNELS).toContain("PUSH");
    expect(NOTIFICATION_CHANNELS).toContain("SMS");
  });
});
