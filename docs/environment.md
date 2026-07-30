# Axeriva — Environment Configuration

Every backend environment variable is read in exactly one place:
[server/src/config.ts](../server/src/config.ts). Routes, middleware, services
and scripts import the `config` object from there — **no other file may read
`process.env`**. The module also calls `dotenv.config()` itself, so consumers
never need to.

The frontend has a single build-time variable read by Vite in
[src/services/api.ts](../src/services/api.ts).

## Backend variables (`server/.env`)

| Variable | Required | Default (development) | Purpose |
|---|---|---|---|
| `DATABASE_URL` | **always** | — | PostgreSQL connection string for Prisma: `postgresql://USER:PASSWORD@HOST:PORT/DB?schema=public`. Managed providers usually need `&sslmode=require`. *(Replaced the former SQLite `file:` URL — a `file:` URL is no longer valid.)* |
| `JWT_SECRET` | **always** | — | Signs/verifies auth JWTs. Long random string; never use the dev placeholder in production. |
| `NODE_ENV` | no | `development` | `production` switches validation to strict mode (see below) and changes runtime behaviour — CORS, error responses, logging, `trust proxy` (see [runtime.md](runtime.md)). |
| `PORT` | no | `5000` | API listen port. |
| `APP_URL` | production | unset → CORS allow-all, links use `http://localhost:5173` | Frontend origin. Drives CORS and all links built into emails (verify/reset/invite) and Stripe redirect URLs. |
| `UPLOAD_ROOT` | production | `./uploads` under the server cwd | Absolute path for uploaded project attachments — must point inside the persistent disk mount in production. |
| `STRIPE_SECRET_KEY` | production | unset → Stripe client throws on first use | Stripe API key (`sk_test_...` / `sk_live_...`). Mode-checked at startup: a test key under `NODE_ENV=production` refuses to boot, a live key under `NODE_ENV=test` always refuses (see `config/stripeKeyMode.ts`). |
| `ALLOW_TEST_STRIPE_KEY` | no | — | Escape hatch: allows startup with an `sk_test_…` key under `NODE_ENV=production` (staging deploy). Only the exact value `true` has any effect. Never set it on the live deploy. |
| `STRIPE_PRICE_ID` | production | unset → checkout returns 500 with a clear error | The legacy Axeriva Pro monthly price. `npm run stripe:setup` prints it. |
| `STRIPE_PRICE_STARTER_EUR` / `STRIPE_PRICE_STARTER_HUF` / `STRIPE_PRICE_PROFESSIONAL_EUR` / `STRIPE_PRICE_PROFESSIONAL_HUF` / `STRIPE_PRICE_BUSINESS_EUR` / `STRIPE_PRICE_BUSINESS_HUF` | production | unset → per-plan checkout reports a clear per-request error | Per-plan, per-currency Stripe Price IDs (S2.3). `npm run stripe:setup` creates and prints all six; they must come from the same Stripe account as `STRIPE_SECRET_KEY`. |
| `STRIPE_WEBHOOK_SECRET` | production | unset → webhook returns 400 | Webhook signing secret (`whsec_...`). See [stripe-webhook-production-readiness.md](stripe-webhook-production-readiness.md). |
| `STRIPE_PORTAL_FLOW_CONFIG_ID` | production | unset → paid→paid upgrades return a clear 500 | Design C — the dedicated Billing Portal configuration (`bpc_…`) used only by the hosted upgrade-confirmation flow (all six prices, `always_invoice`, `end_trial`). `npm run stripe:setup` creates it and prints the id. **Must come from the same Stripe account AND mode as `STRIPE_SECRET_KEY`** — a test-mode id on the live deploy boots cleanly but fails every upgrade at runtime (no livemode marker exists in `bpc_` ids). Rollout order matters: see [render-deployment.md](render-deployment.md). |
| `RESEND_API_KEY` | production | unset → MockEmailService (emails logged, not sent) | Resend API key for real email delivery. |
| `RESEND_FROM_EMAIL` | production | `Axeriva <onboarding@resend.dev>` | From-address for outgoing email. |
| `STRIPE_PUBLISHABLE_KEY` | no | — | **Currently unused** — no frontend Stripe.js integration exists. Kept in `.env.example` only as a placeholder for a future client-side integration. |
| `DEVELOPER_EMAIL` / `DEVELOPER_PASSWORD` | no | — | Only read by `npm run seed:developer` when no CLI arguments are given. |

