import { Router, Request, Response } from "express";
import prisma from "../database/prisma";
import { createRateLimiter } from "../middleware/rateLimit.middleware";
import { RATE_LIMITS } from "../constants/rateLimits";
import { ROLES } from "../constants/roles";
import { isBusinessAuthorityCalendarType, isCalendarType } from "../constants/calendarTypes";
import { isPrincipalType } from "../constants/calendarEvents";
import {
  type CalendarPermission,
  type CalendarRolePreset,
  SHARE_LEVEL_PRESET,
  expandImplied,
  isCalendarRolePreset,
  isCalendarShareLevel,
  permissionsForPreset,
  shareLevelForCompanyGrant,
} from "../constants/calendarPermissions";
import { CALENDAR_AUDIT_ACTIONS } from "../constants/calendarAuditActions";
import {
  type CalendarActor,
  type CalendarSubject,
  resolveCalendarAccess,
  visibleCalendarFilter,
} from "../services/calendar/permissions";
import {
  type CalendarAuditEntry,
  auditSourceForRequest,
  diffChanges,
  mirrorPermissionChangeToAuditLog,
  writeCalendarAudit,
} from "../services/calendar/audit";

const router = Router();

// CAL1.4 — the calendar module's first WRITE surface.
//
// Mounted through `tenantWrite` in app.ts, so a read-only (lapsed) company
// inherits the write block automatically — GET/HEAD/OPTIONS always pass.
//
// NO UI CALLS ANY OF THIS. The calendar becomes visible at CAL1.6; until then
// these endpoints exist so the data and permission layers can be exercised for
// real. Rollback is removing the one mount line in app.ts.
//
// THE RULE EVERY HANDLER FOLLOWS: no route reads a Calendar row directly.
// Access goes through services/calendar/permissions.ts (CAL1.3), and the tenant
// filter is carried by that gate rather than by companyScope() — which returns
// an empty where-clause for DEVELOPER and would therefore expose every tenant's
// personal calendars (plan §11.3).
//
// 404 vs 403, applied consistently:
//   * cannot see the calendar at all  → 404, indistinguishable from "no such
//     calendar". Anything else would let a company owner enumerate which of
//     their employees have personal calendars, which is the R2 guarantee
//     leaking through a status code.
//   * can see it but lacks the specific permission → 403.

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

// Keyed per USER rather than per IP: this is authenticated tenant self-service,
// so the thing worth bounding is one account rewriting its sharing in a loop,
// not a shared office NAT. Applied to the WRITE endpoints only — reads stay
// unlimited, exactly as the notification preference limiter does.
const calendarWriteLimiter = createRateLimiter({
  name: "calendar-writes",
  ...RATE_LIMITS.CALENDAR_WRITES,
  keyGenerator: (req) => (req.user ? String(req.user.userId) : req.ip ?? "unknown"),
});

function actorFrom(req: Request): CalendarActor {
  return {
    id: req.user!.userId,
    companyId: req.user!.companyId,
    role: req.user!.role,
    employeeId: req.user!.employeeId,
  };
}

// Every audit row this router writes derives its source HERE, from the
// authentication path. Never from a header, never from the body.
function auditBase(req: Request) {
  return {
    actorUserId: req.user!.userId,
    source: auditSourceForRequest(req),
    requestId: req.id ?? null,
  };
}

type LoadedGrant = {
  id: number;
  principalType: string;
  principalId: string;
  preset: string;
  permissions: string | null;
  grantedByUserId: number | null;
};

// Omit<…, "members"> rather than a plain intersection: CalendarSubject.members
// is the narrow shape the permission gate needs, and intersecting would keep
// that narrower type here, hiding the row id the member endpoints address rows
// by. LoadedGrant is still assignable to CalendarGrant, so a LoadedCalendar
// satisfies CalendarSubject wherever the resolver wants one.
type LoadedCalendar = Omit<CalendarSubject, "members"> & {
  id: number;
  name: string;
  description: string | null;
  color: string | null;
  timezone: string | null;
  projectId: number | null;
  employeeId: number | null;
  isDefault: boolean;
  members: LoadedGrant[];
};

