# Render Deployment — Axeriva

Ez a leírás a backend (Express + Prisma + SQLite) és a frontend (Vite build)
production deploy-ját írja le Renderen, az `axeriva.com` domainnel.

## Miért Render

A backend SQLite-fájlt használ (`server/prisma/axeriva.db`), nem külön
DB-szervert — ezért **perzisztens disk** kell, ami a fájlrendszert deploy
között megtartja. Render Web Service-e ezt natívan támogatja. Ugyanez igaz a
feltöltött project-attachmentekre (`server/uploads/`).

## 1. Backend — Web Service

1. Render Dashboard → **New → Web Service**, kösd be a GitHub repót.
2. **Root Directory**: `server`
3. **Build Command**: `npm install && npm run build`
   (a `build` script lefuttatja a `prisma generate`-et és a `tsc`-t —
   lásd [server/package.json](../server/package.json))
4. **Start Command**: `npm run start`
   (ez lefuttatja a `prisma migrate deploy`-t, majd elindítja a
   `dist/index.js`-t — minden deploy-nál automatikusan alkalmazza az új
   migrációkat)
5. **Add a Disk** (Render → a service Settings → Disks):
   - Mount path: pl. `/var/data`
   - Ez tartja meg a SQLite fájlt és a feltöltött fájlokat újraindítás/redeploy
     között.

### Environment Variables (Render Dashboard → Environment)

| Változó | Érték |
|---|---|
| `DATABASE_URL` | `file:/var/data/axeriva.db` (a disk mount path-on belül!) |
| `UPLOAD_ROOT` | `/var/data/uploads` (a disk mount path-on belül!) |
| `JWT_SECRET` | hosszú, véletlen string — **ne** a dev placeholder |
| `STRIPE_SECRET_KEY` | `sk_live_...` |
| `STRIPE_PUBLISHABLE_KEY` | `pk_live_...` |
| `STRIPE_PRICE_ID` | live Price ID — lásd 3. pont |
| `STRIPE_WEBHOOK_SECRET` | live webhook signing secret — lásd 4. pont |
| `APP_URL` | `https://axeriva.com` (a frontend URL-je — ez szabja meg a CORS engedélyezett origin-t is) |
| `RESEND_API_KEY` | a meglévő Resend API key |
| `RESEND_FROM_EMAIL` | `Axeriva <noreply@axeriva.com>` |

Az első deploy előtt **ne** felejtsd el a `DATABASE_URL`-t és `UPLOAD_ROOT`-ot
a disk mount path alá tenni — különben a fájlok minden redeploy-nál
elveszhetnek (a Render a service container fájlrendszerét újraépíti, csak a
csatolt disk marad meg).

## 2. Frontend — Static Site

1. Render Dashboard → **New → Static Site**, ugyanaz a repo.
2. **Root Directory**: *(repo root, üresen hagyva)*
3. **Build Command**: `npm install && npm run build`
4. **Publish Directory**: `dist`
5. **Custom Domain**: `axeriva.com` (+ `www.axeriva.com` redirect, ha kell)

A frontend `API_URL`-je jelenleg `src/services/api.ts`-ben van
hardkódolva `http://localhost:5000`-re — ezt production build előtt
frissíteni kell a backend Render URL-jére (pl.
`https://axeriva-api.onrender.com`, vagy ha a backendnek is saját
aldomain van: `https://api.axeriva.com`).

## 3. Stripe live mode — Product + Price

```powershell
# server/.env-ben (vagy ideiglenesen exportálva) a live sk_live_... kulccsal:
npm run stripe:setup
```

Ez (újra)létrehozza az "Axeriva Pro" Productot és a havi Price-t **live
mode**-ban, és kiírja a `STRIPE_PRICE_ID`-t — ezt másold a Render
Environment Variables-be.

## 4. Stripe live webhook

1. Stripe Dashboard → bal felül **Live mode**-ra váltás.
2. Developers → Webhooks → **Add endpoint**.
3. Endpoint URL: `https://<backend-domained>/subscription/webhook`
4. Események: `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`.
5. A létrehozott endpoint "Signing secret" mezője adja a
   `STRIPE_WEBHOOK_SECRET` értékét.

Részletesebb háttér (miért ez a 3 esemény, raw-body middleware sorrend,
retry-logika) a [stripe-webhook-production-readiness.md](./stripe-webhook-production-readiness.md)-ban.

## 5. Ellenőrzés deploy után

- `GET https://<backend-domain>/` → `{"name":"Axeriva API",...}`
- Regisztrálj egy teszt-fiókot a live frontendről → érkezik-e a
  verifikációs email (Resend, `noreply@axeriva.com`-ról)
- Próbálj egy Stripe Checkout-ot a teszt-kártyával (`4242 4242 4242 4242`,
  **live mode**-ban ez NEM fog működni — élesben csak valódi kártyával
  tesztelhető, vagy maradj rövid ideig test mode-ban párhuzamosan)
- Tölts fel egy project-attachmentet, majd redeployolj — a fájlnak
  **megmaradnia** kell (ha eltűnik, az `UPLOAD_ROOT` nincs a disk-en)
