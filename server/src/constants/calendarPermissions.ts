// Calendar permission vocabulary (CAL1.3) — see docs/calendar-system-plan.md
// §4.3-§4.4 and docs/calendar-cal1-scope.md §2.
//
// This is the resource-level authorisation layer decision D2/R1: the three
// global JWT roles (DEVELOPER / BUSINESS_OWNER / EMPLOYEE) are NOT changed, and
// nothing in constants/roles.ts, the auth middleware or any existing router is
// touched. A calendar-scoped layer sits above them, so an EMPLOYEE can hold
// manager-level rights on one specific calendar without becoming a global
// admin — and so that adding the global ADMIN role later (constants/limits.ts
// already prices `admin_users` for a role that does not exist) stays a separate
// series that this layer keeps working underneath.
//
// Strings plus a registry, never a Prisma enum — the same rule the rest of the
// schema follows, so widening a preset is a data change rather than a
// migration.

// --- The ten permissions ---------------------------------------------------
//
// Two splits here are load-bearing rather than cosmetic:
//
//   view_free_busy / view_details is what lets scheduling and privacy hold at
//   the same time. The company can learn that someone is busy 09:00-10:30
//   without learning what they are doing. R4 makes this the cornerstone of the
//   personal-calendar model, which is why it is two permissions and not a
//   rendering flag.
//
//   _own / _any exists because without it a "manager" either edits everything
//   (including the calendar owner's private entry) or nothing at all.
export const CALENDAR_PERMISSIONS = [
  // Time slots only: "busy 09:00-10:30", with no title, description or
  // participants.
  "view_free_busy",
  // The full event content.
  "view_details",
  "event.create",
  "event.edit_own",
  "event.edit_any",
  "event.delete_own",
  "event.delete_any",
  "participant.invite",
  // Writing grants — i.e. sharing the calendar with someone else.
  "share",
  // Renaming, archiving, calendar settings.
  "manage",
] as const;

export type CalendarPermission = (typeof CALENDAR_PERMISSIONS)[number];

export function isCalendarPermission(value: unknown): value is CalendarPermission {
  return typeof value === "string" && (CALENDAR_PERMISSIONS as readonly string[]).includes(value);
}

// --- Implication -----------------------------------------------------------
//
// ONE DIRECTION ONLY. Seeing the details of an event necessarily means seeing
// that the slot is occupied, so view_details implies view_free_busy. The
// reverse must never hold: the whole point of the FREE_BUSY level is that it
// reveals occupancy WITHOUT content, and an implication in that direction would
// quietly hand every free/busy grantee the titles too.
const IMPLIES: Partial<Record<CalendarPermission, readonly CalendarPermission[]>> = {
  view_details: ["view_free_busy"],
};

// Closes a permission set under the implications above. Applied once at the end
// of resolution rather than at each grant, so it cannot be forgotten on one
// path and applied on another.
export function expandImplied(
  permissions: Iterable<CalendarPermission>
): Set<CalendarPermission> {
  const expanded = new Set<CalendarPermission>(permissions);
  for (const permission of [...expanded]) {
    for (const implied of IMPLIES[permission] ?? []) expanded.add(implied);
  }
  return expanded;
}

// --- The seven presets -----------------------------------------------------
//
// Bundles of permissions, NOT JWT roles — the names deliberately echo the
// product vision's five levels plus the two the refinements added. A preset
// expands at RESOLUTION time, so widening one upgrades every existing grant
// automatically; the same property the Feature Registry relies on.
export const CALENDAR_ROLE_PRESETS = [
  "OWNER",
  "ADMIN",
  "MANAGER",
  "MEMBER",
  "VIEWER",
  "FREE_BUSY",
  "CUSTOM",
] as const;

export type CalendarRolePreset = (typeof CALENDAR_ROLE_PRESETS)[number];

export function isCalendarRolePreset(value: unknown): value is CalendarRolePreset {
  return typeof value === "string" && (CALENDAR_ROLE_PRESETS as readonly string[]).includes(value);
}

export const CALENDAR_PRESET_PERMISSIONS: Record<
  CalendarRolePreset,
  readonly CalendarPermission[]
> = {
  // Everything, including the ability to give it away and to archive.
  OWNER: [...CALENDAR_PERMISSIONS],

  // Everything except `manage`: an admin runs the calendar's contents but
  // cannot rename or archive the calendar itself.
  ADMIN: CALENDAR_PERMISSIONS.filter((permission) => permission !== "manage"),

  // Note what is ABSENT: event.delete_any and share. A manager may reschedule
  // anyone's entry (edit_any) but may not delete other people's events, and may
  // not widen the calendar's audience. Deleting is the irreversible half.
  MANAGER: [
    "view_free_busy",
    "view_details",
    "event.create",
    "event.edit_own",
    "event.edit_any",
    "event.delete_own",
    "participant.invite",
  ],

  // A normal participant: contributes, and controls only their own entries.
  MEMBER: ["view_free_busy", "view_details", "event.create", "event.edit_own", "event.delete_own"],

  // Read the whole content, change nothing.
  VIEWER: ["view_free_busy", "view_details"],

  // R4's own level: occupancy and nothing else. This is what an employee can
  // give the company from a PERSONAL calendar without revealing any content —
  // it is the reason the view split exists.
  FREE_BUSY: ["view_free_busy"],

  // Empty by definition; the actual list lives in CalendarMember.permissions as
  // a JSON string. A CUSTOM grant with no stored list therefore grants NOTHING,
  // which is the safe direction.
  CUSTOM: [],
};

// --- CUSTOM expansion ------------------------------------------------------

// Parses CalendarMember.permissions (a JSON string, per the schema-wide "JSON
// is String?, never the Json column type" convention).
//
// NEVER THROWS, and every failure yields the EMPTY set. This is authorisation:
// unreadable stored data must fail closed. Unknown permission strings are
// dropped individually rather than voiding the whole grant, so a future
// permission name appearing in an old row degrades to "less access", never to
// "more".
export function parseCustomPermissions(raw: string | null | undefined): Set<CalendarPermission> {
  const permissions = new Set<CalendarPermission>();
  if (!raw) return permissions;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn("[calendar/permissions] unparseable CUSTOM permissions — granting nothing");
    return permissions;
  }

  if (!Array.isArray(parsed)) {
    console.warn("[calendar/permissions] CUSTOM permissions is not an array — granting nothing");
    return permissions;
  }

  for (const entry of parsed) {
    if (isCalendarPermission(entry)) permissions.add(entry);
  }
  return permissions;
}

// The permission set a single grant confers, before implication closure.
// An unrecognised preset grants nothing — again, failing closed.
export function permissionsForPreset(
  preset: string,
  customPermissions?: string | null
): Set<CalendarPermission> {
  if (!isCalendarRolePreset(preset)) {
    console.warn(`[calendar/permissions] unknown preset ${JSON.stringify(preset)} — granting nothing`);
    return new Set();
  }

  if (preset === "CUSTOM") return parseCustomPermissions(customPermissions);

  return new Set(CALENDAR_PRESET_PERMISSIONS[preset]);
}

// Ranks presets by breadth, for the privilege-escalation guard CAL1.4 needs:
// nobody may grant a preset wider than the one they themselves hold. CUSTOM is
// deliberately absent — its breadth depends on its stored list, so it must be
// compared by permission set rather than by rank.
export function presetPermissionCount(preset: CalendarRolePreset): number {
  return CALENDAR_PRESET_PERMISSIONS[preset].length;
}