## Frontend variables (root `.env`)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `VITE_API_URL` | production build | `http://localhost:5000` | Backend API base URL, baked in at **build time** by Vite. Set it in the build environment (e.g. Render Static Site env vars) before `npm run build`. |

## Validation behaviour

Validation runs once, at module load of `server/src/config.ts` (the first
import in `index.ts`), before anything else starts:

- **Every environment:** `DATABASE_URL` and `JWT_SECRET` must be set and
  non-blank (whitespace-only counts as missing). If not, the process exits
  with code 1 and a `FATAL: missing required environment variable(s): ...`
  message naming each missing variable.
- **`NODE_ENV=production`:** additionally `APP_URL`, `STRIPE_SECRET_KEY`,
  `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, the six per-plan
  `STRIPE_PRICE_{STARTER,PROFESSIONAL,BUSINESS}_{EUR,HUF}` ids,
  `STRIPE_PORTAL_FLOW_CONFIG_ID`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL` and
  `UPLOAD_ROOT` are all required — a half-configured deploy fails at startup
  instead of surfacing later as broken checkout, email or uploads.
- **No silent placeholders:** the old `sk_test_placeholder` Stripe fallback
  is gone. In development without `STRIPE_SECRET_KEY` the server boots (with
  a warning), but any actual Stripe call throws
  `Stripe is not configured: STRIPE_SECRET_KEY is missing.`

## Development setup

```bash
# Backend
cp server/.env.example server/.env      # fill in DATABASE_URL + JWT_SECRET
cd server && npm install
npx prisma migrate deploy               # apply migrations to the Postgres DB
npm run dev                             # port 5000

# Frontend (repo root) — no .env needed locally
npm install && npm run dev              # Vite on port 5173
```

Optional locally: Stripe test keys (`npm run stripe:setup` prints the price
ID) and a Resend key — without them billing routes error clearly and emails
go to the console via MockEmailService.

### Running the integration tests

The suite needs its **own** PostgreSQL database — it drops the schema and
truncates every table between tests, so it must never point at the
development one:

```bash
createdb axeriva_test                   # once
cd server && npm test
```

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `TEST_DATABASE_URL` | test runs | `postgresql://postgres:postgres@localhost:5432/axeriva_test?schema=public` | Connection string the suite provisions and wipes. Read by `server/vitest.config.ts`; CI sets it to its `postgres` service container. **Must point at a LOCAL database** (see `ALLOW_REMOTE_TEST_DB`). A local `.env` must never hold a remote live/test instance URL. |
| `ALLOW_REMOTE_TEST_DB` | no | — | Escape hatch for the suite's host guard: only the exact value `true` lets the suite target a non-localhost database. Exists for deliberate, eyes-open setups only — in July 2026 the production database was named `axeriva_test` on a remote host and a suite run wiped it, which is why remote targets are refused by default. |

Safety rail: `src/tests/helpers/disposableDatabase.ts` (called from
`globalSetup.ts`) refuses to start unless the target database name contains
`test` **and** the host is local (`localhost`/`127.0.0.1`/`::1`) — a remote
host needs the explicit `ALLOW_REMOTE_TEST_DB=true` opt-in, and even then the
name rule still applies. Everything else the suite needs (JWT secret, Stripe
test keys) is set in `vitest.config.ts` — no `.env` and no secrets are
involved.

## Production setup

Set all variables from the backend table above in the hosting platform's
environment panel (never commit a production `.env`). On Render specifically,
`DATABASE_URL` is the managed PostgreSQL instance's connection string and
`UPLOAD_ROOT` must still point inside the persistent disk mount (uploads are
files, not rows — they did not move with the database) — full walkthrough in
[render-deployment.md](render-deployment.md). Build the frontend with
`VITE_API_URL` set to the deployed API URL.

Git hygiene: `.env` / `.env.local` are ignored at both the repo root and in
`server/`; the legacy local SQLite database (`server/prisma/axeriva.db`) and
`server/tsconfig.tsbuildinfo` are ignored too and no longer tracked.
