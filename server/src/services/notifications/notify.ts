import { Prisma } from "@prisma/client";
import prisma from "../../database/prisma";
import { enqueue } from "../queue";
import { NOTIFY_QUEUES } from "./queues";
import type { NotificationTypeKey } from "./registry";

// N1.5 — the ONE entry point application code uses. A route or webhook says
// "this happened"; everything after that (who, which channel, which language,
// when) is the module's business.
//
// Two properties matter more than anything else here:
//
//  1. It never throws. A notification failing must not fail the operation it
//     describes — the same contract logAudit() already established. A caller
//     that had to wrap notify() in try/catch would eventually forget to.
//  2. It only writes a row. No rendering, no SMTP, no external call — so it
//     is safe inside a request handler and inside a Stripe webhook, where the
//     2xx must not wait for an email (a constraint the webhook docs spell
//     out explicitly).

export type NotifyInput = {
  type: NotificationTypeKey;
  // Null for notifications about a user with no company (a platform
  // operator's password reset).
  companyId?: number | null;
  // Template variables + recipient hints (userId / email, depending on the
  // type's recipient strategy). Stored as JSON, exactly like AuditLog.metadata.
  context?: Record<string, unknown>;
  // Idempotency. A second notify() with the same key is silently dropped —
  // which is what lets a daily sweep run repeatedly and a webhook be
  // redelivered without producing a second message.
  dedupeKey?: string;
  actorUserId?: number | null;
};

export async function notify(input: NotifyInput): Promise<void> {
  try {
    const event = await prisma.notificationEvent.create({
      data: {
        type: input.type,
        companyId: input.companyId ?? null,
        dedupeKey: input.dedupeKey ?? null,
        context: input.context ? JSON.stringify(input.context) : null,
        actorUserId: input.actorUserId ?? null,
      },
    });

    // Written first, enqueued second. If the process dies in between, the row
    // is still there in `pending` and the sweep (registered alongside the
    // workers) picks it up — that ordering is the whole point of an outbox.
    await enqueue(NOTIFY_QUEUES.DISPATCH, { eventId: event.id });
  } catch (error) {
    // A duplicate dedupeKey is the mechanism working, not a failure.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return;
    }
    console.error(`[notify] failed to record ${input.type}`, error);
  }
}
