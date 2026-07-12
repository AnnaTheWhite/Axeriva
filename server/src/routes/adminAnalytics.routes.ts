import { Router } from "express";
import prisma from "../database/prisma";
import { requireRole } from "../middleware/role.middleware";
import { ROLES } from "../constants/roles";

// Admin Analytics & User Activity dashboard API (DEVELOPER only). Mounted at
// /admin/analytics in index.ts behind authMiddleware; the guard below keeps
// it consistent with admin.routes.ts. Every handler selects only
// non-sensitive fields (never password/token/secret columns) and leans on
// aggregated Prisma queries (count / groupBy / aggregate) instead of
// per-row work.
const router = Router();

router.use(requireRole(ROLES.DEVELOPER));

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_WINDOW_DAYS = 30;
const ACTIVE_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due"];

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

// ---------------------------------------------------------------------------
// Shared where-clause builder used by /users and /users/export.
// ---------------------------------------------------------------------------
const SORTABLE = new Set(["createdAt", "lastLoginAt", "email", "role"]);

function buildUsersWhere(query: Record<string, unknown>): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  const search = typeof query.search === "string" ? query.search.trim() : "";
  const role = typeof query.role === "string" ? query.role : "";
  const status = typeof query.status === "string" ? query.status : "";
  const plan = typeof query.plan === "string" ? query.plan : "";

  if (search) {
    // SQLite LIKE is case-insensitive for ASCII, so no `mode` needed.
    where.email = { contains: search };
  }
  if (role) where.role = role;
  if (plan) where.company = { plan };

  // Status is derived from lastLoginAt: never (null), active (within the
  // window), inactive (logged in but older than the window).
  if (status === "never") {
    where.lastLoginAt = null;
  } else if (status === "active") {
    where.lastLoginAt = { gte: daysAgo(ACTIVE_WINDOW_DAYS) };
  } else if (status === "inactive") {
    where.lastLoginAt = { not: null, lt: daysAgo(ACTIVE_WINDOW_DAYS) };
  }

  return where;
}

// Attach per-company resource counts (projects/employees/customers) for a
// list of companyIds — one groupBy query per resource, no N+1.
async function fetchCompanyCounts(companyIds: number[]) {
  if (companyIds.length === 0) return { projectGroups: [], employeeGroups: [], customerGroups: [] };
  const [projectGroups, employeeGroups, customerGroups] = await Promise.all([
    prisma.project.groupBy({ by: ["companyId"], where: { companyId: { in: companyIds } }, _count: { _all: true } }),
    prisma.employee.groupBy({ by: ["companyId"], where: { companyId: { in: companyIds } }, _count: { _all: true } }),
    prisma.customer.groupBy({ by: ["companyId"], where: { companyId: { in: companyIds } }, _count: { _all: true } }),
  ]);
  return { projectGroups, employeeGroups, customerGroups };
}

const countFor = (
  groups: { companyId: number | null; _count: { _all: number } }[],
  companyId: number | null,
) => (companyId === null ? 0 : groups.find((g) => g.companyId === companyId)?._count._all ?? 0);

