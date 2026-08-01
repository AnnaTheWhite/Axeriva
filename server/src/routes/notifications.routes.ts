import { Router, Request } from "express";
import prisma from "../database/prisma";
import { requireRole } from "../middleware/role.middleware";
import { blockWritesWhenReadOnly } from "../middleware/readOnly.middleware";
import { createRateLimiter } from "../middleware/rateLimit.middleware";
import { RATE_LIMITS } from "../constants/rateLimits";
import { ROLES } from "../constants/roles";
import { companyScope } from "../utils/scope";
import { maskEmail } from "../utils/maskEmail";
import {
  PreferenceValidationError,
  parsePreferenceUpdates,
  resolvePreferences,
  setCompanyDefaults,
  setUserPreferences,
} from "../services/notifications/preferences";

const router = Router();

// N1.7 — the bell's API: the in-app feed, its unread badge, read state, and
// the notification preference screen.
//
// Mounted with authMiddleware only, deliberately NOT through the `tenantWrite`
// chain that every other tenant router uses (see app.ts). Read-only mode is a
// billing state: it stops a lapsed company from EDITING ITS DATA. Dismissing a
// notification is not that — it is per-user UI state, and a read-only company
// is precisely the one whose owner has unread "your trial ended" notices to
// clear. Blocking those writes would leave a permanent badge nobody could
// silence, on the screen we most want that owner to read. Same reasoning that
// keeps /subscription and /account writable. The ONE genuinely tenant-scoped
// write here — the company-wide default — carries the guard inline instead,
// exactly as the two authenticated invite writes do.
//
// The public Resend webhook shares this URL prefix but is mounted separately
// and EARLIER in app.ts, because it needs express.raw() for its signature.

// ---------------------------------------------------------------------------
// Scoping
// ---------------------------------------------------------------------------

// Every row this router touches belongs to ONE user, so userId IS the
// isolation — a feed is scoped one level tighter than every other tenant
// router here, since a colleague inside the same company must not see it
// either. The company clause is defence in depth on top of that: a row written
// for a user of company A can never be read back by a token scoped to company
// B, even if some future path mis-set Notification.userId.
//
// Company-less rows are included deliberately. NotificationEvent.companyId is
// nullable by design (a platform operator belongs to no tenant, and a password
// reset is about a USER), so a notification addressed to this person but tied
// to no company must still reach their own feed rather than falling into a
// gap — it is already filtered by userId, which is the guarantee that matters.
// DEVELOPER has no company at all, so they simply get the userId filter.
function ownScope(req: Request) {
  const userId = req.user!.userId;
  const scope = companyScope(req);

  if (typeof scope.companyId !== "number") {
    return { userId };
  }

  return {
    userId,
    OR: [{ companyId: scope.companyId }, { companyId: null }],
  };
}

// BUSINESS_OWNER/EMPLOYEE are pinned to their own company from the JWT.
// DEVELOPER belongs to none, so they must name the tenant with ?companyId= —
// the same convention as GET/PUT /company/settings and /owner-notes.
function resolveCompanyId(req: Request): number | null {
  const scope = companyScope(req);
  if (typeof scope.companyId === "number") return scope.companyId;

  // Number() of a non-numeric string — or of the array Express builds from a
  // repeated ?companyId= — is NaN, which Prisma would reject at query time
  // with a 500. Anything that is not a positive integer is simply "not named".
  const queryId = Number(req.query.companyId ?? req.body?.companyId);
  return Number.isInteger(queryId) && queryId > 0 ? queryId : null;
}

const preferenceLimiter = createRateLimiter({
  name: "notification-prefs",
  ...RATE_LIMITS.NOTIFICATION_PREFS,
  keyGenerator: (req) => (req.user ? String(req.user.userId) : req.ip ?? "unknown"),
});

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

// What a notification looks like from outside. eventId/companyId/userId stay
// server-side: the client already knows whose feed it asked for, and the event
// id is an internal join key.
const FEED_SELECT = {
  id: true,
  type: true,
  severity: true,
  title: true,
  body: true,
  ctaLabel: true,
  ctaPath: true,
  readAt: true,
  createdAt: true,
} as const;

// GET /notifications?cursor=<id>&limit=<n>&unreadOnly=true
//
// Keyset pagination on the primary key, not offset: ids are monotonic and
// unique, so a page boundary can't shift or duplicate a row when a new
// notification arrives mid-scroll — which on a live feed is the common case,
// not the edge case. createdAt would need a tie-break; the id is already one.
router.get("/", async (req, res) => {
  const limit = Math.min(
    Math.max(Number(req.query.limit) || DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE
  );
  const cursor = Number(req.query.cursor);
  const unreadOnly = req.query.unreadOnly === "true";

  // One extra row is fetched purely to answer "is there a next page?" without
  // a second COUNT over the whole feed.
  const rows = await prisma.notification.findMany({
    where: {
      ...ownScope(req),
      ...(Number.isInteger(cursor) && cursor > 0 ? { id: { lt: cursor } } : {}),
      ...(unreadOnly ? { readAt: null } : {}),
    },
    select: FEED_SELECT,
    orderBy: { id: "desc" },
    take: limit + 1,
  });

  const items = rows.slice(0, limit);

  return res.json({
    items,
    nextCursor: rows.length > limit ? items[items.length - 1].id : null,
  });
});

// The bell badge. Its own endpoint because the client polls this far more
// often than it opens the panel, and it is a single indexed count
// (@@index([userId, readAt])) rather than a page of rows.
router.get("/unread-count", async (req, res) => {
  const unread = await prisma.notification.count({
    where: { ...ownScope(req), readAt: null },
  });

  return res.json({ unread });
});

// updateMany rather than findFirst-then-update: the scope lives in the WHERE,
// so another tenant's id cannot be updated even for an instant, and re-reading
// an already-read notification is a no-op instead of moving its timestamp.
router.post("/:id/read", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid notification id" });
  }

  // `readAt: null` in the WHERE makes a second click a no-op rather than
  // moving the timestamp. The read-back then decides the answer: no row means
  // the id is not ours (or does not exist — indistinguishable from here, which
  // is the point: 404 either way leaks nothing about another tenant), a row
  // means it is read, whether this call or an earlier one did it.
  await prisma.notification.updateMany({
    where: { ...ownScope(req), id, readAt: null },
    data: { readAt: new Date() },
  });

  const notification = await prisma.notification.findFirst({
    where: { ...ownScope(req), id },
    select: FEED_SELECT,
  });

  if (!notification) {
    return res.status(404).json({ error: "Notification not found" });
  }

  return res.json(notification);
});

