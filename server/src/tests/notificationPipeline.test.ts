import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "../database/prisma";
import { enqueue, startQueue, stopQueue } from "../services/queue";
import { notify } from "../services/notifications/notify";
import { registerNotificationWorkers } from "../services/notifications/workers";
import { NOTIFY_QUEUES } from "../services/notifications/queues";
import { createTenant } from "./helpers/factories";

// N1.7.1 — the milestone that fixed what the N1.1–N1.7 architecture review
// found. Two jobs:
//
//  1. Regression cover for every Critical/High defect, so none can come back.
//  2. Close the structural blind spot that let them ship in the first place.
//     notifications.test.ts drives dispatch and delivery DIRECTLY and justified
//     it with "the queue plumbing is covered by queue.test.ts" — which was
//     false: registerNotificationWorkers() was never invoked by any test, so
//     NOTHING checked that a real job reaches a real handler. That gap is
//     exactly how providerMessageId went unwritten through 387 green tests.
//     The tests here run the REAL workers end to end.

// Real workers means real polling, so these tests wait for state instead of
// asserting immediately. Short interval, generous ceiling: a slow CI box must
// not turn a correctness test into a flaky one.
async function waitFor<T>(
  probe: () => Promise<T | null>,
  what: string,
  timeoutMs = 15_000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== null && value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`timed out after ${timeoutMs}ms waiting for: ${what}`);
}

describe("queue -> worker -> email delivery (the untested seam)", () => {
  beforeAll(async () => {
    await startQueue();
    // The real thing: queues, handlers, sweep schedule and the dead-letter
    // consumer, exactly as index.ts wires them in production.
    await registerNotificationWorkers();
  }, 60_000);

  afterAll(async () => {
    await stopQueue();
  });

  it("carries a notify() call all the way to a sent delivery, with no manual driving", async () => {
    const tenant = await createTenant();

    await notify({
      type: "billing.subscription_created",
      companyId: tenant.company.id,
      context: { companyName: tenant.company.name, planName: "Professional" },
    });

    const delivery = await waitFor(
      () =>
        prisma.notificationDelivery.findFirst({
          where: { channel: "EMAIL", status: "sent" },
        }),
      "the email delivery to reach status=sent through the real workers"
    );

    expect(delivery.sentAt).not.toBeNull();
    expect(delivery.attempts).toBe(1);
    // C1 — THE regression. This column is the only join key the N1.6 delivery
    // webhook has, and nothing in production ever wrote it: every provider
    // event arrived unmatched and no delivery could leave "sent". A test that
    // seeds this column by hand (as resendWebhook.test.ts did) cannot catch
    // that; only driving the real send path can.
    expect(delivery.providerMessageId).not.toBeNull();
    expect(delivery.providerMessageId).toMatch(/^mock_/);
  });

  it("gives a permanently failing delivery a terminal state via the dead-letter queue", async () => {
    // H5 — before N1.7.1 the DLQ existed and had no consumer, so an exhausted
    // retry budget left the row in `pending` forever, indistinguishable from a
    // job still waiting its turn.
    const tenant = await createTenant();

    // Missing `planName` — the template requires it, so every attempt throws.
    // retryLimit 0 sends it to the dead-letter queue on the first failure
    // instead of making the test sit through the exponential backoff.
    const event = await prisma.notificationEvent.create({
      data: {
        type: "billing.subscription_created",
        companyId: tenant.company.id,
        context: JSON.stringify({ companyName: "X" }),
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
      },
    });

    await enqueue(NOTIFY_QUEUES.EMAIL, { deliveryId: delivery.id }, { retryLimit: 0 });

    const failed = await waitFor(
      () =>
        prisma.notificationDelivery.findFirst({
          where: { id: delivery.id, status: "failed" },
        }),
      "the dead-letter worker to mark the delivery failed",
      50_000
    );

    expect(failed.lastError).toContain("dead-lettered");
    // The failing attempt itself is still recorded — the trail survives.
    expect(failed.attempts).toBeGreaterThan(0);
    // The whole point: a permanently failed delivery is now distinguishable
    // from one still waiting its turn. Before N1.7.1 both read "pending".
    expect(failed.status).not.toBe("pending");
    // 60s, not the 20s default: this waits on two real polling loops in
    // sequence (the email worker failing the job, then the dead-letter worker
    // consuming it), and a slow box must not turn that into a flake.
  }, 60_000);
});
