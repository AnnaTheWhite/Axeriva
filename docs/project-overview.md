# Axeriva — Projekt-összefoglaló

*Állapot: 2026. július 6. — `master` branch, utolsó commit: `51232bd` (JWT_SECRET fail-fast)*

Az **Axeriva** (repó-mappa neve történeti okból: `CrewFlow`) egy multi-tenant SaaS alkalmazás kis vállalkozások (elsősorban fizikai munkát végző csapatok) számára: munkavállalók, projektek, ügyfelek, műszakok/időnyilvántartás és előfizetés-kezelés egy helyen, tulajdonosi "Command Center"-rel kiegészítve.

---

## 1. Architektúra áttekintés

Klasszikus kétrétegű felépítés, monorepo-szerű elrendezésben:

```
CrewFlow/
├── src/            ← Frontend (React 19 + Vite 8 + TypeScript + Tailwind 4)
├── server/         ← Backend (Express 5 + TypeScript + Prisma 6 + SQLite)
│   ├── prisma/     ← schema.prisma, migrációk, axeriva.db (SQLite fájl)
│   ├── src/
│   │   ├── routes/       ← 16 route-modul (a teljes API itt él, controller réteg nincs használatban)
│   │   ├── middleware/   ← auth (JWT), role (RBAC), upload (multer)
│   │   ├── services/     ← activity, audit, email (Resend), geofence, stripe
│   │   ├── constants/    ← státusz/prioritás/kategória listák
│   │   └── scripts/      ← seedDeveloper, stripeSetup
│   └── uploads/    ← projekt-csatolmányok (diszken, UUID fájlnévvel)
└── docs/           ← render-deployment.md, stripe-webhook-production-readiness.md
```

- **Kommunikáció:** REST/JSON, JWT Bearer tokennel. A frontend `src/services/*.service.ts` fájljai fedik le végpontonként az API-t (`src/services/api.ts` a közös kliens, benne globális 401-kezelés).
- **Adatbázis:** SQLite fájl (`server/prisma/axeriva.db`) Prisma ORM-en keresztül — production-ben Render persistent diskre kerül.
- **Fájltárolás:** lemezen (`server/uploads/`), statikus mount `/uploads` alatt, véletlenszerű UUID fájlnevekkel.
- **E-mail:** Resend (verifikáció, jelszó-reset, meghívók).
- **Fizetés:** Stripe Checkout + Billing Portal + webhook.

### Szerepkörök (RBAC)

| Szerep | Leírás |
|---|---|
| `DEVELOPER` | Platform-operátor, céghez nem tartozik; admin felületek (`/admin/*`) |
| `BUSINESS_OWNER` | Cégtulajdonos — a teljes cégadminisztráció, előfizetés, Command Center |
| `EMPLOYEE` | Munkavállaló — saját beosztás, saját projektek, clock-in/out (`/my-*` oldalak) |

A multi-tenancy alapja a `companyId`: minden üzleti entitás céghez kötött, a lekérdezések a bejelentkezett user cégére szűrnek.

---

## 2. Technológiai stack

**Frontend:** React 19, TypeScript ~6.0, Vite 8, Tailwind CSS 4, React Router 7, react-big-calendar (naptár/beosztás), date-fns. Saját, könnyűsúlyú i18n megoldás (`src/i18n/` — `hu.json` + `en.json`, `LanguageProvider` context, `LanguageSwitcher` komponens).

**Backend:** Node.js + Express 5 (CommonJS), TypeScript 5.6, Prisma 6 (SQLite), bcryptjs (jelszó-hash), jsonwebtoken, multer (upload), Stripe SDK, Resend SDK, dotenv, cors. Dev: `ts-node-dev`.

**Nincs még:** automatizált tesztek (unit/integration/E2E), CI pipeline, controller-réteg (a route-fájlok tartalmazzák a logikát), state-management könyvtár (React context + service hívások).

---

## 3. Adatbázis-séma (17 modell)

22 migráció, 2026.06.15–06.21 között. Fő entitások és kapcsolataik:

