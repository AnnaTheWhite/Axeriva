# Nyilvános indulás — végrehajtható checklist

*Készült: 2026-07-26, a post-deployment sanity audit alapján. Cél: a lehető
leghamarabbi, de biztonságos nyilvános indulás. Három szint:*

- **P0 — kötelező a nyilvános indulás előtt** (valódi launch blocker)
- **P1 — v1.0 utáni első sprint** (fontos, de nem blokkol)
- **P2 — jó gyakorlat** (nem blokkol, alkalomszerűen)

*Típusjelölés: 🔧 operatív (dashboard/shell, kód nem változik) · 💻 kódmódosítás ·
📄 doksi · 🤔 döntés. Az időbecslések egyszemélyes végrehajtásra szólnak.*

**P0 összesen: ~5–6 óra egyben** (a lokális PostgreSQL-telepítéssel együtt) —
egy fókuszált nap.

---

## P0 — Kötelező a nyilvános indulás előtt

### Backup-lánc (≈3 óra) — a saját tervünk szerint enélkül a launch blokkolt

- [x] **P0.1** 🔧 *5 perc* — ~~A Render dashboardról kitölteni a DB-táblázatot~~
  **Kész (2026-07-26):** Basic-256mb, PostgreSQL **18**, PITR 7 napos ablakkal,
  on-demand Export ≥7 nap megőrzéssel — a tábla kitöltve a
  [render-deployment.md](render-deployment.md) 0. pontjában. Tier-váltás nem
  szükséges.
- [x] **P0.2** 🤔 *10 perc* — **Kész (2026-07-26):** tier-váltás nem kellett
  (PITR él); tárolási hely `D:\Axeriva\Backups\` — egyelőre titkosítás nélkül
  (tudatos kockázatvállalás, BitLocker follow-up a backlogban #0a) —,
  retention 30 nap. Rögzítve a [backup-restore.md](backup-restore.md)
  5. pontjában.
- [ ] **P0.3** 🔧 *15 perc* — Azonnali éles mentés: `pg_dump --format=custom …`
  (PowerShell-változat a backup-restore.md 2. pontjában) + uploads-tar a teljes
  `/var/data/uploads`-ról a Render Shellből. *Bizonyíték: a két fájl megvan,
  méret > 0, a kijelölt titkosított tárolóban.*
- [ ] **P0.4** 🔧 *~45 perc, egyszeri* — Lokális PostgreSQL telepítése a drillhez:
  **18-as verzió kell** (a szerver PostgreSQL 18 — régebbi `pg_dump` kliens el
  sem indul ellene): `winget install PostgreSQL.PostgreSQL.18`. Csak a drillhez
  kell, a suite továbbra is a Render teszt-DB-t használja.
- [ ] **P0.5** 🔧 *1,5–2 óra* — **Restore-drill** a P0.3 dumpjával:
  [backup-restore.md](backup-restore.md) D0–D8. A pass/fail mag a **D5**
  (második restore, már feltöltött célba). Dátum + mért RTO a Drill-naplóba;
  utána pipálható a production-checklist Backups-szekciója.
  *Bizonyíték: kitöltött drill-napló sor.*

### Incidens-utómunka (≈20 perc) — credential-higiénia

- [ ] **P0.6** 🔧 *5 perc* — **DEVELOPER-jelszó rotálása** az app reset-flow-ján
  (forgot-password → e-mail → új jelszó). A hash megjárta az `axeriva_test`-et,
  a jelszó kétszer a parancssort. *Mellékhaszon: ez egyben az éles Resend
  kézbesítés élő próbája.* Új jelszó a jelszókezelőbe.
- [x] **P0.7** 🔧 *~15 perc* — **Kész (2026-07-27):** a Render nem támogat
  jelszó-rotálást ([docs](https://render.com/docs/postgresql-credentials)),
  ezért a támogatott új-default-credential úton ment: `axeriva_product`
  létrehozva → `DATABASE_URL` átállítva az új Internal URL-re → redeploy →
  `/health` OK + DEVELOPER login OK → **a régi `axeriva_test_user` credential
  törölve**. Ezzel minden korábbi connection string (shell-history,
  allowlist-bejegyzés, session-fájlok) végleg hatástalan.
- [x] **P0.8** 🔧 *10 perc* — **Nagyrészt tárgytalan a P0.7 után:** a
  historyban és config-fájlokban ülő connection stringek a régi credential
  törlésével halottá váltak. Ami maradt: a `.claude/settings.local.json`
  allowlist-bejegyzése a régi teszt-URL-lel — **törlendő vagy cserélendő** a
  lokálisra (`postgresql://axeriva_test_local:…@localhost:5432/axeriva_test`),
  hogy egy jövőbeli session ne is próbálkozzon távolival (a kód már tiltja:
  `ALLOW_REMOTE_TEST_DB` nélkül elutasít). A seedelt DEVELOPER-jelszó
  rotálása külön tétel: **P0.6**.

### Stripe regressziós smoke (≈30–45 perc) — újraellenőrzés a B4 után

*A flow korábban end-to-end tesztelve volt — de a B4 óta a kliens pinelt
API-verzióval (`2026-05-27.dahlia`) hív a korábbi account-default helyett, és
minden Stripe-hívás az új hiba-mapperen megy át. Ez a futás azt bizonyítja,
hogy a release után is hibátlan.*

- [ ] **P0.9** 🔧 *2 perc* — Render env: `ALLOW_TEST_STRIPE_KEY` **nincs**
  beállítva (a kulcs-mód fatal-védelme csak így él).
- [ ] **P0.10** 🔧 *2 perc* — Live Stripe Dashboard: Customer Portal
  konfiguráció **el van mentve** (Settings → Billing → Customer portal → Save).
