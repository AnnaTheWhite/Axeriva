import { Router } from "express";
import { Resend } from "resend";
import { config } from "../config";
import { recordDeliveryEvent } from "../services/notifications/deliveryEvents";

const router = Router();

// N1.6 — Resend delivery events (delivered / bounced / complained / opened…).
//
// Structured exactly like the Stripe webhook, for the same reasons:
//   - mounted with express.raw() BEFORE the global express.json(), because
//     the Svix signature covers the raw bytes and a parse+re-stringify
//     invalidates it;
//   - a signature failure is a 400 and nothing else happens;
//   - the provider's own event id is the primary key of what we store, so a
//     redelivery collides instead of double-applying;
//   - a GET returns 404 rather than falling through to an authenticated
//     router below.
//
// One deliberate difference from the Stripe webhook: a handler failure here
// still answers 2xx. Stripe events carry money state, so a non-2xx (and the
// redelivery it buys) is worth more than a clean response. These events are
// TELEMETRY — losing one costs an "opened" flag, and letting Resend retry a
// broken handler in a loop is the worse outcome.

// A Resend client is needed only for webhooks.verify(); the API key is
// irrelevant to signature checking, so this works even when the app is
// running on MockEmailService.
const verifier = new Resend(config.resend.apiKey ?? "re_unused_for_verification_only");

router.post("/", async (req, res) => {
  const secret = config.resend.webhookSecret;

  if (!secret) {
    // Not configured: refuse rather than accept unverified input. Deliberately
    // not a boot-time failure (see config.ts) — missing delivery telemetry is
    // not worth taking the API down for.
    return res.status(400).json({ error: "Webhook not configured" });
  }

  let event: { type: string; created_at?: string; data?: unknown };
  let svixId: string;

  try {
    // Resend's verify() takes its OWN header shape ({id, timestamp,
    // signature}), not the WHATWG Headers object the name suggests.
    const id = String(req.headers["svix-id"] ?? "");
    const timestamp = String(req.headers["svix-timestamp"] ?? "");
    const signature = String(req.headers["svix-signature"] ?? "");

    if (!id || !timestamp || !signature) {
      return res.status(400).json({ error: "Missing signature headers" });
    }

    // req.body is the raw Buffer here (express.raw at the mount in app.ts).
    // Svix also rejects a stale timestamp, which is the replay guard on top
    // of the event-id primary key below.
    event = verifier.webhooks.verify({
      payload: req.body.toString("utf8"),
      headers: { id, timestamp, signature },
      webhookSecret: secret,
    }) as typeof event;

    svixId = id;
  } catch (error) {
    console.error("[resend webhook] signature verification failed", error);
    return res.status(400).json({ error: "Invalid signature" });
  }

  try {
    const outcome = await recordDeliveryEvent({
      eventId: svixId,
      type: event.type,
      occurredAt: event.created_at ? new Date(event.created_at) : new Date(),
      payload: event as Record<string, unknown>,
    });

    return res.json({ received: true, outcome });
  } catch (error) {
    // Ack anyway — see the note above on why telemetry does not get the
    // Stripe treatment. The failure is loud in the logs instead.
    console.error("[resend webhook] failed to record event", error);
    return res.json({ received: true, outcome: "error" });
  }
});

// Resend only ever POSTs here. Without this a GET would fall through to the
// authenticated routers mounted later and answer a confusing 401.
router.all("/", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

export default router;