- **Company** — tenant-gyökér. Branding/profil mezők (logó, számlázási adatok, adószám), Stripe-előfizetés mezők (`plan`, `subscriptionStatus`, `stripeCustomerId/SubscriptionId`, `subscriptionEndsAt`), soft-delete (`active`, `deletedAt`).
- **User** — login-fiók. E-mail-verifikáció és jelszó-reset tokenekkel, soft-delete-tel. Opcionális `companyId` (DEVELOPER-nek nincs) és `employeeId` (EMPLOYEE-szerepnél köti a dolgozói rekordhoz).
- **Employee** — dolgozói (worker) rekord; státusszal, projekt-hozzárendelésekkel, műszakokkal.
- **Project** — státusz, határidő, ügyfél-kapcsolat, **geofence-alapmezők** (cím, lat/lng, sugár, kapcsoló — automatikus clock-in/out még nincs rákötve).
- **ProjectAssignment** — Employee↔Project N:M (unique párral).
- **Customer** — ügyfél; projektek, emlékeztetők, kommunikációs napló kapcsolódik hozzá.
- **Shift** — műszak (clock-in/out): start/end, opcionális projekt, jegyzet.
- **ProjectNote / ProjectAttachment / ProjectActivity** — projekt-jegyzetek (dolgozóknak is látható), csatolmányok (kategóriával, diszken tárolva), append-only tevékenység-idővonal (típus + szabad JSON metadata).
- **Owner Command Center modellek:**
  - **OwnerNote** — tulajdonosi privát jegyzet/scratchpad; státusz (Inbox/Reviewed/…), prioritás, pin, opcionális Project/Customer/Employee link, konverzió-történet.
  - **Task** — minimális feladat-modell (Open/InProgress/Done, prioritás, határidő, opcionális projekt/dolgozó) — szándékosan nem teljes task-modul.
  - **Reminder** — emlékeztető (értesítés-kézbesítés még nincs, csak tárolás).
  - **CommunicationLog** — ügyfél-interakció napló (hívás/e-mail/meeting).
  - **ProjectInternalNote** — csak tulajdonos/developer által látható projektjegyzet (szándékosan külön a ProjectNote-tól).
  - **OwnerNoteConversion** — audit arról, hogy egy jegyzetből mi lett konvertálva (duplikáció-védelem + történet).
- **Invitation** — token-alapú munkavállalói meghívó lejárattal.
- **AuditLog** — akció + szabad JSON metadata, cég/user hivatkozással.

Tervezési elvek: enumok helyett szabad string mezők API-szintű validációval (`server/src/constants/`), hogy bővítés migráció nélkül menjen; törlés helyett soft-delete a történet megőrzésére.

---

## 4. API-végpontok (Express, `server/src/index.ts` mount-jai)

Publikus: `/auth/*`, `/invites/*`, `/subscription/webhook` (raw body a Stripe-aláíráshoz, a `express.json()` **előtt** mountolva). Minden más `authMiddleware` mögött.

| Modul | Végpontok |
|---|---|
| `/auth` | register, login, verify-email/:token, resend-verification, forgot-password, reset-password/:token |
| `/invites` | GET :token (meghívó adatai), POST :token/accept |
| `/employees` | list, update, státusz-váltás, delete |
| `/projects` | list, create, update, assignment fel-/leszerelés, delete; + `/:id/notes`, `/:id/attachments`, `/:id/activity` (projectActivity.routes) |
| `/customers` | CRUD + `/:id/communications` |
| `/companies` | list, get, update (developer/owner szint) |
| `/company` | GET/PUT `/settings` (branding, base64 logó — ezért 5 MB JSON-limit) |
| `/shifts` | GET `/me`, POST clock-in, clock-out |
| `/subscription` | GET állapot, POST checkout, sync, portal |
| `/subscription/webhook` | Stripe: checkout.session.completed, subscription.updated, subscription.deleted |
| `/dashboard` | tulajdonosi dashboard-aggregátumok |
| `/account` | POST `/delete` (soft-delete + session-revoke) |
| `/owner-notes` | list, dashboard, context/:projectId, detect (link-javaslat), CRUD, `/:id/conversions`, POST `/:id/convert` |
| `/admin` | companies, users, logs (DEVELOPER) |
| `/attachments` | csatolmány-kiszolgálás/-kezelés |

Biztonsági megoldások már beépítve: JWT_SECRET fail-fast induláskor; CORS `APP_URL`-re szűkítve productionben; soft-deletelt userek session-jeinek visszavonása; inaktív fiókra jelszó-reset tiltása; soft-deletelt e-mail címek felszabadítása újraregisztrációhoz; globális 401-kezelés a frontenden.

---

## 5. Frontend-oldalak és route-ok

Publikus: Landing (`/`), Pricing, Login, Register, `/invite/:token`, `/verify-email/:token`, `/forgot-password`, `/reset-password/:token`.

Bejelentkezett (DashboardLayout: Sidebar + Topbar, `ProtectedRoute` szerep-guarddal):

- **Tulajdonos:** Dashboard, `/employees`, `/projects` (+ `/projects/:id` részletek: jegyzetek, csatolmányok, activity-idővonal), `/customers`, `/schedule` (naptár), `/time-tracking`, `/subscription`, `/command-center` (Owner Command Center), `/settings` (cégprofil/branding), `/profile`.
- **Munkavállaló:** `/my-schedule`, `/my-time` (clock-in/out), `/my-projects` (+ `/my-projects/:id`).
- **Developer/admin:** `/admin` (platform-dashboard), `/admin/companies`, `/admin/users`, `/admin/billing`, `/admin/logs`.

