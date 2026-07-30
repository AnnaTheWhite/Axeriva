# Render Deployment — Axeriva

Teljes, önmagában követhető leírás az Axeriva production deployjához Renderen
(`axeriva.com` domainnel). A környezeti változók referenciája:
[environment.md](environment.md), a futásidejű viselkedés:
[runtime.md](runtime.md), az élesítési checklist:
[production-checklist.md](production-checklist.md).

## Repository-struktúra

```
CrewFlow/                 ← repo root = FRONTEND (React + Vite)
├── src/                  ← frontend forrás
├── package.json          ← frontend build ("npm run build" → dist/)
├── .env.example          ← frontend env minta (VITE_API_URL)
└── server/               ← BACKEND (Express + Prisma + PostgreSQL)
    ├── src/              ← backend forrás (belépési pont: src/index.ts)
    ├── prisma/           ← schema + migrációk
    ├── package.json      ← backend build/start scriptek
    └── .env.example      ← backend env minta
```

Két Render-szolgáltatás kell ugyanabból a repóból: egy **Web Service**
(backend, Root Directory: `server`) és egy **Static Site** (frontend, Root
Directory: a repo root).

## Miért Render

A backend **managed PostgreSQL**-t használ (Render PostgreSQL vagy bármely
külső Postgres) — az adatbázis tehát már *nem* a konténer fájlrendszerén él.
**Perzisztens disk viszont továbbra is kell**, mert a feltöltött
project-attachmentek fájlok maradtak: ezeket a Render deployonként eldobná a
konténer efemer fájlrendszeréről. Render Web Service-e ezt natívan támogatja.

## Deployment sorrend

1. **PostgreSQL instance létrehozása** (lásd 0. pont) — ennek meg kell lennie,
   mielőtt a backend elindulna.
2. Backend Web Service létrehozása diskkel + env varokkal → deploy.
3. Backend URL ellenőrzése (`/health`).
4. Stripe live setup (product/price + webhook) a backend URL-lel — **a seed
   előtt kell**: `NODE_ENV=production` alatt a hat `STRIPE_PRICE_*` változó
   nélkül a config-validáció a seed scriptet is kilépteti.
5. **DEVELOPER (platform-admin) fiók seedelése** — az adatbázis üres, ez az
   egyetlen módja, hogy az `/admin` felület elérhetővé váljon (lásd 1.9 pont).
6. Frontend Static Site a backend URL-re mutató `VITE_API_URL`-lel → deploy.
7. `APP_URL` beállítása a backendben a végleges frontend-domainre → redeploy.
8. Post-deploy validáció (lásd checklist).

## 0. Adatbázis — Render PostgreSQL

A backend nem hoz létre magának adatbázist: a `DATABASE_URL`-nek egy már létező
instance-ra kell mutatnia, különben a szerver induláskor `FATAL: cannot connect
to the database` hibával kilép.

1. Render Dashboard → **New → PostgreSQL**.
2. **Region**: *ugyanaz*, amit a Web Service is kapni fog. Ez nem stílus
   kérdése — az Internal Database URL csak azonos régión belül oldható fel.
3. Név / adatbázisnév / user: szabadon. Jegyezd fel.
4. Létrehozás után az instance **Connect** fülén két connection string van:
   - **Internal Database URL** — ezt add a backend `DATABASE_URL`-jének. Nem
     megy ki a publikus internetre, és nem kell hozzá `sslmode=require`.
   - **External Database URL** — csak a Renderen kívülről (pl. a saját gépedről
     futtatott `pg_dump`, seed-script vagy migráció) használható; ehhez kell az
     `sslmode=require`.
5. A sémát **nem kell kézzel létrehozni**: a Start Command első fele
   (`prisma migrate deploy`) minden deploynál alkalmazza a migrációkat, az
   elsőnél a teljes sémát a nulláról.

> **Az adatbázis üresen indul.** A projekt SQLite-ról állt át PostgreSQL-re, és
> a régi fejlesztői adatok szándékosan nem lettek átmigrálva. Az első deploy
> után nincs egyetlen cég, felhasználó vagy projekt sem — az első fiók a
> regisztrációs űrlapon keresztül jön létre, a platform-admin pedig az 1.9
> pontban leírt seed-scripttel.

