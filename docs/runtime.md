# Axeriva — Runtime Behaviour

How the backend behaves at runtime, and how development and production
differ. Environment variables themselves are documented in
[environment.md](environment.md).

## Startup sequence

Order of operations in [server/src/index.ts](../server/src/index.ts) — each
step fails the process early (exit code 1) with a clear message if it can't
complete:

1. **Environment validation** — `config.ts` is the first import; it loads
   `.env` and exits if required variables are missing (strict set in
   production, see environment.md).
2. **Upload directory initialization** — importing
   `upload.middleware.ts` creates `UPLOAD_ROOT/projects` (recursive). If the
   path is invalid or unwritable (e.g. missing disk mount), startup fails
   with a `FATAL: cannot create upload directory` message.
3. **Middleware registration** — CORS, Stripe raw-body webhook mount, JSON
   body parser (5 MB limit), static `/uploads` mount, dev request logger.
4. **Routes** — public (`/auth`, `/invites`, `/subscription/webhook`,
   `/`, `/health`), then everything else behind `authMiddleware`.
5. **Error handlers** — JSON 404 catch-all, then the global error handler.
6. **Database connect** — explicit `prisma.$connect()`; a broken
   `DATABASE_URL` kills the process at startup instead of failing on the
   first query.
7. **HTTP listen** on `PORT` (default 5000).

## Development vs production behaviour

| Concern | Development (`NODE_ENV` ≠ production) | Production (`NODE_ENV=production`) |
|---|---|---|
| Env validation | `DATABASE_URL`, `JWT_SECRET` only | full required set (see environment.md) |
| CORS origin | `APP_URL` if set, otherwise allow-all | `APP_URL` only (required variable) |
| Request logging | one line per request (`GET /projects 200 12ms`) | silent on the happy path |
| Error responses | HTTP 500 with `error` message + `stack` | HTTP 500 with generic `{"error":"Internal server error"}` — no internals leak |
| Server-side error log | full error object, always | full error object, always |
| `trust proxy` | off | `1` (behind the hosting platform's reverse proxy — correct `req.ip`/`req.protocol`) |
| Email | MockEmailService when `RESEND_API_KEY` unset (logged, not sent) | real Resend delivery (key required) |
| Stripe | boots without keys; any Stripe call throws a clear error | keys required at startup |

Both environments: `X-Powered-By` is disabled, CORS allows only
`GET/POST/PUT/PATCH/DELETE` with `Content-Type` + `Authorization` headers,
credentials disabled (Bearer tokens, no cookies), unknown routes get JSON
404.

## Express runtime configuration

- **Body parsing:** `express.json({ limit: "5mb" })` — the limit exists for
  base64 logo uploads (`PUT /company/settings`). No `urlencoded` parser on
  purpose: the API is JSON-only plus multer multipart for file uploads.
- **Stripe webhook raw body:** `/subscription/webhook` is mounted with
  `express.raw()` *before* the JSON parser so signature verification gets
  the untouched bytes.
- **Static files:** `/uploads` serves `UPLOAD_ROOT` with `maxAge: 1d` —
  filenames are immutable random UUIDs, so browser caching is safe.
- **Compression / Helmet:** not installed (constraint: no new runtime
  libraries). The app is compatible with both — `x-powered-by` is already
  disabled, no custom headers conflict with Helmet defaults, and responses
  are plain JSON/static files that compression middleware (or the hosting
  platform's edge) can handle. Render compresses at the edge, so an
  in-process `compression` middleware is optional.

## Health endpoint

`GET /health` — unauthenticated, no database access (answers "is the process
up and serving HTTP", suitable for platform health probes and uptime
monitors):

```json
{
  "status": "ok",
  "environment": "production",
  "version": "1.0.0",
  "uptime": "348s",
  "timestamp": "2026-07-06T20:37:05.465Z"
}
```

`version` comes from [server/package.json](../server/package.json) via
`config.version` — the single source of the version string (the legacy
`GET /` endpoint reports the same value and is kept for existing clients).

## Logging behaviour

- Module-tagged `console.*` logs (`[auth]`, `[stripe webhook]`, `[email]`,
  `[audit]`, …) for notable events and background failures (e.g. email send
  failures never fail the request — they are logged and the request
  proceeds).
- The global error handler logs every unhandled route error with method +
  URL + the full error, in every environment. Clients never receive stack
  traces in production.
- No secrets are logged: tokens, passwords and API keys never appear in log
  statements.
