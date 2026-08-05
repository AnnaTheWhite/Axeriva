// CAL1.4 — the calendar audit writer (decision D13). See
// docs/calendar-system-plan.md §6.6 and docs/calendar-cal1-scope.md §2.
//
// The calendar's first WRITE surface arrives already audited, deliberately. If
// the audit writer landed with CAL1.5 instead, there would be a window in which
// permissions — the most security-relevant thing this module has — could change
// with no record, and that record cannot be reconstructed afterwards.
//
// TWO THINGS HERE DIFFER FROM logAudit(), AND BOTH ARE ON PURPOSE:
//
//   1. This writes INSIDE the caller's transaction. logAudit() is
//      fire-and-forget and never throws, so a logging outage cannot stop an
//      account deletion. For calendar permissions that trade is wrong: a log
//      with silent holes is worse than no log, because nobody can tell WHERE
//      the holes are. If the audit insert fails, the mutation rolls back —
//      "no audit, no change". The cost is stated plainly: an audit-table
//      problem stops calendar writes.
//
//   2. `source` is derived from the AUTHENTICATION PATH, never from the
//      request. A client-settable source would make the table lie about
//      exactly the field an investigation starts from.

import type { Prisma } from "@prisma/client";
import prisma from "../../database/prisma";
import { AUDIT_ACTIONS } from "../../constants/auditActions";
import { logAudit } from "../audit/auditLog";
import {
  type AuditSource,
  type AuditTargetType,
  type CalendarAuditAction,
  CALENDAR_AUDIT_ACTIONS_MIRRORED_TO_AUDIT_LOG,
} from "../../constants/calendarAuditActions";

// The subset of PrismaClient available inside an interactive transaction.
export type CalendarAuditClient = Prisma.TransactionClient;

// { field: { from, to } } — CHANGED FIELDS ONLY.
export type CalendarAuditChanges = Record<string, { from: unknown; to: unknown }>;

export type CalendarAuditEntry = {
  companyId: number;
  // Always set, including for member changes — this is what makes "what
  // happened on this calendar?" a single query.
  calendarId: number;
  targetType: AuditTargetType;
  targetId: number;
  action: CalendarAuditAction;
  // null means the system acted, not a person.
  actorUserId: number | null;
  source: AuditSource;
  requestId?: string | null;
  changes?: CalendarAuditChanges | null;
};

// Derives the audit source from HOW the call authenticated.
//
// Reads `req.user` — which only auth.middleware.ts sets, after verifying the
// JWT — and nothing else. It deliberately does NOT look at headers, the body or
// query parameters, so there is no input a client can supply that changes the
// recorded source. A test asserts exactly that by sending spoofing headers.
//
// "API" is in the vocabulary but unreachable today: there is no API-key
// authentication path to produce it.
export function auditSourceForRequest(req: { user?: unknown }): AuditSource {
  return req.user ? "WEB" : "SYSTEM";
}

// Builds the `changes` payload from a before/after pair, keeping ONLY the
// fields that actually differ.
//
// Two reasons this is not a whole-row snapshot: a snapshot would copy private
// events' titles and descriptions into the log on every edit, and it would grow
// the table to a multiple of the real content. It also means a PATCH that
// changes nothing writes no false from/to pair — pinned by a test.
export function diffChanges<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>
): CalendarAuditChanges | null {
  const changes: CalendarAuditChanges = {};

  for (const key of Object.keys(after)) {
    const next = after[key];
    // An absent key means "not being changed" — distinct from an explicit null,
    // which means "being cleared".
    if (next === undefined) continue;

    const previous = before[key];
    if (Object.is(normalise(previous), normalise(next))) continue;

    changes[key] = { from: normalise(previous), to: normalise(next) };
  }

  return Object.keys(changes).length > 0 ? changes : null;
}

// Dates compare by identity, not value, so an unchanged timestamp would look
// like a change on every write. Compared and stored as ISO strings.
function normalise(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value ?? null;
}

// Writes one audit row INSIDE the caller's transaction.
//
// Deliberately does NOT catch: a throw here must reach the caller so the
// surrounding transaction rolls back. That is the whole contract.
export async function writeCalendarAudit(
  tx: CalendarAuditClient,
  entry: CalendarAuditEntry
): Promise<void> {
  await tx.calendarAudit.create({
    data: {
      companyId: entry.companyId,
      calendarId: entry.calendarId,
      targetType: entry.targetType,
      targetId: entry.targetId,
      action: entry.action,
      actorUserId: entry.actorUserId,
      source: entry.source,
      requestId: entry.requestId ?? null,
      // JSON as a string, per the schema-wide convention.
      changes: entry.changes ? JSON.stringify(entry.changes) : null,
    },
  });
}

// The second level of the two-level write (§6.6).
//
// PERMISSION changes are security events and belong where the operator already
// looks for security events (/admin/logs). Event mutations are NOT mirrored:
// their volume would bury a log that sees a handful of rows a day.
//
// Called AFTER the transaction commits, and through the existing
// fire-and-forget logAudit(). That is deliberate: the transactional guarantee
// D13 demands is on CalendarAudit, and extending it to the global log would
// mean an AuditLog outage stops calendar writes for no additional benefit —
// the authoritative record is already durable by the time this runs.
export function mirrorPermissionChangeToAuditLog(entry: CalendarAuditEntry): void {
  if (!CALENDAR_AUDIT_ACTIONS_MIRRORED_TO_AUDIT_LOG.includes(entry.action)) return;

  void logAudit({
    action: AUDIT_ACTIONS.CALENDAR_PERMISSION_CHANGED,
    userId: entry.actorUserId,
    companyId: entry.companyId,
    metadata: {
      calendarId: entry.calendarId,
      calendarAction: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      source: entry.source,
      ...(entry.changes ? { changes: entry.changes } : {}),
    },
  });
}