**Az instance adatai és backup-képessége** *(a dashboardról töltendő ki — enélkül
a mentési terv ellenőrizhetetlen; lásd [backup-restore.md](backup-restore.md))*:

| Tétel | Érték *(dashboardról leolvasva: 2026-07-26)* |
|---|---|
| Render PostgreSQL plan/tier | **Basic-256mb** |
| PostgreSQL major verzió | **18** — a `pg_dump`/`pg_restore` kliensnek is ≥18 kell (régebbi kliens `server version mismatch` hibával el sem indul) |
| Napi automatikus backup | Külön napi backup-lista a Recovery oldalon **nem jelenik meg** — a védelmet a PITR adja (lásd alább), plusz on-demand **Export** (a fájlok ≥7 napig megőrizve) |
| Point-in-time recovery (PITR) | **van — 7 napos** visszaállítási ablak |

## 1. Backend — Web Service

1. Render Dashboard → **New → Web Service**, kösd be a GitHub repót.
2. **Root Directory**: `server`
3. **Runtime**: Node (a `server/package.json` `engines` mezője Node ≥20-at
   ír elő — Render ezt tiszteletben tartja).
4. **Build Command**: `npm install && npm run build`
   (a `build` script: `prisma generate && tsc` — lásd
   [server/package.json](../server/package.json))
5. **Start Command**: `npm run start`
   (ez: `prisma migrate deploy && node dist/index.js` — minden deploynál
   automatikusan alkalmazza az új migrációkat, majd indít)
6. **Health Check Path**: `/health`
   (autentikáció és DB-hozzáférés nélküli végpont, pontosan erre való —
   lásd [runtime.md](runtime.md))
7. **Add a Disk** (a service Settings → Disks):
   - **Mount path: `/var/data`** (ez az ajánlott érték, a lenti env varok
     erre épülnek)
   - Méret: 1 GB-tal indulva bővíthető.
   - Ez tartja meg a **feltöltött fájlokat** újraindítás/redeploy között.
     (Az adatbázis a Postgres-migráció óta már nem itt van — lásd lentebb.)

### Environment Variables (Render Dashboard → Environment)