// Loads a calendar WITH its grants and resolves what the caller may do on it.
//
// Returns null when the caller may not see it at all — the 404 case. Note the
// lookup itself is not tenant-filtered: resolveCalendarAccess applies tenant
// isolation before consulting any grant, so a foreign-tenant row resolves to an
// empty permission set and becomes the same 404 as a non-existent id.
async function loadCalendarFor(
  actor: CalendarActor,
  calendarId: number
): Promise<{ calendar: LoadedCalendar; permissions: Set<CalendarPermission> } | null> {
  if (!Number.isInteger(calendarId)) return null;

  const calendar = (await prisma.calendar.findUnique({
    where: { id: calendarId },
    include: { members: true },
  })) as LoadedCalendar | null;

  if (!calendar) return null;

  const permissions = resolveCalendarAccess(actor, calendar);
  if (permissions.size === 0) return null;

  return { calendar, permissions };
}

function serializeCalendar(calendar: LoadedCalendar, permissions: Set<CalendarPermission>) {
  return {
    id: calendar.id,
    companyId: calendar.companyId,
    type: calendar.type,
    name: calendar.name,
    description: calendar.description,
    color: calendar.color,
    timezone: calendar.timezone,
    ownerUserId: calendar.ownerUserId,
    projectId: calendar.projectId,
    employeeId: calendar.employeeId,
    isDefault: calendar.isDefault,
    archivedAt: calendar.archivedAt,
    // What THIS caller may do, so the UI never has to guess.
    permissions: [...permissions].sort(),
  };
}

// The permission set a preset would confer, used by the escalation guard.
function permissionsOf(preset: CalendarRolePreset, custom?: string | null): Set<CalendarPermission> {
  return expandImplied(permissionsForPreset(preset, custom));
}

// §11.2 — "nobody may grant a preset wider than the one they hold".
//
// Compared as SETS rather than by preset rank, because CUSTOM's breadth depends
// on its stored list and cannot be ranked. Without this, anyone holding `share`
// could grant themselves OWNER and then do anything at all — the classic
// self-escalation, and the reason `share` is deliberately absent from MANAGER.
function grantsBeyond(
  granted: Set<CalendarPermission>,
  held: Set<CalendarPermission>
): CalendarPermission[] {
  return [...granted].filter((permission) => !held.has(permission));
}

// ---------------------------------------------------------------------------
// Calendars
// ---------------------------------------------------------------------------

// GET /calendars — every calendar whose contents this caller may read.
//
// The permission filter is IN the query (§11.1). Filtering a page afterwards
// would make counts and pagination lie.
router.get("/", async (req: Request, res: Response) => {
  const actor = actorFrom(req);

  const calendars = (await prisma.calendar.findMany({
    where: visibleCalendarFilter(actor),
    include: { members: true },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  })) as LoadedCalendar[];

  // visibleCalendarFilter is a deliberate over-approximation (SQL cannot read
  // inside the CUSTOM permissions JSON), so the resolver has the final word.
  // It can only ever remove rows here, never add them.
  const visible = calendars
    .map((calendar) => ({ calendar, permissions: resolveCalendarAccess(actor, calendar) }))
    .filter((entry) => entry.permissions.size > 0)
    .map((entry) => serializeCalendar(entry.calendar, entry.permissions));

  res.json(visible);
});

