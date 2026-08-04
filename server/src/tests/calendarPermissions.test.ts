import { describe, expect, it, vi } from "vitest";
import prisma from "../database/prisma";
import { ROLES } from "../constants/roles";
import { CALENDAR_TYPES } from "../constants/calendarTypes";
import { PRINCIPAL_TYPES } from "../constants/calendarEvents";
import {
  CALENDAR_PERMISSIONS,
  CALENDAR_PRESET_PERMISSIONS,
  CALENDAR_ROLE_PRESETS,
  type CalendarPermission,
  type CalendarRolePreset,
  expandImplied,
  permissionsForPreset,
} from "../constants/calendarPermissions";
import {
  type CalendarActor,
  type CalendarSubject,
  hasCalendarPermission,
  resolveCalendarAccess,
  visibleCalendarFilter,
} from "../services/calendar/permissions";
import { createCalendar, createTenant, createUser } from "./helpers/factories";

// CAL1.3 — the permission layer.
//
// This is the milestone every calendar endpoint rests on, and the one where a
// mistake is invisible until it is a data leak, so the matrix here is
// exhaustive rather than representative: 4 calendar types x 4 principal types x
// 7 presets, every step of the resolution order individually, and each negative
// case named in the scope document.
//
// The single most important assertion in the file is that a BUSINESS_OWNER gets
// an EMPTY set on someone else's PERSONAL calendar. That one line is the whole
// technical content of refinement R2 — without it "private calendar" is a label
// on a screen rather than a property of the system.

const COMPANY_ID = 1;
const OTHER_COMPANY_ID = 2;
const ACTOR_USER_ID = 10;
const ACTOR_EMPLOYEE_ID = 20;
const SOMEONE_ELSE_ID = 99;

function employeeActor(overrides: Partial<CalendarActor> = {}): CalendarActor {
  return {
    id: ACTOR_USER_ID,
    companyId: COMPANY_ID,
    role: ROLES.EMPLOYEE,
    employeeId: ACTOR_EMPLOYEE_ID,
    ...overrides,
  };
}

function calendarOwnedByOther(overrides: Partial<CalendarSubject> = {}): CalendarSubject {
  return {
    companyId: COMPANY_ID,
    type: "COMPANY",
    ownerUserId: SOMEONE_ELSE_ID,
    archivedAt: null,
    members: [],
    ...overrides,
  };
}

// The principalId a grant must carry to name our standard actor.
const PRINCIPAL_ID_FOR: Record<string, string> = {
  USER: String(ACTOR_USER_ID),
  EMPLOYEE: String(ACTOR_EMPLOYEE_ID),
  ROLE: ROLES.EMPLOYEE,
  COMPANY: String(COMPANY_ID),
};

function sorted(permissions: Iterable<CalendarPermission>): string[] {
  return [...permissions].sort();
}

// ---------------------------------------------------------------------------
// The full matrix
// ---------------------------------------------------------------------------