| Változó | Érték |
|---|---|
| `NODE_ENV` | `production` — **kötelező kézzel beállítani**: ez kapcsolja be a szigorú env-validációt, a produkciós CORS-t és hibaválaszokat (lásd [runtime.md](runtime.md)) |
| `DATABASE_URL` | a managed PostgreSQL connection stringje (`postgresql://…?sslmode=require`). Render PostgreSQL esetén az **Internal Database URL** (ugyanabban a régióban, nem megy ki a publikus netre) |
| `UPLOAD_ROOT` | `/var/data/uploads` (a disk mount path-on belül, **abszolút** út!) |
| `JWT_SECRET` | hosszú, véletlen string (pl. `openssl rand -hex 64`) — **ne** a dev placeholder |
| `APP_URL` | `https://axeriva.com` — a frontend URL-je; ez a CORS engedélyezett origin ÉS az e-mailekbe/Stripe-redirectekbe épülő linkek alapja |
| `STRIPE_SECRET_KEY` | `sk_live_...` — **test kulcs itt indulási hibát okoz**: `NODE_ENV=production` + `sk_test_…` esetén az API exit(1)-gyel megtagadja az indulást, tehát a deploy bukik (szándékos védelem, lásd `config/stripeKeyMode.ts`; staging kivétel: `ALLOW_TEST_STRIPE_KEY=true`) |
| `STRIPE_PRICE_ID` | live Price ID (legacy „Axeriva Pro") — lásd 3. pont |
| `STRIPE_PRICE_STARTER_EUR` | live per-plan Price ID — a `npm run stripe:setup` mind a hatot kiírja (3. pont) |
| `STRIPE_PRICE_STARTER_HUF` | live per-plan Price ID — ugyanonnan |
| `STRIPE_PRICE_PROFESSIONAL_EUR` | live per-plan Price ID — ugyanonnan |
| `STRIPE_PRICE_PROFESSIONAL_HUF` | live per-plan Price ID — ugyanonnan |
| `STRIPE_PRICE_BUSINESS_EUR` | live per-plan Price ID — ugyanonnan |
| `STRIPE_PRICE_BUSINESS_HUF` | live per-plan Price ID — ugyanonnan |
| `STRIPE_WEBHOOK_SECRET` | live webhook signing secret — lásd 4. pont |
| `STRIPE_PORTAL_FLOW_CONFIG_ID` | live portál flow-konfiguráció id (`bpc_…`) — Design C, a `npm run stripe:setup` hozza létre és írja ki. **Ugyanabból az accountból és módból kell származnia, mint a `STRIPE_SECRET_KEY`** (a `bpc_` id-ben nincs test/live jelölés — rossz módú id-vel az indulás sikeres, de minden upgrade elhasal futáskor). Lásd a lenti Design C rollout-sorrendet. |
| `RESEND_API_KEY` | Resend API key (élesítés előtt rotálva!) |
| `RESEND_FROM_EMAIL` | `Axeriva <noreply@axeriva.com>` |

#### Design C rollout-sorrend (2026-07-30 — kötelező, különben a deploy bukik)

A `STRIPE_PORTAL_FLOW_CONFIG_ID` a Design C commit óta production-kötelező,
és az értékét csak az ÚJ `stripe:setup` tudja előállítani. A helyes sorrend:

1. **Deploy ELŐTT, lokálisan**, a live kulccsal: `npm run stripe:setup` —
   beállítja a price-ok `tax_behavior`-ját (egyirányú művelet a live
   price-okon!), létrehozza/frissíti a flow-konfigurációt, és kiírja a
   `STRIPE_PORTAL_FLOW_CONFIG_ID` sort.
2. A Render Environmentben **beállítani** az új változót.
3. A Stripe Dashboardban a **default** Customer Portal konfigurációból a
   csomagváltást **kikapcsolni** (fizetési mód, számlák, lemondás, folytatás
   maradjon), és a **Billing → Revenue recovery → Retries → „If all retries
   fail"** beállítást **cancel** vagy **mark unpaid** értékre állítani (a
   „leave as-is" a past_due türelmi állapotot végtelenítené).
4. **Csak ezután** pusholni a commitot (a Render a pushra deployol).

Ha a sorrend felborul: a boot `FATAL: missing … STRIPE_PORTAL_FLOW_CONFIG_ID`
hibával elszáll — a korábbi verzió szolgál tovább (nincs leállás), de a
pipeline minden további deployt blokkol, amíg a változó be nincs állítva.
Fontos: a start command (`prisma migrate deploy && node dist/index.js`) a
migrációt MÁR lefuttatta, mielőtt a config-validáció elbukik — a bukott
deploy-ablakban a RÉGI kód regisztrál cégeket `trialConsumedAt` nélkül.
Cutover után egy egyszeri
`UPDATE "Company" SET "trialConsumedAt" = "createdAt" WHERE "trialConsumedAt" IS NULL;`
zárja ezt a rést. Megjegyzés: a `ProcessedStripeEvent` webhook-idempotencia
tábla lassan, de korlát nélkül nő (3 eseménytípus) — évi egyszeri prune elég.

`PORT`-ot a Render maga adja — nem kell beállítani, a szerver a
`config.port`-on keresztül felveszi. `NODE_ENV=production` mellett a fenti
lista **mindegyike kötelező**: bármelyik hiányzik, a szerver induláskor
kilép, és a log pontosan megnevezi a hiányzó változó(ka)t — a deploy így
azonnal, láthatóan bukik, nem félkészen üzemel.

### Perzisztens tárolás — miért így

- Az **adatbázis** a Postgres-migráció óta külön managed szolgáltatás: a
  `DATABASE_URL` connection string, nem fájlút. Az adatbázist a szolgáltatói
  backup (napi snapshot / PITR — a konkrét képességet a 0. pont táblázata
  rögzíti) **és** a deploy előtti kézi `pg_dump` együtt fedi; a disk pedig az
  **uploadokat** tartja, amit külön, a DB-dumppal egy időablakban kell menteni.
  A kettő együtt ad teljes mentést — részletek: [backup-restore.md](backup-restore.md).
- Az `UPLOAD_ROOT` viszont továbbra is **abszolút, a `/var/data` mount alatti**
  út. Relatív út (a lokális `./uploads` fallback) a konténer efemer
  fájlrendszerére mutatna, amit a Render minden deploynál eldob — **minden
  feltöltött fájl elveszne**.
- Az upload-könyvtárat a szerver induláskor hozza létre
  (`/var/data/uploads/projects`); ha a mount hiányzik vagy nem írható,
  induláskor `FATAL` hibával leáll (szándékosan — lásd runtime.md).

### 1.9 DEVELOPER (platform-admin) fiók seedelése

Az adatbázis üresen indul, és a regisztráció **mindig `BUSINESS_OWNER`-t hoz
létre** — nincs olyan végpont, amivel `DEVELOPER` szerepkör kiosztható lenne.
Az `/admin` és `/admin/analytics` felület tehát addig elérhetetlen, amíg ez a
script le nem fut. Egyszer kell megcsinálni, az első deploy után.

A Render Shellben (Web Service → **Shell**):

```bash
node dist/scripts/seedDeveloper.js <email> <erős-jelszó>
```

> **Ne `npm run seed:developer`-t használj a szerveren.** Az az alias
> `ts-node`-ot hív, ami csak devDependency — a Render `NODE_ENV=production`
> mellett buildel, tehát ott nincs telepítve, és a parancs
> `ts-node: not found`-dal elhasal. A `dist/scripts/seedDeveloper.js` a build
> részeként keletkezik, és csak production-függőségeket használ. Lokálisan
> (ahol a devDependencies megvannak) az `npm run seed:developer` továbbra is
> jó.

Alternatíva: a scriptet a saját gépedről is futtathatod az **External**
Database URL-lel a `DATABASE_URL`-ben — ilyenkor `npm run seed:developer` is
működik. A jelszó ne kerüljön a repóba és ne maradjon shell-historyban.

## 2. Frontend — Static Site

1. Render Dashboard → **New → Static Site**, ugyanaz a repo.
2. **Root Directory**: *(üresen hagyva — repo root)*
3. **Build Command**: `npm install && npm run build`
4. **Publish Directory**: `dist`
5. **Environment Variables**: `VITE_API_URL` = a backend publikus URL-je
   (pl. `https://axeriva-api.onrender.com` vagy `https://api.axeriva.com`).
   Build-time változó: ha módosítod, **redeploy (rebuild) kell**. Ha
   kimarad, a build localhostra mutatna — az app ezt a böngészőkonzolban
   hangosan jelzi (`[config] VITE_API_URL was not set at build time…`,
   lásd [src/services/api.ts](../src/services/api.ts)).
6. **SPA fallback (kötelező!)**: a Static Site **Redirects/Rewrites**
   fülén vegyél fel egy rewrite-ot:
   - Source: `/*` → Destination: `/index.html` → Action: **Rewrite**
   - E nélkül a React Router útvonalai (pl. `/login`,
     `/reset-password/<token>`) közvetlen megnyitásra/frissítésre 404-et
     adnának.

Az assetek relatív gyökér-útvonalról (`/assets/...`) töltődnek — a Vite
default `base: "/"` beállítása domain-gyökérre publikálva helyes, ehhez
nem kell nyúlni.

7. **Response headerök (kötelező — a H2 lezárása, lásd
   [http-security.md](http-security.md))**: a Static Site **Settings →
   Headers** fülén vedd fel az alábbi három sort. Figyelem: a Render
   **nem olvas `public/_headers` fájlt** (az Netlify/Cloudflare Pages
   mechanizmus) — kizárólag a Dashboard-beállítás él.

   | Path | Name | Value |
   |---|---|---|
   | `/*` | `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://<API-ORIGIN>; connect-src 'self' https://<API-ORIGIN>; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; upgrade-insecure-requests` |
   | `/*` | `X-Content-Type-Options` | `nosniff` |
   | `/*` | `Referrer-Policy` | `strict-origin-when-cross-origin` |

   A `https://<API-ORIGIN>` **mindkét** előfordulását cseréld a backend
   tényleges originjére — **pontosan arra, ami a `VITE_API_URL`-ben van**
   (pl. `https://axeriva-api.onrender.com` vagy `https://api.axeriva.com`;
   origin = séma + host, útvonal nélkül). Az `img-src`-ben az uploads-képek
   és logók miatt kell, a `connect-src`-ben az API-hívások miatt; a `data:`
   a legacy logókat és a beépített SVG-hátteret fedi. A `style-src
   'unsafe-inline'` a React inline `style` attribútumai miatt szükséges
   (strength meter, usage bar, naptár) — az érték a 2026-07-26-i builden
   böngészőben validálva: nulla CSP-sértés a landing/login/register
   oldalakon. Beállítás után ellenőrzés:
   `curl -sI https://axeriva.com | findstr /i content-security` — a fejléc
   jelenjen meg, és a live appban a DevTools-konzol maradjon „Refused to…"
   üzenetek nélkül.

## 3. Stripe live mode — Product + Price

```powershell
# server/.env-ben (vagy ideiglenesen exportálva) a live sk_live_... kulccsal:
npm run stripe:setup
```

> A scriptet `NODE_ENV` beállítása **nélkül** (development módban) futtasd: ott a
> live kulcs csak egy hangos figyelmeztetést vált ki, az indulás engedélyezett.
> (`NODE_ENV=test` alatt a live kulcs fatális — a teszt-suite soha nem érhet
> live accounthoz; lásd `config/stripeKeyMode.ts`.)

A script idempotens, és **nem csak** a legacy `STRIPE_PRICE_ID`-t adja: minden
self-serve csomaghoz (starter/professional/business) létrehozza a Productot és
a valutánkénti (EUR/HUF) recurring Price-okat, majd kiírja mind a **hat**
`STRIPE_PRICE_*` env-sort — mindet be kell másolni a Render env-be, mert
`NODE_ENV=production` alatt mindegyik kötelező (`config.ts PRODUCTION_REQUIRED`).

Idempotens: (újra)létrehozza az "Axeriva Pro" Productot és a havi Price-t
**live mode**-ban, és kiírja a `STRIPE_PRICE_ID`-t — ezt másold a Render
Environment Variables-be.

## 4. Stripe live webhook

1. Stripe Dashboard → bal felül **Live mode**-ra váltás.
2. Developers → Webhooks → **Add endpoint**.
3. Endpoint URL: `https://<backend-domain>/subscription/webhook`
4. Események: `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`.
5. A létrehozott endpoint "Signing secret" mezője adja a
   `STRIPE_WEBHOOK_SECRET` értékét.

Részletesebb háttér (miért ez a 3 esemény, raw-body middleware sorrend,
retry-logika): [stripe-webhook-production-readiness.md](./stripe-webhook-production-readiness.md).

## 5. Custom domain + HTTPS

1. Frontend Static Site → Settings → **Custom Domains** → `axeriva.com`
   (+ `www.axeriva.com` redirect).
2. Backend Web Service → Custom Domains → `api.axeriva.com` (opcionális, de
   szebb, mint az `onrender.com` URL — ilyenkor a `VITE_API_URL`-t és a
   Stripe webhook URL-t is erre állítsd).
3. **DNS** a domain-szolgáltatónál: a Render által mutatott `CNAME` (www,
   api) és `A`/`ALIAS` (apex) rekordok felvétele.
4. **HTTPS**: a Render automatikusan ad Let's Encrypt tanúsítványt minden
   verifikált domainre, és HTTP→HTTPS redirectet is végez — külön teendő
   nincs. A backend `trust proxy` beállítása (production) a Render proxyja
   mögötti helyes protokoll/IP-kezelést már tudja.

## 6. Ellenőrzés deploy után

- `GET https://<backend-domain>/health` →
  `{"status":"ok","environment":"production","version":"1.0.0",...}` — az
  `environment` **legyen `production`** (ha `development`, a `NODE_ENV`
  nincs beállítva!).
- Regisztrálj egy teszt-fiókot a live frontendről → érkezik-e a
  verifikációs e-mail (Resend, `noreply@axeriva.com`-ról).
- Böngészőkonzol a frontenden: ne legyen `[config] VITE_API_URL...` hiba és
  CORS-hiba.
- Frissíts rá egy mély útvonalra (pl. `/login`) — SPA rewrite működik-e.
- Tölts fel egy project-attachmentet, majd **redeployolj** — a fájlnak meg
  kell maradnia (ha eltűnik, az `UPLOAD_ROOT` nincs a disken).
- Stripe: élesben csak valódi kártyával tesztelhető; a webhook-kézbesítést
  a Stripe Dashboard → Webhooks → endpoint → "Events" listán ellenőrizd.

## 7. Rollback-stratégia

- **Kód**: Render Dashboard → a service **Events/Deploys** listája → korábbi
  sikeres deploy mellett **"Rollback to this deploy"**. Ez a korábbi buildet
  állítja vissza — env varokat nem érinti.
- **Migrációk**: a `prisma migrate deploy` csak előre megy. Ha egy deploy új
  migrációt is hozott, a kód-rollback után a séma újabb marad — az additív
  migrációk (új tábla/oszlop) ettől még kompatibilisek a régi kóddal;
  destruktív migrációt (oszlop/tábla törlés) ezért CSAK két lépcsőben,
  külön release-ben adj ki.
- **Adat**: deploy előtt készíts DB-mentést custom formátumban:

  ```bash
  pg_dump --format=custom --no-owner --no-privileges \
    --file="axeriva-$(date +%F-%H%M).dump" "$DATABASE_URL"
  ```

  Vészhelyzetben a visszaállítás — **nem üres adatbázisba is** működik:

  ```bash
  pg_restore --clean --if-exists --no-owner --no-privileges \
    --single-transaction --dbname="$DATABASE_URL" axeriva-<dátum>.dump
  ```

  ⚠️ Restore után a következő restart `prisma migrate deploy`-a automatikusan
  újra felviszi a hiányzó migrációkat — ha az incidens oka egy destruktív
  migráció volt, azt a repóban előbb vissza kell vonni. A **feltöltött
  fájlokat** (a teljes `/var/data/uploads`-ot: `projects/` + `logos/`) a
  DB-dumppal egy időablakban, külön kell menteni — azok nincsenek a DB-ben.
  A teljes eljárás, a verifikációs lépések és a restore-drill:
  [backup-restore.md](backup-restore.md).

## 8. Troubleshooting

| Tünet | Ok / megoldás |
|---|---|
| Deploy log: `FATAL: missing required environment variable(s): ...` | A megnevezett env var hiányzik a Render Environment panelen. Pótold, redeploy. |
| Deploy log: `FATAL: cannot create upload directory` | `UPLOAD_ROOT` nem a diskre mutat, vagy a disk nincs csatolva. Ellenőrizd a mount path-t (`/var/data`). |
| Deploy log: `FATAL: cannot connect to the database` | `DATABASE_URL` hibás vagy elérhetetlen: nem `postgresql://…` formátumú, rossz jelszó/host, hiányzó `sslmode=require`, vagy a DB nem ugyanabban a régióban van (Render: az **Internal** Database URL-t használd). |
| A frontend minden API-hívása elhasal, konzolban `localhost:5000` | A build `VITE_API_URL` nélkül készült — állítsd be és **rebuild**. |
| CORS-hiba a böngészőben | A backend `APP_URL`-je nem egyezik a frontend tényleges origin-jével (pontos séma+domain, trailing slash nélkül). |
| `/login` frissítésre 404 | Hiányzik az SPA rewrite (`/*` → `/index.html`). |
| Feltöltött fájlok eltűnnek redeploy után | `UPLOAD_ROOT` (vagy `DATABASE_URL`) nem a persistent disk alatt van. |
| Stripe webhook 400 "Invalid signature" | Rossz `STRIPE_WEBHOOK_SECRET` (test vs live mode keveredés), vagy a webhook nem a `/subscription/webhook` útvonalra mutat. |
| `/health` `environment: "development"`-et mutat | `NODE_ENV=production` nincs beállítva a Renderen. |
| E-mail nem megy ki, a log `MockEmailService`-t ír | `RESEND_API_KEY` hiányzik (prodban ez env-validációs hiba is — nézd a startup logot). |