// The columns that identify a calendar of each type, for find-then-create.
function identityFor(type: string, actor: CalendarActor, body: Record<string, unknown>) {
  switch (type) {
    case "PERSONAL":
      // Always the CALLER's own. A personal calendar is never created for
      // somebody else, by anybody — that is R2 at the create path.
      return { ownerUserId: actor.id, projectId: null, employeeId: null };
    case "EMPLOYEE":
      return {
        ownerUserId: null,
        projectId: null,
        employeeId: Number(body.employeeId),
      };
    case "PROJECT":
      return { ownerUserId: null, projectId: Number(body.projectId), employeeId: null };
    default:
      return { ownerUserId: null, projectId: null, employeeId: null };
  }
}

// POST /calendars — lazy, find-then-create (Q5).
//
// find-then-create rather than a bare create, because CAL1.1 recorded that
// "one default calendar per user" is NOT expressible in a Prisma schema — it
// would need a partial unique index (WHERE isDefault). So the invariant lives
// here.
//
// ⚠️ KNOWN LIMIT, inherited from that: two genuinely concurrent creates can
// still both miss the find and both insert, because there is no unique
// constraint to catch the loser. The window is small and the consequence is a
// duplicate calendar rather than a security failure. Closing it properly needs
// the partial index CAL1.1 deferred; recorded here rather than papered over.
router.post("/", calendarWriteLimiter, async (req: Request, res: Response) => {
  const actor = actorFrom(req);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const type = String(body.type ?? "");

  // The validation CAL1.3 deferred to this milestone. Calendar.type is an
  // unconstrained TEXT column and the permission gate branches on it, so an
  // unvalidated value written here is a permission question, not a data-quality
  // one.
  if (!isCalendarType(type)) {
    return res.status(400).json({ error: "type must be one of PERSONAL, COMPANY, PROJECT, EMPLOYEE" });
  }

  if (actor.companyId === null) {
    return res.status(403).json({ error: "A company is required to create a calendar" });
  }

  // §4.8 — who governs which type. The company owner governs the business
  // calendars; a PERSONAL calendar is created by, and only for, its own user.
  if (type !== "PERSONAL" && actor.role !== ROLES.BUSINESS_OWNER) {
    return res.status(403).json({ error: "Only the company owner can create this calendar type" });
  }

  const identity = identityFor(type, actor, body);

  if (type === "PROJECT") {
    if (!Number.isInteger(identity.projectId)) {
      return res.status(400).json({ error: "projectId is required" });
    }
    // Re-resolved under the caller's tenant — the shifts.routes.ts pattern
    // (§11.2). A body id is never trusted to belong to this company.
    const project = await prisma.project.findFirst({
      where: { id: identity.projectId!, companyId: actor.companyId },
    });
    if (!project) return res.status(404).json({ error: "Project not found" });
  }

  if (type === "EMPLOYEE") {
    if (!Number.isInteger(identity.employeeId)) {
      return res.status(400).json({ error: "employeeId is required" });
    }
    const employee = await prisma.employee.findFirst({
      where: { id: identity.employeeId!, companyId: actor.companyId },
    });
    if (!employee) return res.status(404).json({ error: "Employee not found" });
  }

  const existing = await prisma.calendar.findFirst({
    where: { companyId: actor.companyId, type, ...identity, archivedAt: null },
    include: { members: true },
  });

  if (existing) {
    // Idempotent by design: "first use" may happen twice.
    const permissions = resolveCalendarAccess(actor, existing as LoadedCalendar);
    return res.status(200).json(serializeCalendar(existing as LoadedCalendar, permissions));
  }

  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : defaultName(type);

  const created = await prisma.$transaction(async (tx) => {
    const calendar = await tx.calendar.create({
      data: {
        companyId: actor.companyId!,
        type,
        name,
        description: typeof body.description === "string" ? body.description : null,
        color: typeof body.color === "string" ? body.color : null,
        timezone: typeof body.timezone === "string" ? body.timezone : null,
        ...identity,
      },
    });

    // Audit inside the same transaction — if this insert fails the calendar is
    // not created either (D13).
    await writeCalendarAudit(tx, {
      ...auditBase(req),
      companyId: actor.companyId!,
      calendarId: calendar.id,
      targetType: "CALENDAR",
      targetId: calendar.id,
      action: CALENDAR_AUDIT_ACTIONS.CALENDAR_CREATED,
      changes: { name: { from: null, to: name }, type: { from: null, to: type } },
    });

    return calendar;
  });

  const reloaded = (await prisma.calendar.findUnique({
    where: { id: created.id },
    include: { members: true },
  })) as LoadedCalendar;

  res.status(201).json(serializeCalendar(reloaded, resolveCalendarAccess(actor, reloaded)));
});

