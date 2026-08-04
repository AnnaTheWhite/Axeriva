// CAL1.3 — the calendar permission gate. See docs/calendar-system-plan.md §4.6,
// §4.8 and §11.1-§11.3.
//
// THE MOST IMPORTANT FILE IN THE CALENDAR MODULE. Every API decision in CAL1.4
// and CAL1.5 rests on it, and an endpoint shipped without it cannot be
// retro-fitted behind one without a breaking change. That is why it lands
// before the first route exists and arrives with a full test matrix.
//
// PURE FUNCTIONS. No Prisma client, no database access, no Express. The caller
// loads the calendar with its members and hands both in — which is also what
// makes the 4 x 4 x 7 matrix testable without a fixture per cell.
//
// DEFAULT IS DENY. Every path that is not an explicit grant returns an empty
// set. There is no "allow unless" branch anywhere in this file, deliberately:
// the failure mode of a missing case must be no access, never total access.

import type { Prisma } from "@prisma/client";
import { ROLES } from "../../constants/roles";
import {
  type CalendarPermission,
  expandImplied,
  permissionsForPreset,
} from "../../constants/calendarPermissions";
import {
  BUSINESS_AUTHORITY_CALENDAR_TYPES,
  isBusinessAuthorityCalendarType,
} from "../../constants/calendarTypes";

// Who is asking. Deliberately NOT Express's AuthPayload: this stays free of the
// HTTP layer so it can be unit-tested, and so CAL1.4 can resolve access for a
// user other than the caller (the share-level screen needs exactly that).
export type CalendarActor = {
  id: number;
  // null for DEVELOPER, who belongs to no tenant.
  companyId: number | null;
  role: string;
  // Set only for EMPLOYEE-role logins.
  employeeId: number | null;
  // Defence in depth. auth.middleware.ts already re-checks `active` on EVERY
  // request (not just at login), so a live request cannot carry an inactive
  // user — this second gate exists because authorisation code should not
  // depend on a caller it cannot see having done the right thing.
  active?: boolean;
};

// One CalendarMember row, reduced to what resolution needs.
export type CalendarGrant = {
  principalType: string;
  // STRING, because a ROLE grant's principal is the role NAME, not a number.
  principalId: string;
  preset: string;
  permissions?: string | null;
};

// The calendar being accessed, plus its grants. The caller supplies the members
// (one Prisma `include`), so this function performs no query of its own.
export type CalendarSubject = {
  companyId: number;
  type: string;
  // Scalar on the row — survives the owner's account deletion.
  ownerUserId: number | null;
  archivedAt: Date | null;
  members: readonly CalendarGrant[];
};

const NO_ACCESS: ReadonlySet<CalendarPermission> = new Set<CalendarPermission>();

function ownerAccess(): Set<CalendarPermission> {
  return expandImplied(permissionsForPreset("OWNER"));
}

// Resolves what this actor may do on this calendar.
//
// The order below is §4.6 and is NOT rearrangeable — the most specific grant
// wins, and the early denials must precede the role shortcuts or a
// BUSINESS_OWNER would out-rank an archive.
//
//   0. inactive actor                         → DENY
//   0. archived calendar                      → DENY
//   1. DEVELOPER                              → OWNER, except on PERSONAL
//   -  foreign tenant                         → DENY
//   2. calendar.ownerUserId === actor.id      → OWNER
//   3. BUSINESS_OWNER && type !== PERSONAL    → OWNER              (R2)
//   4. CalendarMember(USER, actor.id)
//   5. CalendarMember(EMPLOYEE, actor.employeeId)
//   6. CalendarMember(ROLE, actor.role)
//   7. CalendarMember(COMPANY, actor.companyId)
//   8. DENY
export function resolveCalendarAccess(
  actor: CalendarActor,
  calendar: CalendarSubject
): Set<CalendarPermission> {
  // Step 0a — an account that has been soft-deleted or offboarded holds
  // nothing, whatever grants still name it.
  if (actor.active === false) return new Set(NO_ACCESS);

  // Step 0b — an archived calendar is closed to everyone, including its owner.
  //
  // ⚠️ CONSEQUENCE FOR CAL1.4: un-archiving therefore cannot authorise itself
  // through this function, because by then nobody has `manage`. The un-archive
  // endpoint must resolve against the calendar as if it were active, or be
  // restricted to the owner/company owner explicitly. Flagged rather than
  // solved here — CAL1.3 ships no endpoints.
  if (calendar.archivedAt !== null) return new Set(NO_ACCESS);

  // Step 1 — DEVELOPER (D12 / §11.3).
  //
  // This is the first place in the system where companyScope()'s default is
  // WRONG. companyScope() returns an empty where-clause for DEVELOPER, i.e.
  // every tenant's every row; for PERSONAL calendars that is a privacy problem
  // rather than a convenience. A platform operator keeps the cross-tenant
  // access they have today on COMPANY/PROJECT/EMPLOYEE calendars — the support
  // need is real and §11.3 preserves it in those words — and gets NOTHING on
  // anyone's personal calendar. If support ever genuinely needs that, §11.3
  // says it must be an explicit, audited action, not a silent default.
  if (actor.role === ROLES.DEVELOPER) {
    // Allow-list, not `!== "PERSONAL"`. Calendar.type is an unconstrained TEXT
    // column, so the deny-list form would hand a cross-tenant operator full
    // access to any row whose type is not byte-identical to "PERSONAL".
    if (!isBusinessAuthorityCalendarType(calendar.type)) return new Set(NO_ACCESS);
    return ownerAccess();
  }

  // Tenant isolation, before any grant is consulted. Everything below this line
  // has already been proven to be same-tenant, which is why the grant lookups
  // can compare ids without re-checking the company.
  if (actor.companyId === null || actor.companyId !== calendar.companyId) {
    return new Set(NO_ACCESS);
  }

  // Step 2 — the calendar's own owner. Applies to PERSONAL calendars too: the
  // whole point is that the employee controls their own.
  if (calendar.ownerUserId !== null && calendar.ownerUserId === actor.id) {
    return ownerAccess();
  }

  // Step 3 — the company owner, WITH THE PERSONAL EXCEPTION.
  //
  // This single condition is the only technical guarantee behind R2. Without
  // `type !== PERSONAL`, "personal calendar" would be a label rather than a
  // property: the BUSINESS_OWNER would read every employee's private entries by
  // virtue of their role, and the word "private" on the UI would be false.
  // Access to a PERSONAL calendar is reachable ONLY through steps 4-7, i.e.
  // only through a grant the employee themselves created (§4.8).
  //
  // Expressed as an ALLOW-LIST of the three business-authority types. The
  // natural `type !== "PERSONAL"` reads the same but fails open on any
  // non-canonical stored value — see BUSINESS_AUTHORITY_CALENDAR_TYPES.
  if (actor.role === ROLES.BUSINESS_OWNER && isBusinessAuthorityCalendarType(calendar.type)) {
    return ownerAccess();
  }

  // Steps 4-7 — explicit grants, most specific first. The first match wins and
  // resolution stops; grants are NOT unioned, because "most specific wins" is
  // what lets a company-wide VIEWER grant be narrowed for one person.
  const lookup: Array<[string, string | null]> = [
    ["USER", String(actor.id)],
    ["EMPLOYEE", actor.employeeId === null ? null : String(actor.employeeId)],
    ["ROLE", actor.role],
    ["COMPANY", String(actor.companyId)],
  ];

  for (const [principalType, principalId] of lookup) {
    if (principalId === null) continue;

    const grant = calendar.members.find(
      (member) => member.principalType === principalType && member.principalId === principalId
    );
    if (!grant) continue;

    return expandImplied(permissionsForPreset(grant.preset, grant.permissions));
  }

  // Step 8 — no grant anywhere.
  return new Set(NO_ACCESS);
}

