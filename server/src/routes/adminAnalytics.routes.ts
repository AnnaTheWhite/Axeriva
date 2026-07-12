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
    companies,
    projects,
    employees,
    customers,
    activeSubscriptions,
    planGroups,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { lastLoginAt: { gte: today } } }),
    prisma.user.count({ where: { lastLoginAt: { gte: daysAgo(7) } } }),
    prisma.user.count({ where: { lastLoginAt: { gte: daysAgo(30) } } }),
    prisma.user.count({ where: { createdAt: { gte: daysAgo(30) } } }),
    prisma.company.count(),
    prisma.project.count(),
    prisma.employee.count(),
    prisma.customer.count(),
    prisma.company.count({
      where: { subscriptionStatus: { in: ACTIVE_SUBSCRIPTION_STATUSES } },
    }),
    prisma.company.groupBy({ by: ["plan"], _count: { _all: true } }),
  ]);

  const planCount = (plan: string) =>
    planGroups.find((group) => group.plan === plan)?._count._all ?? 0;

  return res.json({
    totalUsers,
    activeUsers: { today: activeToday, sevenDays: active7Days, thirtyDays: active30Days },
    newRegistrations,
    companies,
    projects,
    employees,
    customers,
    activeSubscriptions,
    plans: {
      free: planCount("free"),
      pro: planCount("pro"),
      enterprise: planCount("enterprise"),
    },
  });
});

// ---------------------------------------------------------------------------
// GET /users — paginated, searchable, filterable, sortable user table.
// Per-user project/employee/customer counts are the user's COMPANY totals,
// fetched with a handful of groupBy queries (not N+1) for the page's
// companies.
// ---------------------------------------------------------------------------
const SORTABLE = new Set(["createdAt", "lastLoginAt", "email", "role"]);

router.get("/users", async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const role = typeof req.query.role === "string" ? req.query.role : "";
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const plan = typeof req.query.plan === "string" ? req.query.plan : "";
  const sortBy = SORTABLE.has(String(req.query.sortBy)) ? String(req.query.sortBy) : "createdAt";
  const sortDir = req.query.sortDir === "asc" ? "asc" : "desc";

  const where: Record<string, unknown> = {};

  if (search) {
    // SQLite LIKE is case-insensitive for ASCII, so no `mode` needed.
    where.email = { contains: search };
  }
  if (role) {
    where.role = role;
  }
  if (plan) {
    where.company = { plan };
  }
  // Status is derived from lastLoginAt: never (null), active (within the
  // window), inactive (logged in but older than the window).
  if (status === "never") {
    where.lastLoginAt = null;
  } else if (status === "active") {
    where.lastLoginAt = { gte: daysAgo(ACTIVE_WINDOW_DAYS) };
  } else if (status === "inactive") {
    where.lastLoginAt = { not: null, lt: daysAgo(ACTIVE_WINDOW_DAYS) };
  }

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

  // Company-level usage counts for just the companies on this page.
  const companyIds = [
    ...new Set(users.map((u) => u.companyId).filter((id): id is number => id !== null)),
  ];

  const [projectGroups, employeeGroups, customerGroups] =
    companyIds.length === 0
      ? [[], [], []]
      : await Promise.all([
          prisma.project.groupBy({ by: ["companyId"], where: { companyId: { in: companyIds } }, _count: { _all: true } }),
          prisma.employee.groupBy({ by: ["companyId"], where: { companyId: { in: companyIds } }, _count: { _all: true } }),
          prisma.customer.groupBy({ by: ["companyId"], where: { companyId: { in: companyIds } }, _count: { _all: true } }),
        ]);

  const countFor = (groups: { companyId: number | null; _count: { _all: number } }[], companyId: number | null) =>
    companyId === null ? 0 : groups.find((g) => g.companyId === companyId)?._count._all ?? 0;

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
