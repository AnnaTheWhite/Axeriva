// Central rate-limit configuration (K2.1.3) — every limit lives here, no
// magic numbers in route files. Applied via createRateLimiter() in
// middleware/rateLimit.middleware.ts.
//
// All limiters use a fixed window: `max` requests per `windowMs` per key.
// The key is the client IP unless the route passes a custom keyGenerator
// (e.g. login's IP+email limiter).

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

export const RATE_LIMITS = {
  // Brute-force: generous per-IP ceiling for shared offices/NAT, tight
  // per-credential limit underneath it.
  LOGIN_PER_IP: { windowMs: 15 * MINUTE_MS, max: 20 },
  LOGIN_PER_EMAIL: { windowMs: 15 * MINUTE_MS, max: 5 },

  // Mass-registration / automated signup abuse.
  REGISTER: { windowMs: HOUR_MS, max: 5 },

  // Email flooding + Resend cost abuse. The endpoint's response stays
  // identical whether the target email exists or not; the limit is keyed
  // purely on the caller's IP, so it leaks nothing either.
  FORGOT_PASSWORD: { windowMs: HOUR_MS, max: 5 },

  // Token guessing on the reset endpoint (tokens are 256-bit, this is
  // belt-and-braces against blind hammering).
  RESET_PASSWORD: { windowMs: HOUR_MS, max: 10 },

  // Authenticated, self-service — limits how fast one account can make us
  // send verification emails.
  VERIFY_EMAIL: { windowMs: HOUR_MS, max: 3 },

  // Invite-token guessing / automated account creation via invites.
  INVITE_ACCEPT: { windowMs: HOUR_MS, max: 10 },
} as const;