// ---------------------------------------------------------------------------
// GET /overview — the dashboard's overview cards, all via aggregate queries.
// ---------------------------------------------------------------------------
router.get("/overview", async (_req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    totalUsers,
    activeToday,
    active7Days,
    active30Days,
    newRegistrations,
    newRegistrationsToday,
    companies,
    newCompaniesToday,
    newCompanies30Days,
    projects,
    newProjectsToday,
    newProjects30Days,
    employees,
    newEmployees30Days,
    customers,
    newCustomers30Days,
    activeSubscriptions,
    planGroups,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { lastLoginAt: { gte: today } } }),
    prisma.user.count({ where: { lastLoginAt: { gte: daysAgo(7) } } }),
    prisma.user.count({ where: { lastLoginAt: { gte: daysAgo(30) } } }),
    prisma.user.count({ where: { createdAt: { gte: daysAgo(30) } } }),
    prisma.user.count({ where: { createdAt: { gte: today } } }),
    prisma.company.count(),
    prisma.company.count({ where: { createdAt: { gte: today } } }),
    prisma.company.count({ where: { createdAt: { gte: daysAgo(30) } } }),
    prisma.project.count(),
    prisma.project.count({ where: { createdAt: { gte: today } } }),
    prisma.project.count({ where: { createdAt: { gte: daysAgo(30) } } }),
    prisma.employee.count(),
    prisma.employee.count({ where: { createdAt: { gte: daysAgo(30) } } }),
    prisma.customer.count(),
    prisma.customer.count({ where: { createdAt: { gte: daysAgo(30) } } }),
    prisma.company.count({
      where: { subscriptionStatus: { in: ACTIVE_SUBSCRIPTION_STATUSES } },
    }),
    prisma.company.groupBy({ by: ["plan"], _count: { _all: true } }),
  ]);

  // Dynamic plan breakdown — returns every plan actually in the DB.
  const planBreakdown = planGroups
    .map((g) => ({ plan: g.plan, count: g._count._all }))
    .sort((a, b) => b.count - a.count);

  // Legacy plan fields kept for backward compatibility.
  const planCount = (plan: string) =>
    planGroups.find((group) => group.plan === plan)?._count._all ?? 0;

  return res.json({
    totalUsers,
    activeUsers: { today: activeToday, sevenDays: active7Days, thirtyDays: active30Days },
    newRegistrations,
    newRegistrationsToday,
    companies,
    newCompaniesToday,
    newCompanies30Days,
    projects,
    newProjectsToday,
    newProjects30Days,
    employees,
    newEmployees30Days,
    customers,
    newCustomers30Days,
    activeSubscriptions,
    planBreakdown,
    plans: {
      free: planCount("free"),
      pro: planCount("pro"),
      enterprise: planCount("enterprise"),
    },
  });
});

// ---------------------------------------------------------------------------
// GET /charts — daily time-series data for the last 30 days (line charts).
// Uses raw SQL with SQLite DATE() to group by calendar day without loading
// all rows. BigInt values from COUNT(*) are serialized as numbers.
// ---------------------------------------------------------------------------
type RawDayRow = { date: string; count: bigint };

router.get("/charts", async (_req, res) => {
  const since = daysAgo(30);

  const [userRegs, companyGrowth, projectCreations, activeUsers] = await Promise.all([
    prisma.$queryRaw<RawDayRow[]>`
      SELECT DATE(createdAt) as date, COUNT(*) as count
      FROM "User" WHERE createdAt >= ${since}
      GROUP BY DATE(createdAt) ORDER BY date ASC`,
    prisma.$queryRaw<RawDayRow[]>`
      SELECT DATE(createdAt) as date, COUNT(*) as count
      FROM "Company" WHERE createdAt >= ${since}
      GROUP BY DATE(createdAt) ORDER BY date ASC`,
    prisma.$queryRaw<RawDayRow[]>`
      SELECT DATE(createdAt) as date, COUNT(*) as count
      FROM "Project" WHERE createdAt >= ${since}
      GROUP BY DATE(createdAt) ORDER BY date ASC`,
    prisma.$queryRaw<RawDayRow[]>`
      SELECT DATE(lastLoginAt) as date, COUNT(*) as count
      FROM "User" WHERE lastLoginAt IS NOT NULL AND lastLoginAt >= ${since}
      GROUP BY DATE(lastLoginAt) ORDER BY date ASC`,
  ]);

  const toSeries = (rows: RawDayRow[]) =>
    rows.map((r) => ({ date: r.date, count: Number(r.count) }));

  return res.json({
    userRegistrations: toSeries(userRegs),
    companyGrowth: toSeries(companyGrowth),
    projectCreations: toSeries(projectCreations),
    activeUsers: toSeries(activeUsers),
  });
});

// ---------------------------------------------------------------------------
// GET /storage — platform-wide storage analytics derived from
// ProjectAttachment.fileSize. No new columns needed.
// ---------------------------------------------------------------------------
type RawStorageRow = { companyId: number; companyName: string; totalBytes: bigint };

