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
| `DATABASE_URL` | **always** | — | SQLite file for Prisma, e.g. `file:./axeriva.db`. Production: put it on the persistent disk (`file:/var/data/axeriva.db`). |
| `JWT_SECRET` | **always** | — | Signs/verifies auth JWTs. Long random string; never use the dev placeholder in production. |
| `NODE_ENV` | no | `development` | `production` switches validation to strict mode (see below) and changes runtime behaviour — CORS, error responses, logging, `trust proxy` (see [runtime.md](runtime.md)). |
| `PORT` | no | `5000` | API listen port. |
| `APP_URL` | production | unset → CORS allow-all, links use `http://localhost:5173` | Frontend origin. Drives CORS and all links built into emails (verify/reset/invite) and Stripe redirect URLs. |
| `UPLOAD_ROOT` | production | `./uploads` under the server cwd | Absolute path for uploaded project attachments — must point inside the persistent disk mount in production. |
| `STRIPE_SECRET_KEY` | production | unset → Stripe client throws on first use | Stripe API key (`sk_test_...` / `sk_live_...`). |
| `STRIPE_PRICE_ID` | production | unset → checkout returns 500 with a clear error | The Axeriva Pro monthly price. `npm run stripe:setup` prints it. |
| `STRIPE_WEBHOOK_SECRET` | production | unset → webhook returns 400 | Webhook signing secret (`whsec_...`). See [stripe-webhook-production-readiness.md](stripe-webhook-production-readiness.md). |
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
  `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`,
  `RESEND_FROM_EMAIL` and `UPLOAD_ROOT` are all required — a half-configured
  deploy fails at startup instead of surfacing later as broken checkout,
  email or uploads.
- **No silent placeholders:** the old `sk_test_placeholder` Stripe fallback
  is gone. In development without `STRIPE_SECRET_KEY` the server boots (with
  a warning), but any actual Stripe call throws
  `Stripe is not configured: STRIPE_SECRET_KEY is missing.`

## Development setup

```bash
# Backend
cp server/.env.example server/.env      # fill in JWT_SECRET at minimum
cd server && npm install
npx prisma migrate dev                  # create/refresh the local SQLite DB
npm run dev                             # port 5000

# Frontend (repo root) — no .env needed locally
npm install && npm run dev              # Vite on port 5173
```

Optional locally: Stripe test keys (`npm run stripe:setup` prints the price
ID) and a Resend key — without them billing routes error clearly and emails
go to the console via MockEmailService.

## Production setup

Set all variables from the backend table above in the hosting platform's
environment panel (never commit a production `.env`). On Render specifically,
`DATABASE_URL` and `UPLOAD_ROOT` must point inside the persistent disk mount
— full walkthrough in [render-deployment.md](render-deployment.md). Build the
frontend with `VITE_API_URL` set to the deployed API URL.

Git hygiene: `.env` / `.env.local` are ignored at both the repo root and in
`server/`; the local SQLite database (`server/prisma/axeriva.db`) and
`server/tsconfig.tsbuildinfo` are ignored too and no longer tracked.
