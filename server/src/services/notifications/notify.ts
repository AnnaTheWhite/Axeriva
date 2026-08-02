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
    // A duplicate dedupeKey is the mechanism working, not a failure — so this
    // stays a silent success as far as the CALLER is concerned.
    //
    // N1.8 Fázis 0: but it no longer passes without a trace. Until now a
    // collision returned with no log at all, which made the two possible
    // meanings indistinguishable from outside:
    //
    //   (a) Stripe redelivered an event → suppressing the second send is
    //       exactly right, and
    //   (b) the dedupeKey is too BROAD → a notification that should have gone
    //       out was silently dropped.
    //
    // (b) is invisible by construction: no error, no row, no email, and the
    // customer simply never hears about their second failed payment. N1.8
    // multiplies the exposure — twelve new types, each with a hand-built key,
    // several keyed on Stripe object ids rather than event ids. One log line
    // is what makes a suspected miss diagnosable instead of theoretical.
    //
    // WARN, not ERROR: in steady state these are legitimate redeliveries and
    // must not page anyone. The dedupeKey is included because it IS the
    // diagnosis — it says which discriminator collided.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      console.warn(
        `[notify] ${input.type} suppressed as a duplicate (dedupeKey: ${input.dedupeKey ?? "none"})`
      );
      return;
    }
    console.error(`[notify] failed to record ${input.type}`, error);
  }
}

// ---------------------------------------------------------------------------
// Sensitive context (N1.7.1 — H1)
// ---------------------------------------------------------------------------

// Context keys that carry a single-use credential in the clear.
//
// The repo hashes these tokens at rest — `User.passwordResetToken`,
// `User.emailVerificationToken` and `Invitation.token` all store
// hashToken(...) so a database read cannot yield a usable token (K2.1.4). But
// the outbox needs the RENDERED LINK to survive until the worker runs, so the
// raw token was being written straight into NotificationEvent.context, a plain
// text column sitting one table away from the hash that was protecting it.
// That silently undid K2.1.4 for every token type, and the rows outlived the
// send indefinitely — with N1.10 planning a support-facing event viewer over
// exactly this table.
//
// The token cannot be removed from the context outright: an outbox by
// definition renders later than it decides, and the hash cannot be reversed to
// rebuild the link. What it CAN be is short-lived. Redaction runs the moment
// the last delivery for the event settles, which reduces the exposure from
// "forever" to "the seconds the job spends in the queue".
//
// Residual risk, stated plainly: a dump taken inside that window still catches
// the plaintext, and an event whose deliveries never settle keeps it. Closing
// that completely needs the context encrypted at rest with the
// NOTIFICATION_TOKEN_SECRET the plan already anticipates (§15) — a larger
// change than this milestone, and tracked as such.
export const SENSITIVE_CONTEXT_KEYS = ["resetLink", "verifyLink", "inviteLink"] as const;

// Drops the sensitive keys once no delivery for this event is still pending.
// Never throws: this is hygiene running at the tail of a successful send, and
// failing it must not fail the send or trigger a retry that re-sends the mail.
export async function redactEventContextIfSettled(eventId: number): Promise<void> {
  try {
    const stillWorking = await prisma.notificationDelivery.count({
      where: { eventId, status: "pending" },
    });
    if (stillWorking > 0) return;

    const event = await prisma.notificationEvent.findUnique({
      where: { id: eventId },
      select: { context: true },
    });
    if (!event?.context) return;

    const context = JSON.parse(event.context) as Record<string, unknown>;
    const present = SENSITIVE_CONTEXT_KEYS.filter((key) => key in context);
    if (present.length === 0) return;

    for (const key of present) delete context[key];

    await prisma.notificationEvent.update({
      where: { id: eventId },
      data: { context: JSON.stringify(context) },
    });
  } catch (error) {
    // Loud, because a silent failure here means a live token is still sitting
    // in the table and nobody knows.
    console.error(`[notify] failed to redact context for event ${eventId}`, error);
  }
}
