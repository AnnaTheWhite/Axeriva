# Axeriva v1.0 — Release Candidate (RC1) Checklist

*Az első production deploy előtti/utáni ellenőrző kapu. Kiegészíti a
részletesebb [production-checklist.md](production-checklist.md)-t; ez az
RC-specifikus, végső gate. Deploy-lépések: [render-deployment.md](render-deployment.md).*

*Állapot: `f269c38`. A commitolt HEAD == working tree; backend és frontend
`tsc`/build zöld.*

---

## Part 1 — Pre-deploy gate (kód + repó)

- [x] **Backend build** — `cd server && npm run build` (`prisma generate && tsc`) hibamentes
- [x] **Frontend build** — `npm run build` (`tsc -b && vite build`) hibamentes
- [x] **Nincs blokkoló TODO/FIXME/debugger** a `src`/`server/src` alatt (audit: 0)
- [x] **Nincs stray debug** — a `console.*` hívások szándékos naplózás (auth-audit, startup, error handler, mock email)
- [x] **Nincs direkt `process.env`** a `config.ts`-en kívül
- [x] **Nincs valós secret a repóban** — csak `.env.example`-ök; `server/.env` gitignore-olt; a docs-beli `sk_live_...`/`whsec_xxxx` placeholderek
- [x] **A commitolt HEAD fordul** — a függőben lévő config/token/rate-limit/migráció alapmunka commitolva (RC1)
- [ ] **Git push** a Render által figyelt branchre (deploy-trigger)

## Part 2 — Deploy-konfiguráció verifikáció (Task 3)

| Elem | Elvárt | Státusz |
|---|---|---|
| Backend Build Command | `npm install && npm run build` | ✅ (`build` = prisma generate + tsc) |
| Backend Start Command | `npm run start` | ✅ (`prisma migrate deploy && node dist/index.js`) |
| Prisma migrate deploy | start-parancs része, minden deploynál fut | ✅ |
| Health Check Path | `/health` (auth+DB nélkül) | ✅ jelen van |
| Frontend Build / Publish | `npm run build` / `dist` | ✅ |
| SPA rewrite | `/*` → `/index.html` (Render Static Site) | ⚠️ Renderen beállítandó |
| `NODE_ENV=production` | kézzel beállítva | ⚠️ deploy-időben |
| Env-validáció | hiányzó kötelező változó → startup exit(1) | ✅ (config.ts) |
| DATABASE_URL | `file:/var/data/axeriva.db` (persistent disk) | ⚠️ deploy-időben |
| UPLOAD_ROOT | `/var/data/uploads` (persistent disk) | ⚠️ deploy-időben |
| CORS | prod: csak `APP_URL` origin | ✅ (index.ts) |
| Helmet | globális, prod strict | ✅ (K2.2) |
| CSP | prod strict (nincs unsafe-inline/eval), dev laza | ✅ |
| HSTS | prod: 1 év + preload; dev: off | ✅ |
| Uploads | fehérlistás MIME, nosniff, CORP cross-origin | ✅ |
| `VITE_API_URL` | build-time a backend URL-re | ⚠️ frontend build env |

Jelmagyarázat: ✅ kódban igazolva; ⚠️ Render dashboard/deploy-időben állítandó
(nem kód).

## Part 3 — Environment változók (Render)

Backend (kötelező prod-ban, hiány → startup exit): `NODE_ENV`, `DATABASE_URL`,
`JWT_SECRET`, `APP_URL`, `UPLOAD_ROOT`, `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`,
`STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`. Opcionális:
`PORT` (Render adja), `STRIPE_PUBLISHABLE_KEY` (jelenleg **nem használt**),
`DEVELOPER_EMAIL/PASSWORD` (csak seedhez). Frontend: `VITE_API_URL`.
Részletek: [environment.md](environment.md).

- [ ] Minden kötelező változó beállítva
- [ ] `JWT_SECRET` hosszú, véletlen (nem placeholder)
- [ ] **`RESEND_API_KEY` rotálva** (a dev `.env`-ben éles kinézetű kulcs ült — K1.1)
- [ ] `APP_URL` = végleges frontend origin; `VITE_API_URL` = végleges backend URL

## Part 4 — HTTPS / Domain / DNS

