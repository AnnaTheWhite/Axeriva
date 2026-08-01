// N1.5 — the notification module's queues. Slash-namespaced because pg-boss
// v12 rejects colons in queue names (found the hard way in N1.4).
//
// Two stages rather than one, deliberately: fan-out (deciding who gets what)
// and delivery (rendering and sending) fail for completely different reasons.
// A recipient-resolution bug must not consume an email's retry budget, and a
// provider outage must not re-run the fan-out and risk duplicate rows.
export const NOTIFY_QUEUES = {
  // Claims a NotificationEvent and turns it into NotificationDelivery rows.
  DISPATCH: "notify/dispatch",
  // Renders and sends one delivery.
  EMAIL: "notify/email",
  // Periodic safety net for events whose dispatch job was never enqueued
  // (a crash between the outbox INSERT and the enqueue).
  SWEEP: "notify/sweep",
} as const;
