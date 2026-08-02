// Calendar audit vocabulary (CAL1.1, decision D13) — see
// docs/calendar-system-plan.md §6.6 and docs/calendar-cal1-scope.md §7.3.
//
// The CalendarAudit table is created at CAL1.1 and stays EMPTY until CAL1.4:
// this file is the vocabulary only, there is no writer yet
// (services/calendar/audit.ts lands with the first write endpoint, so that no
// window exists in which a calendar permission can change unlogged). The audit
// READER is CAL2.6.
//
// Two things about this table differ from the rest of the repo's audit story,
// both deliberately:
//
//  1. It is POLYMORPHIC (targetType + targetId, the OwnerNoteConversion
//     pattern). The original design keyed the table on eventId, which could not
//     have recorded a permission change — that happens on the Calendar or the
//     CalendarMember, not on any event.
//  2. It is written in the SAME TRANSACTION as the mutation it describes,
//     unlike the fire-and-forget logAudit(). If the audit write fails the
//     mutation rolls back: "no audit, no change". A log with silent holes is
//     worse than no log, because nobody can tell where the holes are.

// --- Actions ---------------------------------------------------------------
// An object map rather than a bare array, matching constants/auditActions.ts —
// writers reference these by name, so a typo is a compile error rather than a
// row nobody ever queries.
export const CALENDAR_AUDIT_ACTIONS = {
  // Container lifecycle (written by CAL1.4). ARCHIVED, not DELETED: DELETE
  // /calendars/:id sets archivedAt, it never removes the row.
  CALENDAR_CREATED: "CALENDAR_CREATED",
  CALENDAR_UPDATED: "CALENDAR_UPDATED",
  CALENDAR_ARCHIVED: "CALENDAR_ARCHIVED",

  // Event lifecycle (written by CAL1.5).
  //
  // EVENT_CREATED is a DELIBERATE departure from the rule stated in the header
  // of constants/auditActions.ts ("entity-creation events are NOT listed here —
  // the timeline derives those from each row's createdAt"). That rule holds
  // where rows are not deleted; events ARE deleted, and the deletion takes
  // createdByUserId and createdAt with it. The one question the audit exists to
  // answer — who created the thing that was later removed? — would be exactly
  // the one it could not answer. The audit row outlives the event.
  EVENT_CREATED: "EVENT_CREATED",
  EVENT_UPDATED: "EVENT_UPDATED",
  EVENT_DELETED: "EVENT_DELETED",

  // Permission changes (written by CAL1.4). These are the rows that also go to
  // the global AuditLog — see CALENDAR_AUDIT_ACTIONS_MIRRORED_TO_AUDIT_LOG.
  MEMBER_GRANTED: "MEMBER_GRANTED",
  MEMBER_UPDATED: "MEMBER_UPDATED",
  MEMBER_REVOKED: "MEMBER_REVOKED",
  SHARE_LEVEL_CHANGED: "SHARE_LEVEL_CHANGED",

  // Participants (CAL2.1 — vocabulary only in CAL1, nothing writes these).
  PARTICIPANT_ADDED: "PARTICIPANT_ADDED",
  PARTICIPANT_REMOVED: "PARTICIPANT_REMOVED",
  PARTICIPANT_RESPONDED: "PARTICIPANT_RESPONDED",
} as const;

export type CalendarAuditAction =
  (typeof CALENDAR_AUDIT_ACTIONS)[keyof typeof CALENDAR_AUDIT_ACTIONS];

export const CALENDAR_AUDIT_ACTION_LIST = Object.values(
  CALENDAR_AUDIT_ACTIONS
) as readonly CalendarAuditAction[];

export function isCalendarAuditAction(value: unknown): value is CalendarAuditAction {
  return typeof value === "string" && (CALENDAR_AUDIT_ACTION_LIST as readonly string[]).includes(value);
}

// Which actions are ALSO mirrored into the global AuditLog (plan §6.6, the
// two-level write). Permission changes are security events and belong where the
// operator already looks for security events (/admin/logs). Event mutations are
// not: their volume would bury a log that sees a handful of rows a day.
export const CALENDAR_AUDIT_ACTIONS_MIRRORED_TO_AUDIT_LOG: readonly CalendarAuditAction[] = [
  CALENDAR_AUDIT_ACTIONS.MEMBER_GRANTED,
  CALENDAR_AUDIT_ACTIONS.MEMBER_UPDATED,
  CALENDAR_AUDIT_ACTIONS.MEMBER_REVOKED,
  CALENDAR_AUDIT_ACTIONS.SHARE_LEVEL_CHANGED,
];

// --- Target types ----------------------------------------------------------
// What targetId points at. The polymorphic half of the table.
export const AUDIT_TARGET_TYPES = ["CALENDAR", "EVENT", "MEMBER", "PARTICIPANT"] as const;
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

export function isAuditTargetType(value: unknown): value is AuditTargetType {
  return typeof value === "string" && (AUDIT_TARGET_TYPES as readonly string[]).includes(value);
}

// --- Sources ---------------------------------------------------------------
// Which authentication path the mutation arrived through.
//
//   WEB    — the request carried a JWT (req.user is set)
//   API    — future API-key authentication. NOT reachable in CAL1: there is no
//            such path yet. Listed from day one for the same reason the
//            notification module lists PUSH/SMS — so the column vocabulary
//            never needs widening when the channel ships.
//   SYSTEM — no request at all: worker, sweep, cron, webhook
//
// THE rule for this field: it is derived SERVER-SIDE from how the call
// authenticated, and is never read from a request header or body. A
// client-settable `source` would make the audit table lie about precisely the
// field an investigation would start from.
export const AUDIT_SOURCES = ["WEB", "API", "SYSTEM"] as const;
export type AuditSource = (typeof AUDIT_SOURCES)[number];

export function isAuditSource(value: unknown): value is AuditSource {
  return typeof value === "string" && (AUDIT_SOURCES as readonly string[]).includes(value);
}
