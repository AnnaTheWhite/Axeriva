# Axeriva — Production Checklist

Élesítés előtti és utáni ellenőrzőlista. A deploy lépései:
[render-deployment.md](render-deployment.md).

## Environment

- [ ] `NODE_ENV=production` beállítva a backenden (a `/health` `environment` mezője igazolja)
- [ ] Minden kötelező backend env var beállítva (a startup-validáció zöld — lásd [environment.md](environment.md))
- [ ] `JWT_SECRET` hosszú, véletlen, egyedi (nem a dev placeholder; pl. `openssl rand -hex 64`)
- [ ] `APP_URL` pontosan a végleges frontend origin (https, trailing slash nélkül)
- [ ] `VITE_API_URL` a frontend build-környezetében a backend URL-re állítva
- [ ] Nincs `.env` fájl a repóban (csak `.env.example`) — `git status` tiszta

## Database

- [ ] **PostgreSQL instance létrehozva**, a Web Service-szel **azonos régióban** (enélkül az Internal URL nem oldható fel)
- [ ] `DATABASE_URL` = a managed PostgreSQL connection stringje (Renderen az **Internal** Database URL; külső kapcsolatnál `?sslmode=require`)
- [ ] `prisma migrate deploy` lefutott az első deployban (start command része — deploy log igazolja)
- [ ] Redeploy után az adatok megmaradnak (teszt-rekorddal ellenőrizve)

## Uploads

- [ ] `UPLOAD_ROOT` = `/var/data/uploads` (persistent disk alatt)
- [ ] Feltöltés működik és redeploy után a fájl megmarad
- [ ] Feltöltött fájl elérhető a `/uploads/...` URL-en

## HTTPS / Domain / DNS

- [ ] Custom domain(ek) felvéve a Renderen (frontend: `axeriva.com`, backend: `api.axeriva.com`)
- [ ] DNS rekordok (CNAME/A) beállítva, propagálódtak
- [ ] Let's Encrypt tanúsítvány kiadva, HTTP→HTTPS redirect él
- [ ] A Stripe webhook és a `VITE_API_URL` a végleges backend-domainre mutat

## Health / Monitoring

- [ ] Render Health Check Path = `/health`, a probe zöld
- [ ] `GET /health` → `status: ok`, `environment: production`, helyes `version`
- [ ] Külső uptime-monitor (pl. UptimeRobot) rákötve a `/health`-re *(ajánlott — monitoring-eszköz telepítése nem volt K1.4 scope)*

## Stripe

- [ ] `STRIPE_SECRET_KEY` **live** kulcs (`sk_live_…`) — a Render env-ben ellenőrizve; az `ALLOW_TEST_STRIPE_KEY` **NINCS** beállítva (staging kivétel: lásd docs/environment.md). Test kulcs `NODE_ENV=production` alatt a deployt buktatja (config/stripeKeyMode.ts).
- [ ] **Customer Portal konfiguráció elmentve a LIVE Stripe Dashboardon** (Settings → Billing → Customer portal → Save) — enélkül a `/subscription/portal` „No configuration provided" hibával áll el
- [ ] Live mode Product + Price létrehozva (`npm run stripe:setup` live kulccsal), `STRIPE_PRICE_ID` **és mind a hat per-plan `STRIPE_PRICE_*`** beállítva — a script mindet kiírja; `NODE_ENV=production` alatt mindegyik kötelező
- [ ] Live webhook endpoint létrehozva a 3 eseménnyel, `STRIPE_WEBHOOK_SECRET` beállítva
- [ ] Webhook-kézbesítés sikeres (Stripe Dashboard → endpoint → Events, nincs failed delivery)
- [ ] Checkout → előfizetés aktiválódik (Company.plan frissül) → Billing Portal elérhető

## Resend (e-mail)