describe("resolveCalendarAccess — the 4 x 4 x 7 matrix", () => {
  for (const calendarType of CALENDAR_TYPES) {
    it(`resolves every principal type and preset identically on a ${calendarType} calendar`, () => {
      // The actor is an EMPLOYEE and owns nothing here, so the GRANT is the only
      // thing that can decide — which is exactly what this matrix is measuring.
      // It also proves the type does not secretly alter grant handling: a
      // PERSONAL calendar is reached through grants like any other, it simply
      // has no role-based shortcut into it.
      for (const principalType of PRINCIPAL_TYPES) {
        for (const preset of CALENDAR_ROLE_PRESETS) {
          const calendar = calendarOwnedByOther({
            type: calendarType,
            members: [
              {
                principalType,
                principalId: PRINCIPAL_ID_FOR[principalType]!,
                preset,
              },
            ],
          });

          const resolved = resolveCalendarAccess(employeeActor(), calendar);
          const expected = expandImplied(permissionsForPreset(preset, null));

          expect(
            sorted(resolved),
            `${calendarType} / ${principalType} / ${preset}`
          ).toEqual(sorted(expected));
        }
      }
    });
  }

  it("gives each preset the exact breadth §4.4 specifies", () => {
    const breadth = (preset: CalendarRolePreset) =>
      sorted(expandImplied(permissionsForPreset(preset, null)));

    expect(breadth("OWNER")).toEqual(sorted(CALENDAR_PERMISSIONS));
    // ADMIN is everything except the calendar's own settings.
    expect(breadth("ADMIN")).not.toContain("manage");
    expect(breadth("ADMIN")).toHaveLength(CALENDAR_PERMISSIONS.length - 1);
    // A MANAGER may reschedule anyone's event but may not delete anyone's, and
    // may not widen the audience. Deleting and sharing are the irreversible
    // halves, and this is the line the _own/_any split exists to draw.
    //
    // Pinned EXACTLY rather than by membership: `toContain`/`not.toContain`
    // would stay green if the preset silently gained a permission nobody
    // thought to name here.
    expect(breadth("MANAGER")).toEqual(
      sorted([
        "view_free_busy",
        "view_details",
        "event.create",
        "event.edit_own",
        "event.edit_any",
        "event.delete_own",
        "participant.invite",
      ])
    );
    expect(breadth("MEMBER")).toEqual(
      sorted(["view_free_busy", "view_details", "event.create", "event.edit_own", "event.delete_own"])
    );
    expect(breadth("VIEWER")).toEqual(sorted(["view_free_busy", "view_details"]));
    expect(breadth("FREE_BUSY")).toEqual(["view_free_busy"]);
    // CUSTOM with nothing stored grants nothing — failing closed.
    expect(breadth("CUSTOM")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The eight resolution steps
// ---------------------------------------------------------------------------

describe("resolveCalendarAccess — the resolution order, step by step", () => {
  it("step 1: DEVELOPER keeps full access to non-personal calendars", () => {
    for (const type of ["COMPANY", "PROJECT", "EMPLOYEE"]) {
      const resolved = resolveCalendarAccess(
        { id: 1, companyId: null, role: ROLES.DEVELOPER, employeeId: null },
        calendarOwnedByOther({ type, companyId: OTHER_COMPANY_ID })
      );
      expect(sorted(resolved), type).toEqual(sorted(CALENDAR_PERMISSIONS));
    }
  });

  it("step 1: DEVELOPER gets NOTHING on a personal calendar, in any tenant", () => {
    // D12/§11.3. companyScope() would hand a DEVELOPER every tenant's every
    // row; for personal calendars that is a privacy problem, not a convenience.
    // The scope document requires this case by name.
    const developer: CalendarActor = {
      id: 1,
      companyId: null,
      role: ROLES.DEVELOPER,
      employeeId: null,
    };

    expect([...resolveCalendarAccess(developer, calendarOwnedByOther({ type: "PERSONAL" }))]).toEqual(
      []
    );
    expect([
      ...resolveCalendarAccess(
        developer,
        calendarOwnedByOther({ type: "PERSONAL", companyId: OTHER_COMPANY_ID })
      ),
    ]).toEqual([]);
  });

  it("step 2: the calendar's own owner gets OWNER, personal included", () => {
    const resolved = resolveCalendarAccess(
      employeeActor(),
      calendarOwnedByOther({ type: "PERSONAL", ownerUserId: ACTOR_USER_ID })
    );
    expect(sorted(resolved)).toEqual(sorted(CALENDAR_PERMISSIONS));
  });

  it("step 3: BUSINESS_OWNER gets OWNER on company, project and employee calendars", () => {
    for (const type of ["COMPANY", "PROJECT", "EMPLOYEE"]) {
      const resolved = resolveCalendarAccess(
        employeeActor({ role: ROLES.BUSINESS_OWNER, employeeId: null }),
        calendarOwnedByOther({ type })
      );
      expect(sorted(resolved), type).toEqual(sorted(CALENDAR_PERMISSIONS));
    }
  });

  it("step 3 (R2): BUSINESS_OWNER gets NOTHING on an employee's personal calendar", () => {
    // ******************************************************************
    // THE single technical guarantee behind refinement R2. If this test
    // ever goes green for the wrong reason, "private" becomes a false
    // statement on the user's screen: the company owner would read every
    // employee's personal entries purely by virtue of their role.
    //
    // Access to a PERSONAL calendar is reachable ONLY through an explicit
    // grant the employee themselves created (§4.8) — proved by the second
    // half of this test.
    // ******************************************************************
    const owner = employeeActor({ role: ROLES.BUSINESS_OWNER, employeeId: null });
    const personal = calendarOwnedByOther({ type: "PERSONAL" });

    expect([...resolveCalendarAccess(owner, personal)]).toEqual([]);
    expect(hasCalendarPermission(owner, personal, "view_free_busy")).toBe(false);
    expect(hasCalendarPermission(owner, personal, "view_details")).toBe(false);

    // ...but the employee CAN choose to share it — the FREE_BUSY level of §4.8,
    // which is a COMPANY grant and nothing more.
    const shared = calendarOwnedByOther({
      type: "PERSONAL",
      members: [
        { principalType: "COMPANY", principalId: String(COMPANY_ID), preset: "FREE_BUSY" },
      ],
    });
    expect([...resolveCalendarAccess(owner, shared)]).toEqual(["view_free_busy"]);
    // Free/busy really is content-free: the details permission is absent.
    expect(hasCalendarPermission(owner, shared, "view_details")).toBe(false);
  });

  it("steps 4-7: the most specific grant wins and resolution stops there", () => {
    // All four principal forms name this actor at once, each with a different
    // preset. Grants are NOT unioned — if they were, the narrow USER grant
    // could never restrict someone the company-wide grant had already widened.
    const calendar = calendarOwnedByOther({
      members: [
        { principalType: "COMPANY", principalId: String(COMPANY_ID), preset: "OWNER" },
        { principalType: "ROLE", principalId: ROLES.EMPLOYEE, preset: "ADMIN" },
        { principalType: "EMPLOYEE", principalId: String(ACTOR_EMPLOYEE_ID), preset: "MANAGER" },
        { principalType: "USER", principalId: String(ACTOR_USER_ID), preset: "FREE_BUSY" },
      ],
    });

    // USER is the most specific → FREE_BUSY, despite a COMPANY-wide OWNER grant.
    expect([...resolveCalendarAccess(employeeActor(), calendar)]).toEqual(["view_free_busy"]);

    // Remove the USER grant → EMPLOYEE wins.
    const withoutUser = { ...calendar, members: calendar.members.filter((m) => m.principalType !== "USER") };
    expect(sorted(resolveCalendarAccess(employeeActor(), withoutUser))).toEqual(
      sorted(expandImplied(permissionsForPreset("MANAGER")))
    );

    // Remove EMPLOYEE too → ROLE wins.
    const roleOnly = {
      ...calendar,
      members: calendar.members.filter((m) => m.principalType === "ROLE" || m.principalType === "COMPANY"),
    };
    expect(sorted(resolveCalendarAccess(employeeActor(), roleOnly))).toEqual(
      sorted(expandImplied(permissionsForPreset("ADMIN")))
    );

    // Only COMPANY left → COMPANY wins.
    const companyOnly = {
      ...calendar,
      members: calendar.members.filter((m) => m.principalType === "COMPANY"),
    };
    expect(sorted(resolveCalendarAccess(employeeActor(), companyOnly))).toEqual(
      sorted(CALENDAR_PERMISSIONS)
    );
  });

  it("step 5 is skipped for a login with no employee record", () => {
    // An EMPLOYEE-principal grant must not match a user whose employeeId is
    // null — otherwise String(null) games could collide.
    const calendar = calendarOwnedByOther({
      members: [{ principalType: "EMPLOYEE", principalId: "null", preset: "OWNER" }],
    });
    expect([...resolveCalendarAccess(employeeActor({ employeeId: null }), calendar)]).toEqual([]);
  });

  it("steps 4-7: a grant that names someone ELSE grants nothing", () => {
    // Pins the principalId equality in the lookup. Every OTHER grant in this
    // file names the actor under test, so without this case the comparison
    // could be dropped entirely and the whole suite would stay green — while
    // another user's OWNER row silently handed this actor all ten permissions.
    const notThisActor: Array<[string, string]> = [
      ["USER", String(SOMEONE_ELSE_ID)],
      ["EMPLOYEE", String(ACTOR_EMPLOYEE_ID + 1)],
      ["ROLE", ROLES.BUSINESS_OWNER],
      // The calendar is in company 1 while the grant names company 2. Such a
      // row should never exist — which is the point: tenant isolation cannot
      // catch it, because the CALENDAR is in the actor's own tenant.
      ["COMPANY", String(OTHER_COMPANY_ID)],
    ];

    for (const [principalType, principalId] of notThisActor) {
      const calendar = calendarOwnedByOther({
        members: [{ principalType, principalId, preset: "OWNER" }],
      });
      expect(
        [...resolveCalendarAccess(employeeActor(), calendar)],
        `${principalType}/${principalId}`
      ).toEqual([]);
    }
  });

  it("step 8: no grant anywhere means no access", () => {
    expect([...resolveCalendarAccess(employeeActor(), calendarOwnedByOther())]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Implication
// ---------------------------------------------------------------------------

describe("view_details implies view_free_busy — and never the reverse", () => {
  it("adds free/busy to a details grant, but adds nothing to a free/busy grant", () => {
    const viewer = calendarOwnedByOther({
      members: [{ principalType: "USER", principalId: String(ACTOR_USER_ID), preset: "VIEWER" }],
    });
    const resolvedViewer = resolveCalendarAccess(employeeActor(), viewer);
    expect(resolvedViewer.has("view_details")).toBe(true);
    expect(resolvedViewer.has("view_free_busy")).toBe(true);

    const freeBusy = calendarOwnedByOther({
      members: [{ principalType: "USER", principalId: String(ACTOR_USER_ID), preset: "FREE_BUSY" }],
    });
    const resolvedFreeBusy = resolveCalendarAccess(employeeActor(), freeBusy);
    expect(resolvedFreeBusy.has("view_free_busy")).toBe(true);
    // The direction that must NEVER hold: occupancy does not reveal content.
    expect(resolvedFreeBusy.has("view_details")).toBe(false);
    expect([...resolvedFreeBusy]).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// CUSTOM
// ---------------------------------------------------------------------------

describe("the CUSTOM preset", () => {
  it("applies its stored list, drops unknown entries, and fails closed on junk", () => {
    const withList = calendarOwnedByOther({
      members: [
        {
          principalType: "USER",
          principalId: String(ACTOR_USER_ID),
          preset: "CUSTOM",
          permissions: JSON.stringify(["view_details", "event.create"]),
        },
      ],
    });
    // view_free_busy arrives through the implication, not the stored list.
    expect(sorted(resolveCalendarAccess(employeeActor(), withList))).toEqual(
      sorted(["view_details", "view_free_busy", "event.create"])
    );

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (const permissions of [null, "", "not json", '{"not":"an array"}', "[]"]) {
        const calendar = calendarOwnedByOther({
          members: [
            { principalType: "USER", principalId: String(ACTOR_USER_ID), preset: "CUSTOM", permissions },
          ],
        });
        expect([...resolveCalendarAccess(employeeActor(), calendar)], String(permissions)).toEqual([]);
      }

      // An unknown permission name is dropped individually — a future
      // permission appearing in an old row degrades to LESS access, never more.
      const mixed = calendarOwnedByOther({
        members: [
          {
            principalType: "USER",
            principalId: String(ACTOR_USER_ID),
            preset: "CUSTOM",
            permissions: JSON.stringify(["view_free_busy", "calendar.take_over_the_world"]),
          },
        ],
      });
      expect([...resolveCalendarAccess(employeeActor(), mixed)]).toEqual(["view_free_busy"]);

      // An unrecognised PRESET grants nothing at all.
      const bogus = calendarOwnedByOther({
        members: [{ principalType: "USER", principalId: String(ACTOR_USER_ID), preset: "SUPERUSER" }],
      });
      expect([...resolveCalendarAccess(employeeActor(), bogus)]).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it("ignores a stored permissions list unless the preset is CUSTOM", () => {
    // The column is meaningful ONLY for CUSTOM (schema comment, plan §4.4).
    // CAL1.4 will write preset and permissions from one request body, so a
    // non-CUSTOM row carrying a list is a shape real data will contain — and if
    // it were honoured, anyone able to write a VIEWER grant could smuggle
    // `manage` in alongside it.
    const escalation = JSON.stringify(["manage", "share", "event.delete_any"]);

    for (const preset of CALENDAR_ROLE_PRESETS.filter((p) => p !== "CUSTOM")) {
      const calendar = calendarOwnedByOther({
        members: [
          {
            principalType: "USER",
            principalId: String(ACTOR_USER_ID),
            preset,
            permissions: escalation,
          },
        ],
      });
      expect(sorted(resolveCalendarAccess(employeeActor(), calendar)), preset).toEqual(
        // Built from the registry directly, NOT from permissionsForPreset(preset,
        // escalation) — that is the function under test, so it would happily
        // agree with its own bug and the test would pass either way.
        sorted(expandImplied(CALENDAR_PRESET_PERMISSIONS[preset]))
      );
    }
  });
});

// ---------------------------------------------------------------------------
// The negative cases the scope document names
// ---------------------------------------------------------------------------

describe("negative cases", () => {
  it("a non-canonical calendar type FAILS CLOSED for owners and operators alike", () => {
    // ******************************************************************
    // Found by the CAL1.3 adversarial review. Calendar.type is an
    // unconstrained TEXT column (migration.sql:5) and nothing validates it
    // today — isCalendarType has zero call sites. The natural way to write
    // the R2 exception, `type !== "PERSONAL"`, therefore FAILS OPEN: every
    // one of the values below satisfies it and would hand the company owner
    // (and a cross-tenant DEVELOPER) the full ten-permission set on what may
    // well be somebody's private calendar.
    //
    // The gate uses an allow-list of the three business-authority types
    // instead. This test is what stops anyone rewriting it "more simply".
    // ******************************************************************
    const owner = employeeActor({ role: ROLES.BUSINESS_OWNER, employeeId: null });
    const developer: CalendarActor = {
      id: 1,
      companyId: null,
      role: ROLES.DEVELOPER,
      employeeId: null,
    };

    for (const type of ["personal", "Personal", "PERSONAL ", "TEAM", ""]) {
      expect([...resolveCalendarAccess(owner, calendarOwnedByOther({ type }))], `owner/${type}`).toEqual(
        []
      );
      expect(
        [...resolveCalendarAccess(developer, calendarOwnedByOther({ type }))],
        `developer/${type}`
      ).toEqual([]);
    }

    // The three canonical business types still work, so this is a tightening
    // rather than a lockout.
    for (const type of ["COMPANY", "PROJECT", "EMPLOYEE"]) {
      expect(resolveCalendarAccess(owner, calendarOwnedByOther({ type })).size, type).toBe(
        CALENDAR_PERMISSIONS.length
      );
    }
  });

  it("an archived calendar is closed to everyone, including its owner", () => {
    const archived = calendarOwnedByOther({
      type: "PERSONAL",
      ownerUserId: ACTOR_USER_ID,
      archivedAt: new Date("2026-07-01T00:00:00.000Z"),
      members: [{ principalType: "COMPANY", principalId: String(COMPANY_ID), preset: "OWNER" }],
    });

    expect([...resolveCalendarAccess(employeeActor(), archived)]).toEqual([]);
    expect([
      ...resolveCalendarAccess(employeeActor({ role: ROLES.BUSINESS_OWNER }), archived),
    ]).toEqual([]);
    expect([
      ...resolveCalendarAccess(
        { id: 1, companyId: null, role: ROLES.DEVELOPER, employeeId: null },
        archived
      ),
    ]).toEqual([]);
  });

  it("a foreign tenant is denied even with a grant that names the actor", () => {
    // The grant is real and matches, but the calendar belongs to another
    // company — tenant isolation is checked BEFORE any grant is consulted.
    const foreign = calendarOwnedByOther({
      companyId: OTHER_COMPANY_ID,
      members: [{ principalType: "USER", principalId: String(ACTOR_USER_ID), preset: "OWNER" }],
    });

    expect([...resolveCalendarAccess(employeeActor(), foreign)]).toEqual([]);
    expect([...resolveCalendarAccess(employeeActor({ role: ROLES.BUSINESS_OWNER }), foreign)]).toEqual(
      []
    );
    // Even being named as the owner of another tenant's calendar grants nothing.
    expect([
      ...resolveCalendarAccess(
        employeeActor(),
        calendarOwnedByOther({ companyId: OTHER_COMPANY_ID, ownerUserId: ACTOR_USER_ID })
      ),
    ]).toEqual([]);
  });

  it("an inactive actor holds nothing, whatever the grants say", () => {
    const calendar = calendarOwnedByOther({
      ownerUserId: ACTOR_USER_ID,
      members: [{ principalType: "USER", principalId: String(ACTOR_USER_ID), preset: "OWNER" }],
    });
    expect([...resolveCalendarAccess(employeeActor({ active: false }), calendar)]).toEqual([]);
    // active omitted means active — the middleware is the primary gate.
    expect(sorted(resolveCalendarAccess(employeeActor(), calendar))).toEqual(
      sorted(CALENDAR_PERMISSIONS)
    );
  });

  it("a non-DEVELOPER with no company reaches nothing", () => {
    expect([
      ...resolveCalendarAccess(employeeActor({ companyId: null }), calendarOwnedByOther()),
    ]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// visibleCalendarFilter — proved against the real database
// ---------------------------------------------------------------------------

describe("visibleCalendarFilter — the filter is IN the query (§11.1)", () => {
  async function visibleTo(actor: CalendarActor) {
    const rows = await prisma.calendar.findMany({
      where: visibleCalendarFilter(actor),
      orderBy: { name: "asc" },
    });
    return rows.map((row) => row.name);
  }

  it("shows a company owner every non-personal calendar and no one else's personal one", async () => {
    const tenant = await createTenant();
    const employee = await createUser({ companyId: tenant.company.id, role: ROLES.EMPLOYEE });

    await createCalendar(tenant.company.id, { name: "Company", type: "COMPANY" });
    await createCalendar(tenant.company.id, { name: "Project", type: "PROJECT" });
    await createCalendar(tenant.company.id, {
      name: "Owner personal",
      type: "PERSONAL",
      ownerUserId: tenant.owner.id,
    });
    await createCalendar(tenant.company.id, {
      name: "Employee personal",
      type: "PERSONAL",
      ownerUserId: employee.id,
    });

    const owner: CalendarActor = {
      id: tenant.owner.id,
      companyId: tenant.company.id,
      role: ROLES.BUSINESS_OWNER,
      employeeId: null,
    };

    // Their own personal calendar is reachable (step 2); the employee's is not.
    expect(await visibleTo(owner)).toEqual(["Company", "Owner personal", "Project"]);
  });

  it("shows an employee only what a grant names, and their own calendar", async () => {
    const tenant = await createTenant();
    const user = await createUser({
      companyId: tenant.company.id,
      role: ROLES.EMPLOYEE,
      employeeId: tenant.employee.id,
    });

    const shared = await createCalendar(tenant.company.id, { name: "Shared", type: "COMPANY" });
    await createCalendar(tenant.company.id, { name: "Unshared", type: "COMPANY" });
    await createCalendar(tenant.company.id, {
      name: "Mine",
      type: "PERSONAL",
      ownerUserId: user.id,
    });

    const actor: CalendarActor = {
      id: user.id,
      companyId: tenant.company.id,
      role: ROLES.EMPLOYEE,
      employeeId: tenant.employee.id,
    };

    expect(await visibleTo(actor)).toEqual(["Mine"]);

    await prisma.calendarMember.create({
      data: {
        calendarId: shared.id,
        companyId: tenant.company.id,
        principalType: "EMPLOYEE",
        principalId: String(tenant.employee.id),
        preset: "VIEWER",
      },
    });

    expect(await visibleTo(actor)).toEqual(["Mine", "Shared"]);
  });

  it("never leaks another tenant's calendars, and never a personal one to a DEVELOPER", async () => {
    const a = await createTenant();
    const b = await createTenant();

    await createCalendar(a.company.id, { name: "A company", type: "COMPANY" });
    await createCalendar(a.company.id, { name: "A personal", type: "PERSONAL", ownerUserId: a.owner.id });
    await createCalendar(b.company.id, { name: "B company", type: "COMPANY" });
    await createCalendar(b.company.id, { name: "B personal", type: "PERSONAL", ownerUserId: b.owner.id });

    const ownerOfA: CalendarActor = {
      id: a.owner.id,
      companyId: a.company.id,
      role: ROLES.BUSINESS_OWNER,
      employeeId: null,
    };
    expect(await visibleTo(ownerOfA)).toEqual(["A company", "A personal"]);

    // The DEVELOPER crosses tenants — but not into anyone's personal calendar.
    const developer: CalendarActor = {
      id: 987654,
      companyId: null,
      role: ROLES.DEVELOPER,
      employeeId: null,
    };
    expect(await visibleTo(developer)).toEqual(["A company", "B company"]);
  });

  it("excludes archived calendars, and matches nothing for an inactive actor", async () => {
    const tenant = await createTenant();
    await createCalendar(tenant.company.id, { name: "Live", type: "COMPANY" });
    await createCalendar(tenant.company.id, {
      name: "Archived",
      type: "COMPANY",
      archivedAt: new Date("2026-07-01T00:00:00.000Z"),
    });

    const owner: CalendarActor = {
      id: tenant.owner.id,
      companyId: tenant.company.id,
      role: ROLES.BUSINESS_OWNER,
      employeeId: null,
    };

    expect(await visibleTo(owner)).toEqual(["Live"]);
    expect(await visibleTo({ ...owner, active: false })).toEqual([]);
  });

  it("agrees with resolveCalendarAccess on every calendar it returns", async () => {
    // The filter is a deliberate OVER-approximation (SQL cannot read inside the
    // CUSTOM permissions JSON), so the contract is one-directional: it may
    // include a calendar the resolver then denies, but it must NEVER omit one
    // the resolver would allow. This pins that direction.
    const tenant = await createTenant();
    const employeeUser = await createUser({
      companyId: tenant.company.id,
      role: ROLES.EMPLOYEE,
      employeeId: tenant.employee.id,
    });

    const granted = await createCalendar(tenant.company.id, { name: "Granted", type: "PROJECT" });
    await createCalendar(tenant.company.id, { name: "Ungranted", type: "PROJECT" });
    await createCalendar(tenant.company.id, {
      name: "Own personal",
      type: "PERSONAL",
      ownerUserId: employeeUser.id,
    });
    await prisma.calendarMember.create({
      data: {
        calendarId: granted.id,
        companyId: tenant.company.id,
        principalType: "USER",
        principalId: String(employeeUser.id),
        preset: "MEMBER",
      },
    });

    const actor: CalendarActor = {
      id: employeeUser.id,
      companyId: tenant.company.id,
      role: ROLES.EMPLOYEE,
      employeeId: tenant.employee.id,
    };

    const all = await prisma.calendar.findMany({ include: { members: true } });
    const allowedByResolver = all
      .filter((calendar) => resolveCalendarAccess(actor, calendar).size > 0)
      .map((calendar) => calendar.name)
      .sort();
    const returnedByFilter = await visibleTo(actor);

    expect(returnedByFilter).toEqual(["Granted", "Own personal"]);
    // No calendar the resolver allows may be missing from the filter's result.
    for (const name of allowedByResolver) {
      expect(returnedByFilter, `resolver allowed ${name} but the filter omitted it`).toContain(name);
    }
  });
});