function defaultName(type: string): string {
  switch (type) {
    case "PERSONAL":
      return "Personal";
    case "COMPANY":
      return "Company";
    case "PROJECT":
      return "Project";
    default:
      return "Employee";
  }
}

// GET /calendars/:id
router.get("/:id", async (req: Request, res: Response) => {
  const actor = actorFrom(req);
  const loaded = await loadCalendarFor(actor, Number(req.params.id));
  if (!loaded) return res.status(404).json({ error: "Calendar not found" });

  res.json(serializeCalendar(loaded.calendar, loaded.permissions));
});

// PATCH /calendars/:id — settings. Requires `manage`.
router.patch("/:id", calendarWriteLimiter, async (req: Request, res: Response) => {
  const actor = actorFrom(req);
  const loaded = await loadCalendarFor(actor, Number(req.params.id));
  if (!loaded) return res.status(404).json({ error: "Calendar not found" });
  if (!loaded.permissions.has("manage")) {
    return res.status(403).json({ error: "You cannot manage this calendar" });
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  for (const field of ["name", "description", "color", "timezone"] as const) {
    if (!(field in body)) continue;
    const value = body[field];
    if (field === "name") {
      if (typeof value !== "string" || !value.trim()) {
        return res.status(400).json({ error: "name cannot be empty" });
      }
      updates.name = value.trim();
    } else {
      updates[field] = value === null ? null : String(value);
    }
  }

  // `type` is deliberately NOT updatable. Changing it would move the calendar
  // between permission authorities — a PERSONAL calendar could be turned into a
  // COMPANY one and its contents handed to the company owner in a single PATCH.
  if ("type" in body) {
    return res.status(400).json({ error: "type cannot be changed" });
  }

  const changes = diffChanges(loaded.calendar as unknown as Record<string, unknown>, updates);
  if (!changes) {
    // A no-op PATCH writes NO audit row — the log must not fill with false
    // from/to pairs.
    return res.json(serializeCalendar(loaded.calendar, loaded.permissions));
  }

  await prisma.$transaction(async (tx) => {
    await tx.calendar.update({ where: { id: loaded.calendar.id }, data: updates });
    await writeCalendarAudit(tx, {
      ...auditBase(req),
      companyId: loaded.calendar.companyId,
      calendarId: loaded.calendar.id,
      targetType: "CALENDAR",
      targetId: loaded.calendar.id,
      action: CALENDAR_AUDIT_ACTIONS.CALENDAR_UPDATED,
      changes,
    });
  });

  const reloaded = (await prisma.calendar.findUnique({
    where: { id: loaded.calendar.id },
    include: { members: true },
  })) as LoadedCalendar;

  res.json(serializeCalendar(reloaded, resolveCalendarAccess(actor, reloaded)));
});

// DELETE /calendars/:id — ARCHIVE, never a physical delete. The events and the
// audit trail must remain readable.
router.delete("/:id", calendarWriteLimiter, async (req: Request, res: Response) => {
  const actor = actorFrom(req);
  const loaded = await loadCalendarFor(actor, Number(req.params.id));
  if (!loaded) return res.status(404).json({ error: "Calendar not found" });
  if (!loaded.permissions.has("manage")) {
    return res.status(403).json({ error: "You cannot manage this calendar" });
  }

  const archivedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.calendar.update({ where: { id: loaded.calendar.id }, data: { archivedAt } });
    await writeCalendarAudit(tx, {
      ...auditBase(req),
      companyId: loaded.calendar.companyId,
      calendarId: loaded.calendar.id,
      targetType: "CALENDAR",
      targetId: loaded.calendar.id,
      action: CALENDAR_AUDIT_ACTIONS.CALENDAR_ARCHIVED,
      changes: { archivedAt: { from: null, to: archivedAt.toISOString() } },
    });
  });

  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Members — the grant rows that ARE the permission model
// ---------------------------------------------------------------------------

// GET /calendars/:id/members — who has what. Requires `share` or `manage`:
// the grant list names people, so it is not ordinary calendar content.
router.get("/:id/members", async (req: Request, res: Response) => {
  const actor = actorFrom(req);
  const loaded = await loadCalendarFor(actor, Number(req.params.id));
  if (!loaded) return res.status(404).json({ error: "Calendar not found" });
  if (!loaded.permissions.has("share") && !loaded.permissions.has("manage")) {
    return res.status(403).json({ error: "You cannot see this calendar's sharing" });
  }

  res.json(
    loaded.calendar.members.map((member) => ({
      id: member.id,
      principalType: member.principalType,
      principalId: member.principalId,
      preset: member.preset,
      permissions: member.permissions ? JSON.parse(member.permissions) : null,
      grantedByUserId: member.grantedByUserId,
    }))
  );
});

type GrantInput = {
  principalType: string;
  principalId: string;
  preset: CalendarRolePreset;
  permissions: string | null;
};

function parseGrant(body: Record<string, unknown>): GrantInput | { error: string } {
  const principalType = String(body.principalType ?? "");
  if (!isPrincipalType(principalType)) {
    return { error: "principalType must be one of USER, EMPLOYEE, ROLE, COMPANY" };
  }

  const principalId = String(body.principalId ?? "").trim();
  if (!principalId) return { error: "principalId is required" };

  const preset = String(body.preset ?? "");
  if (!isCalendarRolePreset(preset)) return { error: "preset is not a known calendar role" };

  let permissions: string | null = null;
  if (preset === "CUSTOM") {
    if (!Array.isArray(body.permissions)) {
      return { error: "CUSTOM requires a permissions array" };
    }
    permissions = JSON.stringify(body.permissions);
  }

  return { principalType, principalId, preset, permissions };
}

// POST /calendars/:id/members — grant. Requires `share`.
router.post("/:id/members", calendarWriteLimiter, async (req: Request, res: Response) => {
  const actor = actorFrom(req);
  const loaded = await loadCalendarFor(actor, Number(req.params.id));
  if (!loaded) return res.status(404).json({ error: "Calendar not found" });
  if (!loaded.permissions.has("share")) {
    return res.status(403).json({ error: "You cannot share this calendar" });
  }

  const parsed = parseGrant((req.body ?? {}) as Record<string, unknown>);
  if ("error" in parsed) return res.status(400).json({ error: parsed.error });

  const beyond = grantsBeyond(permissionsOf(parsed.preset, parsed.permissions), loaded.permissions);
  if (beyond.length > 0) {
    return res.status(403).json({
      error: `You cannot grant permissions you do not hold: ${beyond.sort().join(", ")}`,
    });
  }

  const duplicate = loaded.calendar.members.find(
    (member) =>
      member.principalType === parsed.principalType && member.principalId === parsed.principalId
  );
  if (duplicate) {
    return res.status(409).json({ error: "That principal already has a grant on this calendar" });
  }

  const entry = await prisma.$transaction(async (tx) => {
    const member = await tx.calendarMember.create({
      data: {
        calendarId: loaded.calendar.id,
        companyId: loaded.calendar.companyId,
        principalType: parsed.principalType,
        principalId: parsed.principalId,
        preset: parsed.preset,
        permissions: parsed.permissions,
        grantedByUserId: actor.id,
      },
    });

    const auditEntry: CalendarAuditEntry = {
      ...auditBase(req),
      companyId: loaded.calendar.companyId,
      calendarId: loaded.calendar.id,
      targetType: "MEMBER",
      targetId: member.id,
      action: CALENDAR_AUDIT_ACTIONS.MEMBER_GRANTED,
      changes: {
        preset: { from: null, to: parsed.preset },
        // Carried too, or a CUSTOM grant's actual contents would never appear
        // in the log at any point in its life — granted, changed or revoked.
        ...(parsed.permissions ? { permissions: { from: null, to: parsed.permissions } } : {}),
      },
    };
    await writeCalendarAudit(tx, auditEntry);
    return { member, auditEntry };
  });

  // Second level of the two-level write, after the transaction is durable.
  mirrorPermissionChangeToAuditLog(entry.auditEntry);

  res.status(201).json({
    id: entry.member.id,
    principalType: entry.member.principalType,
    principalId: entry.member.principalId,
    preset: entry.member.preset,
  });
});

// PATCH /calendars/:id/members/:memberId — change a grant's preset.
router.patch("/:id/members/:memberId", calendarWriteLimiter, async (req: Request, res: Response) => {
  const actor = actorFrom(req);
  const loaded = await loadCalendarFor(actor, Number(req.params.id));
  if (!loaded) return res.status(404).json({ error: "Calendar not found" });
  if (!loaded.permissions.has("share")) {
    return res.status(403).json({ error: "You cannot share this calendar" });
  }

  const memberId = Number(req.params.memberId);
  const member = loaded.calendar.members.find((candidate) => candidate.id === memberId);
  if (!member) return res.status(404).json({ error: "Grant not found" });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const preset = String(body.preset ?? "");
  if (!isCalendarRolePreset(preset)) return res.status(400).json({ error: "preset is not a known calendar role" });

  let permissions: string | null = null;
  if (preset === "CUSTOM") {
    if (!Array.isArray(body.permissions)) {
      return res.status(400).json({ error: "CUSTOM requires a permissions array" });
    }
    permissions = JSON.stringify(body.permissions);
  }

  const beyond = grantsBeyond(permissionsOf(preset, permissions), loaded.permissions);
  if (beyond.length > 0) {
    return res.status(403).json({
      error: `You cannot grant permissions you do not hold: ${beyond.sort().join(", ")}`,
    });
  }

  // Demoting the last OWNER grant would leave the calendar unmanageable.
  if (member.preset === "OWNER" && preset !== "OWNER" && isLastOwnerGrant(loaded.calendar, member.id)) {
    return res.status(409).json({ error: "This is the last owner grant on the calendar" });
  }

  // Diffed over BOTH mutated columns, not just `preset`.
  //
  // Hand-building a preset-only pair audited a CUSTOM → CUSTOM permission-list
  // rewrite as `preset: { from: "CUSTOM", to: "CUSTOM" }` — a row asserting that
  // nothing changed, while the grant's actual permission set had been replaced.
  // That is the widest privilege change this endpoint can make, and it was the
  // one the log described as a no-op. diffChanges also subsumes the old
  // equality guard: it returns null when nothing really differs.
  const changes = diffChanges(
    { preset: member.preset, permissions: member.permissions },
    { preset, permissions }
  );
  if (!changes) {
    // A no-op PATCH writes NO audit row.
    return res.json({ id: member.id, preset: member.preset });
  }

  const auditEntry: CalendarAuditEntry = {
    ...auditBase(req),
    companyId: loaded.calendar.companyId,
    calendarId: loaded.calendar.id,
    targetType: "MEMBER",
    targetId: member.id,
    action: CALENDAR_AUDIT_ACTIONS.MEMBER_UPDATED,
    changes,
  };

  await prisma.$transaction(async (tx) => {
    await tx.calendarMember.update({ where: { id: member.id }, data: { preset, permissions } });
    await writeCalendarAudit(tx, auditEntry);
  });

  mirrorPermissionChangeToAuditLog(auditEntry);

  res.json({ id: member.id, preset });
});

// DELETE /calendars/:id/members/:memberId — revoke.
router.delete("/:id/members/:memberId", calendarWriteLimiter, async (req: Request, res: Response) => {
  const actor = actorFrom(req);
  const loaded = await loadCalendarFor(actor, Number(req.params.id));
  if (!loaded) return res.status(404).json({ error: "Calendar not found" });
  if (!loaded.permissions.has("share")) {
    return res.status(403).json({ error: "You cannot share this calendar" });
  }

  const memberId = Number(req.params.memberId);
  const member = loaded.calendar.members.find((candidate) => candidate.id === memberId);
  if (!member) return res.status(404).json({ error: "Grant not found" });

  // §11.2 — the owner grant cannot be removed while it is the last one, or the
  // calendar becomes unmanageable by anyone.
  if (member.preset === "OWNER" && isLastOwnerGrant(loaded.calendar, member.id)) {
    return res.status(409).json({ error: "This is the last owner grant on the calendar" });
  }

  // Revoking a NARROWING grant must not promote the caller to the broader grant
  // underneath it.
  //
  // Resolution stops at the first matching principal and never unions (§4.6),
  // which is exactly what lets a company-wide grant be narrowed for one person.
  // Run in reverse, deleting your own narrowing row promotes you: an ADMIN
  // holds `share`, so they could revoke the USER row that narrows them and pick
  // up `manage` from the COMPANY row beneath — the escalation POST and PATCH
  // both refuse. The guard covers a narrowing USER, EMPLOYEE or ROLE row alike,
  // which a check keyed on "is this row about me?" would not.
  const afterRevoke = resolveCalendarAccess(actor, {
    ...loaded.calendar,
    members: loaded.calendar.members.filter((candidate) => candidate.id !== member.id),
  });
  const gained = grantsBeyond(afterRevoke, loaded.permissions);
  if (gained.length > 0) {
    return res.status(403).json({
      error: `Revoking this grant would give you permissions you do not hold: ${gained.sort().join(", ")}`,
    });
  }

  const auditEntry: CalendarAuditEntry = {
    ...auditBase(req),
    companyId: loaded.calendar.companyId,
    calendarId: loaded.calendar.id,
    targetType: "MEMBER",
    targetId: member.id,
    action: CALENDAR_AUDIT_ACTIONS.MEMBER_REVOKED,
    changes: {
      preset: { from: member.preset, to: null },
      ...(member.permissions ? { permissions: { from: member.permissions, to: null } } : {}),
    },
  };

  await prisma.$transaction(async (tx) => {
    await tx.calendarMember.delete({ where: { id: member.id } });
    await writeCalendarAudit(tx, auditEntry);
  });

  mirrorPermissionChangeToAuditLog(auditEntry);

  res.status(204).send();
});

// "Is this the last OWNER on the calendar?" — in the §4.6 sense, not merely the
// last row with preset OWNER.
//
// Steps 2 and 3 of the resolution order are standing owners that no grant row
// can remove: the calendar's own ownerUserId, and the BUSINESS_OWNER on the
// three business-authority types. While either exists the calendar stays
// manageable with zero OWNER grants, so the guard must not fire — otherwise the
// FIRST owner grant ever written could never be revoked or demoted, including
// one a user handed out on their own personal calendar. §11.2 says "until there
// is another owner", not "another owner grant".
function isLastOwnerGrant(calendar: LoadedCalendar, memberId: number): boolean {
  if (calendar.ownerUserId !== null) return false;
  if (isBusinessAuthorityCalendarType(calendar.type)) return false;
  return calendar.members.filter((m) => m.preset === "OWNER" && m.id !== memberId).length === 0;
}

// ---------------------------------------------------------------------------
// Share level — the R2/R4 convenience view over the COMPANY grant
// ---------------------------------------------------------------------------

// Only the calendar's OWN owner may read or write the share level.
//
// Deliberately NOT `share`: the company owner holds `share` on every business
// calendar, and the whole point of §4.8 is that they have no authority over a
// personal one. Anyone else — including the company owner — gets the same 404
// as a stranger, so the endpoint does not confirm the calendar exists.
function ownsCalendar(actor: CalendarActor, calendar: LoadedCalendar): boolean {
  return calendar.ownerUserId !== null && calendar.ownerUserId === actor.id;
}

router.get("/:id/share-level", async (req: Request, res: Response) => {
  const actor = actorFrom(req);
  const loaded = await loadCalendarFor(actor, Number(req.params.id));
  if (!loaded || !ownsCalendar(actor, loaded.calendar)) {
    return res.status(404).json({ error: "Calendar not found" });
  }

  const companyGrant = loaded.calendar.members.find(
    (member) =>
      member.principalType === "COMPANY" &&
      member.principalId === String(loaded.calendar.companyId)
  );

  res.json({ shareLevel: shareLevelForCompanyGrant(companyGrant?.preset) });
});

// PUT /calendars/:id/share-level — PRIVATE | FREE_BUSY | DETAILS.
//
// The level is not a column: it is the presence and preset of the COMPANY
// grant. PRIVATE therefore DELETES the row rather than storing a value, which
// is why a brand-new personal calendar is private with no backfill.
router.put("/:id/share-level", calendarWriteLimiter, async (req: Request, res: Response) => {
  const actor = actorFrom(req);
  const loaded = await loadCalendarFor(actor, Number(req.params.id));
  if (!loaded || !ownsCalendar(actor, loaded.calendar)) {
    return res.status(404).json({ error: "Calendar not found" });
  }

  const level = String(((req.body ?? {}) as Record<string, unknown>).shareLevel ?? "");
  if (!isCalendarShareLevel(level)) {
    return res.status(400).json({ error: "shareLevel must be PRIVATE, FREE_BUSY or DETAILS" });
  }

  const companyPrincipalId = String(loaded.calendar.companyId);
  const existing = loaded.calendar.members.find(
    (member) => member.principalType === "COMPANY" && member.principalId === companyPrincipalId
  );
  const previous = shareLevelForCompanyGrant(existing?.preset);
  if (previous === level) return res.json({ shareLevel: level });

  const targetPreset = SHARE_LEVEL_PRESET[level];

  const auditEntry: CalendarAuditEntry = {
    ...auditBase(req),
    companyId: loaded.calendar.companyId,
    calendarId: loaded.calendar.id,
    targetType: "MEMBER",
    targetId: existing?.id ?? loaded.calendar.id,
    action: CALENDAR_AUDIT_ACTIONS.SHARE_LEVEL_CHANGED,
    changes: { shareLevel: { from: previous, to: level } },
  };

  await prisma.$transaction(async (tx) => {
    if (targetPreset === null) {
      if (existing) await tx.calendarMember.delete({ where: { id: existing.id } });
    } else if (existing) {
      await tx.calendarMember.update({ where: { id: existing.id }, data: { preset: targetPreset, permissions: null } });
    } else {
      const created = await tx.calendarMember.create({
        data: {
          calendarId: loaded.calendar.id,
          companyId: loaded.calendar.companyId,
          principalType: "COMPANY",
          principalId: companyPrincipalId,
          preset: targetPreset,
          grantedByUserId: actor.id,
        },
      });
      auditEntry.targetId = created.id;
    }

    await writeCalendarAudit(tx, auditEntry);
  });

  mirrorPermissionChangeToAuditLog(auditEntry);

  res.json({ shareLevel: level });
});

export default router;