Egyéb: `EmailVerificationBanner`, kétnyelvű UI (HU/EN), `AuthContext` a session-kezeléshez.

---

## 6. Elkészült fő funkciók (összefoglalva)

1. **Teljes auth-életciklus:** regisztráció + e-mail-verifikáció (Resend), login (JWT), jelszó-reset, fiók-törlés (soft-delete audit-loggal), meghívó-alapú employee-onboarding.
2. **Multi-tenant cégkezelés** RBAC-kal (DEVELOPER / BUSINESS_OWNER / EMPLOYEE).
3. **Employee-, Project-, Customer-kezelés** hozzárendelésekkel.
4. **Projekt-részletek:** jegyzetek, kategorizált fájl-csatolmányok, activity-idővonal.
5. **Időnyilvántartás:** clock-in/out műszakok, naptáras beosztás (react-big-calendar), munkavállalói saját nézetek.
6. **Owner Command Center (Phase 1–3):** privát jegyzetek státusszal/prioritással/pinnel, entitás-link-detektálás, konverzió Task/Reminder/CommunicationLog/ProjectInternalNote célokra duplikáció-védelemmel és konverzió-történettel.
7. **Stripe-előfizetés:** Checkout, Billing Portal, webhook-szinkron (3 eseménytípus), plan/státusz a Company rekordon.
8. **Cégprofil/branding-beállítások** (logó, számlázási adatok) — későbbi e-mail-sablon/PDF/árajánlat/számla alapjaként.
9. **Admin (platform) felület:** cégek, userek, audit-logok, billing-áttekintés.
10. **i18n (HU/EN)**, landing + pricing oldal.
11. **Auth-stabilizálási kör** (K-jelű fixek): session-revoke, 401-kezelés, JWT_SECRET fail-fast, e-mail-újrafelhasználás.

---

## 7. Hátralévő feladatok / roadmap

### Production-élesítés (dokumentálva a docs/ alatt)
- **Render deploy** ([render-deployment.md](render-deployment.md)): backend Web Service persistent diskkel (`DATABASE_URL` és `UPLOAD_ROOT` a disk mount alá!), frontend Static Site, `axeriva.com` domain.
- **API_URL hardkódolva** `http://localhost:5000`-re a `src/services/api.ts`-ben → environment-alapúvá kell tenni build előtt.
- **Stripe élesítés** ([stripe-webhook-production-readiness.md](stripe-webhook-production-readiness.md)): a jelenlegi `.env` teszt-kulcsokat és placeholder webhook-secretet tartalmaz; élő webhook-endpoint + live kulcsok beállítása szükséges.

### Funkcionális bővítések (a kódban előkészítve)
- **Geofence automatikus clock-in/out** — a Project modellen a mezők (lat/lng/sugár/kapcsoló) és a `services/geofence` alap megvan, az automatika nincs bekötve.
- **Reminder-értesítések** (push/PWA) — a Reminder csak tárol, kézbesítés nincs.
- **Task-modul kiterjesztése** — a mostani minimális Task szándékosan bővíthetőre tervezve (checklist, sablonok, al-feladatok).
- **Árajánlat / számla / PDF generálás** — a Company branding-mezők ehhez készültek elő.
- **E-mail-sablonok** a cég-brandinggel.

### Műszaki adósság / minőség
- **Tesztek**: jelenleg nincs semmilyen automatizált teszt — legalább az auth- és Stripe-webhook-útvonalakra integrációs tesztek kellenének.
- **CI/CD** pipeline (lint + build + teszt).
- **SQLite → PostgreSQL** megfontolandó, ha a Render-diskes SQLite-ot kinövi a projekt (párhuzamos írások, backupok).
- **Controller/service réteg** — a route-fájlok vastagok (üres `controllers/` mappa jelzi az eredeti szándékot).
- Repó-higiénia: `server/tsconfig.tsbuildinfo` és a dev `axeriva.db` gitignore-olása.

---

## 8. Fejlesztői gyorsindítás

```bash
# Backend (server/.env: DATABASE_URL, JWT_SECRET, STRIPE_*, RESEND_*, APP_URL)
cd server && npm install && npm run dev        # ts-node-dev, port 5000
npm run seed:developer                          # DEVELOPER user seedelése
npm run stripe:setup                            # Stripe product/price setup

# Frontend
npm install && npm run dev                      # Vite dev szerver
```
