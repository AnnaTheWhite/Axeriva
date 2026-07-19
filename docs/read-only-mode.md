# Read-only Mode (S2.7)

When a company loses its active subscription/trial, it enters **Read-only
Mode**: all existing data stays fully viewable and exportable, but every
write is blocked until the owner upgrades or resumes.

## Activation rules

The single decision lives in `server/src/services/readOnly.ts` (`isReadOnly`)
— no other code re-derives it. A company is read-only when it has **no active
paid subscription and no live trial**:

| Company state | Read-only? |
|---|---|
| `trialing`, period not ended | No |
| `trialing`, period ended (trial expired) | **Yes** |
| `active`, period not ended (paid) | No |
| `active` + `cancelAtPeriodEnd`, still in period | No (access until period end) |
| `canceled` (period ended / Stripe deleted) | **Yes** |
| `past_due` (failed renewal) | **Yes** |
| `inactive` (never subscribed) | **Yes** |
| Founder (`plan = founder`) | **Never** |
| Enterprise (`plan = enterprise`) | **Never** |

Founder and Enterprise are operator-managed (`isManuallyManaged`, S2.2) and
are excluded exactly like the Stripe webhook guard never overwrites them.

Activation is automatic and requires no cron: the S2.6 Stripe sync layer
writes `subscriptionStatus` / `subscriptionEndsAt` on every relevant event
(trial end, cancellation-effective `customer.subscription.deleted`, failed
renewal → `past_due`), and `isReadOnly` reads those. Local registration
trials (no Stripe subscription) flip to read-only purely by their
`subscriptionEndsAt` passing. Resuming or upgrading sets the status back to
`active`/`trialing`, which immediately restores writes — no manual step.

## Allowed while read-only

Everything that does not modify tenant data: login/logout, dashboard,
viewing employees / customers / projects / schedule / reports, downloading
existing exports, the Billing Settings page, upgrading/resuming the
subscription, invoice history, and profile. Read requests
(`GET`/`HEAD`/`OPTIONS`) are never blocked.

## Blocked while read-only

Every write (`POST`/`PUT`/`PATCH`/`DELETE`) on tenant data: employees
(incl. invitations = "add employee"), customers, projects, schedule/shifts,
time tracking (clock-in/out), company settings, branding, logo, uploads and
file replacement, owner notes. Future modules inherit this automatically —
see below.

## Middleware architecture

```
request → authMiddleware → blockWritesWhenReadOnly → controller
```

- `server/src/services/readOnly.ts` — the read-only *decision* + the shared
  Prisma select. Reused by the middleware, the `/access/read-only` endpoint
  and the `/subscription` payload.
- `server/src/middleware/readOnly.middleware.ts` — `blockWritesWhenReadOnly`.
  Passes GET/HEAD/OPTIONS and unauthenticated/DEVELOPER requests; otherwise
  loads the acting user's company and refuses a read-only write with
  `403 { error: "READ_ONLY_MODE" }`.
- `server/src/index.ts` — a shared `tenantWrite = [authMiddleware,
  blockWritesWhenReadOnly]` chain is applied to every tenant-write router
  (`/employees`, `/projects`, `/customers`, `/companies`, `/shifts`,
  `/company`, `/attachments`, `/owner-notes`). **A new module inherits
  enforcement simply by being mounted through `tenantWrite`** — no
  per-controller checks. `/subscription` (must stay writable to upgrade out
  of read-only) and `/account` (profile/logout) are deliberately excluded.
- `/invites` mixes public accept routes with per-route auth, so its two
  authenticated write routes carry `blockWritesWhenReadOnly` inline.

Controllers contain **zero** read-only logic.

## Security considerations

Backend enforcement is the real boundary — client-side disabling is only UX.
Every mutating tenant endpoint passes through the same middleware, so calling
the API directly (curl, devtools, a stale tab) still returns `403
READ_ONLY_MODE`. Verified: 10/10 write endpoints across all modules return
403 in read-only; all reads return 200. Errors are clean JSON with no stack
trace (the global error handler already suppresses internals in production).

## User experience

- **Global banner** (`ReadOnlyBanner`, in `DashboardLayout`) shown to every
  read-only tenant user, with a direct link to Billing.
- **Disabled controls, not hidden** — primary write actions (New
  Employee/Customer/Project, Add Shift, Company Settings + Branding/Logo
  save/upload) are disabled with the tooltip *"Upgrade your subscription to
  continue."* via the `useWriteGuard()` hook.
- **Graceful fallback** — `apiFetch` detects any `READ_ONLY_MODE` 403 and
  fires a window event; the global `ReadOnlyContext` flips to read-only
  immediately, so even a control that wasn't pre-disabled fails cleanly and
  the banner appears. No stack trace is ever shown.
- Global state comes from `GET /access/read-only`, readable by every role
  (EMPLOYEE included, since clock-in is a write) — the `/subscription`
  endpoint is owner/developer-only, so a separate role-agnostic source is
  used. DEVELOPER is always writable.

## API responses

- Blocked write → `403` with body `{ "error": "READ_ONLY_MODE", "message": "…" }`.
- `GET /access/read-only` → `{ "readOnly": boolean }` (any authenticated
  role; DEVELOPER always `false`).
- `GET /subscription` → also includes `readOnly` for the billing page.
