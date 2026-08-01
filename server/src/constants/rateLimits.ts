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

  // POST /account/delete re-checks the caller's password, which turns it into
  // a password oracle for anyone holding a stolen JWT: guess in the body,
  // read the 401 vs 400. Authentication alone is no protection here — the
  // attacker already has a token. Keyed per USER (not per IP), so one
  // compromised session can't be brute-forced from a botnet either. The limit
  // is tight because the legitimate flow needs one or two attempts, never ten.
  ACCOUNT_DELETE: { windowMs: HOUR_MS, max: 5 },

  // POST /company/archive re-checks the caller's password exactly like
  // /account/delete does, so it is the same password oracle for a stolen
  // JWT (B2). Same reasoning, same shape: per-user key, tight ceiling.
  COMPANY_ARCHIVE: { windowMs: HOUR_MS, max: 5 },

  // N1.7 — the notification preference writes (plan §15). Keyed per USER, not
  // per IP: this is authenticated self-service, and the thing being bounded is
  // one account rewriting its preference matrix in a loop, not a shared office
  // NAT. Generous enough that a human toggling switches never notices — each
  // save carries the whole changed set, so a busy session is a handful of
  // requests, not one per checkbox.
  NOTIFICATION_PREFS: { windowMs: HOUR_MS, max: 60 },
} as const;
