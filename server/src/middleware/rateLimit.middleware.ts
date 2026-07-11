import { NextFunction, Request, RequestHandler, Response } from "express";
import { AuthEvent, logAuthEvent } from "../services/audit/authAudit";

// Re-exported for existing importers (auth.routes.ts). The canonical
// definition now lives in utils/maskEmail so the audit log and the limiter
// share one implementation without either module depending on the other.
export { maskEmail } from "../utils/maskEmail";

// Reusable in-memory rate limiter (K2.1.3). Deliberately dependency-free
// and process-local: the app runs as a single instance on one node (SQLite
// on a persistent disk), so an in-memory fixed window is exactly as strong
// as an external store would be — if the deployment ever scales to multiple
// instances, swap the Map for a shared store behind the same interface.
//
// Fixed-window counting: `max` requests per `windowMs` per key. The key
// defaults to the client IP (`trust proxy` is enabled in production, see
// index.ts, so req.ip reflects the real client behind Render's proxy).

type RateLimitOptions = {
  // Shown in logs and used to namespace keys so two limiters on the same
  // route (e.g. login per-IP + per-email) never collide.
  name: string;
  windowMs: number;
  max: number;
  // Optional custom key (e.g. IP + email for login). Return null to skip
  // rate limiting for the request (e.g. email missing — the route's own
  // validation will reject it anyway).
  keyGenerator?: (req: Request) => string | null;
};

type WindowEntry = {
  count: number;
  resetAt: number;
};

const windows = new Map<string, WindowEntry>();

// One sweep per minute drops expired windows so the Map can't grow without
// bound under a scanning attack. unref() keeps this timer from holding the
// process open (relevant for scripts importing app code).
const CLEANUP_INTERVAL_MS = 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of windows) {
    if (entry.resetAt <= now) {
      windows.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS).unref();

// Typed as RequestHandler so adding a limiter to a route doesn't change how
// Express infers the route's path params (e.g. `:token` staying `string`).
export function createRateLimiter(options: RateLimitOptions): RequestHandler<any> {
  const { name, windowMs, max, keyGenerator } = options;

  return function rateLimiter(req: Request, res: Response, next: NextFunction) {
    const rawKey = keyGenerator ? keyGenerator(req) : req.ip ?? "unknown";

    if (rawKey === null) {
      return next();
    }

    const key = `${name}:${rawKey}`;
    const now = Date.now();
    const entry = windows.get(key);

    if (!entry || entry.resetAt <= now) {
      windows.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count += 1;

    if (entry.count <= max) {
      return next();
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));

    // Audit the block through the shared auth logger. `reason` carries the
    // limiter name (e.g. "login-email") — never a raw email, password or
    // token; login's per-email key is already masked upstream.
    logAuthEvent(AuthEvent.RATE_LIMIT_TRIGGERED, {
      req,
      level: "WARN",
      result: "denied",
      reason: name,
    });

    res.setHeader("Retry-After", String(retryAfterSeconds));
    return res.status(429).json({
      error: "Too many requests. Please try again later.",
      retryAfterSeconds,
    });
  };
}
