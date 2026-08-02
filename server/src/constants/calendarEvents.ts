// Calendar module vocabulary (CAL1.1) — event and membership string columns.
// See docs/calendar-cal1-scope.md §7.3.
//
// Same rule as constants/calendarTypes.ts and constants/notifications.ts:
// strings plus a registry, never a Prisma enum. Nothing reads these yet — the
// event API lands at CAL1.5 — but the columns they describe are created now, so
// the vocabulary is committed alongside the migration rather than after it.

// --- Event lifecycle -------------------------------------------------------
// iCal-compatible names on purpose. Phase 4 (external sync) is explicitly out
// of scope for CAL1-CAL3 (R7), but a status vocabulary that already matches
// RFC 5545 costs nothing today and avoids a translation table if sync ever
// arrives. "cancelled" is a status, not a delete: a cancelled occurrence stays
// visible to participants who need to know it is off.
export const EVENT_STATUSES = ["confirmed", "tentative", "cancelled"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export function isEventStatus(value: unknown): value is EventStatus {
  return typeof value === "string" && (EVENT_STATUSES as readonly string[]).includes(value);
}

export const DEFAULT_EVENT_STATUS: EventStatus = "confirmed";

// --- Event visibility ------------------------------------------------------
// Layered ON TOP of the calendar-level permission (plan §4.7), not instead of
// it. This is what makes "private events" work without a second table:
//   default      — the calendar's permission decides, nothing further
//   private      — creator and participants see the details; everyone else who
//                  can read the calendar sees an untitled "Busy" block
//   confidential — creator and participants see it; to everyone else the slot
//                  looks free, i.e. the event's EXISTENCE is hidden too
// The difference between the last two is the whole point: "private" still
// blocks the time (so scheduling works), "confidential" does not admit there
// is anything there at all.
export const EVENT_VISIBILITIES = ["default", "private", "confidential"] as const;
export type EventVisibility = (typeof EVENT_VISIBILITIES)[number];

export function isEventVisibility(value: unknown): value is EventVisibility {
  return typeof value === "string" && (EVENT_VISIBILITIES as readonly string[]).includes(value);
}

export const DEFAULT_EVENT_VISIBILITY: EventVisibility = "default";

// --- Participant responses -------------------------------------------------
// CalendarParticipant.response. The table is created at CAL1.1 and stays EMPTY
// until CAL2.1 — participants, invitations and RSVP are out of CAL1 scope
// (scope §4). Listed now for the same reason as the PUSH/SMS channels in
// constants/notifications.ts: the column vocabulary should not need widening
// when the feature ships.
export const PARTICIPANT_RESPONSES = ["needs_action", "accepted", "declined", "tentative"] as const;
export type ParticipantResponse = (typeof PARTICIPANT_RESPONSES)[number];

export function isParticipantResponse(value: unknown): value is ParticipantResponse {
  return typeof value === "string" && (PARTICIPANT_RESPONSES as readonly string[]).includes(value);
}

export const DEFAULT_PARTICIPANT_RESPONSE: ParticipantResponse = "needs_action";

// --- Grantee types ---------------------------------------------------------
// CalendarMember.principalType — "who is this permission grant about?" (plan
// §4.5). These four cover the whole sharing model:
//   USER     — one specific login
//   EMPLOYEE — the worker record a login is bound to
//   ROLE     — everyone holding a given JWT role ("EMPLOYEE", "BUSINESS_OWNER")
//   COMPANY  — every active user of the tenant
//
// NOTE the matching column is `principalId String`, not Int: a ROLE grant's
// principal is the role NAME. That is the only reason the column is a string,
// and it is why every read of it must go through the resolution order in
// services/calendar/permissions.ts (CAL1.3) rather than comparing ids inline.
export const PRINCIPAL_TYPES = ["USER", "EMPLOYEE", "ROLE", "COMPANY"] as const;
export type PrincipalType = (typeof PRINCIPAL_TYPES)[number];

export function isPrincipalType(value: unknown): value is PrincipalType {
  return typeof value === "string" && (PRINCIPAL_TYPES as readonly string[]).includes(value);
}