// Convenience predicate. Exists so call sites read as a question about one
// permission rather than as set plumbing, and so CAL1.5 cannot accidentally
// test membership against a set it forgot to expand.
export function hasCalendarPermission(
  actor: CalendarActor,
  calendar: CalendarSubject,
  permission: CalendarPermission
): boolean {
  return resolveCalendarAccess(actor, calendar).has(permission);
}

// The set of calendars whose EVENTS this actor may read (at least free/busy),
// expressed as a Prisma filter.
//
// §11.1: the permission filter belongs IN the query, never after it. Filtering
// a page of results afterwards makes pagination and counts lie — the user is
// told there are 40 events and shown 12.
//
// This deliberately does NOT call companyScope(). companyScope() hands DEVELOPER
// an empty where-clause, which here would mean every tenant's personal
// calendars; the tenant filter is therefore built in below (§11.3).
//
// ⚠️ KNOWN LIMIT — this filter is a sound OVER-approximation, and CAL1.5 must
// still run resolveCalendarAccess per calendar (which it does anyway, to choose
// between free/busy and detail serialisation). A CUSTOM grant whose stored
// permission list is empty or unparseable grants nothing, but SQL cannot read
// inside the JSON string, so such a calendar still matches here. The error is
// one-directional by construction: this can include a calendar the resolver
// then denies, and can never omit one the resolver would allow.
export function visibleCalendarFilter(actor: CalendarActor): Prisma.CalendarWhereInput {
  // An inactive actor matches nothing. `id: { in: [] }` is an empty IN, which
  // Postgres evaluates to false for every row — an explicit impossible filter
  // rather than a silently absent one.
  if (actor.active === false) return { id: { in: [] } };

  // DEVELOPER: every tenant, but never a personal calendar.
  if (actor.role === ROLES.DEVELOPER) {
    return {
      archivedAt: null,
      // `in` rather than `not: "PERSONAL"`: the deny-list form would LIST a row
      // whose type reads "personal" straight from the query, and §11.1 forbids
      // repairing that afterwards.
      type: { in: [...BUSINESS_AUTHORITY_CALENDAR_TYPES] },
    };
  }

  // A tenant-less non-DEVELOPER cannot see anything.
  if (actor.companyId === null) return { id: { in: [] } };

  const principalMatches: Prisma.CalendarMemberWhereInput[] = [
    { principalType: "USER", principalId: String(actor.id) },
    { principalType: "ROLE", principalId: actor.role },
    { principalType: "COMPANY", principalId: String(actor.companyId) },
  ];
  if (actor.employeeId !== null) {
    principalMatches.push({
      principalType: "EMPLOYEE",
      principalId: String(actor.employeeId),
    });
  }

  const reachable: Prisma.CalendarWhereInput[] = [
    // Their own calendar.
    { ownerUserId: actor.id },
    // Any explicit grant naming them.
    { members: { some: { OR: principalMatches } } },
  ];

  // The company owner reaches every business-authority calendar by role — and,
  // because this is an allow-list, no personal calendar at all (R2), nor any
  // row whose type is not one of the three canonical business values.
  if (actor.role === ROLES.BUSINESS_OWNER) {
    reachable.push({ type: { in: [...BUSINESS_AUTHORITY_CALENDAR_TYPES] } });
  }

  return {
    // Tenant isolation, carried by the filter itself.
    companyId: actor.companyId,
    archivedAt: null,
    OR: reachable,
  };
}
