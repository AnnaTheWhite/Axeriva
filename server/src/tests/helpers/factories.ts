import bcrypt from "bcryptjs";
import prisma from "../../database/prisma";
import { ROLES } from "../../constants/roles";
import { signAuthToken } from "../../utils/authToken";

// Test data builders. Two rules they follow deliberately:
//
//  1. They write through Prisma, not through the API. A tenant-isolation test
//     must be able to create the OTHER tenant's data without depending on the
//     very endpoints it is about to prove are broken.
//  2. Tokens are minted with the app's own signAuthToken(), so a test can
//     never accidentally pass by using a differently-shaped payload than the
//     one login actually issues.

// Password used for every seeded account. Satisfies the password policy
// (upper, lower, digit, symbol, length) so it can also be used to log in
// through the real endpoint.
export const TEST_PASSWORD = "Str0ng!Passw0rd";

let sequence = 0;
function unique(prefix: string) {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

type CompanyOverrides = Partial<{
  name: string;
  plan: string;
  subscriptionStatus: string;
  subscriptionEndsAt: Date | null;
  active: boolean;
  // Defaults to null (like every real company before its first Checkout).
  // The B2 archive guard blocks only status ∈ ACTIVE_SUBSCRIPTION_STATUSES
  // AND stripeSubscriptionId != null, so tests seeding a billed company must
  // set this explicitly.
  stripeSubscriptionId: string | null;
}>;

// A company with a live trial by default — i.e. NOT in read-only mode — so
// tests that are about something else aren't accidentally testing the
// read-only guard. Read-only tests opt in explicitly (see readOnlyCompany).
export async function createCompany(overrides: CompanyOverrides = {}) {
  return prisma.company.create({
    data: {
      name: overrides.name ?? unique("Test Co"),
      plan: overrides.plan ?? "starter",
      subscriptionStatus: overrides.subscriptionStatus ?? "trialing",
      subscriptionEndsAt:
        overrides.subscriptionEndsAt === undefined
          ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
          : overrides.subscriptionEndsAt,
      ...(overrides.active === undefined ? {} : { active: overrides.active }),
      ...(overrides.stripeSubscriptionId === undefined
        ? {}
        : { stripeSubscriptionId: overrides.stripeSubscriptionId }),
    },
  });
}

// A company whose trial has elapsed → isReadOnly() is true.
export async function createReadOnlyCompany(overrides: CompanyOverrides = {}) {
  return createCompany({
    subscriptionStatus: "trialing",
    subscriptionEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    ...overrides,
  });
}

type UserOverrides = Partial<{
  email: string;
  password: string;
  role: string;
  companyId: number | null;
  employeeId: number | null;
  emailVerified: boolean;
  active: boolean;
  tokenVersion: number;
}>;

export async function createUser(overrides: UserOverrides = {}) {
  const password = overrides.password ?? TEST_PASSWORD;

  return prisma.user.create({
    data: {
      email: overrides.email ?? `${unique("user")}@example.com`,
      password: await bcrypt.hash(password, 10),
      role: overrides.role ?? ROLES.BUSINESS_OWNER,
      companyId: overrides.companyId ?? null,
      employeeId: overrides.employeeId ?? null,
      emailVerified: overrides.emailVerified ?? true,
      active: overrides.active ?? true,
      tokenVersion: overrides.tokenVersion ?? 0,
    },
  });
}

export async function createEmployee(companyId: number, overrides: Partial<{ firstName: string; lastName: string; status: string }> = {}) {
  return prisma.employee.create({
    data: {
      firstName: overrides.firstName ?? "Test",
      lastName: overrides.lastName ?? unique("Employee"),
      status: overrides.status ?? "Active",
      companyId,
    },
  });
}

export async function createCustomer(companyId: number, overrides: Partial<{ name: string }> = {}) {
  return prisma.customer.create({
    data: {
      name: overrides.name ?? unique("Customer"),
      companyId,
    },
  });
}

export async function createProject(
  companyId: number,
  overrides: Partial<{ name: string; status: string; customerId: number | null }> = {}
) {
  return prisma.project.create({
    data: {
      name: overrides.name ?? unique("Project"),
      status: overrides.status ?? "Planned",
      customerId: overrides.customerId ?? null,
      companyId,
    },
  });
}

export async function createShift(
  employeeId: number,
  overrides: Partial<{ projectId: number | null; start: Date; end: Date | null }> = {}
) {
  return prisma.shift.create({
    data: {
      employeeId,
      projectId: overrides.projectId ?? null,
      start: overrides.start ?? new Date(),
      end: overrides.end ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// Calendar module (CAL1.1)
// ---------------------------------------------------------------------------

type CalendarOverrides = Partial<{
  type: string;
  name: string;
  timezone: string | null;
  ownerUserId: number | null;
  projectId: number | null;
  employeeId: number | null;
  isDefault: boolean;
  archivedAt: Date | null;
}>;

// Defaults to a COMPANY calendar: it is the one type that needs no owner
// column, so a test that only wants "a calendar to hang events off" gets a
// valid row without deciding anything. PERSONAL/PROJECT/EMPLOYEE tests pass
// the matching id explicitly — see CALENDAR_OWNER_COLUMN.
export async function createCalendar(companyId: number, overrides: CalendarOverrides = {}) {
  return prisma.calendar.create({
    data: {
      companyId,
      type: overrides.type ?? "COMPANY",
      name: overrides.name ?? unique("Calendar"),
      timezone: overrides.timezone ?? null,
      ownerUserId: overrides.ownerUserId ?? null,
      projectId: overrides.projectId ?? null,
      employeeId: overrides.employeeId ?? null,
      isDefault: overrides.isDefault ?? false,
      archivedAt: overrides.archivedAt ?? null,
    },
  });
}

type CalendarEventOverrides = Partial<{
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  timezone: string | null;
  recurrenceRule: string | null;
  recurrenceEndsAt: Date | null;
  status: string;
  visibility: string;
  createdByUserId: number;
  projectId: number | null;
  customerId: number | null;
  employeeId: number | null;
  shiftId: number | null;
  location: string | null;
}>;

const ONE_HOUR_MS = 60 * 60 * 1000;

// A one-hour, non-recurring, confirmed, default-visibility event — the shape
// most tests want, so anything else in the assertion is the thing under test.
//
// companyId is passed separately rather than read back from the calendar: a
// tenant-isolation test needs to be able to construct the MISMATCHED case
// (event of tenant A on a calendar of tenant B) to prove it is rejected, and a
// factory that silently derived it could not express that.
export async function createCalendarEvent(
  calendarId: number,
  companyId: number,
  overrides: CalendarEventOverrides = {}
) {
  const startsAt = overrides.startsAt ?? new Date();

  return prisma.calendarEvent.create({
    data: {
      calendarId,
      companyId,
      title: overrides.title ?? unique("Event"),
      description: overrides.description ?? null,
      startsAt,
      endsAt: overrides.endsAt ?? new Date(startsAt.getTime() + ONE_HOUR_MS),
      allDay: overrides.allDay ?? false,
      timezone: overrides.timezone ?? null,
      recurrenceRule: overrides.recurrenceRule ?? null,
      recurrenceEndsAt: overrides.recurrenceEndsAt ?? null,
      status: overrides.status ?? "confirmed",
      visibility: overrides.visibility ?? "default",
      // A scalar with no foreign key (it must survive the creator's account
      // deletion), so 0 is storable and means "this test is not about
      // authorship". Tests that ARE about authorship pass a real user id.
      createdByUserId: overrides.createdByUserId ?? 0,
      projectId: overrides.projectId ?? null,
      customerId: overrides.customerId ?? null,
      employeeId: overrides.employeeId ?? null,
      shiftId: overrides.shiftId ?? null,
      location: overrides.location ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// Whole-tenant fixture
// ---------------------------------------------------------------------------

// A complete, self-contained tenant: company + owner (with token) + one
// employee, customer and project. Two of these give a cross-tenant test
// everything it needs to attempt "tenant A touches tenant B's row".
export async function createTenant(companyOverrides: CompanyOverrides = {}) {
  const company = await createCompany(companyOverrides);
  const owner = await createUser({ companyId: company.id, role: ROLES.BUSINESS_OWNER });
  const employee = await createEmployee(company.id);
  const customer = await createCustomer(company.id);
  const project = await createProject(company.id, { customerId: customer.id });

  return {
    company,
    owner,
    employee,
    customer,
    project,
    token: signAuthToken(owner),
  };
}

// An EMPLOYEE-role login bound to an Employee row of the given tenant.
export async function createEmployeeUser(companyId: number, employeeId: number) {
  const user = await createUser({
    companyId,
    employeeId,
    role: ROLES.EMPLOYEE,
  });

  return { user, token: signAuthToken(user) };
}

// A DEVELOPER (platform operator) — no company, sees across tenants by design.
export async function createDeveloper() {
  const user = await createUser({ role: ROLES.DEVELOPER, companyId: null });
  return { user, token: signAuthToken(user) };
}

export function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}
