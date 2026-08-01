// N1.4 — queue names. Only infrastructure queues exist at this milestone; the
// notification queues (notify:email and friends) arrive in N1.5 together with
// the handlers that drain them, so nothing here is speculative surface.
//
// Names are namespaced with a forward slash so a queue's owner is obvious in
// pg-boss's own tables and in any future dashboard. NOT a colon: pg-boss v12
// validates queue names against alphanumerics, underscore, hyphen, period and
// slash, and rejects anything else at createQueue time. Slash also keeps
// queue names visually distinct from the dotted notification type keys
// (billing.trial_ending), which are a different namespace entirely.
export const QUEUES = {
  // Where a job lands after its retries are exhausted. Nothing consumes it
  // automatically: the point of a dead-letter queue is that a human (or the
  // N1.10 admin surface) decides what to do, rather than a poison message
  // cycling forever.
  DEAD_LETTER: "notify/dlq",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES] | (string & {});