- [ ] **P0.11** 🔧 *20–30 perc* — Egy valódi checkout végigvitele élesben:
  Checkout indul → fizetés → `Company.plan` frissül → a webhook endpoint
  Events-listáján `succeeded` kézbesítések a **végleges** backend-domainre →
  `POST /subscription/portal` URL-t ad vissza (curl-lel elég). Utána az
  előfizetés lemondható/refundálható. *Bizonyíték: a production-checklist
  Stripe-sorai (43–48) dátummal kipipálva.*

### Frontend CSP — a H2 lezárása (≈15 perc)

- [ ] **P0.12** 🔧 *15 perc* — A három fejléc-sor felvétele a Static Site
  **Settings → Headers** fülén, a [render-deployment.md](render-deployment.md)
  2. pont 7. lépéséből másolva; a `<API-ORIGIN>` helyére a tényleges backend
  origin kerül (= a `VITE_API_URL` értéke). **A Render nem olvas
  `public/_headers` fájlt** — csak a Dashboard-beállítás él (ellenőrizve a
  Render-doksiból, 2026-07-26). A CSP-érték a friss builden böngészőben
  validálva: nulla sértés a landing/login/register oldalakon, a strength
  meter inline style-jaival együtt. *Bizonyíték:
  `curl -sI https://axeriva.com` mutatja a CSP-fejlécet, és a live appban a
  konzol „Refused to…" üzenet nélkül marad a fő oldalakon.*

### Gyors üzemi ellenőrzések (≈35 perc)

- [ ] **P0.13** 🔧 *15–20 perc* — **Upload-perzisztencia próba**: attachment
  feltöltése → redeploy → a fájl megvan, az aláírt URL 200. Néma hibamód —
  ha az `UPLOAD_ROOT` rossz, minden ügyfélfájl elveszik a következő deploynál.
- [ ] **P0.14** 🔧 *5 perc* — `RESEND_API_KEY` rotálva (K1.1 óta nyitott) —
  ha a deploy során megtörtént, csak dátumozott pipa.
- [ ] **P0.15** 🔧 *10 perc* — Uptime-monitor a `/health`-re (pl. UptimeRobot,
  ingyenes) — a deploy-napi incidenst kézzel vettük észre; a következőt
  riasztás jelezze.
- [ ] **P0.16** 📄 *30 perc* — A production-checklist végigjárása: ami a deploy
  során elkészült, dátumozott pipát kap; ami nem, az ide (P0) vagy P1-be kerül.
  *Az incidens pont a „kész, de nem rögzített" résben történt.*

---

## P1 — v1.0 utáni első sprint

| # | Tétel | Típus | Becslés |
|---|---|---|---|
| P1.1 | **Seed-script hardening** (cél-DB host kiírása, non-empty guard `--force` nélkül tilt, `normalizeEmail` + `validatePassword`, usage-string csere) — az incidens gyökéroka | 💻 | 2–3 óra |
| P1.2 | **Sentry (vagy egyenértékű) hibakövetés** az API-ra — a roadmap #5 másik fele (az uptime-ping P0.15-ben már él) | 💻 | fél nap |
| P1.3 | **Trial-tulajdonos fióktörlési guardja** (`account.routes.ts` — ugyanaz az `isBilled` finomítás, mint a B2-ben, tükör-teszttel) | 💻 | 2 óra |
| P1.4 | **Admin unarchive endpoint** (DEVELOPER-only, auditált) — tévesen archivált cég DB-turkálás nélkül menthető | 💻 | 3–4 óra |
| P1.5 | **Lokális env-higiénia**: `server/.env` lokális PostgreSQL-re, `environment.md`-be a „lokális .env soha nem tartalmaz távoli instance-URL-t" szabály | 🔧📄 | 15 perc |
| P1.6 | **CompanyProfileSection hardkódolt angol validációs szövegei** i18n-re | 💻 | 1 óra |
| P1.7 | **Seat-szemantika döntés** (visszavont dolgozó a seat-számításban) + addig a kiadási jegyzet fedi | 🤔💻 | döntés + 2 óra |
| P1.8 | **Frontend teszt-harness** (vitest + testing-library, először a jelszó-képernyőkre) + `strict` bekapcsolása | 💻 | 1–2 nap |
| P1.9 | **R2 (#4) kickoff-döntés**: presigned URL vs. HMAC-proxy + a kapcsolódó öt aldöntés (a sanity audit R2-szekciója szerint) | 🤔 | 1 óra megbeszélés |

## P2 — Jó gyakorlat, nem blokkol

| # | Tétel | Típus | Becslés |
|---|---|---|---|
| P2.1 | TOTP/MFA a DEVELOPER (és opcionálisan BUSINESS_OWNER) fiókokra | 💻 | 1 nap |
| P2.2 | Szerver-hibaszövegek egységes lokalizálása (stabil hibakódok + i18n-leképezés) | 💻 | 1 nap |
| P2.3 | Revoke-endpoint rate limit; tombstone-jelölő az admin-listákban; scheduling-badge visszavont dolgozóra | 💻 | fél nap |
| P2.4 | Log-retention/streaming döntés, amíg kicsi a volumen | 🤔 | 30 perc |
| P2.5 | Uploads-backup állandó csatornájának kiválasztása (a drillhez az egyszeri letöltés elég volt) | 🤔 | 30 perc |
| P2.6 | A 23 örökölt lint-hiba ledolgozása → lint-gate blokkolóra állítása | 💻 | fél nap |
| P2.7 | Teszt-fájlok típusellenőrzése (külön typecheck-tsconfig) | 💻 | 1 óra |

---

*A P1/P2 tételek részletes kontextusa: [post-launch-backlog.md](post-launch-backlog.md).
A P0 lezárultával a nyilvános indulásnak technikai akadálya nincs.*
