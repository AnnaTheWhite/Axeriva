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
- [x] **P0.5** 🔧 — **Kész (2026-07-27): a drill PASS.** D3 (üres célba) és
  **D5 (nem üres célba)** egyaránt exit 0, duplázódás nélkül; D4 verifikáció
  mindkétszer átment; D6-ban a valódi backend elindult a visszaállított DB-re
  és minden lekért végpont 200-at adott, a bcrypt hash-ek épek. Mért RTO:
  ~0,6 mp technikai / 10–15 perc teljes ciklus — a
  [backup-restore.md](backup-restore.md) drill-naplójában rögzítve.
  *Marad: az uploads-csatolás ellenőrzése az első valódi feltöltés után.*

### Incidens-utómunka (≈20 perc) — credential-higiénia

- [x] **P0.6** 🔧 — **Kész (2026-07-27):** a DEVELOPER-jelszó rotálva az app
  saját reset-flow-ján; a reset e-mail megérkezett, a link működött, az új
  jelszóval a belépés sikeres. A parancssort megjárt credential ezzel
  érvénytelen. *Egyben bizonyíték: az éles Resend-kézbesítés működik
  (verifikáció/reset/meghívó levelek útja élő).*
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

- [x] **P0.13** 🔧 — **Kész (2026-07-27): perzisztens disk megerősítve.**
  Funkcionális próba: kép feltöltve → „Deploy latest commit" → a kép
  továbbra is elérhető. Infrastruktúra-bizonyíték a Render Shellből:
  `df -h /var/data/uploads` → **`/dev/nvme21n1`, 4,9 GB, mountpoint
  `/var/data`** (külön blokk-eszköz, nem az efemer overlay), a feltöltött
  fájl a helyén, a könyvtár dátuma régebbi a deployoknál.
  ⚠️ *Kapacitás-megjegyzés: a disk 4,9 GB, a csomag-kvóták viszont
  5/25/100 GB — lásd post-launch-backlog #0c.*
- [ ] **P0.14** 🔧 *5 perc* — `RESEND_API_KEY` **rotálása** (K1.1 óta nyitott).
  ⚠️ Nem azonos a kézbesítési próbával: a P0.6 bizonyította, hogy a Resend
  *működik*, de a K1.1 audit azt kifogásolta, hogy egy élesnek látszó kulcs
  ült a dev `.env`-ben — ha az a kulcs máig érvényes, bárki küldhet levelet a
  `noreply@axeriva.com` nevében (phishing-vektor éles ügyfelek felé).
  Teendő: Resend Dashboard → új API key → a Render env `RESEND_API_KEY`
  cseréje → redeploy → **a régi kulcs visszavonása**. Ha a rotálás már
  megtörtént korábban, csak dátumozott pipa.
- [x] **P0.15** 🔧 — **Kész (2026-07-27):** UptimeRobot, „Axeriva API Health"
  monitor a `https://axeriva.onrender.com/health` endpointon, 5 perces
  ellenőrzési időközzel, e-mail-értesítéssel. Induló állapot: **UP**, 100%
  uptime, 0 incidens. A deploy-napi incidenst még kézzel vettük észre — a
  következő kiesést már riasztás jelzi.
- [x] **P0.16** 📄 — **Kész (2026-07-27):** mindkét checklist végigolvasva,
  **112 sor** osztályozva a session bizonyítékai ellen. Eredmény:
  production-checklist 53 sor (18 bizonyítottan kész · 18 valószínűleg kész,
  de nem igazolt · 11 valós kockázat · 6 apró), release-candidate-checklist
  59 sor (29 · 6 · 10 · 14). Az átfutás **öt új P0-tételt** tárt fel (P0.17–P0.21
  lent), amik nem szerepeltek az eredeti listán.

### P0.16 által feltárt új tételek

- [ ] **P0.17** 🔧 *2 perc* — **A legnagyobb hasznú egyetlen ellenőrzés:**
  `curl -s https://<backend>/health` → olvasd el az `environment` mezőt.
  Ha `production`, az **kaszkádol**: a `config.ts` `process.exit(1)`-et hív
  bármely hiányzó `PRODUCTION_REQUIRED` változóra, tehát a puszta bootolás
  bizonyítja **mind a 16 env-változó** meglétét — és a `stripeKeyMode` miatt
  azt is, hogy a Stripe-kulcs `sk_live_` **vagy** `ALLOW_TEST_STRIPE_KEY=true`
  (P0.9 fele ingyen zárul). Ha viszont `development`, akkor a szigorú
  env-validáció, a produkciós CORS, a HSTS és a kulcs-mód védelem
  **mind csendben ki van kapcsolva**.
- [ ] **P0.18** 🔧 *15 perc* — **Uploads-mentés** (`tar` a teljes
  `/var/data/uploads`-ról). Ez a P0.13 óta élessé vált: **valódi ügyfélfájl
  van a diszken**, a DB-dump és a disk tartalma tehát már szétcsúszott. A
  drill ezt a felét nem tudta fedni — most már tudja.
- [ ] **P0.19** 🔧 *~20 perc* — **A két soha nem tesztelt fő folyamat élesben:**
  (a) **regisztráció** új céggel → verifikációs e-mail → belépés (a termék
  bejárati ajtaja, eddig csak a seedelt DEVELOPER-fiókot használtuk);
  (b) **meghívó** → elfogadás → employee-belépés (a B3 óta ez a képernyő
  változott is). Mindkettő Resend-transzportja már bizonyított.
- [ ] **P0.20** 🔧 *5 perc* — **Rate limiting proxy mögött**: 6 gyors hibás
  login → `429` + `Retry-After`. Ez a klasszikus kontroll, ami lokálisan
  átmegy, de Renderen a load balancer miatt vagy egyáltalán nem véd, vagy
  minden usert egy vödörbe tesz — csak élesben látszik. Ugyanebben a
  körben: `curl -I` a security headerökre (HSTS, CSP, nosniff, nincs
  `X-Powered-By`) — egy hívás, két sor lezárva.
- [ ] **P0.21** 🤔 *döntés* — **Egyedi domain: most vagy soha (olcsón).** A
  production ma `axeriva.onrender.com`-on szolgál. Ha lesz `axeriva.com` /
  `api.axeriva.com`, azt **a Stripe live webhook beállítása ELŐTT** érdemes
  megtenni — utána a webhook-URL-t újra kell irányítani, és egy elrontott
  átállás **némán** töri el a fizetés-aktiválást (a Stripe egy nem figyelt
  endpointra kézbesít). Az `axeriva.com` DNS már a kezedben van (a Resend
  SPF/DKIM verifikálva), tehát most olcsó. *Alternatíva: tudatosan
  onrender.com-on indulsz, és a váltás külön, tervezett művelet lesz.*
- [ ] **P0.22** 🔧 *1 perc* — **`JWT_SECRET` szemrevételezése** a Render
  env-panelen: hosszú, véletlen érték-e, nem a `.env.example` placeholderje.
  A bootolás csak a *meglétét* bizonyítja; egy placeholder mellett bárki,
  aki látta a repót, hamisíthat DEVELOPER-tokent.

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