router.post("/read-all", async (req, res) => {
  const updated = await prisma.notification.updateMany({
    where: { ...ownScope(req), readAt: null },
    data: { readAt: new Date() },
  });

  return res.json({ updated: updated.count });
});

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

// The whole matrix with all three levels exposed, so the screen can show what
// is in effect AND where it came from. See services/notifications/preferences.
router.get("/preferences", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const resolved = await resolvePreferences(companyId, req.user!.userId);

  return res.json({
    ...resolved,
    // The company default is the owner's switch, not the employee's.
    canEditDefaults:
      companyId !== null &&
      (req.user!.role === ROLES.BUSINESS_OWNER || req.user!.role === ROLES.DEVELOPER),
  });
});

// The caller's own overrides. Every user may set these, including an EMPLOYEE
// — which is the point of level 3: a mixed team is not one preference.
router.put("/preferences", preferenceLimiter, async (req, res) => {
  const companyId = resolveCompanyId(req);
  if (companyId === null) {
    // NotificationPreference.companyId is NOT NULL, so a user with no company
    // has no row to write. A DEVELOPER wanting to act on a tenant must name it.
    return res.status(400).json({ error: "companyId is required" });
  }

  let updates;
  try {
    updates = parsePreferenceUpdates(req.body);
  } catch (error) {
    if (error instanceof PreferenceValidationError) {
      return res.status(400).json({ error: error.message });
    }
    throw error;
  }

  await setUserPreferences(companyId, req.user!.userId, updates);

  return res.json(await resolvePreferences(companyId, req.user!.userId));
});

// The company-wide default (userId = null). The one write in this router that
// changes TENANT configuration rather than personal state, so it is the one
// that carries the read-only guard — inline, because the router as a whole is
// deliberately outside `tenantWrite` (see the header comment).
router.put(
  "/preferences/defaults",
  requireRole(ROLES.BUSINESS_OWNER, ROLES.DEVELOPER),
  blockWritesWhenReadOnly,
  preferenceLimiter,
  async (req, res) => {
    const companyId = resolveCompanyId(req);
    if (companyId === null) {
      return res.status(400).json({ error: "companyId is required" });
    }

    let updates;
    try {
      updates = parsePreferenceUpdates(req.body);
    } catch (error) {
      if (error instanceof PreferenceValidationError) {
        return res.status(400).json({ error: error.message });
      }
      throw error;
    }

    await setCompanyDefaults(companyId, updates);

    return res.json(await resolvePreferences(companyId, req.user!.userId));
  }
);

// ---------------------------------------------------------------------------
// Suppression list (operator surface)
// ---------------------------------------------------------------------------

// N1.7.1 (H2) — the recovery path the suppression list never had.
//
// Until now EmailSuppression was write-only: the webhook inserted rows and the
// gate read them, and nothing anywhere could remove one. A hard bounce caused
// by a temporary DNS failure, or a customer who once clicked "spam" on a
// digest, blocked that address permanently with no route back short of manual
// SQL against production.
//
// DEVELOPER-only, and deliberately audited: removing a suppression is a
// decision to resume mailing an address that a provider told us not to mail,
// and that has consequences for every tenant's deliverability, not just the
// one asking. This is a small forward slice of the admin surface the plan puts
// at N1.10; it moves under /admin/notifications when that lands.
router.delete(
  "/suppressions/:email",
  requireRole(ROLES.DEVELOPER),
  async (req, res) => {
    const email = String(req.params.email).trim().toLowerCase();

    const removed = await prisma.emailSuppression.deleteMany({ where: { email } });

    if (removed.count === 0) {
      return res.status(404).json({ error: "Suppression not found" });
    }

    // maskEmail, not the raw address: this log line is the audit trail, and the
    // module's own rule is that addresses never reach the logs in the clear.
    console.warn(
      `[notify] suppression removed for ${maskEmail(email)} by user ${req.user!.userId}`
    );

    return res.json({ removed: removed.count });
  }
);

// Operator visibility for the same list — you cannot sensibly un-suppress an
// address you have no way to discover.
router.get("/suppressions", requireRole(ROLES.DEVELOPER), async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);

  const suppressions = await prisma.emailSuppression.findMany({
    select: { id: true, email: true, reason: true, companyId: true, createdAt: true },
    orderBy: { id: "desc" },
    take: limit,
  });

  return res.json({ suppressions });
});

export default router;