- [ ] Custom domain(ek) felvéve (frontend + `api.` backend)
- [ ] DNS (CNAME/A) propagált
- [ ] Let's Encrypt tanúsítvány kiadva, HTTP→HTTPS redirect él
- [ ] HSTS fejléc a prod válaszokon (K2.2)
- [ ] Stripe webhook URL + `VITE_API_URL` a végleges backend-domainre

## Part 5 — Stripe / Resend / Uploads / Backups

- [ ] Stripe **live** Product+Price (`npm run stripe:setup`), `STRIPE_PRICE_ID` beállítva
- [ ] Stripe **live** webhook a 3 eseménnyel, `STRIPE_WEBHOOK_SECRET` beállítva
- [ ] Resend domain verifikálva (SPF/DKIM), `ResendEmailService` aktív (nem Mock)
- [ ] Feltöltés működik, redeploy után a fájl megmarad (persistent disk)
- [ ] Deploy előtti DB-mentés: `cp /var/data/axeriva.db /var/data/backup-$(date +%F).db`

## Part 6 — Rollback-terv

- **Kód:** Render → Events/Deploys → „Rollback to this deploy" (env-et nem érint).
- **Migráció:** `migrate deploy` csak előre megy — destruktív migrációt csak
  külön release-ben; additív migrációk a régi kóddal kompatibilisek.
- **Adat:** a Part 5 disk-mentés visszamásolása + restart.
- Részletek: [render-deployment.md](render-deployment.md) 7. pont.

---

## Part 7 — Post-deploy Smoke Test (Task 4)

Végrehajtandó közvetlenül a deploy után, a **live** frontend + backend
ellen. Minden lépés a valós UI-ból (kivéve ahol API-hívás jelezve).

### Alapinfrastruktúra
1. **Health:** `GET https://<api>/health` → `200`, `environment: "production"`,
   helyes `version`. *(Ha `development` → `NODE_ENV` nincs beállítva.)*
2. **Security headerek:** böngésző DevTools → Network → egy API-válasz →
   `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`,
   `X-Content-Type-Options: nosniff` jelen. `X-Powered-By` **nincs**.
3. **Frontend betöltés:** konzol hibamentes (nincs `[config] VITE_API_URL...`,
   nincs CORS-hiba); mély útvonal (`/login`) frissítésre is betölt (SPA rewrite).

### Autentikáció
4. **Registration:** új céggel regisztráció → generikus siker, átirányítás.
5. **Email verification:** érkezik a verifikációs e-mail (Resend) → link →
   „verified".
6. **Login:** a frissen regisztrált fiókkal → dashboard.
7. **JWT auth:** védett oldalak (projektek, ügyfelek) betöltenek; token
   nélkül/lejárt tokennel `/login`-ra dob.
8. **Password reset:** forgot-password → e-mail → új (policy-konform) jelszó →
   régi session érvénytelen, új jelszóval login OK.
9. **Logout:** kijelentkezés törli a helyi sessiont.

### Üzleti flow-k
10. **Invitation:** owner meghív egy employee-t → e-mail/link → employee
    accept (jelszó-policy) → employee login → `/my-*` oldalak.
11. **Uploads:** projekt-attachment feltöltés → megjelenik (kép embedelődik,
    CORP cross-origin) → **redeploy után is megmarad**.
12. **Dashboard:** owner dashboard aggregátumok betöltenek.
13. **Stripe:** Checkout indítása → (live kártyával) előfizetés aktiválódik →
    `Company.plan` frissül → Billing Portal elérhető → webhook-esemény
    „succeeded" a Stripe Dashboardon.
14. **Account deletion:** teszt-fiók törlése (jelszó + „DELETE") → a fiók
    tokenje azonnal érvénytelen.

### Biztonsági kontrollok
15. **Rate limiting:** 6+ gyors hibás login ugyanarra a címre → `429` +
    `Retry-After`.
16. **Enumeration:** ismeretlen vs létező e-maillel login → azonos generikus
    hiba; létező címre regisztráció → ugyanaz a generikus siker.
17. **Company isolation:** owner fiók-törlése után az employee tokenje
    `401` (inaktív cég).
18. **Audit log:** a Render logban strukturált `"channel":"auth-audit"` sorok
    (maszkolt e-mail, nincs jelszó/token/JWT).

Bármely lépés bukása esetén: [render-deployment.md](render-deployment.md) 8.
Troubleshooting.