- [ ] `RESEND_API_KEY` **rotálva** (a dev .env-ben ült egy éles kinézetű kulcs — K1.1 audit) és beállítva
- [ ] `axeriva.com` domain verifikálva a Resendben (SPF/DKIM DNS-rekordok)
- [ ] Regisztrációs/verifikációs/jelszó-reset/meghívó e-mail mind kézbesítődik (nem spam)
- [ ] A backend-log `ResendEmailService`-t ír, nem `MockEmailService`-t

## Logging

- [ ] Startup-log tiszta: nincs FATAL, nincs Stripe/Resend figyelmeztetés
- [ ] Hibaválaszok prodban generikusak (nincs stack trace a kliens felé) — [runtime.md](runtime.md)
- [ ] Render log-retention/stream áttekintve (hosszabb megőrzéshez log stream beállítása megfontolandó)

## Build

- [ ] Backend build (`prisma generate && tsc`) hiba- és warning-mentes
- [ ] Frontend build (`tsc -b && vite build`) hiba- és warning-mentes
- [ ] A frontend bundle-ben nincs `localhost` hivatkozás (`VITE_API_URL`-lel buildelve)

## Backups

*(A teljes eljárás, a verifikáció és a drill: [backup-restore.md](backup-restore.md).)*

- [ ] Deploy előtti manuális DB-mentés: `pg_dump --format=custom --no-owner --no-privileges --file="axeriva-$(date +%F-%H%M).dump" "$DATABASE_URL"` — PowerShell-változat a backup-restore.md-ben
- [ ] Rendszeres mentés: a szolgáltatói napi backup a mechanizmus (a tier képessége a render-deployment.md 0. pontjában dokumentálva); saját ütemezett dump-job **tudatosan nincs** (indoklás: backup-restore.md 6. pont)
- [ ] Visszaállítás egyszer kipróbálva (`pg_restore --clean` **nem üres** adatbázisba, verifikációval — a backup-restore.md drillje, dátummal naplózva)

## Security

- [ ] CORS csak az `APP_URL` origint engedi (idegen originről a hívás elutasítva)
- [ ] `X-Powered-By` header nincs a válaszokban
- [ ] Rate limiting és Helmet **működik**: ismételt hibás login 429-et ad `Retry-After` fejléccel (K2.1.3, `constants/rateLimits.ts`), a válaszokon ott vannak a Helmet security headerök (K2.2, `middleware/httpSecurity.ts`) — deploy után egyszer ellenőrizve
- [x] Admin (DEVELOPER) fiók erős jelszóval seedelve — a szerveren `node dist/scripts/seedDeveloper.js <email> <jelszó>` (**nem** `npm run seed:developer`: az `ts-node`-ot hív, ami production-installban nincs telepítve — lásd [render-deployment.md](render-deployment.md) 1.9), a credential nem a repóban él *(végrehajtva és verifikálva: 2026-07-26 — login 200, role DEVELOPER, companyId null, /admin elérhető)*

## Deployment verification (közvetlenül deploy után)

- [ ] `/health` 200, `environment: production`
- [ ] Frontend betölt, konzol hibamentes (nincs `[config] VITE_API_URL...`, nincs CORS-hiba)
- [ ] Mély útvonal (pl. `/login`) frissítésre is betölt (SPA rewrite)
- [ ] Regisztráció → verifikációs e-mail → verifikálás → login végigmegy
- [ ] Employee-meghívó e-mail → elfogadás → employee-login végigmegy

## Post-deployment validation (első 1–2 nap)

- [ ] Redeploy-teszt: adat + feltöltött fájl megmarad
- [ ] Stripe webhook-események hibamentesen dolgozódnak fel
- [ ] Render metrics: memória/CPU stabil, nincs restart-loop
- [ ] Log-átnézés: nincs ismétlődő `[error]` bejegyzés
- [ ] Rollback-próba ismerete: a csapat tudja, hol van a "Rollback to this deploy" (lásd [render-deployment.md](render-deployment.md) 7. pont)
