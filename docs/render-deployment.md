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
└── server/               ← BACKEND (Express + Prisma + SQLite)
    ├── src/              ← backend forrás (belépési pont: src/index.ts)
    ├── prisma/           ← schema + migrációk
    ├── package.json      ← backend build/start scriptek
    └── .env.example      ← backend env minta
```

Két Render-szolgáltatás kell ugyanabból a repóból: egy **Web Service**
(backend, Root Directory: `server`) és egy **Static Site** (frontend, Root
Directory: a repo root).

## Miért Render

A backend SQLite-fájlt használ, nem külön DB-szervert — ezért **perzisztens
disk** kell, ami a fájlrendszert deploy között megtartja. Render Web
Service-e ezt natívan támogatja. Ugyanez igaz a feltöltött
project-attachmentekre.

## Deployment sorrend

1. Backend Web Service létrehozása diskkel + env varokkal → deploy.
2. Backend URL ellenőrzése (`/health`).
3. Stripe live setup (product/price + webhook) a backend URL-lel.
4. Frontend Static Site a backend URL-re mutató `VITE_API_URL`-lel → deploy.
5. `APP_URL` beállítása a backendben a végleges frontend-domainre → redeploy.
6. Post-deploy validáció (lásd checklist).

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
   - Ez tartja meg a SQLite fájlt és a feltöltött fájlokat
     újraindítás/redeploy között.

### Environment Variables (Render Dashboard → Environment)

| Változó | Érték |
|---|---|
| `NODE_ENV` | `production` — **kötelező kézzel beállítani**: ez kapcsolja be a szigorú env-validációt, a produkciós CORS-t és hibaválaszokat (lásd [runtime.md](runtime.md)) |
| `DATABASE_URL` | `file:/var/data/axeriva.db` (a disk mount path-on belül, **abszolút** út!) |
| `UPLOAD_ROOT` | `/var/data/uploads` (a disk mount path-on belül, **abszolút** út!) |
| `JWT_SECRET` | hosszú, véletlen string (pl. `openssl rand -hex 64`) — **ne** a dev placeholder |
| `APP_URL` | `https://axeriva.com` — a frontend URL-je; ez a CORS engedélyezett origin ÉS az e-mailekbe/Stripe-redirectekbe épülő linkek alapja |
| `STRIPE_SECRET_KEY` | `sk_live_...` |
| `STRIPE_PRICE_ID` | live Price ID — lásd 3. pont |
| `STRIPE_WEBHOOK_SECRET` | live webhook signing secret — lásd 4. pont |
| `RESEND_API_KEY` | Resend API key (élesítés előtt rotálva!) |
| `RESEND_FROM_EMAIL` | `Axeriva <noreply@axeriva.com>` |

`PORT`-ot a Render maga adja — nem kell beállítani, a szerver a
`config.port`-on keresztül felveszi. `NODE_ENV=production` mellett a fenti
lista **mindegyike kötelező**: bármelyik hiányzik, a szerver induláskor
kilép, és a log pontosan megnevezi a hiányzó változó(ka)t — a deploy így
azonnal, láthatóan bukik, nem félkészen üzemel.

### Perzisztens tárolás — miért így

- A `DATABASE_URL` és `UPLOAD_ROOT` **abszolút, a `/var/data` mount alatti**
  utak. Relatív út (pl. a default `file:./axeriva.db` vagy a lokális
  `./uploads` fallback) a konténer efemer fájlrendszerére mutatna, amit a
  Render minden deploynál eldob — **minden adat elveszne**.
- Az upload-könyvtárat a szerver induláskor hozza létre
  (`/var/data/uploads/projects`); ha a mount hiányzik vagy nem írható,
  induláskor `FATAL` hibával leáll (szándékosan — lásd runtime.md).

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

## 3. Stripe live mode — Product + Price

```powershell
# server/.env-ben (vagy ideiglenesen exportálva) a live sk_live_... kulccsal:
npm run stripe:setup
```

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
- **Adat**: deploy előtt készíts disk-mentést (lásd checklist — a SQLite
  fájl lemásolása a Render Shell-ből: `cp /var/data/axeriva.db
  /var/data/backup-$(date +%F).db`). Vészhelyzetben ez másolható vissza.

## 8. Troubleshooting

| Tünet | Ok / megoldás |
|---|---|
| Deploy log: `FATAL: missing required environment variable(s): ...` | A megnevezett env var hiányzik a Render Environment panelen. Pótold, redeploy. |
| Deploy log: `FATAL: cannot create upload directory` | `UPLOAD_ROOT` nem a diskre mutat, vagy a disk nincs csatolva. Ellenőrizd a mount path-t (`/var/data`). |
| Deploy log: `FATAL: cannot connect to the database` | `DATABASE_URL` hibás (nem `file:/var/data/...` formátumú abszolút út). |
| A frontend minden API-hívása elhasal, konzolban `localhost:5000` | A build `VITE_API_URL` nélkül készült — állítsd be és **rebuild**. |
| CORS-hiba a böngészőben | A backend `APP_URL`-je nem egyezik a frontend tényleges origin-jével (pontos séma+domain, trailing slash nélkül). |
| `/login` frissítésre 404 | Hiányzik az SPA rewrite (`/*` → `/index.html`). |
| Feltöltött fájlok eltűnnek redeploy után | `UPLOAD_ROOT` (vagy `DATABASE_URL`) nem a persistent disk alatt van. |
| Stripe webhook 400 "Invalid signature" | Rossz `STRIPE_WEBHOOK_SECRET` (test vs live mode keveredés), vagy a webhook nem a `/subscription/webhook` útvonalra mutat. |
| `/health` `environment: "development"`-et mutat | `NODE_ENV=production` nincs beállítva a Renderen. |
| E-mail nem megy ki, a log `MockEmailService`-t ír | `RESEND_API_KEY` hiányzik (prodban ez env-validációs hiba is — nézd a startup logot). |
