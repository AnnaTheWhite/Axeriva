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

- [ ] `DATABASE_URL` = `file:/var/data/axeriva.db` (persistent disk alatt, abszolút út)
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

- [ ] Live mode Product + Price létrehozva (`npm run stripe:setup` live kulccsal), `STRIPE_PRICE_ID` beállítva
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

- [ ] Deploy előtti manuális DB-mentés: Render Shell → `cp /var/data/axeriva.db /var/data/backup-$(date +%F).db`
- [ ] Rendszeres (pl. napi) mentési rutin kijelölve és dokumentálva *(automatizálása jövőbeli feladat)*
- [ ] Visszaállítás egyszer kipróbálva (backup fájl visszamásolása + restart)

## Security

- [ ] CORS csak az `APP_URL` origint engedi (idegen originről a hívás elutasítva)
- [ ] `X-Powered-By` header nincs a válaszokban
- [ ] Rate limiting / Helmet még **nincs** — K2 (Security Foundation) scope, kockázatként nyilvántartva
- [ ] Admin (DEVELOPER) fiók erős jelszóval seedelve (`npm run seed:developer`), a credential nem a repóban él

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