router.get("/storage", async (_req, res) => {
  const [totalResult, companyCount, topCompaniesRaw] = await Promise.all([
    prisma.projectAttachment.aggregate({ _sum: { fileSize: true } }),
    prisma.company.count(),
    prisma.$queryRaw<RawStorageRow[]>`
      SELECT c.id as companyId, c.name as companyName, SUM(pa.fileSize) as totalBytes
      FROM "ProjectAttachment" pa
      JOIN "Project" p ON pa.projectId = p.id
      JOIN "Company" c ON p.companyId = c.id
      GROUP BY c.id, c.name
      ORDER BY totalBytes DESC
      LIMIT 10`,
  ]);

  const totalBytes = totalResult._sum.fileSize ?? 0;

  return res.json({
    totalBytes,
    avgBytesPerCompany: companyCount > 0 ? Math.round(totalBytes / companyCount) : 0,
    topCompanies: topCompaniesRaw.map((r) => ({
      companyId: r.companyId,
      companyName: r.companyName,
      totalBytes: Number(r.totalBytes),
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /users — paginated, searchable, filterable, sortable user table.
// Per-user project/employee/customer counts are the user's COMPANY totals,
// fetched with groupBy queries (not N+1) for the page's companies.
// ---------------------------------------------------------------------------
router.get("/users", async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
  const sortBy = SORTABLE.has(String(req.query.sortBy)) ? String(req.query.sortBy) : "createdAt";
  const sortDir = req.query.sortDir === "asc" ? "asc" : "desc";

  const where = buildUsersWhere(req.query as Record<string, unknown>);

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { [sortBy]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        email: true,
        role: true,
        emailVerified: true,
        active: true,
        createdAt: true,
        lastLoginAt: true,
        companyId: true,
        company: { select: { id: true, name: true, plan: true, subscriptionStatus: true } },
      },
    }),
  ]);

  const companyIds = [
    ...new Set(users.map((u) => u.companyId).filter((id): id is number => id !== null)),
  ];

  const { projectGroups, employeeGroups, customerGroups } = await fetchCompanyCounts(companyIds);
  const activeThreshold = daysAgo(ACTIVE_WINDOW_DAYS);

  const rows = users.map((u) => ({
    id: u.id,
    email: u.email,
    role: u.role,
    company: u.company ? { id: u.company.id, name: u.company.name } : null,
    plan: u.company?.plan ?? null,
    subscriptionStatus: u.company?.subscriptionStatus ?? null,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
    emailVerified: u.emailVerified,
    projectCount: countFor(projectGroups, u.companyId),
    employeeCount: countFor(employeeGroups, u.companyId),
    customerCount: countFor(customerGroups, u.companyId),
    status: !u.lastLoginAt
      ? "never"
      : u.active && u.lastLoginAt >= activeThreshold
        ? "active"
        : "inactive",
  }));

  return res.json({ page, pageSize, total, totalPages: Math.ceil(total / pageSize), users: rows });
});

// ---------------------------------------------------------------------------
// GET /users/export — full result set for CSV/XLSX export. Applies the same
// filters and sorting as /users but returns all rows (cap 10 000) without
// pagination. Only non-sensitive fields.
// ---------------------------------------------------------------------------
router.get("/users/export", async (req, res) => {
  const sortBy = SORTABLE.has(String(req.query.sortBy)) ? String(req.query.sortBy) : "createdAt";
  const sortDir = req.query.sortDir === "asc" ? "asc" : "desc";

  const where = buildUsersWhere(req.query as Record<string, unknown>);

  const users = await prisma.user.findMany({
    where,
    orderBy: { [sortBy]: sortDir },
    take: 10000,
    select: {
      id: true,
      email: true,
      role: true,
      emailVerified: true,
      active: true,
      createdAt: true,
      lastLoginAt: true,
      companyId: true,
      company: { select: { id: true, name: true, plan: true, subscriptionStatus: true } },
    },
  });

  const companyIds = [
    ...new Set(users.map((u) => u.companyId).filter((id): id is number => id !== null)),
  ];

  const { projectGroups, employeeGroups, customerGroups } = await fetchCompanyCounts(companyIds);
  const activeThreshold = daysAgo(ACTIVE_WINDOW_DAYS);

  const rows = users.map((u) => ({
    id: u.id,
    email: u.email,
    role: u.role,
    company: u.company?.name ?? "",
    plan: u.company?.plan ?? "",
    subscriptionStatus: u.company?.subscriptionStatus ?? "",
    emailVerified: u.emailVerified,
    projectCount: countFor(projectGroups, u.companyId),
    employeeCount: countFor(employeeGroups, u.companyId),
    customerCount: countFor(customerGroups, u.companyId),
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
    status: !u.lastLoginAt
      ? "never"
      : u.active && u.lastLoginAt >= activeThreshold
        ? "active"
        : "inactive",
  }));

  return res.json({ users: rows, total: rows.length });
});

// ---------------------------------------------------------------------------
// GET /users/:id — full detail: profile, company, subscription, usage,
// storage, timestamps. Non-sensitive fields only.
// ---------------------------------------------------------------------------
router.get("/users/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid user id" });
  }

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      role: true,
      emailVerified: true,
      active: true,
      createdAt: true,
      lastLoginAt: true,
      employeeId: true,
      company: {
        select: {
          id: true,
          name: true,
          plan: true,
          subscriptionStatus: true,
          subscriptionEndsAt: true,
          createdAt: true,
          contactEmail: true,
          phone: true,
          website: true,
        },
      },
    },
  });

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const companyId = user.company?.id ?? null;

  const [projectCount, employeeCount, customerCount, storage] =
    companyId === null
      ? [0, 0, 0, { _sum: { fileSize: null } }]
      : await Promise.all([
          prisma.project.count({ where: { companyId } }),
          prisma.employee.count({ where: { companyId } }),
          prisma.customer.count({ where: { companyId } }),
          prisma.projectAttachment.aggregate({
            _sum: { fileSize: true },
            where: { project: { companyId } },
          }),
        ]);

  return res.json({
    id: user.id,
    email: user.email,
    role: user.role,
    emailVerified: user.emailVerified,
    active: user.active,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    isEmployee: user.employeeId !== null,
    company: user.company,
    usage: {
      projects: projectCount,
      employees: employeeCount,
      customers: customerCount,
      storageBytes: storage._sum.fileSize ?? 0,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /users/:id/activity — chronological activity timeline. Action events
// (login/logout/verify/settings/subscription/invitation/account) come from
// the AuditLog table; entity-creation events are derived from each row's
// createdAt so they need no extra writes. Merged and sorted newest-first.
// ---------------------------------------------------------------------------
const TIMELINE_LIMIT = 100;
const PER_SOURCE_LIMIT = 50;

router.get("/users/:id/activity", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid user id" });
  }

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, createdAt: true, companyId: true, company: { select: { createdAt: true } } },
  });

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const companyId = user.companyId;

  const [auditLogs, projects, employees, customers, shifts] = await Promise.all([
    prisma.auditLog.findMany({
      // Action events (login/logout/verify/settings/subscription/invitation
      // sent+accepted/account) already carry accurate timestamps here.
      where: { OR: [{ userId: id }, ...(companyId ? [{ companyId }] : [])] },
      orderBy: { createdAt: "desc" },
      take: PER_SOURCE_LIMIT,
      select: { id: true, action: true, metadata: true, createdAt: true },
    }),
    companyId ? prisma.project.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: PER_SOURCE_LIMIT, select: { id: true, name: true, createdAt: true } }) : [],
    companyId ? prisma.employee.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: PER_SOURCE_LIMIT, select: { id: true, firstName: true, lastName: true, createdAt: true } }) : [],
    companyId ? prisma.customer.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: PER_SOURCE_LIMIT, select: { id: true, name: true, createdAt: true } }) : [],
    companyId ? prisma.shift.findMany({ where: { employee: { companyId } }, orderBy: { createdAt: "desc" }, take: PER_SOURCE_LIMIT, select: { id: true, createdAt: true } }) : [],
  ]);

  type Event = { type: string; timestamp: Date; label?: string };
  const events: Event[] = [];

  events.push({ type: "USER_REGISTERED", timestamp: user.createdAt });
  if (user.company) {
    events.push({ type: "COMPANY_CREATED", timestamp: user.company.createdAt });
  }

  for (const log of auditLogs) {
    events.push({ type: log.action, timestamp: log.createdAt });
  }
  for (const p of projects) {
    events.push({ type: "PROJECT_CREATED", timestamp: p.createdAt, label: p.name });
  }
  for (const e of employees) {
    events.push({ type: "EMPLOYEE_CREATED", timestamp: e.createdAt, label: `${e.firstName} ${e.lastName}` });
  }
  for (const c of customers) {
    events.push({ type: "CUSTOMER_CREATED", timestamp: c.createdAt, label: c.name });
  }
  for (const s of shifts) {
    events.push({ type: "SCHEDULE_CREATED", timestamp: s.createdAt });
  }

  events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  return res.json({ events: events.slice(0, TIMELINE_LIMIT) });
});

export default router;
