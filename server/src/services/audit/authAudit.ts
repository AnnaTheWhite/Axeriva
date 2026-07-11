import { Request } from "express";
import { maskEmail } from "../../utils/maskEmail";

// Centralized authentication audit logging (K2.1.10). One helper, one
// schema, one place to change how auth events are emitted. Every auth flow
// (login, register, reset, verify, invite, logout, account delete) and the
// auth middleware / rate limiter route their security-relevant events
// through logAuthEvent() instead of ad-hoc console calls.
//
// Output is a single structured JSON line per event on the appropriate
// console stream (INFO->stdout, WARN/ERROR->stderr). JSON keeps the log
// machine-parseable for a future SIEM/log-shipping pipeline AND makes log
// injection via attacker-controlled fields (e.g. User-Agent) harmless —
// JSON.stringify escapes newlines and quotes. No external logging system is
// introduced (constraint); this only standardizes what already goes to the
// console.

export type AuthAuditLevel = "INFO" | "WARN" | "ERROR";

// The closed set of audit-worthy authentication events.
export const AuthEvent = {
  LOGIN_SUCCEEDED: "LOGIN_SUCCEEDED",
  LOGIN_FAILED: "LOGIN_FAILED",
  REGISTRATION_SUCCEEDED: "REGISTRATION_SUCCEEDED",
  REGISTRATION_DUPLICATE: "REGISTRATION_DUPLICATE",
  PASSWORD_RESET_REQUESTED: "PASSWORD_RESET_REQUESTED",
  PASSWORD_RESET_COMPLETED: "PASSWORD_RESET_COMPLETED",
  EMAIL_VERIFICATION_REQUESTED: "EMAIL_VERIFICATION_REQUESTED",
  EMAIL_VERIFIED: "EMAIL_VERIFIED",
  INVITATION_CREATED: "INVITATION_CREATED",
  INVITATION_ACCEPTED: "INVITATION_ACCEPTED",
  LOGOUT: "LOGOUT",
  ACCOUNT_DELETED: "ACCOUNT_DELETED",
  AUTH_DENIED: "AUTH_DENIED",
  COMPANY_INACTIVE_DENIED: "COMPANY_INACTIVE_DENIED",
  RATE_LIMIT_TRIGGERED: "RATE_LIMIT_TRIGGERED",
  INVALID_TOKEN: "INVALID_TOKEN",
} as const;

export type AuthEventType = (typeof AuthEvent)[keyof typeof AuthEvent];

export type AuthAuditResult = "success" | "failure" | "denied";

type AuthAuditContext = {
  // Source request — IP, User-Agent and request id are derived from it.
  req?: Request;
  level?: AuthAuditLevel;
  result?: AuthAuditResult;
  userId?: number | null;
  companyId?: number | null;
  role?: string | null;
  // Masked before it is written — never store the raw address.
  email?: string | null;
  // Short, non-sensitive machine tag (e.g. "session_invalidated"). Never a
  // token, password or other secret.
  reason?: string;
};

const USER_AGENT_MAX_LENGTH = 256;

// Express header values are string | string[] | undefined; collapse to a
// single trimmed, length-capped string. (JSON.stringify handles escaping,
// so no manual control-char stripping is needed for safety — the cap is
// just to keep lines bounded.)
function headerString(value: string | string[] | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const raw = Array.isArray(value) ? value.join(",") : value;
  return raw.slice(0, USER_AGENT_MAX_LENGTH);
}

export function logAuthEvent(
  event: AuthEventType,
  context: AuthAuditContext = {}
): void {
  const { req, level = "INFO", result, userId, companyId, role, email, reason } =
    context;

  const entry = {
    ts: new Date().toISOString(),
    channel: "auth-audit",
    level,
    event,
    result: result ?? null,
    userId: userId ?? null,
    companyId: companyId ?? null,
    role: role ?? null,
    // Only ever the masked form reaches the log.
    email: email ? maskEmail(email) : null,
    ip: req?.ip ?? null,
    userAgent: req ? headerString(req.headers["user-agent"]) : null,
    // Populated by the request-id middleware (see index.ts); null if absent.
    requestId: req?.id ?? null,
    reason: reason ?? null,
  };

  const line = JSON.stringify(entry);

  if (level === "ERROR") {
    console.error(line);
  } else if (level === "WARN") {
    console.warn(line);
  } else {
    console.log(line);
  }
}
