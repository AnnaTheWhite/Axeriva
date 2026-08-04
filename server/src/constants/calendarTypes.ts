// Calendar module vocabulary (CAL1.1) — the container types.
// See docs/calendar-system-plan.md §3 and docs/calendar-cal1-scope.md §7.3.
//
// Plain strings validated at the API layer rather than a Prisma enum, per the
// schema's standing rule (same reasoning as constants/notifications.ts): adding
// a calendar type later is then a data change, not a migration.
//
// The four types are NOT four data shapes — every one of them stores the same
// CalendarEvent. What differs is who owns the container and who may read it,
// which is why the type lives on Calendar and not on the event (plan §3).

export const CALENDAR_TYPES = ["PERSONAL", "COMPANY", "PROJECT", "EMPLOYEE"] as const;
export type CalendarType = (typeof CALENDAR_TYPES)[number];

export function isCalendarType(value: unknown): value is CalendarType {
  return typeof value === "string" && (CALENDAR_TYPES as readonly string[]).includes(value);
}

// PERSONAL is singled out throughout the permission layer (CAL1.3): it is the
// one type whose access the BUSINESS_OWNER role does NOT confer, because the
// content is not business data (R2, plan §4.6 step 3 / §4.8). Named here so the
// share-level API (CAL1.4) can express that exception without a bare string
// literal.
export const PRIVATE_BY_DEFAULT_CALENDAR_TYPE: CalendarType = "PERSONAL";

// The types whose permission authority is the COMPANY OWNER (plan §4.8) — i.e.
// the ones a BUSINESS_OWNER reaches by role alone, and the ones a DEVELOPER
// keeps cross-tenant access to.
//
// ⚠️ THIS IS AN ALLOW-LIST, AND THAT IS THE POINT. The obvious way to write the
// R2 exception is `type !== "PERSONAL"`, and it fails OPEN: `Calendar.type` is
// an unconstrained TEXT column (migration.sql:5) that nothing validates today,
// so a row reading "personal", "Personal", "PERSONAL " or a future "TEAM" would
// satisfy that test and hand the company owner — and a cross-tenant DEVELOPER —
// the full ten-permission set on a calendar that may well be someone's private
// one. Measured, not theorised: every one of those five values passes the
// deny-list form.
//
// Written out as literals rather than derived by filtering PERSONAL out of
// CALENDAR_TYPES, because deriving it would just move the deny-list up a level.
// A NEW calendar type must be added here BY HAND, after someone decides which
// authority governs it; until then it is invisible to owners and operators,
// which is the safe direction.
export const BUSINESS_AUTHORITY_CALENDAR_TYPES = ["COMPANY", "PROJECT", "EMPLOYEE"] as const;

export function isBusinessAuthorityCalendarType(value: string): boolean {
  return (BUSINESS_AUTHORITY_CALENDAR_TYPES as readonly string[]).includes(value);
}

// Which types carry which optional owner column on Calendar. Pinned as data so
// CAL1.4's create path and CAL1.1's tests agree on the shape without either
// re-deriving it: a PROJECT calendar without a projectId is a bug, not a
// variant. Enforced at the API layer — the schema keeps all three nullable
// because no single column is required by every type.
export const CALENDAR_OWNER_COLUMN: Record<CalendarType, "ownerUserId" | "projectId" | "employeeId" | null> = {
  PERSONAL: "ownerUserId",
  COMPANY: null,
  PROJECT: "projectId",
  EMPLOYEE: "employeeId",
};
