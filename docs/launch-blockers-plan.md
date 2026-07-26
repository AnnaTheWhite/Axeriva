# Axeriva v1.0 #3.5 — Launch Blockers: implementációs terv

*Állapot: 2026-07-25 — a kód a `master` @ `a13ce54` ellen verifikálva (a rákövetkező `de53cc0` csak dokumentációt adott hozzá, kódot nem érint). Ez a dokumentum a hivatalos, munkamenetek közt is érvényes terv (lásd a roadmap 3.5 szakaszát: `Axeriva-Product-Roadmap-v2.md`).*

> **Utóirat (2026-07-26):** B1–B7 implementálva a `6f428b6`..`bb8c94d` commitokban
> (B6 operatívan végrehajtva és verifikálva a productionön). A szakaszokban
> hivatkozott sorszámok a javítás **előtti** fát írják le — a jelenlegi állapotot
> a [release-readiness-audit.md](release-readiness-audit.md) rögzíti, a nyitva
> maradt tételeket a [post-launch-backlog.md](post-launch-backlog.md).

## Honnan jött ez a terv

A #3 (PostgreSQL-migráció) lezárása után futtatott teljes nyitott-tétel leltár (106 nyers megállapítás, konszolidálva) hat launch-blokkolót azonosított. 2026-07-25-én mind a hatot újra verifikáltuk a jelenlegi kódbázison: blokkeronként külön vizsgálat + adverzális ellenőrzés futott, és **mind a hat reprodukálódik** — több esetben súlyosabbnak bizonyult, mint az eredeti leírás (részletek az egyes szakaszokban). Az itt szereplő fájl- és sorhivatkozásokat két független menet ellenőrizte, de a fa mozog: implementálás előtt a kritikus sorokat érdemes újra megnézni.

## Lezárt döntések

Két döntés volt nyitva a terv jóváhagyásakor; mindkettő 2026-07-25-én lezárult:

- **B1 alakja: (A) — külön, explicit „hozzáférés visszavonása" művelet.** Nem új `Inactive` státusz. Indok: az `Employee.status` ma szabad szöveges mező, két validálatlan endpointról írható, és megerősítés nélküli inline dropdownként jelenik meg — biztonsági mellékhatást kötni rá egy véletlen kattintást tenne visszafordíthatatlanná. A státusz-dropdown tisztán elérhetőség-jelző marad.
- **B4 szigorúsága: fatal + explicit kilépő.** `sk_test_` kulcs `NODE_ENV=production` alatt megtagadja az indulást, KIVÉVE ha `ALLOW_TEST_STRIPE_KEY=true` explicit be van állítva. Indok: a Render start-parancsa (`prisma migrate deploy && node dist/index.js`) miatt a bukott boot a deployt buktatja meg, az előző verzió szolgál tovább — a fatal tehát rossz deployt blokkol, nem élő rendszert visz le. A kilépővel a staging szándékos, dokumentált döntés lesz.

## Implementációs sorrend és munkaszabályok

**Sorrend: B6 → B2 → B3 → B1 → B4 → B7.** A sorrend a regressziós kockázat minimalizálására van rendezve, nem súlyosság szerint: minden lépés tesztjei a következő lépés biztonsági hálójává válnak. Átrendezés némán elveszíti ezt a tulajdonságot.

Minden blokkernél:

1. Implementálás előtt ellenőrizd, hogy a hivatkozott sorok még azt tartalmazzák, amit a terv állít.
2. Minden fix a meglévő teszt-háló alatt készül (140 teszt, valós PostgreSQL, `TEST_DATABASE_URL`).
3. Blokkerenként: teljes suite + mindkét build (`server: npm run build`, root: `npm run build`) fusson zöldre a commit előtt.
4. Minden, ami productiont vagy pénzt érint (B6 végrehajtás, B4 élesítés, B7 Render-oldali lépések), Anna jóváhagyásával és/vagy Anna kezével történik — Claude-nak nincs Render- és Stripe-hozzáférése.
5. A szakaszvégi „Nyitott kérdések" nem blokkolók: implementáláskor kell dönteni róluk, a terv ajánlást ad, ahol tud.

---

### B6 — DEVELOPER fiók seedelése az üres production adatbázison (~30 perc)

*Kritikus, launch-blokkoló, de **nem kódhiba**: tisztán operatív lépés. Az üres prod DB-n egyetlen `DEVELOPER` felhasználó sincs, a regisztráció pedig mindig `BUSINESS_OWNER`-t hoz létre — így a `/admin` platform-admin felület és a mögötte álló `/admin` + `/admin/analytics` API élesben elérhetetlen marad. A végrehajtás három ismert csapdát rejt (rossz parancs, nagybetűs e-mail, policy-t nem érvényesítő jelszó), amelyek mindegyike néma hibát ad: a fiók "létrejön", de nem használható.*

#### Mi a hiba

Az adatbázis a PostgreSQL-átállás óta üresen indul (lásd `docs/render-deployment.md:68-72`), és nincs olyan végpont, amivel `DEVELOPER` szerepkör kiosztható lenne — a Prisma séma `role` default értéke `BUSINESS_OWNER` (`prisma/schema.prisma:117`), a regisztráció fixen `ROLES.BUSINESS_OWNER`-t ír (`auth.routes.ts:162`), az `/admin` router pedig csak `GET`-eket tartalmaz, szerepkör-módosító végpont nincs benne. A platform-admin felületet szerveroldalon a `router.use(requireRole(ROLES.DEVELOPER))` (`server/src/routes/admin.routes.ts:8`), frontend oldalon a `ProtectedRoute roles={[ROLES.DEVELOPER]}` (`src/app/router/index.tsx:220-229`) zárja; ugyanez a szerepkör védi a `/admin/analytics` API-t is (`server/src/app.ts:177-178` — ennek nincs külön frontend route-ja, a `PlatformDashboardPage` hívja). Az egyetlen út a `server/src/scripts/seedDeveloper.ts` script kézi lefuttatása a production ellen.

A script működik, de három ponton rá lehet futni néma hibára:

1. **A dokumentált-önmagát-cáfoló parancs.** A script hiányzó argumentumok esetén a `"Usage: npm run seed:developer -- <email> <password>"` üzenetet írja ki (`seedDeveloper.ts:12`), miközben pontosan ez az a parancs, ami a Renderen **nem** működik: a `seed:developer` alias `ts-node`-ot hív (`server/package.json:8`), a `ts-node` viszont csak tranzitív dev-függőség a `ts-node-dev` alatt (`server/package-lock.json:4578-4582`, `"dev": true`), és a Render `NODE_ENV=production` mellett telepít (`server/package.json:45` kommentje ezt explicit rögzíti), tehát ott nincs telepítve. A helyes parancs a lefordított JS: a `tsconfig.json` `include: ["src"]` (:11), `exclude: ["src/tests"]` (:16), `outDir: "./dist"` (:6) miatt a `build` (`package.json:10`, `prisma generate && tsc`) kiadja a `dist/scripts/seedDeveloper.js`-t.
2. **Nagybetűs e-mail = soha be nem lépő fiók.** A script az e-mailt **szó szerint** menti (`seedDeveloper.ts:18` duplikátum-ellenőrzés és `:29` insert) — sem `validateEmail()`, sem `normalizeEmail()` nem fut le rajta. A login viszont a **normalizált** címmel keres (`auth.routes.ts:211-218`), és a `normalizeEmail()` a domain részt kisbetűsíti (`utils/emailValidation.ts:44-53`). Egy `admin@Axeriva.com`-mal seedelt fiókot ezért a `prisma.user.findUnique({ where: { email: "admin@axeriva.com" } })` sosem találja meg → a tünet a semmitmondó `Invalid credentials` (`auth.routes.ts:239`), miközben a sor ott van a DB-ben.
3. **A jelszó-policy nem érvényesül.** A script közvetlenül hash-el: `bcrypt.hash(password, 10)` (`seedDeveloper.ts:25`); a `validatePassword()` (`utils/passwordPolicy.ts:32-49`) sosincs importálva. A 12 karakteres, kis-/nagybetűt és számjegyet követelő policy (`passwordPolicy.ts:9,24-26`) tehát a platform legmagasabb jogosultságú fiókjára **nem** vonatkozik — az operátornak kézzel kell betartania.

Plusz egy előfeltétel: a script a 4. sorban importálja a `../config`-ot, ami induláskor lefuttatja az env-validációt és hiányzó változónál `process.exit(1)`-gyel kilép (`config.ts:65-77`). `NODE_ENV=production` mellett a `PRODUCTION_REQUIRED` lista (`config.ts:40-58`) tartalmazza a hat `STRIPE_PRICE_*` változót is (`config.ts:49-54`), amelyek a `docs/render-deployment.md:98-109` env-táblájából **hiányoznak**. Ha ezek nincsenek beállítva, a seed script ugyanúgy `FATAL: missing required environment variable(s)` hibával áll le, mint maga a szerver.

#### Érintett fájlok

| Fájl | Sor | Mi történik |
|---|---|---|
| `server/src/scripts/seedDeveloper.ts` | 4 | `import { config } from "../config"` → a script indulásakor lefut a teljes env-validáció |
| `server/src/scripts/seedDeveloper.ts` | 7-8 | `argv[2]` = e-mail, `argv[3]` = jelszó; fallback `config.developerEmail` / `config.developerPassword` |
| `server/src/scripts/seedDeveloper.ts` | 12 | Félrevezető usage-üzenet: `npm run seed:developer` — prodban ez nem fut le (follow-up, nem B6) |
| `server/src/scripts/seedDeveloper.ts` | 18, 21-22 | Duplikátum-ellenőrzés a **nyers** e-mailre; létező cím esetén `exit 1` |
| `server/src/scripts/seedDeveloper.ts` | 25 | `bcrypt.hash(password, 10)` — semmilyen jelszó-policy nem fut |
| `server/src/scripts/seedDeveloper.ts` | 27-37, 39 | Insert: `role: DEVELOPER`, `companyId: null`, `emailVerified: true`; siker esetén `Created DEVELOPER user #<id> (<email>)` |
| `server/src/config.ts` | 34, 40-58, 65-77 | `ALWAYS_REQUIRED` + `PRODUCTION_REQUIRED` (benne a 6 db `STRIPE_PRICE_*`), hiány esetén `process.exit(1)` |
| `server/src/utils/emailValidation.ts` | 44-53 | `normalizeEmail()`: trim + a domain rész kisbetűsítése (a local part érintetlen) |
| `server/src/routes/auth.routes.ts` | 208-218 | Login a **normalizált** címmel keresi a usert — ez az, amihez a seedelt e-mailnek passzolnia kell |
| `server/src/routes/auth.routes.ts` | 46-55 | `loginPerEmailLimiter` (IP+e-mail kulcs) — a manuális próbálkozásokat ez korlátozza |
| `server/src/constants/rateLimits.ts` | 15-16 | `LOGIN_PER_IP`: 20 / 15 perc, `LOGIN_PER_EMAIL`: 5 / 15 perc |
| `server/src/utils/passwordPolicy.ts` | 9, 24-26 | A policy, amit a seedelésnél kézzel kell betartani: min. 12 karakter + kisbetű + nagybetű + számjegy |
| `server/package.json` | 8, 10, 45 | `seed:developer` = `ts-node …` (prodban nem elérhető); `build` = `prisma generate && tsc`; a komment magyarázza a `NODE_ENV=production` installt |
| `server/package-lock.json` | 4578-4582 | `ts-node` `"dev": true` — production installban nincs telepítve |
| `server/tsconfig.json` | 6, 11, 16 | `outDir: ./dist`, `include: ["src"]`, `exclude: ["src/tests"]` → keletkezik a `dist/scripts/seedDeveloper.js` |
| `server/src/routes/admin.routes.ts` | 8 | `requireRole(ROLES.DEVELOPER)` az egész `/admin` routeren |
| `server/src/app.ts` | 152, 177-178 | `/auth`, `/admin/analytics` és `/admin` mountolása (nincs `/api` prefix) — ehhez igazodnak a lenti curl-ök |
| `src/app/router/index.tsx` | 220-229 | `/admin` → `ProtectedRoute roles={[ROLES.DEVELOPER]}` (frontend ellenőrzés) |
| `docs/render-deployment.md` | 77, 80, 83 | Root Directory: `server`; Build: `npm install && npm run build`; Start: `npm run start` |
| `docs/render-deployment.md` | 98-109 | Env-tábla — **hiányzik** belőle a 6 db `STRIPE_PRICE_*` (follow-up, nem B6) |
| `docs/render-deployment.md` | 130-153 | Az 1.9 szakasz: a végrehajtandó eljárás + a `ts-node` figyelmeztetés |
| `docs/project-overview.md` | 172 | `npm run seed:developer -- <email> <jelszó>` — production-figyelmeztetés nélkül (follow-up, nem B6) |
| `docs/production-checklist.md` | 78 | A checklist-sor, amit ez a blocker kipipál |

#### Tervezett változtatás

**Kódváltozás nem ships.** Az alábbi egy végrehajtási runbook; a fájlokhoz nem nyúlunk (a javításokat lásd a végén, follow-upként).

**1. Pre-flight: teljes-e az env?**
A script ugyanazon a validáción megy át, mint a szerver (`config.ts:65-77`), tehát mielőtt bármit futtatnál, a Render Environment panelen meg kell lennie mind a 16 változónak: `NODE_ENV=production`, `DATABASE_URL`, `JWT_SECRET`, `APP_URL`, `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER_EUR`, `STRIPE_PRICE_STARTER_HUF`, `STRIPE_PRICE_PROFESSIONAL_EUR`, `STRIPE_PRICE_PROFESSIONAL_HUF`, `STRIPE_PRICE_BUSINESS_EUR`, `STRIPE_PRICE_BUSINESS_HUF`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `UPLOAD_ROOT`.
A leggyorsabb bizonyíték, hogy teljes: `GET https://<backend-domain>/health` válaszol és `"environment": "production"` (`docs/render-deployment.md:218-221`) — ha a szerver fut, az env átment a validáción, tehát a script is át fog.
**Következmény a deploy-sorrendre:** a `docs/render-deployment.md:37-46` lista 4. lépéseként szerepel a seed, 5.-ként a Stripe live setup — ez így nem futtatható, mert a `STRIPE_PRICE_*` értékek az 5. lépésből jönnek. A seedet a Stripe-setup **után** kell elvégezni.

**2. Jelszó választása (kézzel, policy-konformra).**
A script nem ellenőriz semmit, ezért a `passwordPolicy.ts:9,24-26` szabályait manuálisan kell betartani: legalább 12 karakter, van benne kisbetű, nagybetű és számjegy. Generáld jelszókezelővel, és ott is tárold — a repóba, a `.env`-be és Slackbe/e-mailbe ne kerüljön. (Ha nem policy-konform jelszót adsz meg, a fiók létrejön és be is tud lépni, de a platform legerősebb jogosultsága gyengébb jelszóval védett, mint bármelyik ügyfélfiók.)

**3. E-mail: végig kisbetűvel.**
Pl. `admin@axeriva.com`. A domain részben egyetlen nagybetű is elég ahhoz, hogy a fiók soha ne tudjon belépni (lásd "Mi a hiba" 2. pont). A local part elvileg case-sensitive marad, de a félreértést elkerülendő az egészet írd kisbetűvel.

**4. Futtatás — Render Shell (elsődleges út).**
Render Dashboard → a backend Web Service → **Shell**. A shell munkakönyvtára nem garantáltan a service gyökere, a `dist/scripts/...` viszont relatív út, ezért először ellenőrizd:

```bash
pwd
ls dist/scripts
```

Ha nem látod a `seedDeveloper.js`-t, válts a service gyökerére (a Root Directory `server`, `docs/render-deployment.md:77`; a Render checkout tipikusan `/opt/render/project/src/`):

```bash
cd /opt/render/project/src/server && ls dist/scripts
```

Majd — abszolút úttal a legbiztonságosabb, mert a Node a script relatív importjait (`../database/prisma`, `../config`) a fájl helyéhez, nem a cwd-hez oldja fel:

```bash
node /opt/render/project/src/server/dist/scripts/seedDeveloper.js 'admin@axeriva.com' '<policy-konform-jelszó>'
```

Elvárt kimenet: `Created DEVELOPER user #1 (admin@axeriva.com)` (`seedDeveloper.ts:39`).

Hibaüzenetek olvasata:
- `FATAL: missing required environment variable(s): …` → vissza az 1. lépéshez, a felsorolt változó hiányzik.
- `A user with email … already exists.` (`seedDeveloper.ts:21`) → vagy már lefutott, vagy egy korábbi elgépelt címmel van sor a DB-ben.
- `Cannot find module …` / `MODULE_NOT_FOUND` → rossz cwd vagy a build nem futott le; nézd meg a legutóbbi deploy build logját.

**5. Alternatíva, ha nincs Render Shell (pl. free plan).**
Futtatható a saját gépről is, a Render PostgreSQL **External** Database URL-jével (`?sslmode=require`, `docs/render-deployment.md:61-63`) a `DATABASE_URL`-ben. Lokálisan a `NODE_ENV` nem `production`, ezért csak a `DATABASE_URL` + `JWT_SECRET` kötelező (`config.ts:34`), és a `ts-node` is megvan, tehát itt tényleg működik az `npm run seed:developer -- <email> <jelszó>`. Két figyelmeztetés: (a) a `dotenv.config()` a cwd-ből olvas `.env`-t (`config.ts:8`), tehát a parancsot a `server/` könyvtárból add ki; (b) ilyenkor egy lokális shell a **live** adatbázisra mutat — a seed után **azonnal** állítsd vissza a `DATABASE_URL`-t, mielőtt bármilyen `prisma migrate dev` / `prisma migrate reset` parancsot kiadnál. A jelszó a PowerShell historyba is beíródik (`(Get-PSReadlineOption).HistorySavePath`) — utólag töröld a sort.

**6. Jelszó-rotáció (ajánlott, opcionális).**
Mivel a seedelt jelszó megjárta a parancssort (és esetleg a shell historyt), a fiók belépése után érdemes lecserélni az alkalmazás saját reset-flow-ján: `POST /auth/forgot-password` → e-mail link → `POST /auth/reset-password/:token` (`auth.routes.ts:462`, `:527`). Ez a végpont **már** meghívja a `validatePassword()`-öt (`auth.routes.ts:535-539`), tehát a végállapotban policy-konform jelszó lesz, és minden korábbi session is érvénytelenné válik. Előfeltétel: működő Resend-konfiguráció.

**7. Adminisztráció.**
Pipáld ki a `docs/production-checklist.md:78` sort, és jegyezd fel (jelszókezelőben, nem a repóban), hogy melyik cím lett a DEVELOPER fiók.

#### Tesztek

Ez a blocker **nem ad ki kódot**, ezért új automatizált teszt sem tartozik hozzá — a `server/src/tests/` alá semmi nem kerül. Ezt az is indokolja, hogy maga a script nem integrációs-teszt-barát: `process.exit()`-et hív és import időben lefuttatja az env-validációt. A `DEVELOPER` szerepkör *viselkedését* a meglévő suite már fedi a `createDeveloper()` factoryval (`server/src/tests/helpers/factories.ts:173-176`), amit az `adminAnalytics.test.ts` és a `readOnlyMode.test.ts` használ; ezekhez nem kell hozzányúlni.

Helyette **manuális verifikáció**, egyszer, a production ellen, közvetlenül a seed után:

1. **Login működik és a szerepkör helyes.** `POST https://<backend-domain>/auth/login` a seedelt címmel és jelszóval:
   ```bash
   curl -s -X POST https://<backend-domain>/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"admin@axeriva.com","password":"<jelszó>"}'
   ```
   Elvárás: `200`, és a válasz `user` objektumában (`auth.routes.ts:319-326`) `role: "DEVELOPER"`, **`companyId: null`**, `emailVerified: true`. A `companyId: null` az, ami bizonyítja, hogy nincs cég a fiókhoz kötve (`seedDeveloper.ts:32`).
2. **A DEVELOPER-only API tényleg nyílik.** A kapott tokennel `GET https://<backend-domain>/admin/companies` → `200` (üres tömb is elfogadható válasz egy friss adatbázison). Ha `403` jön, a szerepkör nem `DEVELOPER` (`admin.routes.ts:8`).
3. **Frontend belépés.** `https://axeriva.com/login` → bejelentkezés → a `/admin` platform dashboard betöltődik és a Sidebar admin menüpontjai megjelennek (`src/app/router/index.tsx:220-229`).
4. **Negatív kontroll.** Egy szándékosan rossz jelszavas login `401 Invalid credentials`-t ad. **Figyelem:** IP+e-mail kulcsra 5 kísérlet / 15 perc, IP-re 20 / 15 perc (`constants/rateLimits.ts:15-16`) — ne próbálkozz vaktában, mert kizárod magad negyed órára.
5. **Ha az 1. lépés `401`-et ad** (a leggyakoribb ok a nagybetűs e-mail): nézd meg a tényleges sort psql-lel az External URL-en — `SELECT id, email, role, "companyId" FROM "User";`. Ha a mentett cím nem kisbetűs, javítsd `UPDATE "User" SET email = lower(email) WHERE role = 'DEVELOPER';`, majd ismételd az 1. lépést.

#### Regressziós kockázat

- **Kódfelület: nulla.** Semmilyen forrásfájl nem változik, deploy sem kell hozzá — a futó alkalmazás viselkedése változatlan.
- **Adatkockázat: minimális, de éles DB-n történik.** A script egyetlen `INSERT`-et végez a `User` táblába (`seedDeveloper.ts:27-37`), más táblát nem érint.
- **Duplikált fiók.** A `User.email` `@unique` (`prisma/schema.prisma:115`), de nem case-insensitive, és a script duplikátum-ellenőrzése is a nyers címre néz (`seedDeveloper.ts:18`). Egy elrontott futás után a helyes címmel újra lehet seedelni — ekkor **két** DEVELOPER sor marad, amiből csak az egyik használható. Takarítás: a frissen seedelt sorra nincs függő rekord (a `User`-re mutató FK-k mind projekt-szintű táblákból jönnek: `ProjectNote:245-246`, `ProjectAttachment:264-265`, `ProjectActivity:295-296`, `OwnerNote:401-402`, `ProjectInternalNote:543-544`; az `AuditLog.userId` FK nélküli `Int?` a `:583` soron), tehát a `DELETE` biztonságos — de az `UPDATE … SET email = lower(email)` az egyszerűbb javítás.
- **Gyenge jelszó a legmagasabb jogosultságon.** Nincs technikai védőháló (lásd "Mi a hiba" 3. pont) — ez tisztán fegyelem kérdése.
- **Lokális alternatíva melléhatása:** a live `DATABASE_URL` bent maradhat a fejlesztői környezetben. Egy ezt követő `prisma migrate reset` a production adatbázist törölné. Ezért az 5. lépés utolsó mondata nem opcionális.

#### Kész, ha

- [ ] `GET /health` válasza `"environment": "production"` — az env teljes, a script el fog indulni
- [ ] A Stripe live price ID-k (6 db `STRIPE_PRICE_*`) már be vannak állítva a Renderen, azaz a seed a Stripe-setup **után** fut
- [ ] `node dist/scripts/seedDeveloper.js '<kisbetűs-email>' '<jelszó>'` lefutott, kimenet: `Created DEVELOPER user #<id> (<email>)`
- [ ] A megadott e-mail teljesen kisbetűs, a jelszó min. 12 karakter + kisbetű + nagybetű + számjegy
- [ ] `POST /auth/login` → `200`, `role: "DEVELOPER"`, `companyId: null`
- [ ] `GET /admin/companies` a tokennel → `200` (nem `403`)
- [ ] A `/admin` felület betöltődik a live frontenden
- [ ] A jelszó jelszókezelőben van; nincs a repóban, `.env`-ben, chatben
- [ ] `docs/production-checklist.md:78` kipipálva
- [ ] A három follow-up felvéve a backlogba (nem B6 hatókör)

**Follow-upok (NEM a B6 végrehajtás része):**
1. `seedDeveloper.ts:12` — a usage-üzenet cseréje a ténylegesen működő `node dist/scripts/seedDeveloper.js <email> <password>` alakra; ugyanez a `docs/project-overview.md:172` sorra, ami ma production-figyelmeztetés nélkül dokumentálja az `npm run seed:developer -- <email> <jelszó>` alakot.
2. `seedDeveloper.ts` — `normalizeEmail()` (`utils/emailValidation.ts:44`) és `validatePassword()` (`utils/passwordPolicy.ts:32`) behúzása a scriptbe, hogy a "nem tud belépni" és a "gyenge jelszó" csapda technikailag is megszűnjön.
3. `docs/render-deployment.md:98-109` — az env-tábla kiegészítése a hat `STRIPE_PRICE_*` változóval, és a `37-46` deploy-sorrendben a seed lépés (4.) áthelyezése a Stripe live setup (5.) mögé.

#### Nyitott kérdések (implementáláskor eldöntendő)

- Melyik legyen a DEVELOPER fiók e-mail címe: dedikált platform-mailbox (pl. admin@axeriva.com), amit a Resend domain is kiszolgál, vagy a személyes cím? Ez határozza meg, hogy a 6. lépés jelszó-rotációja (forgot-password e-mail) egyáltalán kézbesíthető-e.
- Fut-e Render Shell a választott service plane-en? Ha nem (free plan), a lokális, External Database URL-es út a tényleges eljárás — ezt előre el kell dönteni, mert más a kockázati profilja.
- Rotálódjon-e a seedelt jelszó közvetlenül a belépés után a reset-flow-n keresztül, vagy elfogadható, hogy a parancssorban megadott jelszó marad véglegesen?
- Véglegesen átkerüljön-e a docs/render-deployment.md deploy-sorrendjében a seed lépés a Stripe live setup mögé (dokumentációs javítás), vagy csak ehhez az egyszeri élesítéshez tér el a sorrend?
- Ha a seed elsőre elrontott e-maillel fut le: javítás UPDATE-tel a meglévő soron, vagy DELETE + újraseedelés? (Mindkettő biztonságos egy friss fiókon, de rögzíteni kell, melyik lesz az eljárás.)

---

### B2 — Az archiválás kizárja a céget, miközben a Stripe tovább számláz (~4-6 óra)

*Kritikus, launch-blokkoló: a `POST /company/archive` végpontnak nincs előfizetés-ellenőrzése, így a tulajdonos egyetlen kattintással véglegesen, appon belül visszafordíthatatlanul kizárja magát és minden munkatársát egy olyan cégből, amelynek a Stripe-előfizetése változatlanul fut és tovább terhel — a lemondáshoz szükséges `/subscription` felület pedig pontosan ettől a pillanattól elérhetetlen. Fizetős ügyfél első napján is bekövetkezhet, és csak közvetlen adatbázis-hozzáféréssel javítható.*

#### Mi a hiba

A `POST /company/archive` handler (`server/src/routes/companyArchive.routes.ts:33-79`) hat validációt végez — `companyId` megléte (l.38), `confirmation === "ARCHIVE"` (l.42), user létezik (l.49), `bcrypt.compare` (l.53), company létezik (l.59), `!company.active` → 409 (l.63) —, **de az előfizetés állapotát egyáltalán nem nézi**. A fájlban nincs egyetlen Stripe-import sem. Az egyetlen mutáció az l.67-70:

```ts
await prisma.company.update({
  where: { id: companyId },
  data: { active: false, deletedAt: new Date() },
});
```

Ez a két flag beállítása után a következő történik:

1. **Azonnali, teljes kizárás.** Az `auth.middleware.ts:71-81` minden kérésnél beágyazottan lekéri a `company: { select: { active: true } }` mezőt, és az l.100-110 bármely inaktív cégű felhasználót általános 401-gyel dob vissza — minden `authMiddleware` mögötti útvonalon, kivétel nélkül.
2. **A kizárás nem visszafordítható.** Az `auth.routes.ts` egymástól függetlenül is blokkolja az inaktív cégeket a login (l.219 include, l.277 ellenőrzés), az e-mail-verifikáció (`GET /verify-email/:token`, l.366, l.376), a forgot-password (l.495, l.503 — **reset token ki sem állítódik**) és a reset-password (l.543, l.554) ágon. Refresh-token végpont egyáltalán nincs a fájlban. Ebből következik: friss tokent semmilyen úton nem lehet szerezni, a meglévő JWT pedig már az első kérésnél elhal.
3. **A Stripe tovább számláz.** Az `app.ts:174` a `/subscription` routert csak `authMiddleware` mögé teszi, így a `subscription.routes.ts:233` `POST /cancel` és a `:253` `POST /portal` — vagyis a lemondás és a Stripe Billing Portal — archiválás után halott végpont. Semmi nem mondja le az előfizetést, semmi nem törli a Stripe subscription-t.
4. **Nincs visszaállítás.** Az `admin.routes.ts` mindössze három GET route-ot tesz elérhetővé: `/companies` (l.10), `/users` (l.26), `/logs` (l.43). A repóban semmi nem állítja vissza a `Company.active` értékét `true`-ra. Az egyetlen mai orvosság a közvetlen DB-hozzáférés — miközben a számlázás fut.

A frontend **nem véd, csak félrevezet**: a `SettingsPage.tsx:12` definiál egy `ACTIVE_STATUSES = ["active","trialing","past_due"]` listát (a repó negyedik példánya!), l.22-28 lekéri az állapotot, és l.39-47 átad egy `warning`-ot — de az átadott szöveg (`en.json:656`, `hu.json:656`) kizárólag a **fiók törléséről** szól, az archiválást meg sem említi. A `DangerZoneSection.tsx:34-41` az Archive gombot csak `isOwner`-re köti — az előfizetés állapotát semmilyen formában nem nézi. A `ProfilePage.tsx:22` pedig `<DangerZoneSection />`-t rendel `warning` prop nélkül — ott még figyelmeztetés sincs.

A mintaként szolgáló guard már létezik, az `account.routes.ts:69-85`-ben: `if (role === ROLES.BUSINESS_OWNER && companyId)` blokkon belül `if (company && ACTIVE_SUBSCRIPTION_STATUSES.includes(company.subscriptionStatus))` → audit bejegyzés (l.73-78), majd 409 (l.80-83).

**Konstans-káosz.** Három lista létezik, kettő azonos, egy szándékosan más:

| Hely | Tartalom | Szemantika |
|---|---|---|
| `account.routes.ts:13` | `["active","trialing","past_due"]` | "van élő számlázás" |
| `adminAnalytics.routes.ts:18` | `["active","trialing","past_due"]` | ugyanaz, byte-azonos másolat |
| `readOnly.ts:26` `WRITABLE_STATUSES` | `Set(["active","trialing"])` | "írhat-e" — a `past_due`-t **szándékosan** kihagyja |

A `readOnly.ts:3-6` kommentje azt állítja, ő "the ONE place that decides" — ez már ma sem igaz. **Az archive guard-ot a `past_due`-t is tartalmazó listára kell építeni, és semmiképp nem a `hasActiveSubscription()`-re** (`readOnly.ts:36-44`), mert az `false`-t ad `past_due`-ra és lejárt `subscriptionEndsAt`-ra is — márpedig egy `past_due` vagy lejárt tükrözésű cég pontosan az, amelyiket a Stripe még mindig terheli.

**Mellékes, de ugyanebben a fájlban:** a `companyArchive.routes.ts` `bcrypt.compare`-jén (l.53) nincs rate limiter, miközben az `account.routes.ts:24-28` definiál `deleteAccountLimiter`-t és az l.33-on alkalmazza is. Egy ellopott JWT birtokában a `/company/archive` korlátlan jelszó-orákulum: a `confirmation` 400-as ellenőrzése (l.42) a jelszó-ellenőrzés előtt fut, tehát a támadó helyes `confirmation`-nel a 401 (rossz jelszó) és a 200/409 (jó jelszó) különbségéből olvas.

**Nulla teszt.** A `server/src/tests/` alatt egyetlen fájl sem hivatkozik az archiválásra (ellenőrizve: `grep -ril "archive" server/src/tests/` → 0 találat). Ez a javítás hozza a route legelső tesztjeit.

#### Érintett fájlok

| Fájl | Sor | Mi történik |
|---|---|---|
| `server/src/constants/subscriptionStatuses.ts` | új fájl | Az `ACTIVE_SUBSCRIPTION_STATUSES` egyetlen közös otthona (a `past_due`-t is tartalmazó, "számlázás-alatt" szemantika), `string[]` típussal. Kommentben rögzíteni, miért **nem** azonos a `readOnly.ts` `WRITABLE_STATUSES`-ével. |
| `server/src/routes/account.routes.ts` | 13 | A lokális `ACTIVE_SUBSCRIPTION_STATUSES` törlése, helyette import az új konstans-fájlból. Viselkedés nem változik. |
| `server/src/routes/adminAnalytics.routes.ts` | 18 | Ugyanaz: lokális másolat törlése, import. Figyelem: az l.140 és l.147 Prisma `in` szűrője mutálható `string[]`-et vár. |
| `server/src/routes/adminAnalytics.routes.ts` | 7 | Elavult komment javítása: a mount nem `index.ts`-ben, hanem `app.ts:177`-ben van. |
| `server/src/services/readOnly.ts` | 26 | **NEM változik.** A `WRITABLE_STATUSES` marad lokális és marad `past_due` nélkül. Legfeljebb egy komment kerül mellé, ami kimondja, hogy ez tudatosan más lista, mint a közös konstans. |
| `server/src/constants/rateLimits.ts` | 43 után | Új `COMPANY_ARCHIVE: { windowMs: HOUR_MS, max: 5 }` bejegyzés az `ACCOUNT_DELETE` mintájára, saját kommenttel. |
| `server/src/constants/auditActions.ts` | 19 után | Új `COMPANY_ARCHIVE_BLOCKED_SUBSCRIPTION` bejegyzés (a fájl már exportálja a `COMPANY_ARCHIVED`-et, a route pedig már importálja az `AUDIT_ACTIONS`-t). |
| `server/src/routes/companyArchive.routes.ts` | 1-7 | Új importok: `createRateLimiter`, `RATE_LIMITS`, `ACTIVE_SUBSCRIPTION_STATUSES`. |
| `server/src/routes/companyArchive.routes.ts` | 18 | Elavult komment javítása: a mount `app.ts:186`-ban van, nem `index.ts`-ben. |
| `server/src/routes/companyArchive.routes.ts` | 33 | `archiveCompanyLimiter` beszúrása a `requireRole` után: `router.post("/", requireRole(...), archiveCompanyLimiter, ...)`. |
| `server/src/routes/companyArchive.routes.ts` | 63-65 | A "már archivált" 409 ág **marad**, de kap egy kommentet arról, hogy az `auth.middleware.ts:100-110` miatt ma elérhetetlen — és hogy egy jövőbeli unarchive végpont elérhetővé tenné. |
| `server/src/routes/companyArchive.routes.ts` | 65 után, 67 előtt | **A guard maga.** Az `update` elé, a jelszó-ellenőrzés után (hogy ne legyen hitelesítetlen státusz-orákulum). |
| `server/src/middleware/auth.middleware.ts` | 68-70 | Elavult komment javítása: azt írja, "Company-level deactivation is intentionally out of scope here", miközben az l.96-110 pontosan ezt implementálja. |
| `src/components/account/DangerZoneSection.tsx` | 7-15, 34-41 | Az előfizetés-állapot lekérése ide költözik (a prop-drilling helyett), az Archive gomb `disabled` lesz, ha a cég számlázás alatt van, és megjelenik mellette az ok. |
| `src/pages/SettingsPage.tsx` | 12, 22-28, 39-47 | A duplikált `ACTIVE_STATUSES`, a `useState`/`useEffect` és a `warning` prop törlése — a logika a `DangerZoneSection`-be került. |
| `src/pages/ProfilePage.tsx` | 22 | **Nem változik** — a komponensbe költöztetett lekérés miatt automatikusan helyes lesz. Ez a fix lényege. |
| `src/i18n/en.json`, `src/i18n/hu.json` | 471-473 (`settings.dangerZone`) | Új kulcs: `archiveBlockedSubscription` — az archiválásról szóló, konkrét szöveg. |
| `src/i18n/en.json`, `src/i18n/hu.json` | 462 (`settings.archiveModal.description`) | A "This can be undone by contacting support." állítás javítása — ma nincs mögötte semmilyen mechanizmus (lásd Nyitott kérdések). |
| `server/src/tests/helpers/factories.ts` | 26-32, 37-50 | A `CompanyOverrides` típus kiegészítése `stripeSubscriptionId: string \| null` mezővel, és átvezetése a `createCompany` `data` blokkjába — enélkül sem a "Stripe-alapú trial", sem az `active`/`past_due` blokkolási eset nem szeedelhető a factory-n keresztül. |
| `server/src/tests/companyArchive.test.ts` | új fájl | A route legelső tesztjei. |

#### Tervezett változtatás

**1. A közös konstans kiemelése (`server/src/constants/subscriptionStatuses.ts`)**

Minden más konstans-lista a `server/src/constants/` alatt él, tehát a hely adott. Fontos típus-részlet: **ne** `as const` legyen, mert akkor a `.includes(company.subscriptionStatus)` — ahol a paraméter `string` — nem fordul le; de **`readonly string[]` sem**, mert az `adminAnalytics.routes.ts:140` és `:147` Prisma `where: { subscriptionStatus: { in: ... } }` szűrője mutálható `string[]`-et vár (`StringFilter.in?: string[]`), és `readonly` tömbre TS2322-t ad. A helyes annotáció a sima `string[]`, ami mindkét használatot kiszolgálja.

```ts
// Stripe statuses that mean "this company is still being billed" — including
// past_due, where a renewal has failed but the subscription is very much
// alive. Deliberately NOT the same list as readOnly.ts's WRITABLE_STATUSES,
// which answers a different question ("may this company write?") and leaves
// past_due out on purpose.
//
// Typed as a mutable string[]: `as const` would break .includes(string), and
// `readonly string[]` would break the Prisma `in` filters in
// adminAnalytics.routes.ts (Prisma's StringFilter.in wants string[]).
export const ACTIVE_SUBSCRIPTION_STATUSES: string[] = [
  "active",
  "trialing",
  "past_due",
];
```

Ezután az `account.routes.ts:13` és az `adminAnalytics.routes.ts:18` lokális másolatait törölni, importra cserélni. A `readOnly.ts`-hez **hozzá sem nyúlunk**.

**2. A guard (`companyArchive.routes.ts`, a l.65 utáni, l.67 előtti pozícióban)**

A jelenlegi sorrend jó: a jelszó-ellenőrzés (l.53) megelőzi a company lekérést, így a guard nem szivárogtat előfizetés-állapotot hitelesítetlen hívónak.

```ts
// The archive flag locks every company user out permanently (auth.middleware
// .ts 401s them, and auth.routes.ts refuses login, verify-email, forgot- and
// reset-password alike), while Stripe carries on billing — and /subscription
// is behind the same authMiddleware, so cancelling afterwards is impossible.
// A live Stripe subscription must therefore be settled first.
const isBilled =
  ACTIVE_SUBSCRIPTION_STATUSES.includes(company.subscriptionStatus) &&
  company.stripeSubscriptionId !== null;

if (isBilled) {
  await logAudit({
    action: AUDIT_ACTIONS.COMPANY_ARCHIVE_BLOCKED_SUBSCRIPTION,
    userId,
    companyId,
    metadata: { subscriptionStatus: company.subscriptionStatus },
  });

  return res.status(409).json({
    error:
      "Your subscription is still active. Cancel it on the Subscription page and wait for the current period to end before archiving the company.",
  });
}
```

**A `stripeSubscriptionId !== null` feltétel szándékos eltérés az `account.routes.ts` guardjától, és ez a szakasz legfontosabb döntése.** Az `auth.routes.ts:148-154` a regisztrációkor `subscriptionStatus: "trialing"`-ra állítja a céget (l.152), tehát a puszta státusz-lista minden vadonatúj céget is blokkolna. Egy regisztrációs trial mögött viszont **nincs Stripe subscription** (`stripeSubscriptionId` `null` egészen a Checkout befejezéséig), tehát nincs mit lemondani és nincs mit leállítani — az ilyen cég archiválása teljesen ártalmatlan, a blokkolása viszont egy értelmezhetetlen hibaüzenetet ad ("mondja le az előfizetését" egy olyan oldalon, ahol nincs előfizetés), ami launchkor közvetlen support-teher. Egy Stripe-alapú trial (`trialing` + létező `stripeSubscriptionId`) ezzel szemben a periódus végén automatikusan terhel, tehát az **blokkolandó**.

Ha a byte-azonos paritás fontosabb, a `stripeSubscriptionId` feltétel elhagyható — de akkor a trial-esetre külön, saját hibaüzenet kell. Az `account.routes.ts` guardja ebben a blokkerben **nem** módosul (ugyanez a trial-probléma ott is fennáll, de az külön döntés — lásd Nyitott kérdések).

**3. Mit jelent ez a futó periódusra**

A `POST /subscription/cancel` (`subscription.routes.ts:233`) csak `cancel_at_period_end`-et állít, a Stripe subscription életben marad, a `subscriptionStatus` pedig `"active"` marad a periódus végéig. Gyakorlati következmény, amit **ki kell mondani a hibaüzenetben és a UI szövegben is**: lemondás után az archiválás csak a fizetett periódus lejártakor (a webhook státusz-frissítése után) válik lehetővé. Ez v1.0-ra a szándékolt viselkedés — a periódus ki van fizetve, a tulajdonosnak addig legyen hozzáférése. Aki azonnal ki akar szállni, a `POST /subscription/portal`-on keresztül a Stripe Billing Portalban mondhat le azonnali hatállyal. A guard **nem** mond le semmit a felhasználó nevében.

**4. Rate limiter**

A `rateLimits.ts:43` után új bejegyzés, az `ACCOUNT_DELETE` mintájára és indoklásával (a végpont jelszót ellenőriz, tehát ellopott token birtokában orákulum):

```ts
COMPANY_ARCHIVE: { windowMs: HOUR_MS, max: 5 },
```

A route-ban, az `account.routes.ts:24-28` mintáját követve — **saját `name`-mel**, hogy ne ossza az ablakot az account-delete limiterrel:

```ts
const archiveCompanyLimiter = createRateLimiter({
  name: "company-archive",
  ...RATE_LIMITS.COMPANY_ARCHIVE,
  keyGenerator: (req) => String(req.user?.userId ?? req.ip ?? "unknown"),
});
```

**5. Frontend**

A javítás lényege, hogy **az előfizetés-lekérés a `DangerZoneSection`-be költözik**, prop helyett. Így a `ProfilePage.tsx:22` no-prop esete egyetlen sor módosítása nélkül megjavul, és megszűnik a `SettingsPage.tsx:12`-beli negyedik státusz-lista is.

- `DangerZoneSection.tsx`: a meglévő `useIsOwner()` mellé egy `useEffect`, ami **csak akkor** hívja a `getSubscriptionStatus()`-t, ha a felhasználó tulajdonos **és van cége**. Két külön ok: az EMPLOYEE hívása 403-at kapna (`subscription.routes.ts:15` `requireRole(BUSINESS_OWNER, DEVELOPER)`), a `useIsOwner()` viszont DEVELOPER-re is `true`-t ad (`src/hooks/useIsOwner.ts`), a DEVELOPER-nek pedig nincs `companyId`, miközben a handler `req.user!.companyId!`-t dereferál (`subscription.routes.ts:24`).
- Az archiválás blokkolt, ha a válasz `subscriptionStatus`-a a `["active","trialing","past_due"]` halmazban van **és** a `stripeSubscriptionId` nem `null`. Payload-bővítés **nem kell**: a `GET /subscription` már ma is visszaadja a `stripeSubscriptionId`-t (`subscription.routes.ts:62`), és a frontend `SubscriptionStatus` típusa (`src/services/subscription.service.ts`) is deklarálja `string | null`-ként — a frontend tehát ugyanazt a szabályt tudja kiértékelni, mint a backend.
- Az Archive gomb (l.34-41) `disabled` állapotot kap, halványított stílussal és `title`-lel, alatta/mellette pedig megjelenik az új `settings.dangerZone.archiveBlockedSubscription` szöveg. A `warning` prop megmarad a fióktörlésre — a két üzenet **külön** kulcs, mert két külön műveletről szólnak.
- Hálózati hiba esetén a lekérés maradjon fail-open (a gomb engedélyezett): az érdemi védelem a backend guard, a `companySettings.service.ts:171-174` pedig már ma is kiolvassa és a modalban megjeleníti a szerver `error` mezőjét, tehát a 409 szövege eljut a felhasználóhoz.
- Az `en.json:462` / `hu.json:462` `archiveModal.description` jelenleg azt ígéri, hogy az archiválás "can be undone by contacting support" — ennek ma semmilyen mechanizmus nem felel meg. Vagy a szöveget kell őszintére javítani ("nem vonható vissza az appból"), vagy meg kell lépni a lenti follow-upot.

**Follow-up (NEM része a B2 lezárásának): admin unarchive végpont**

Erősen javasolt, de tudatosan külön scope: egy `POST /admin/companies/:id/unarchive` (DEVELOPER-only, `admin.routes.ts`), ami `active: true, deletedAt: null`-t ír és auditál. Ma ez az egyetlen hiányzó darab ahhoz, hogy egy téves archiválás DB-hozzáférés nélkül visszavonható legyen, és ez tenné igazzá az `archiveModal` "contact support" ígéretét.

*Kockázat, amiért külön döntés:* az `admin.routes.ts` ma **kizárólag GET** route-okat tartalmaz — ez lenne a legelső platform-szintű írási művelet, amely egy másik tenant adatait módosítja. Saját jogosultsági és audit-átgondolást igényel (ki hívhatja, mi kerül az AuditLog-ba, kell-e megerősítés), és mellékhatásként elérhetővé teszi a `companyArchive.routes.ts:63-65` ma halott "már archivált" ágát. A B2 **enélkül is lezárható**: a guard megakadályozza, hogy a helyzet egyáltalán előálljon; az unarchive csak a már meglévő, DB-vel javítandó esetekre lenne mentőöv.

#### Tesztek

Új fájl: **`server/src/tests/companyArchive.test.ts`** (a route legelső tesztjei). Minta és eszközkészlet: `accountSecurity.test.ts` — `supertest` + `app`, és a `tests/helpers/factories.ts` valóban létező exportjai: `createTenant`, `createEmployeeUser`, `authHeader`, `TEST_PASSWORD`, `createCompany`. A `tests/setup.ts` minden teszt előtt `resetDatabase()`-t és `resetRateLimiters()`-t futtat, tehát a rate-limit teszt nem szennyezi a többit.

Figyelem a fixture-ökre: a `createCompany` alapértelmezése `subscriptionStatus: "trialing"` + jövőbeli `subscriptionEndsAt` (factories.ts:42-46), `stripeSubscriptionId`-t viszont **soha nem állít** — az minden factory-val létrehozott cégen `null`. Mivel a guard a `stripeSubscriptionId !== null`-t is megköveteli, minden blokkolást váró tesztesetnek explicit `stripeSubscriptionId`-t kell seedelnie, különben 409 helyett 200-at kap. Archiválható tenant az `accountSecurity.test.ts:17-21` mintájára állítható elő:

```ts
const archivableTenant = () =>
  createTenant({
    subscriptionStatus: "canceled",
    subscriptionEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
  });
```

A `stripeSubscriptionId` **ma nem szerepel** a `CompanyOverrides` típusban (factories.ts:26-32), ezért vagy ki kell egészíteni a factory-t (javasolt, lásd a fájltáblát), vagy a tesztben `prisma.company.update`-tel kell beállítani.

Esetek:

1. **`active` előfizetésű, Stripe-subscriptionnel rendelkező cég archiválása 409-et ad**, és a `Company.active` a DB-ben **továbbra is `true`** (a DB-ellenőrzés a lényeg, nem csak a státuszkód). A fixture-nek a `subscriptionStatus: "active"` mellé `stripeSubscriptionId`-t is kell adni.
2. **`past_due` előfizetésű (szintén `stripeSubscriptionId`-vel rendelkező) cég archiválása 409-et ad.** Ez az az eset, amit a `readOnly.ts` `hasActiveSubscription()`-je tévesen átengedne — a teszt pontosan ezt a döntést szögezi le.
3. **Stripe-alapú `trialing` (van `stripeSubscriptionId`) → 409.**
4. **Regisztrációs `trialing` (`stripeSubscriptionId` `null`) → sikeres archiválás**, `{ archived: true }`, és a `Company.active` `false`. (Csak akkor, ha a `stripeSubscriptionId`-finomítás mellett döntünk; ha nem, ez a teszt 409-et vár.)
5. **`canceled` / lejárt előfizetésű cég archiválása sikeres** — a guard nem töri el a normál utat.
6. **A blokkolt kísérlet auditálva van:** a `prisma.auditLog` tartalmaz egy `COMPANY_ARCHIVE_BLOCKED_SUBSCRIPTION` sort a megfelelő `companyId`-vel, és a `metadata` JSON-ben a `subscriptionStatus` értékkel.
7. **Rossz jelszó aktív előfizetésű cégnél 401-et ad, nem 409-et** — a jelszó-ellenőrzés megelőzi a guardot, tehát a végpont nem előfizetés-orákulum.
8. **Rate limit:** `RATE_LIMITS.COMPANY_ARCHIVE.max + 1` rossz jelszavas kísérlet után 429, definiált `Retry-After` fejléccel (az `accountSecurity.test.ts:24-37` mintájára), és egy másik tenant tokenje ugyanabban a tesztfolyamatban továbbra is 401-et kap (per-user, nem per-IP kulcsolás).
9. **EMPLOYEE szerepkör 403-at kap** (`createEmployeeUser` + `requireRole(ROLES.BUSINESS_OWNER)`).
10. **Token nélküli hívás 401** (`authMiddleware`).
11. **Sikeres archiválás után a tulajdonos meglévő tokenje 401-et kap** egy tetszőleges `authMiddleware` mögötti végponton (pl. `GET /subscription`) — ez rögzíti, hogy a kizárás valós, és hogy a guard az egyetlen védelem előtte.

Regressziós háló a konstans-költöztetéshez: nem kell új teszt, de a teljes suite-ot le kell futtatni. Fontos tudni, hogy a listát használó ágakat **egyetlen meglévő teszt sem fedi**: az `accountSecurity.test.ts` szándékosan `canceled` tenantot használ (l.17-21), hogy elkerülje az `account.routes.ts:72` guardját, és mind a négy tesztje a rate limiterről szól; az `adminAnalytics.test.ts` pedig rendezésre és üres adatbázisra fut, így az l.140/147 `in`-szűrőit sem hozza játékba. A suite tehát csak azt bizonyítja, hogy semmi nem tört el — a lista szemantikáját az új `companyArchive.test.ts` szögezi le. A `readOnlyMode.test.ts` fedi az érintetlen `readOnly.ts`-t.

#### Regressziós kockázat

- **Közepes: a konstans-migráció.** Két hívóhely importra cserélése önmagában triviális, de a `readOnly.ts:26`-ot **véletlenül se vonjuk be** — a `past_due` kihagyása ott szándékos, és ha a közös listára cserélnénk, minden `past_due` cég egy csapásra írási jogot kapna, ami a S2.7 read-only mód csendes kilyukasztása lenne. TypeScript-buktató mindkét irányban: `as const` esetén a `.includes(string)` nem fordul le, `readonly string[]` esetén viszont az `adminAnalytics.routes.ts:140` és `:147` Prisma `in` szűrője dob TS2322-t — a konstans típusa ezért sima `string[]` legyen.
- **Közepes: a trial-eset.** Ha a guard `stripeSubscriptionId` finomítás nélkül készül el, minden frissen regisztrált cég azonnal beleütközik — a `createCompany` factory alapértelmezése is `trialing`, tehát ez a suite-ban is azonnal látszani fog. A finomítással készülő változatnál ellenőriztük a Stripe-szinkront: az `applySubscriptionUpdate` (`services/stripe/syncSubscription.ts:71-82`) minden frissítésnél feltétel nélkül beírja a `stripeSubscriptionId`-t (l.75), tehát egy fizetős trial nem csúszik át a guardon (az egyetlen kivétel a korán visszatérő `isManuallyManaged` founder/enterprise ág, ami eleve nem Stripe-számlázott).
- **Alacsony: a rate limiter.** Külön `name` ("company-archive") kell, különben az account-delete ablakával osztozna, és az egyik funkció elhasználná a másik keretét. A `keyGenerator` `req.user?.userId`-ra épül; a route `app.ts:186` szerint `authMiddleware` mögött van, tehát ez mindig kitöltött — az IP-fallback csak biztosíték.
- **Alacsony: a frontend átszervezés.** A lekérés `DangerZoneSection`-be költöztetése után a `ProfilePage` is hív egy `GET /subscription`-t; ezt tulajdonos + létező `companyId` feltételre kell kapuzni, különben minden EMPLOYEE profil-megnyitáskor 403-at generál, DEVELOPER-nél pedig a `companyId`-t dereferáló handler hibázik.
- **Alacsony: a 409-es hibaüzenet.** A `companySettings.service.ts:171-174` a szerver `error` mezőjét szó szerint dobja tovább, és a modal jeleníti meg — a szöveg tehát végfelhasználói felület, angolul jelenik meg a magyar UI-ban is. Ha ez zavaró, a modalnak státuszkód alapján saját i18n kulcsot kell választania (ugyanez a meglévő hibaüzenetekre is igaz, tehát ez nem regresszió, csak öröklött viselkedés).
- **Nincs kockázat a meglévő archivált cégekre:** a guard csak új archiválási kísérletet blokkol, meglévő `active: false` sorokat nem érint.

#### Kész, ha

- [ ] A `POST /company/archive` 409-cel utasítja el az archiválást, ha a cégnek élő, számlázott Stripe-előfizetése van, és a `Company.active` változatlanul `true` marad.
- [ ] A blokkolt kísérlet `COMPANY_ARCHIVE_BLOCKED_SUBSCRIPTION` audit sort ír a `subscriptionStatus`-szal a metaadatban.
- [ ] Az `ACTIVE_SUBSCRIPTION_STATUSES` egyetlen helyen, a `server/src/constants/subscriptionStatuses.ts`-ben él `string[]` típussal; az `account.routes.ts:13` és az `adminAnalytics.routes.ts:18` lokális másolata törölve, mindkettő importál, és a `tsc` tisztán fut.
- [ ] A `readOnly.ts` `WRITABLE_STATUSES`-e érintetlen, továbbra is `past_due` nélkül.
- [ ] A route-on rate limiter van, saját `COMPANY_ARCHIVE` konfigurációval és saját limiter-névvel.
- [ ] A Danger Zone Archive gombja letiltott állapotban jelenik meg számlázott előfizetés esetén, az archiválásra vonatkozó (nem a fióktörlésről szóló) magyarázó szöveggel — **a `SettingsPage`-en és a `ProfilePage`-en egyaránt**.
- [ ] A `SettingsPage.tsx:12`-beli duplikált `ACTIVE_STATUSES` lista megszűnt.
- [ ] Létezik a `server/src/tests/companyArchive.test.ts`, benne legalább a fenti 11 eset, és a teljes suite zölden fut.
- [ ] A három elavult komment javítva: `companyArchive.routes.ts:18`, `adminAnalytics.routes.ts:7` (mindkettő `index.ts` helyett `app.ts` — a mountok az `app.ts:186`, illetve az `app.ts:177` sorban vannak), `auth.middleware.ts:68-70` (az "out of scope" állítás ellentmond az l.96-110-nek).
- [ ] Az `archiveModal.description` szövege (`en.json:462`, `hu.json:462`) vagy őszinte a visszavonhatóságról, vagy megszületett hozzá az unarchive végpont.

#### Nyitott kérdések (implementáláskor eldöntendő)

- Blokkolja-e a guard a regisztrációs trial cégeket? A javaslat szerint NEM (a `stripeSubscriptionId !== null` feltétel miatt), mert ott nincs mit lemondani — de ez tudatos eltérés az `account.routes.ts:69-85` guardjától, és el kell dönteni, hogy az eltérés vállalható-e, vagy inkább a byte-azonos paritás fontosabb külön trial-hibaüzenettel.
- Hozzáadható-e a `GET /subscription` payloadhoz egy `hasStripeSubscription` boolean (`subscription.routes.ts:53-66`), hogy a frontend ugyanazt a szabályt tudja kiértékelni, mint a backend — vagy a frontend maradjon a durvább, csak státusz-alapú tiltásnál (ami trial alatt fölöslegesen tiltana)?
- Az `account.routes.ts` fióktörlési guardja is szenved ugyanettől a trial-problémától (egy trial cég tulajdonosa sem tudja törölni a fiókját). Ez B2 scope-jában javítandó, vagy külön blokkerként/follow-upként kezelendő?
- Legyen-e az admin unarchive végpont még v1.0 előtt megcsinálva? A B2 lezárásához nem kell, de nélküle az `archiveModal.description` "contact support" ígérete hazugság, és a már archivált cégek csak DB-hozzáféréssel menthetők.
- Mit írjon pontosan a 409-es hibaüzenet a futó periódusról? A `POST /subscription/cancel` csak `cancel_at_period_end`-et állít, tehát az archiválás a periódus végéig blokkolt marad — a szövegnek ezt közölnie kell, és el kell dönteni, hogy a Stripe Billing Portal (azonnali lemondás) ajánlott-e benne alternatívaként.
- A backend 409 szövege ma angolul jelenik meg a magyar UI-ban is (a `companySettings.service.ts:171-174` szó szerint továbbdobja). Kapjon-e az `ArchiveCompanyModal` státuszkód-alapú i18n kulcsot, vagy maradjon az örökölt viselkedés?
- Kapjon-e a guard mellé egy opcionális "mondd le és archiváld" kombinált folyamatot (a cancel meghívása a felhasználó nevében), vagy maradjon a szigorúan kétlépéses, felhasználó által vezérelt út?

---

### B3 — Jelszó-policy ütközés a frontend és a backend között (~2-3h)

*Súlyosság: magas — a regisztrációs és a meghívó-elfogadó képernyőn a felhasználó `minLength={6}` alapján ír be egy jelszót, a backend 12 karaktert követel, a hibaüzenetet pedig a service réteg eldobja, így a felhasználó egy félrevezető üzenetet kap és nem tudja megjavítani a bevitelt. Ez a két onboarding-belépőpont teljes elakadása — launch előtt kötelező.*

#### Mi a hiba

A backend policy egyetlen helyen él: `server/src/utils/passwordPolicy.ts:9` (`PASSWORD_MIN_LENGTH = 12`), `:14-15` (egyetlen `PASSWORD_POLICY_MESSAGE`), `:39-46` (a szabály: hossz + kisbetű + nagybetű + számjegy, Unicode osztályokkal a `:24-26` sorokban, `:37`-en `.trim()` után). **Speciális karaktert a backend nem követel.**

A frontenden ebből semmi nem jelenik meg, és négy egymásra épülő hiba van:

1. **Rossz `minLength`.** `src/pages/RegisterPage.tsx:78` és `src/pages/AcceptInvitePage.tsx:117` egyaránt `minLength={6}`. A `grep` szerint az egész `src/`-ben pontosan ez a két `minLength` található, és **nulla** találat van a policy bármilyen kliensoldali tükrözésére (nincs `12 characters`, nincs `passwordPolicy`, nincs `PASSWORD_MIN`). A felhasználó tehát 6 karakternél kap zöld utat egy 12 karaktert követelő endpointhoz.

2. **A szerver hibaüzenete kétszer vész el, és az első eldobás a service rétegben történik.** A backend lapos, feldolgozható `{ error: string }`-et ad HTTP 400-zal: `server/src/routes/auth.routes.ts:105-109` (register), `server/src/routes/invites.routes.ts:215-219` (accept invite), `server/src/routes/auth.routes.ts:535-539` (reset-password). Ezt a szerződést backend teszt rögzíti (`server/src/tests/auth.test.ts:72` és `:373`). A frontenden viszont `src/services/auth.service.ts:37-39` `throw new Error("Failed to register")`-t dob anélkül, hogy valaha meghívná a `response.json()`-t; ugyanezt teszi `src/services/invites.service.ts:81-83` az `acceptInvite`-ban. Csak ezután fut a page catch blokkja (`RegisterPage.tsx:29` és `AcceptInvitePage.tsx:46` — mindkettő paraméter nélküli `} catch {`, tehát a hiba még csak kötve sincs egy változóhoz). **Ha csak a page-eket javítod, az üzenet továbbra sem jelenik meg** — a service rétegben már nincs mit felszínre hozni. Ugyanezekben a fájlokban a helyes minta már megvan: `auth.service.ts:48-49`, `62-63`, `75-76`, `92-94` és `invites.service.ts:23-24`.

3. **Két i18n kulcs félrevezet.** `src/i18n/en.json:597` / `src/i18n/hu.json:597` (`auth.register.failed`): "Registration failed. Try a different email address." / "A regisztráció sikertelen. Próbáljon másik e-mail-címet." Ez ma **aktívan hazudik**, mert `server/src/routes/auth.routes.ts:131` duplikált e-mailre 201-et ad vissza (enumeration hardening, K2.1.9) — az egyetlen ok, amit az üzenet megnevez, már nem képes hibát okozni. `src/i18n/en.json:641` / `hu.json:641` (`auth.acceptInvite.failed`): "Failed to activate your account." / "A fiók aktiválása sikertelen." — ez nem hazudik, csak semmitmondó.

4. **Az erősségmérő soha nem tud megfelelést jelezni.** `src/utils/passwordStrength.ts:8` a `length >= 10`-re pontoz (nem 12-re), `:12` pedig pontot ad egy speciális karakterért, amit a backend nem követel. Következmény: a policy-konform `"Abcdefghijk1"` 4/5-nél megáll, a `levelFromScore` (`:17-21`) szerint `"medium"` — a mérő definíció szerint képtelen "strong"-ot mutatni olyan jelszóra, ami pontosan megfelel a szabálynak. **Újonnan talált, az eredeti evidencián túl:** a `:9-11` sorok ASCII-only regexeket használnak (`/[a-z]/`, `/[A-Z]/`, `/[0-9]/`), miközben a backend Unicode osztályokkal dolgozik. Az `"Árvíztűrő12x"` jelszót a szerver elfogadja, a mérő viszont nagybetű nélkülinek látja (`"Á"` nincs benne a `[A-Z]`-ben) — magyar felhasználónál ez rendszeresen félrevezet.

Referencia-implementáció: `src/pages/ResetPasswordPage.tsx:39` **helyesen** felszínre hozza a szerver üzenetét (`err instanceof Error ? err.message : ...`), mert az `auth.service.ts:92-94` mögötte jól viselkedik. Ez ma az egyetlen működő új-jelszó képernyő — a másik kettőt erre kell ráigazítani. Ugyanakkor `:64` és `:77` sorain egyáltalán nincs `minLength`, és **újonnan talált:** a `:38` sor `setStatus("error")`-t hív, ami kicseréli a formot egy zsákutca képernyőre ("Request a new link") — gyenge jelszó esetén a felhasználó elveszíti a beírt adatokat és nem tud javítani.

Kiegészítő tény a scope-hoz: `AcceptInvitePage.tsx:114-121` egy **nyers** `<input type="password">`-öt használ, nem `PasswordInput`-ot, tehát ezen a képernyőn nincs sem szem-ikon, sem erősségmérő. A `PasswordInput.tsx` saját kommentje kimondja, hogy a komponensben nem él auth/validációs logika; a `PasswordStrengthMeter.tsx` tisztán prezentációs és nem rajzol követelmény-hintet.

#### Érintett fájlok

| Fájl | Sor | Mi történik |
| --- | --- | --- |
| `src/utils/passwordPolicy.ts` | új fájl | A backend policy egyetlen, deklaráltan nem-autoritatív frontend tükre: `PASSWORD_MIN_LENGTH = 12`, Unicode regexek, `meetsPasswordPolicy(password): boolean`. |
| `src/services/auth.service.ts` | 37-39 | `register()` — a `response.json()` kiolvasása és a `data.error` továbbadása; a `:48-49` mintájának másolása. **Az első eldobási réteg.** |
| `src/services/invites.service.ts` | 81-83 | `acceptInvite()` — ugyanez, a `:23-24` mintájának másolása. **Az első eldobási réteg.** |
| `src/pages/RegisterPage.tsx` | 78 | `minLength={6}` → `minLength={PASSWORD_MIN_LENGTH}`. |
| `src/pages/RegisterPage.tsx` | 20-34 | `handleSubmit`: submit előtti `meetsPasswordPolicy` ellenőrzés **a `:23` `setIsSubmitting(true)` elé**; `:29` `} catch {` → `} catch (err) {` és a szerver üzenetének felszínre hozása. |
| `src/pages/RegisterPage.tsx` | 74-84 | A jelszó mező alá bekerül a `<PasswordRequirements />`. |
| `src/pages/AcceptInvitePage.tsx` | 1-6 | Új import: `PasswordInput` (ma nincs benne, a fájl csak `Button`-t importál). |
| `src/pages/AcceptInvitePage.tsx` | 114-121 | A nyers `<input type="password">` cseréje `PasswordInput`-ra (`showStrength`, `autoComplete="new-password"`), `minLength={PASSWORD_MIN_LENGTH}`, alatta `<PasswordRequirements />`. |
| `src/pages/AcceptInvitePage.tsx` | 35-51 | `handleSubmit`: submit előtti policy-ellenőrzés **a `:40` `setIsSubmitting(true)` elé**; `:46` `} catch {` → `} catch (err) {`. |
| `src/pages/ResetPasswordPage.tsx` | 21-43 | `handleSubmit`: a `mismatch` ág (`:25-28`) után policy-ellenőrzés, ami **nem** vált `status="error"`-ra. |
| `src/pages/ResetPasswordPage.tsx` | 64, 77 | `minLength={PASSWORD_MIN_LENGTH}` felvétele mindkét `PasswordInput`-ra. |
| `src/pages/ResetPasswordPage.tsx` | 60-71 | A `<PasswordRequirements />` beszúrása az új jelszó mező alá (egyszer, a megerősítő mező alá nem). |
| `src/components/ui/PasswordRequirements.tsx` | új fájl | Tisztán prezentációs hint-sor, a `common.passwordRequirements` kulcsot rendereli `{{min}}` behelyettesítéssel. |
| `src/utils/passwordStrength.ts` | 5-15 | `length >= 10` → `>= PASSWORD_MIN_LENGTH`; ASCII regexek → Unicode osztályok; a speciális karakter pontja bónusszá alakul. |
| `src/utils/passwordStrength.ts` | 17-21 | `levelFromScore` helyett megfelelés-alapú szintezés: nem-konform → `weak`, konform → `medium`, konform + bónusz → `strong`. |
| `src/i18n/en.json` | 48-53 | A `common.passwordStrength` blokk mellé új `common.passwordRequirements` és `common.passwordPolicyError` kulcsok. |
| `src/i18n/en.json` | 597 | `auth.register.failed` átfogalmazása (nem hivatkozhat e-mail-címre). |
| `src/i18n/en.json` | 641 | `auth.acceptInvite.failed` átfogalmazása fallback-üzenetté. |
| `src/i18n/hu.json` | 48-53, 597, 641 | Sorról sorra ugyanaz a három változtatás (a két fájl kulcsszerkezete azonos). |
| `server/src/tests/passwordPolicy.test.ts` | új fájl | Tripwire teszt a tükrözött konstansra (lásd DRY). |
| `server/src/tests/invites.test.ts` | új fájl | A `POST /invites/:token/accept` policy-szerződésének lefedése. |
| `server/src/utils/passwordPolicy.ts` | 9 | Csak egy kommentsor a `PASSWORD_MIN_LENGTH` fölé, ami megnevezi a frontend tükröt. Logika nem változik. |
| `src/components/ui/PasswordInput.tsx` | — | **Nem változik.** A követelmény-hint nem kerül bele (lásd indoklás). |
| `src/components/ui/PasswordStrengthMeter.tsx` | — | **Nem változik.** A `(score/5)` kijelzés és a 3 sáv a `level` alapján továbbra is helyes marad. |
| `src/pages/LoginPage.tsx` | — | **Nem változik.** A login soha nem validál erősséget (`server/src/utils/passwordPolicy.ts:6-7`). |
| `src/components/account/DeleteAccountModal.tsx` | 76 | **Nem változik.** A nyers `<input type="password">` itt a **meglévő** jelszó újramegadása (`server/src/routes/account.routes.ts:57`, `bcrypt.compare`) — se `minLength`, se policy-ellenőrzés, se hint. |
| `src/components/company/ArchiveCompanyModal.tsx` | 76 | **Nem változik.** Ugyanaz a re-autentikációs minta, mint a törlés-modálban. |

#### Tervezett változtatás

**1. A DRY-kérdés — nyílt döntés: duplikálunk, egy helyre.**

Nincs közös modul a `server/` és a `src/` között: külön `package.json`, külön tsconfig, és a `tsconfig.app.json` `include`-ja szigorúan `["src"]`. Egy megosztott csomag (workspace + path alias mindkét tsconfigban + Vite `resolve.alias` + a szerver build/Docker/Render pipeline érintése) messze túlnyúlik ezen a bloccker 2-3 órás keretén, és build-törési kockázatot visz egy release-blokkoló javításba. **Ezért a 12-es szám duplikálódik a frontenden**, de kizárólag egyetlen új fájlban: `src/utils/passwordPolicy.ts`. Semmilyen page, komponens vagy i18n string nem tartalmazhatja a számot literálként — az i18n kulcsok `{{min}}` interpolációval kapják meg (az `src/i18n/index.tsx` `interpolate()` függvénye ezt már támogatja).

A duplikáció három mechanizmussal marad őszinte:

- **Az autoritás a backendé marad.** A kliensoldali ellenőrzés kizárólag UX: azonnali, lokalizált visszajelzést ad. Egyetlen döntés sem múlik rajta.
- **A szerver üzenete mindig felszínre kerül**, ha a kliens átengedne valamit, amit a szerver elutasít. Pontosan ezért nem opcionális a 2. pont: a service réteg javítása az a védőháló, ami a duplikációt túlélhetővé teszi. Elcsúszás esetén a felhasználó rossz üzenet helyett a pontos szerveroldali szabályt látja.
- **Kereszthivatkozás + tripwire teszt.** Mindkét `passwordPolicy.ts` tetején kommentben megnevezzük a másikat, és a backendre kerül egy teszt, ami a konstans értékét rögzíti — így a backend-oldali változtatás CI-ben, hangosan bukik el, a hibaüzenet pedig megmondja, hol a tükör.

Ismert, elfogadott korlát: `PASSWORD_POLICY_MESSAGE` csak angolul létezik. Ha a szerveroldali elutasítás mégis eljut a felhasználóig, magyar nyelvnél is angol szöveget lát. Ez tudatos csere — inkább pontos angol üzenet, mint pontatlan magyar. A rendes úton a kliensoldali ellenőrzés fog előbb megszólalni, magyarul.

**2. Az új `src/utils/passwordPolicy.ts`.**

Tartalma tükrözze a `server/src/utils/passwordPolicy.ts:37-46` logikáját, beleértve a `.trim()`-et (a szerver a trimmelt formát hasheli, tehát a kliens verdiktje csak így egyezik) és a Unicode osztályokat (`/\p{Ll}/u`, `/\p{Lu}/u`, `/\p{Nd}/u`, `:24-26`). Exportál: `PASSWORD_MIN_LENGTH` és `meetsPasswordPolicy(password: string): boolean`. Hibaüzenetet **nem** exportál — az i18n-ből jön.

**3. A két service-eldobás javítása.** `src/services/auth.service.ts:37-39`:

```ts
if (!response.ok) {
  const data = await response.json().catch(() => ({}));
  throw new Error(data.error || "Failed to register");
}
```

Ugyanez `src/services/invites.service.ts:81-83`-ban `"Failed to accept invitation"` fallbackkel. Ez szó szerint a `:48-49`, illetve `:23-24` sorok mintája — ne találj ki újat.

**4. A page-ek catch blokkjai.** `RegisterPage.tsx:29` és `AcceptInvitePage.tsx:46` paraméter nélküli `} catch {`-je kap egy kötött hibát, és a `ResetPasswordPage.tsx:39` mintáját követi:

```ts
} catch (err) {
  setError(err instanceof Error ? err.message : t("auth.register.failed"));
}
```

Az `AcceptInvitePage`-en ugyanez a minta, de a saját fallback kulcsával (`t("auth.acceptInvite.failed")`, ma a `:47` sor) — a register kulcsát ide másolni hiba. Az i18n kulcs innentől mindkét helyen **fallback**, nem elsődleges üzenet.

**5. Submit előtti ellenőrzés mindhárom képernyőn.** A `minLength` önmagában nem elég: natív módon csak a hosszt blokkolja, a kis-/nagybetű/számjegy szabályt nem (`"abcdefghijkl"` átmenne). Mindhárom `handleSubmit`-be, a hálózati hívás elé:

```ts
if (!meetsPasswordPolicy(password)) {
  setError(t("common.passwordPolicyError", { min: PASSWORD_MIN_LENGTH }));
  return;
}
```

**Az elhelyezés mindhárom oldalon kötött: az ellenőrzés a `setIsSubmitting(true)` sor ELÉ kerül.** A `RegisterPage`-en ez a `:23`, az `AcceptInvitePage`-en a `:40` sor, és mindkettő a `try` blokkon **kívül** áll — ha a korai `return` utánuk futna, a `finally` (`RegisterPage.tsx:31-33`, `AcceptInvitePage.tsx:48-50`) soha nem hajtódna végre, és a gomb véglegesen a "Signing up..." / "Activating..." feliraton ragadna. A `ResetPasswordPage`-en ez a `:25-28` mismatch-ág **után** és a `:32` `setIsSubmitting(true)` **előtt** áll, és sima `return` — nem hívhat `setStatus("error")`-t, különben megismétli azt a zsákutcát, amit épp elkerülünk.

**6. A követelmény-hint helye — nyílt döntés: külön komponens, nem `PasswordInput` prop.**

Új `src/components/ui/PasswordRequirements.tsx`, ami egyetlen halvány sort renderel (`text-xs text-white/50`, a `PasswordStrengthMeter` alsó sorával azonos stílusban) és a page-ek renderelik, nem a `PasswordInput`. Indoklás: a `ResetPasswordPage` két `PasswordInput`-ot rajzol, és a hintnek egyszer kell megjelennie — egy `showRequirements` prop előbb-utóbb duplán renderelődne; a `LoginPage`-en pedig a hint kifejezetten hibás lenne. A hint a **form szabálya**, nem a beviteli widget tulajdonsága. A `PasswordInput.tsx` így érintetlen marad, összhangban a saját kommentjével.

**7. `AcceptInvitePage` beviteli mezőjének cseréje.** A `:114-121` nyers inputja `PasswordInput`-ra vált; ehhez a fájl import-blokkjába (`:1-6`) fel kell venni a `import PasswordInput from "../components/ui/PasswordInput";` sort, mert ma nincs benne. A csere vizuálisan biztonságos: a `PasswordInput` `DEFAULT_INPUT_CLASS`-a **karakterre azonos** a jelenlegi `className`-nel, tehát csak a szem-ikon (`pr-10`) és a `showStrength` mérő a különbség — pontosan az, ami ma hiányzik erről a képernyőről.

**8. `src/utils/passwordStrength.ts` újrahangolása.** A pontozás maradjon 0-5 skálán, hogy a `PasswordStrengthMeter` `(score/5)` kijelzését és 3 sávos logikáját ne kelljen hozzányúlni. A függvény a `.trim()`-elt értéken dolgozzon, a szerverrel egyezően — tehát rögtön az elején `const value = password.trim();`, és minden további ellenőrzés ezen fusson. Négy pont a valódi policy négy szabálya (hossz `>= PASSWORD_MIN_LENGTH`, kisbetű, nagybetű, számjegy — Unicode regexekkel), az ötödik egy bónusz a minimumon túli erősségért:

```ts
const value = password.trim();
const bonus = value.length >= PASSWORD_MIN_LENGTH + 4 || /[^\p{L}\p{Nd}]/u.test(value);
if (bonus) score += 1;
```

A szint viszont **ne** nyers pontszámból jöjjön, hanem megfelelésből: `!meetsPasswordPolicy(value)` → `"weak"`, konform → `"medium"`, konform és bónusz → `"strong"`. Így a `"weak"` innentől pontosan azt jelenti, hogy *a szerver ezt elutasítaná*, és a `"strong"` **elérhető speciális karakter nélkül is**, pusztán hosszal (16+) — nem sugallunk olyan szabályt, amit a backend nem kényszerít ki.

**9. i18n — mindkét nyelvi fájl, azonos kulcsszerkezettel.**

Új kulcsok a `common` névtérbe, a `passwordStrength` blokk mellé (`en.json:48-53` / `hu.json:48-53`):

- `common.passwordRequirements` — en: `"At least {{min}} characters, with an uppercase letter, a lowercase letter and a number."` / hu: `"Legalább {{min}} karakter, nagybetűvel, kisbetűvel és számmal."`
- `common.passwordPolicyError` — en: `"Your password doesn't meet the requirements: at least {{min}} characters, with an uppercase letter, a lowercase letter and a number."` / hu: `"A jelszó nem felel meg a követelményeknek: legalább {{min}} karakter, nagybetűvel, kisbetűvel és számmal."`

Átírt kulcsok:

- `auth.register.failed` (`en.json:597` / `hu.json:597`) — en: `"Registration failed. Please check the form and try again."` / hu: `"A regisztráció sikertelen. Kérjük, ellenőrizze az űrlapot, és próbálja újra."` Az e-mail-címre való hivatkozásnak el kell tűnnie: `auth.routes.ts:131` óta a duplikált e-mail 201-et ad, tehát az az ok fizikailag nem tud idejutni.
- `auth.acceptInvite.failed` (`en.json:641` / `hu.json:641`) — en: `"Couldn't activate your account. Please check the form and try again."` / hu: `"A fiók aktiválása sikertelen. Kérjük, ellenőrizze az űrlapot, és próbálja újra."`

**10. Backend — egyetlen kommentsor.** `server/src/utils/passwordPolicy.ts:9` fölé egy sor, ami rögzíti, hogy a `src/utils/passwordPolicy.ts` tükrözi ezt az értéket, és változtatás esetén mindkettőt frissíteni kell. Logikai módosítás nincs; a backend viselkedése ebben a blockerben **nem** változik.

#### Tesztek

**Frontend: nincs teszt-harness, ezért manuális mátrix.** Az `src/` alatt nulla `*.test.tsx` van, és a gyökér `package.json` devDependencies-ében semmilyen futtató nincs (nincs vitest, jest, sem testing-library) — ez a blocker **nem** vezet be teszt-infrastruktúrát, az önálló feladat. Helyette az alábbi mátrixot kell végigfuttatni, nyitott DevTools Network fülnél, mert több esetnél az a lényeg, hogy *nem indul* kérés.

| # | Képernyő | Bemenet | Elvárt látható eredmény |
| --- | --- | --- | --- |
| 1 | Register | `short1A` | Natív böngésző-buborék a `minLength` miatt, submit blokkolva, **nincs** hálózati kérés. |
| 2 | Register | `abcdefghijkl` | Piros dobozban a lokalizált `common.passwordPolicyError`, **nincs** hálózati kérés, és a gomb visszaáll a normál feliratra (nem ragad "Signing up..."-on). |
| 3 | Register | `Abcdefghijk1` | Sikeres regisztráció; a mérő beírás közben `medium 4/5`, nem `weak`. |
| 4 | Register | `Abcdefghijklmnop1` (17 kar., speciális karakter nélkül) | A mérő `strong 5/5` — bizonyítja, hogy a "strong" elérhető speciális karakter nélkül. |
| 5 | Register | `Árvíztűrő12x` | A mérő nem jelöl hiányzó nagybetűt; a szerver elfogadja (Unicode-igazítás ellenőrzése). |
| 6 | Register | Ideiglenesen `PASSWORD_MIN_LENGTH = 6`-ra állítva a `src/utils/passwordPolicy.ts`-ben, majd `Abc1de` | A szerver **angol** üzenete jelenik meg szó szerint: "Password must contain: at least 12 characters, one uppercase letter, one lowercase letter and one number." Ez a service-réteg javításának egyetlen közvetlen bizonyítéka. **Utána a konstanst vissza kell állítani 12-re.** |
| 7 | Accept invite | `short1A` | Mint az 1. sor. Élő meghívó-link kell: owner fiókkal `POST /invites`, a válasz `inviteLink` mezőjét megnyitni. |
| 8 | Accept invite | `abcdefghijkl` | Mint a 2. sor, a gomb-visszaállással együtt. |
| 9 | Accept invite | 6. sor szerinti ideiglenes állítással | Mint a 6. sor — ez az `invites.service.ts` javításának bizonyítéka. |
| 10 | Accept invite | tetszőleges gépelés | Megjelent a szem-ikon és az erősségmérő (a `PasswordInput`-ra cserélés visszaigazolása), a mező mérete/stílusa egyébként változatlan. |
| 11 | Reset password | `abcdefghijkl` | Inline hibaüzenet a form **fölött**, a form továbbra is látszik és szerkeszthető; **nem** vált át az "errorTitle" / "Request a new link" képernyőre. |
| 12 | Reset password | két különböző jelszó | A `mismatch` üzenet jelenik meg (a policy-ellenőrzés nem előzte meg). |
| 13 | Reset password | lejárt/érvénytelen token + érvényes jelszó | Változatlanul a hibaképernyő a "Request a new link" linkkel — a meglévő viselkedés nem sérült. |
| 14 | Mindhárom | üres mező, beírás előtt | A követelmény-hint látszik a jelszó mező alatt. |
| 15 | Mindhárom | nyelvváltás magyarra, majd 2/8/11. eset megismétlése | Magyar hibaüzenet és magyar hint, a `{{min}}` helyén `12`. |
| 16 | Login | meglévő, 12 karakternél rövidebb régi jelszó | Sikeres bejelentkezés, nincs hint, nincs `minLength`. Ez a legfontosabb regressziós próba: a policy csak jelszó **beállítására** vonatkozik (`server/src/utils/passwordPolicy.ts:6-7`). |
| 17 | Fiók törlése / Cég archiválása | meglévő, 12 karakternél rövidebb régi jelszó | A megerősítő modál változatlanul elfogadja — a `DeleteAccountModal` és az `ArchiveCompanyModal` jelszómezője re-autentikáció, nem jelszóbeállítás. |
| 18 | — | `npm run build` a gyökérben | `tsc -b` és a Vite build hiba nélkül lefut (a `noUnusedLocals` miatt egy elfelejtett import is bukik). |

**Backend: két új fájl, a meglévő harness eszközeivel.** A `server/src/tests/helpers/factories.ts` a következőket adja, amit használni lehet: `TEST_PASSWORD` (`"Str0ng!Passw0rd"`), `createTenant()`, `authHeader(token)`, `createCompany`, `createReadOnlyCompany`, `createUser`, `createEmployee`, `createCustomer`, `createProject`, `createShift`, `createEmployeeUser`, `createDeveloper`; a `helpers/db.ts` egyetlen exportja a `resetDatabase()`. Ezeken kívül semmi mást ne feltételezz.

- **`server/src/tests/invites.test.ts` (új fájl).** Ma nincs teszt a `POST /invites/:token/accept` policy-ágára — a `planLimits.test.ts` csak a `POST /invites` létrehozást fedi (`:153-191`, a `describe("employee invitation limit")` blokk). Ez az a szerződés, amire a frontend a javítás után épít, tehát le kell fedni. Két eset:
  - *"rejects a password that fails the policy on invite accept"* — `createTenant()`, majd `POST /invites` az owner tokenjével (`authHeader(t.token)`), a válaszból a nyers `token` (a route `:117` sora `{ ...invitation, token, inviteLink }`-et ad vissza), végül `POST /invites/${inviteToken}/accept` `{ firstName, lastName, password: "short" }` törzzsel. Elvárás: `status === 400` és `res.body.error === PASSWORD_POLICY_MESSAGE` — a `PASSWORD_POLICY_MESSAGE`-t ugyanúgy a `../utils/passwordPolicy`-ból importálva, ahogy az `auth.test.ts:8` teszi.
  - *"accepts a policy-compliant password"* — ugyanaz a felépítés `TEST_PASSWORD`-del; elvárás `status === 201` és `res.body.token` létezik (a route `:269-270` sorai szerint).
- **`server/src/tests/passwordPolicy.test.ts` (új fájl, tripwire).** Tiszta unit teszt, DB-hozzáférés nélkül (a `tests/setup.ts` `beforeEach`-e ettől függetlenül minden fájlra lefut): `expect(PASSWORD_MIN_LENGTH).toBe(12)` és `expect(PASSWORD_POLICY_MESSAGE).toContain(String(PASSWORD_MIN_LENGTH))`. A fájl tetején kommentben: ha ez a teszt elbukik, a `src/utils/passwordPolicy.ts` frontend tükröt és a `common.passwordRequirements` / `common.passwordPolicyError` kulcsokat is frissíteni kell. Ez az egyetlen mechanizmus, ami a duplikációt CI-ben őrzi.

A meglévő `server/src/tests/auth.test.ts:72` és `:373` assertek változatlanul maradnak — ezek rögzítik a register és reset-password szerződést, amire a frontend most már ténylegesen támaszkodik.

#### Regressziós kockázat

- **Alacsony, de valós: meglévő felhasználók kizárása.** A javítás után a Register és az Accept invite képernyő 12 karaktert követel — ez már ma is a szerver viselkedése, tehát új elutasítás nem keletkezik, csak láthatóvá válik. A **bejelentkezés**, valamint a fiók-törlés és cég-archiválás megerősítő jelszómezője viszont soha nem validál erősséget (`account.routes.ts:57`: `bcrypt.compare`); a 16. és 17. manuális eset kifejezetten ezt őrzi. Ha a policy véletlenül a `LoginPage`-re vagy a két megerősítő modálra is átszivárogna, minden régi fiók kizáródna — ez lenne az egyetlen igazán súlyos elrontható dolog ebben a blockerben.
- **A `PasswordInput` csere az Accept invite oldalon.** Vizuális regresszió elvi lehetősége; a `DEFAULT_INPUT_CLASS` azonossága miatt gyakorlatilag kizárt, de a 10. manuális eset ellenőrzi. Figyelj rá, hogy a `value`/`onChange` kontrollált pár változatlan maradjon, különben a mező elveszti a beírt szöveget.
- **A korai `return` és a submit-flag.** A `RegisterPage` és az `AcceptInvitePage` a `setIsSubmitting(true)`-t a `try` blokkon kívül hívja, tehát egy rosszul elhelyezett policy-`return` után a `finally` nem fut le és a gomb beragad. A 2. és 8. manuális eset ezt explicit ellenőrzi.
- **A `passwordStrength.ts` szintezés átírása.** A `PasswordStrengthMeter` egyetlen fogyasztó (`grep` szerint sehol máshol nem importálódik a `getPasswordStrength`), tehát a hatókör zárt. A `score` továbbra is 0-5, így a `(score/5)` kijelzés és a 3 sávos renderelés érintetlen — ha valaki a skálát 4-re csökkenti, a mérő szövege hazudni fog.
- **i18n kulcsszerkezet-elcsúszás.** Az `src/i18n/index.tsx` a hiányzó kulcsra az `en` szótárra esik vissza, majd magára a kulcsnévre — tehát egy elfelejtett `hu.json` kulcs nem crashel, csak angolul (vagy nyers kulcsnévként) jelenik meg. Emiatt a 15. manuális eset nem opcionális.
- **Elfogadott maradék:** a `ResetPasswordPage` továbbra is a zsákutca hibaképernyőre vált, ha a szerver utasít el egy jelszót, amit a kliens átengedett. A submit előtti ellenőrzés ezt a gyakorlatban megszünteti, a teljes megoldás (backend hibakód, és csak token-hibánál hard fail) viszont a backend válaszformátumát érintené — **kifejezetten kívül esik a B3 hatókörén.**
- A `tsconfig.app.json`-ban nincs `"strict"` kulcs, tehát a fordító itt kevesebbet fog el, mint amennyit egy szigorú beállításnál elkapna. Ne támaszkodj a típusellenőrzésre a `catch (err)` ágak helyességénél — a `err instanceof Error` szűkítést mindhárom helyen ki kell írni.

#### Kész, ha

- [ ] Létezik `src/utils/passwordPolicy.ts`, és a `12`-es szám az egész `src/` fában **kizárólag** ebben az egy fájlban szerepel literálként (`grep -rn "12" src/` alapján ellenőrizve a releváns kontextusban).
- [ ] `grep -rn "minLength" src/` már nem ad `minLength={6}` találatot; mindhárom új-jelszó képernyő `PASSWORD_MIN_LENGTH`-t használ, a `LoginPage` és a két megerősítő modál pedig továbbra sem kap `minLength`-et.
- [ ] `src/services/auth.service.ts` `register()` és `src/services/invites.service.ts` `acceptInvite()` kiolvassa a válasz `error` mezőjét, a `:48-49`, illetve `:23-24` mintája szerint.
- [ ] `RegisterPage.tsx` és `AcceptInvitePage.tsx` catch blokkja kötött hibaobjektumot használ és a szerver üzenetét jeleníti meg, az i18n kulcs csak fallback — a meghívó-oldalon a saját `auth.acceptInvite.failed` kulcsával.
- [ ] Mindhárom képernyőn látszik a követelmény-hint, és mindhárom `handleSubmit` a hálózati hívás **és** a `setIsSubmitting(true)` előtt ellenőrzi a policyt.
- [ ] `AcceptInvitePage` jelszó mezője `PasswordInput`, szem-ikonnal és erősségmérővel, a hozzá tartozó importtal.
- [ ] `getPasswordStrength("Abcdefghijk1")` legalább `medium`, `getPasswordStrength("Abcdefghijklmnop1")` `strong`, `getPasswordStrength("abcdefghijkl")` `weak`; `"Árvíztűrő12x"` nem jelöl hiányzó nagybetűt.
- [ ] `auth.register.failed` egyik nyelvi fájlban sem hivatkozik e-mail-címre; a négy érintett kulcs (2 átírt + 2 új) mindkét szótárban azonos szerkezettel megvan.
- [ ] `server/src/utils/passwordPolicy.ts:9` fölött ott a kereszthivatkozó komment.
- [ ] `server/src/tests/invites.test.ts` és `server/src/tests/passwordPolicy.test.ts` létezik és zölden fut; a teljes backend suite (benne `auth.test.ts:72` és `:373`) továbbra is zöld.
- [ ] A 18 soros manuális mátrix minden sora végigfuttatva, a 6. és 9. sor ideiglenes konstans-módosítása **visszaállítva** (`git diff` üres a `src/utils/passwordPolicy.ts` mérési célú részére nézve).
- [ ] `npm run build` a gyökérben és `npm run lint` hiba nélkül lefut.

#### Nyitott kérdések (implementáláskor eldöntendő)

- A kliensoldali validátor mennyit tükrözzön: a tervezet a teljes predikátumot átmásolja (hossz + Unicode kis-/nagybetű + számjegy + trim). Elfogadható alternatíva, hogy csak a minimális hosszt tükrözzük kliensen, és minden más szabálynál a szerver üzenetére hagyatkozunk — kevesebb duplikáció, cserébe magyar felhasználó angol hibaüzenetet lát a gyakoribb esetekben is.
- A 'strong' szint bónusz-küszöbe (jelenlegi javaslat: hossz >= PASSWORD_MIN_LENGTH + 4 VAGY speciális karakter) tetszőleges. A +4 és a speciális karakter regex (/[^\p{L}\p{Nd}]/u, ami a szóközt is speciálisnak számolja) UX-döntés, nem biztonsági — implementáláskor finomítható.
- A követelmény-hint mint külön PasswordRequirements komponens vs. egy showRequirements prop a PasswordInput-on. A terv a külön komponenst választja (ResetPasswordPage két inputja és a LoginPage miatt), de a prop-alapú megoldás is védhető, ha a ResetPasswordPage csak az első mezőn adja át.
- A ResetPasswordPage status='error' zsákutcája (a form eltűnik minden szerverhiba esetén) a submit előtti ellenőrzéssel gyakorlatilag elkerülhető, de nem szűnik meg. Külön eldöntendő, hogy ez saját blocker/follow-up legyen-e, backend hibakóddal (csak token-hibánál hard fail).
- A PASSWORD_POLICY_MESSAGE angol-only marad. Külön döntés, hogy a backend adjon-e strukturált error code-ot a lokalizációhoz — ez a B3-ban szándékosan nincs benne, mert megváltoztatná a auth.test.ts:72 és :373 által rögzített válaszszerződést.
- A frontend teszt-harness (vitest + testing-library) bevezetése és a tsconfig.app.json 'strict' bekapcsolása külön feladat marad. Eldöntendő, hogy v1.0 előtt vagy után kerüljön sorra — enélkül a B3 javítása kizárólag manuálisan verifikálható és regresszió ellen nincs automatikus védelme.

---

### B1 — Offboarding: külön "hozzáférés visszavonása" művelet (~0,5–1 nap)

*Súlyosság: kritikus (biztonsági). Ma egy távozó munkavállaló korlátlan ideig megtartja a teljes belépését — nem csak a régi tokenjét tudja használni, hanem frissen be is tud jelentkezni —, és a tulajdonosnak nincs egyetlen olyan gombja sem, amivel ezt elvenné. Megvalósítási sorrend: 4.*

#### Mi a hiba

Az `Employee` rekordnak nincs semmilyen offboarding-oszlopa. A `server/prisma/schema.prisma:172` szerint a `status` egy szabad szöveges `String @default("Active")` — nem enum —, és az `Employee` modellben (`schema.prisma:164-191`) nincs sem `active`, sem `deletedAt`, ellentétben a `Company` (`schema.prisma:84-85`) és a `User` (`schema.prisma:140-141`) modellel.

A visszavonás **mechanizmusa viszont már készen van**, csak nincs hozzá művelet:

- `schema.prisma:140` `User.active Boolean @default(true)` — a login elutasításra kerül, ha `false`.
- `schema.prisma:136` `User.tokenVersion Int @default(0)` — a session-kill kapcsoló (K2.1.2).
- `server/src/middleware/auth.middleware.ts:71-81` minden kérésnél lekérdezi a `{ active, tokenVersion, company: { active } }` hármast; a `:83` sorban `if (!user || !user.active)` → 401, a `:117` sorban a `tokenVersion` eltérés → 401.
- `server/src/routes/auth.routes.ts:217-220` a friss bejelentkezésnél csak a `User`-t és a `company.active`-ot olvassa, `Employee` join nélkül — a `:260` sorban viszont ellenőrzi a `user.active`-ot.

Tehát egyetlen `User.update({ active: false, tokenVersion: { increment: 1 } })` egyszerre öli meg az összes kint lévő JWT-t és a jövőbeli bejelentkezést. **Prisma migráció nem kell.**

Fontos árnyalat: a `DELETE /employees/:id` **már ma helyesen von vissza hozzáférést** — a `server/src/routes/employees.routes.ts:110-112` a tranzakción belül kitörli a kapcsolt `User`-t. A rés pontosan és kizárólag a 409-es ág: a `employees.routes.ts:95-100` visszautasítja a törlést, ha van munkaidő-előzmény, és az üzenete így szól:

```
"This employee has shift history and can't be deleted. Set their status instead of removing them."
```

Ez a mondat a tulajdonost egy **nulla auth-hatású** művelethez küldi. A `PUT /employees/:id/status` (`employees.routes.ts:65-75`) csak egy szöveges mezőt ír át, a belépésre semmilyen hatással nincs. Éles környezetben minden munkavállalónak van munkaidő-előzménye, tehát a gyakorlatban **minden valós offboarding a 409-es ágon köt ki**, és a rendszer aktívan félrevezeti a tulajdonost.

Éles környezetben minden `Employee`-hez pontosan egy EMPLOYEE szerepkörű `User` tartozik: a `server/src/routes/invites.routes.ts:223-244` (invite-accept) az egyetlen létrehozási út, és ezt a `employees.routes.ts:20-22` illetve a frontend `src/services/employee.service.ts:15-17` is állandó termékszabályként rögzíti. A kapcsolat viszont sémaszinten opcionális (`schema.prisma:149` `employeeId Int? @unique`, `schema.prisma:178` `user User?`), és a teszt-harness `server/src/tests/helpers/factories.ts:89-98` `createEmployee` függvénye **User nélküli** `Employee`-t hoz létre — a handlernek tehát tolerálnia kell az `employee.user == null` esetet.

**Jóváhagyott döntés: (A) opció — külön, explicit "revoke access" művelet.** NEM új `Inactive` employee-státusz. Indoklás, amit a kódban is rögzíteni kell: az `Employee.status` ma szabad szöveges mező, amit két validálatlan endpoint ír (`employees.routes.ts:34` `EMPLOYEE_WRITABLE_FIELDS` és `employees.routes.ts:65-75`), és a felületen egy megerősítés nélküli inline `<select>`-ként jelenik meg (`src/pages/EmployeesPage.tsx:238-246` és `:300-313`). Ha erre a mezőre visszafordíthatatlan biztonsági mellékhatást akasztunk, az offboarding **egyetlen véletlen kattintás** lesz. Az (A) opció ezen felül megspórolja a státusz-validáció bevezetését, a UI státusz-szűrőt, az ehhez tartozó i18n kulcsokat és egy seat-számolási döntést is. A státusz-legördülő tiszta *elérhetőségi* vezérlő marad.

#### Érintett fájlok

| Fájl | Sor | Mi történik |
| --- | --- | --- |
| `server/src/routes/employeeAccess.routes.ts` | új fájl | Az új router: `POST /:id/revoke`, `requireRole(BUSINESS_OWNER, DEVELOPER)`, typed confirmation, `User` letiltás + tombstone + `tokenVersion` bump, audit. |
| `server/src/app.ts` | új sor a `174` (`/subscription`) mellé, a `tenantWrite` blokkon kívül | `app.use("/employee-access", authMiddleware, employeeAccessRoutes)` — szándékosan `tenantWrite` **nélkül**. |
| `server/src/routes/employees.routes.ts` | `11-18` | `GET /` mostantól `include: { user: { select: { active: true } } }`, és a válaszban a nested `user` helyett egy származtatott `accessRevoked: boolean` megy ki. |
| `server/src/routes/employees.routes.ts` | `96-99` | A 409-es hibaüzenet átírása: a `status` helyett a revoke műveletre mutasson. |
| `server/src/constants/auditActions.ts` | a `19` sor (`COMPANY_ARCHIVED`) után, még a `20` sor `} as const;` előtt | Új bejegyzés: `EMPLOYEE_ACCESS_REVOKED: "EMPLOYEE_ACCESS_REVOKED"`. |
| `server/src/services/audit/authAudit.ts` | a `37` sor után, az `AuthEvent` zárt halmazba | Új esemény: `EMPLOYEE_ACCESS_REVOKED: "EMPLOYEE_ACCESS_REVOKED"`. |
| `server/src/routes/dashboard.routes.ts` | `54` | Az `activeEmployees` KPI ne számolja a visszavont hozzáférésű munkavállalót. |
| `src/types/employee.ts` | a `7` sor után | Új opcionális mező: `accessRevoked?: boolean`. A `status` marad `string` (nem union) — az B1-en kívül esik. |
| `src/services/employee.service.ts` | az `55` sor után | Új `revokeEmployeeAccess(id, confirmation)` hívó. |
| `src/components/employees/RevokeAccessModal.tsx` | új fájl | Megerősítő modal beírandó szöveggel (a meglévő `ConfirmModal` nem tud input mezőt, lásd `src/components/ui/ConfirmModal.tsx:4-12`). |
| `src/pages/EmployeesPage.tsx` | `132-158` | A `getStatusBadge` mellé egy külön `getAccessBadge` — a státusz és a hozzáférés két független tengely. |
| `src/pages/EmployeesPage.tsx` | `248-262` és `316-334` | Új "Hozzáférés visszavonása" gomb a mobil kártya és a desktop táblázat művelet-sávjába. |
| `src/pages/EmployeesPage.tsx` | `357-365` mellé | Az új `RevokeAccessModal` bekötése (`employeeToRevoke` state). |
| `src/i18n/hu.json` | `employees` blokk, `134-156` | Új kulcsok (lista lentebb). |
| `src/i18n/en.json` | ugyanaz a blokk (`134-156`) | Ugyanazok a kulcsok angolul. |
| `server/src/tests/employeeOffboarding.test.ts` | új fájl | A teljes lefedettség. |
| `server/prisma/schema.prisma` | — | **Nem változik.** Nincs migráció. |

#### Tervezett változtatás

**1. Az új endpoint és a mount (read-only döntés)**

Endpoint: `POST /employee-access/:id/revoke`, szerepkör `BUSINESS_OWNER` és `DEVELOPER` (a `router.use(requireRole(...))` mintát a `employees.routes.ts:9` adja).

A `/employees` prefix a `app.ts:169` sorban `tenantWrite = [authMiddleware, blockWritesWhenReadOnly]` mögött van (`app.ts:167`). Ha a revoke oda kerülne, egy lejárt előfizetésű cég **nem tudná kirakni a távozó dolgozót** — egy biztonsági kontrollt nem szabad fizetőfal mögé tenni. Ezért az új router **saját, külön prefixet kap**, `tenantWrite` nélkül, pontosan a `/company/archive` (`app.ts:182-186`) és a `/subscription` (`app.ts:174`) precedens szerint.

Elvetett alternatíva, amit rögzíteni kell: egy második `app.use("/employees", authMiddleware, employeeAccessRoutes)` mount a `169` sor **elé**. Ez működne (a nem illeszkedő router `next()`-tel továbbenged), és szebb URL-t adna, de minden `/employees` kérésre **kétszer futtatná az `authMiddleware`-t**, azaz megduplázná a `auth.middleware.ts:71` DB-lekérdezést a legforgalmasabb listaútvonalon. Ezért nem ezt választjuk.

**2. A megerősítési ceremónia**

A `account.routes.ts:39-67` (a `39` sorban a `"DELETE"` begépelése, az `57-67` sorokban a jelszó-ellenőrzés) és a `companyArchive.routes.ts:42-56` (a `42-46` sorban a `"ARCHIVE"`, az `53-56` sorban a jelszó) precedens a legnehezebb változat. Itt **könnyebb kell**: `{ confirmation: "REVOKE" }` a body-ban, **jelszó nélkül**.

Indoklás: a jelszó-újrakérés ott azt védi, hogy egy ellopott tokennel ne lehessen a *hívó saját* fiókját vagy az egész céget visszafordíthatatlanul kilőni. A revoke egyetlen másik felhasználót érint, és visszafordítható (a tulajdonos újra meg tudja hívni — lásd a 4. pontot); ráadásul sürgős HR-művelet, amit egy jelszó-prompt aktívan elodáz. A begépelt kulcsszó viszont marad, mert pontosan azt a "véletlen egy kattintás" hibamódot zárja ki, ami miatt a (B) opciót elvetettük.

```ts
const CONFIRMATION_TEXT = "REVOKE";
```

Hibás vagy hiányzó confirmation → `400`, `{ error: 'Please type "REVOKE" to confirm.' }` (szó szerint a `account.routes.ts:46-48` formátuma).

**3. A handler ellenőrzési sorrendje és a tranzakció tartalma**

1. `const employeeId = Number(req.params.id)` — ha nem `Number.isInteger`, `400`.
2. `confirmation` ellenőrzés → `400`. (Előbb, mint a DB-hívás — így a hibás kérés nem is terheli az adatbázist, és a `account.routes.ts:39` sorrendjét követi.)
3. `prisma.employee.findFirst({ where: { id: employeeId, ...companyScope(req) }, include: { user: true } })` → ha nincs, `404` `{ error: "Employee not found" }`. A `companyScope` (`server/src/utils/scope.ts`) DEVELOPER esetén `{}`-t ad, tehát egy DEVELOPER bármelyik tenant dolgozóját visszavonhatja — ez megegyezik a mai `DELETE /employees/:id` viselkedésével, szándékos.
4. `if (!employee.user)` → `409` `{ error: "This employee has no login to revoke." }`. Ez a `factories.ts:89-98` `createEmployee`-je által gyártott (és bármilyen legacy) User nélküli sor esete — nem hiba, csak nincs mit visszavonni.
5. `if (!employee.user.active)` → `409` `{ error: "Access has already been revoked." }`, a `companyArchive.routes.ts:64` "already archived" mintájára. Így a `tokenVersion` nem inkrementálódik feleslegesen kétszer.
6. Az írás — **egyetlen sor frissítése, ezért `$transaction` nem szükséges**:

```ts
const now = new Date();
const tombstoneEmail = `revoked+${employee.user.id}+${now.getTime()}__${employee.user.email}`;

await prisma.user.update({
  where: { id: employee.user.id },
  data: {
    active: false,
    deletedAt: now,
    email: tombstoneEmail,
    tokenVersion: { increment: 1 },
  },
});
```

Az `Employee` sorhoz **hozzá sem nyúlunk**: sem a `status`, sem más mező nem változik, a `Shift` és `ProjectAssignment` rekordok érintetlenek maradnak. Ez a lényeg — a munkaidő-előzmény megmarad, csak a belépés hal meg.

7. Audit — mindkét csatorna kell (a `logAudit` a maradandó, `/admin/logs`-ban látszó nyom, a `logAuthEvent` a strukturált konzol-stream), pontosan úgy, ahogy a `account.routes.ts:122-139` teszi:

```ts
await logAudit({
  action: AUDIT_ACTIONS.EMPLOYEE_ACCESS_REVOKED,
  userId: req.user!.userId,
  companyId: req.user!.companyId,
  metadata: { employeeId, revokedUserId: employee.user.id },
});

logAuthEvent(AuthEvent.EMPLOYEE_ACCESS_REVOKED, {
  req,
  level: "WARN",
  result: "success",
  userId: req.user!.userId,
  companyId: req.user!.companyId,
  role: req.user!.role,
  reason: "employee_access_revoked",
});
```

Figyelem: az `AuthAuditContext` (`authAudit.ts:44-57`) **zárt típus** — csak `req`, `level`, `result`, `userId`, `companyId`, `role`, `email`, `reason` adható át, `metadata` mezője nincs. Az `employeeId` / `revokedUserId` páros ezért kizárólag a `logAudit` `metadata`-jába kerülhet, különben nem fordul le.

8. `return res.json({ revoked: true })` — a `account.routes.ts:141` `{ deleted: true }` / `companyArchive.routes.ts:78` `{ archived: true }` konvenció szerint.

**4. Tombstone döntés: IGEN, tombstone-özni kell**

Ha a `User.email` marad az eredeti, akkor az `invites.routes.ts:207-213` (`findUnique({ where: { email: invitation.email } })` → `409 "Email already in use"`) **örökre megakadályozza**, hogy ugyanazt a személyt ugyanarra a címre újra meghívjuk. Egy visszavett munkavállaló, vagy egy tévedésből visszavont hozzáférés így javíthatatlan lenne. Ezért a `account.routes.ts:99` mintáját másoljuk, `revoked+` prefixszel.

A kompromisszum, amit vállalunk: a `User` soron elvész az olvasható e-mail cím. Ez itt **kockázatmentesebb, mint a fióktörlésnél**, mert az eredeti cím megmarad a `Employee.email` mezőben (`schema.prisma:170`), amihez hozzá sem nyúlunk — az adat tehát nem vész el, csak a `User` sorról költözik át. Mellékhatás, amit tudni kell: a DEVELOPER admin-listákban (`admin.routes.ts:26-39` `/admin/users`) a visszavont felhasználó tombstone-os címmel jelenik meg (kozmetikai).

Következmény, amit dokumentálni kell: az újra-meghívás a `invites.routes.ts:223` szerint **új `Employee` sort hoz létre**, tehát a visszavett ember nem kapcsolódik vissza a régi munkaidő-előzményéhez. Ez az invite-flow adottsága, B1-ben nem javítjuk.

**5. `GET /employees` — kötelező hatókör, nem opcionális**

Az (A) opcióban az `Employee`-n nincs hova felírni a visszavont állapotot, tehát azt a `user` relációból kell származtatni. A `employees.routes.ts:11-18` viszont csupasz `Employee` sorokat ad vissza, reláció nélkül — a frontend így **nem tudná megmutatni, ki van visszavonva**. Ezért ez a route-változtatás a B1 része:

```ts
const rows = await prisma.employee.findMany({
  where: companyScope(req),
  orderBy: { id: "desc" },
  include: { user: { select: { active: true } } },
});

return res.json(
  rows.map(({ user, ...employee }) => ({
    ...employee,
    accessRevoked: user ? !user.active : false,
  })),
);
```

Két dolog kritikus:

- A nested `user` objektum **soha nem kerülhet ki a válaszba** — csak a származtatott boolean. Így semmilyen `User` oszlop (tombstone-os e-mail, `tokenVersion`) nem szivárog a kliensnek.
- `user == null` → `accessRevoked: false`. Akinek nincs belépése, annak nincs mit visszavonni; a "visszavonva" jelölés itt hazugság lenne.

**6. A 409-es üzenet javítása (`employees.routes.ts:96-99`)**

```
"This employee has shift history and can't be deleted. Revoke their access instead — that disables their login and keeps the shift history."
```

Megjegyzés: ezt a szerver-oldali angol szöveget a `src/services/employee.service.ts:53` dobja tovább, és a `src/pages/EmployeesPage.tsx:109-113` szó szerint toast-ként mutatja egy egyébként i18n-elt felületen. Ez **meglévő** inkonzisztencia; B1-ben nem oldjuk meg, de a frontend a 409-et felismerve inkább egy i18n-elt üzenetet mutasson, ami felajánlja a revoke gombot.

**7. Frontend**

- `src/types/employee.ts`: `accessRevoked?: boolean` hozzáadása.
- `src/services/employee.service.ts`: új `revokeEmployeeAccess(id: number, confirmation: string)` az `apiFetch` + `authHeaders()` mintára (`POST ${API_URL}/employee-access/${id}/revoke`), hiba esetén a body `error` mezőjét dobja tovább, ahogy a `deleteEmployee` (`:51-54`) is teszi.
- `src/components/employees/RevokeAccessModal.tsx` (új): a `Modal` komponensre épül (`src/components/ui/Modal.tsx:1-6`, props: `open`, `title`, `children`, `onClose`), egy szöveges inputtal; a "Visszavonás" gomb csak akkor engedélyezett, ha a beírt érték pontosan `REVOKE`. A meglévő `ConfirmModal` nem használható, mert nincs benne input mező (`ConfirmModal.tsx:4-12`).
- `src/pages/EmployeesPage.tsx`: `employeeToRevoke` state, `confirmRevoke` handler (siker után `triggerToast(t("employees.accessRevoked"))` + `loadEmployees()`), gomb mindkét elrendezésben. Ha `employee.accessRevoked === true`, a gomb helyett a jelölő badge jelenjen meg.
- **A revoke gombra NEM kerül `{...guardProps}`** (`src/hooks/useWriteGuard.ts`) — mivel az endpoint read-only módban is működik, a gombot sem szabad letiltani. Ezt kommentben rögzíteni kell, különben egy későbbi "minden write gombra tegyünk guardot" takarítás visszahozza a hibát.
- A `getStatusBadge` (`:132-158`) változatlan marad; mellé egy külön `getAccessBadge`, ami csak `accessRevoked === true` esetén rendel egy piros "Hozzáférés visszavonva" badge-et.
- i18n kulcsok mindkét fájlba (`src/i18n/hu.json` és `src/i18n/en.json`), az `employees` blokkba (`134-156` mindkettőben), a meglévő `{{name}}` interpolációs konvenció szerint (`hu.json:148`): `revokeAccess`, `revokeTitle`, `revokeMessage`, `revokeConfirmPlaceholder`, `accessRevoked`, `accessRevokedBadge`, `revokeFailed`, `deleteBlockedRevokeInstead`.

**8. A három "a status-t senki nem nézi" következmény — mi van benne és mi nincs**

| Következmény | Döntés | Miért |
| --- | --- | --- |
| Dashboard KPI (`dashboard.routes.ts:54`) | **BENNE van** | A `status` érintetlen marad, tehát a visszavont ember továbbra is `"Active"` — az "Aktív munkavállalók" KPI hazudna, és a tulajdonos azt hinné, a visszavonás nem működött. Olcsó javítás. |
| Seat-számolás (`server/src/utils/planLimits.ts:39`, `server/src/routes/subscription.routes.ts:45`) | **HALASZTVA** | Számlázási döntés, ami két hívási helyet érint, és a kettőt csak együtt szabad módosítani, különben a felület "3/5 hely"-et mutat, miközben a létrehozás már tilt. Biztonsági következménye nincs. |
| Beoszthatóság (`shifts.routes.ts:164` és `:216`, `projects.routes.ts:172`, plusz a `src/components/shifts/ShiftForm.tsx:75-89`, `src/components/projects/AssignEmployeeModal.tsx:29-42` és `src/pages/OwnerCommandCenterPage.tsx:118-124` szűretlen legördülői) | **HALASZTVA, teljesen** | Nincs biztonsági kitettség: a visszavont ember egyáltalán nem tud belépni, tehát egy neki felvett műszakot vagy hozzárendelést sosem lát. A tiltás viszont **elrontaná a jogos utólagos rögzítést** (a távozás előtt ledolgozott műszakok könyvelését). A helyes megoldás — múltbeli dátum engedve, jövőbeli tiltva — egy dátumszabályt igényel, ami ma nem létezik. |

A KPI javítása (`dashboard.routes.ts:54`) úgy, hogy a belépés nélküli munkavállalók továbbra is számítsanak:

```ts
prisma.employee.count({
  where: {
    ...scope,
    status: "Active",
    OR: [{ user: { is: null } }, { user: { is: { active: true } } }],
  },
}),
```

A halasztott tételeket fel kell venni a launch utáni backlogbe, és a seat-viselkedést (a visszavont dolgozó **továbbra is fogyaszt egy fizetett helyet**, sőt az újra-meghívás a `isEmployeeLimitReached` `employee.count`-ja miatt egy továbbit) a kiadási jegyzetbe.

#### Tesztek

Új fájl: **`server/src/tests/employeeOffboarding.test.ts`**.

A harness adottságai, amikre építeni lehet: a `server/src/tests/setup.ts` minden teszt előtt `resetDatabase()`-t és `resetRateLimiters()`-t futtat, tehát nincs szükség saját takarításra. A `server/src/tests/helpers/factories.ts`-ből használható: `createTenant()` (cég + owner + token + egy `Employee` + egy `Customer` + egy `Project` — mind a öt vissza is jön), `createEmployee(companyId, overrides)` (**User nélküli** `Employee` — a 6. eset), `createEmployeeUser(companyId, employeeId)` (`{ user, token }`, EMPLOYEE szerepkörű login), `createShift(employeeId, overrides)`, `createReadOnlyCompany()`, `createDeveloper()`, `authHeader(token)` és a `TEST_PASSWORD` konstans. A read-only tenant felépítésének mintája a `server/src/tests/readOnlyMode.test.ts:18-22` `lapsed()` helper.

1. **Sikeres visszavonás** — `POST /employee-access/:id/revoke` `{ confirmation: "REVOKE" }` owner tokennel → `200`, body `{ revoked: true }`; a `prisma.user.findUnique` szerint `active === false`, `deletedAt !== null`, `tokenVersion === 1`, és az `email` már nem az eredeti.
2. **A kint lévő token azonnal meghal** — `createEmployeeUser` tokenjével a revoke ELŐTT `GET /shifts/me` (`shifts.routes.ts:44`, `requireRole(EMPLOYEE)`) → `200`; a revoke UTÁN ugyanaz a token → `401`.
3. **Friss bejelentkezés is tilos** — revoke után `POST /auth/login` az eredeti e-maillel és `TEST_PASSWORD`-del → `401` `{ error: "Invalid credentials" }`.
4. **Az e-mail felszabadul (tombstone)** — revoke után `prisma.user.findUnique({ where: { email: eredetiEmail } })` → `null`. Ez bizonyítja, hogy az `invites.routes.ts:207` duplikátum-ellenőrzése már nem talál rá, tehát újra meg lehet hívni.
5. **Hiányzó / hibás confirmation** — `{}` és `{ confirmation: "revoke" }` (kisbetű) → `400`, és a `User.active` továbbra is `true`, `tokenVersion` továbbra is `0`.
6. **Nincs belépés** — `createEmployee(company.id)` (User nélkül) → `409`, nincs 500-as hiba.
7. **Már visszavonva** — kétszeri hívás: a második `409`, és a `tokenVersion` **1** marad, nem lesz 2.
8. **Tenant-izoláció** — két `createTenant()`; az A tenant ownere a B tenant munkavállalójára hívja → `404`, és B `User`-e érintetlen (`active === true`).
9. **Szerepkör** — egy `createEmployeeUser`-ből származó EMPLOYEE token hívja a revoke-ot → `403` (`role.middleware.ts`).
10. **Read-only cégben is működik** — lejárt trial-ű tenant ownere revoke-ol → `200`.
11. **Read-only regresszió (fontos)** — ugyanabban a lejárt trial-ű cégben `PUT /employees/:id/status` továbbra is `403`, a body `error` mezője `READ_ONLY_ERROR` (`server/src/middleware/readOnly.middleware.ts:21`). Ezt bizonyítja, hogy az új mount nem vette le a guardot a `/employees` routerről. A `readOnlyMode.test.ts` ma **nem** tesztel `/employees` írást, tehát ez új lefedettség.
12. **`GET /employees` mező** — a válaszban a visszavont sorra `accessRevoked === true`, a normálisra `false`, a User nélkülire `false`, és egyik soron sincs `user` kulcs (`expect(res.body[0]).not.toHaveProperty("user")`).
13. **Az `Employee` sor túléli** — revoke után az `Employee` továbbra is létezik, a `status` változatlan (`"Active"`), és a `createShift`-tel felvett műszakok száma nem változott.
14. **A 409-es törlési üzenet** — `createShift` után `DELETE /employees/:id` → `409`, és az üzenet már nem tartalmazza a `"Set their status"` szövegrészt, viszont tartalmazza a `"Revoke"` szót.
15. **Dashboard KPI** — owner tokennel `GET /dashboard`; a `res.body.kpis.activeEmployees` a revoke után eggyel kevesebb, de a User nélküli `Employee`-t továbbra is beszámolja.

#### Regressziós kockázat

- **A legnagyobb kockázat: a read-only guard véletlen leszedése.** Ha az új router mégis a `/employees` prefixre kerülne, vagy valaki a `blockWritesWhenReadOnly`-ba tenne útvonal-kivételt, az egész employee-router írásvédelme elveszhet. A 11. teszt pontosan ezt fogja meg. A `app.ts:155-166` kommentje kifejezetten a mount-alapú érvényesítés mellett érvel — a middleware-be tett kivétel ezt sértené.
- **`GET /employees` válaszalak-változás.** Az `EmployeeEditModal` nem szórja vissza a listából kapott objektumot: a `EmployeeEditModal.tsx:52` `updateEmployee(employee.id, {...})` hívása öt konkrét mezőt küld (`firstName`, `lastName`, `phone`, `email`, `status`), tehát az `accessRevoked` el sem jut a `PUT /employees/:id` body-jáig; ha mégis odakerülne, a `employees.routes.ts:34-45` `EMPLOYEE_WRITABLE_FIELDS` allow-list csendben eldobja. Ellenőrizve, nem regresszió — de ha a `user` objektum kikerülne a válaszba, az már valódi adatszivárgás lenne.
- **Extra JOIN a listán.** Az `include` egy join-t tesz a legforgalmasabb employee-lekérdezésre. A `User.employeeId` `@unique` (`schema.prisma:149`), tehát indexelt; a `@@index([companyId, status])` (`schema.prisma:190`) használata változatlan.
- **Tombstone-ölt e-mail az admin felületeken.** A DEVELOPER admin/analytics listák a `User.email`-t mutatják (`admin.routes.ts:26-39`), ott a `revoked+...` prefix fog megjelenni. Kozmetikai, de meglepetés lehet.
- **DEVELOPER hatókör.** A `companyScope` DEVELOPER esetén `{}` — egy platform-operátor bármelyik tenant dolgozóját visszavonhatja. Ez a `DELETE /employees/:id` mai viselkedésével azonos, de most tudatos döntésként rögzítjük.
- **Amit *nem* rontunk el:** mivel az `Employee` sorhoz nem nyúlunk, a műszak-lista `include: { employee: true }` join-ja (`shifts.routes.ts:16-21`) továbbra is kiírja a visszavont ember nevét a történeti rekordokon. Ez a kívánt viselkedés.

#### Kész, ha

- [ ] `POST /employee-access/:id/revoke` létezik, `BUSINESS_OWNER` + `DEVELOPER` jogosultsággal, és `{ confirmation: "REVOKE" }`-t követel.
- [ ] A művelet a kapcsolt `User`-en beállítja: `active: false`, `deletedAt`, tombstone-olt `email`, `tokenVersion: { increment: 1 }` — és az `Employee` sort, a műszakokat és a hozzárendeléseket érintetlenül hagyja.
- [ ] Prisma migráció **nem** készült; a `schema.prisma` változatlan.
- [ ] User nélküli `Employee` esetén `409`, nem 500; már visszavont esetén `409` és nincs második `tokenVersion` bump.
- [ ] `GET /employees` minden soron visszaad egy `accessRevoked` booleant, és **soha** nem küld ki nested `user` objektumot.
- [ ] Az endpoint read-only (lejárt előfizetésű) cégben is működik, miközben a `PUT /employees/:id/status` ugyanott továbbra is `403 READ_ONLY_MODE`.
- [ ] A `employees.routes.ts` 409-es törlési üzenete a revoke műveletre mutat, nem a státusz átállítására.
- [ ] Az `EmployeesPage` mindkét elrendezésében (mobil kártya + desktop tábla) van visszavonás gomb, beírandó megerősítéssel, és a már visszavont sorokon badge jelenik meg gomb helyett; a gomb read-only módban **nincs** letiltva.
- [ ] `AUDIT_ACTIONS.EMPLOYEE_ACCESS_REVOKED` és `AuthEvent.EMPLOYEE_ACCESS_REVOKED` létezik, és a művelet mindkettőt írja — az `employeeId`/`revokedUserId` páros a `logAudit` `metadata`-jában, nem a `logAuthEvent` kontextusában.
- [ ] A dashboard `kpis.activeEmployees` nem számolja a visszavont hozzáférésűeket, de a belépés nélküli `Employee`-ket igen.
- [ ] Az i18n kulcsok **mindkét** nyelvi fájlban (`hu.json`, `en.json`) megvannak.
- [ ] A `server/src/tests/employeeOffboarding.test.ts` 15 esete zöld, és a teljes szerveroldali suite is zöld.
- [ ] A halasztott tételek (seat-számolás, beoszthatóság) fel vannak véve a launch utáni backlogbe, és a "visszavont dolgozó továbbra is fogyaszt egy helyet" tény szerepel a kiadási jegyzetben.

#### Nyitott kérdések (implementáláskor eldöntendő)

- A megerősítés erőssége: a terv jelszó nélküli, begépelt `REVOKE` kulcsszót ír elő. Ha a launch előtti fenyegetésmodell az ellopott owner-tokent is ide sorolja, a `companyArchive.routes.ts` mintájára jelszót is kérni kell — ez viszont sürgős HR-műveletnél súrlódás.
- Kell-e rate limit a revoke endpointra? A `RATE_LIMITS` (`server/src/constants/rateLimits.ts`) ma csak azokat a végpontokat védi, amelyek jelszót vagy tokent ellenőriznek. Jelszó nélküli revoke esetén nincs oracle-kockázat, de egy elrabolt owner-token tömeges offboardingot tudna futtatni.
- Az újra-meghívás új `Employee` sort hoz létre (`invites.routes.ts:223`), így a visszavett munkavállaló elszakad a régi munkaidő-előzményétől. Kell-e a launch előtt egy "reactivate" út, ami a meglévő `Employee`-hez köt új `User`-t, vagy ez v1.1?
- A tombstone-olt e-mail megjelenik a DEVELOPER admin/analytics listákban. Kell-e ezeken a felületeken a `revoked+...` prefixet elrejteni vagy jelölővé alakítani?
- A seat-számolás halasztása mellett kell-e legalább egy figyelmeztetés a Subscription oldalra, hogy a visszavont dolgozók még mindig fogyasztják a helyeket?
- A frontend a `DELETE /employees/:id` 409-es válaszát ma a szerver angol szövegével mutatja. Külön i18n kulcsra váltás B1 része legyen, vagy egy általános "szerverhibák lokalizálása" feladatba kerüljön?

---

### B4 — Stripe hardening: kulcs-mód ellenőrzés, hibakezelés, live Billing Portal (~1 nap)

*Súlyosság: magas. Nem crash-kockázat, hanem **pénzügyi és diagnosztikai** kockázat: egy rossz módú kulccsal a fizetős flow némán a Test accountra megy (nincs bevétel, de a UI „aktív előfizetést" mutat), a 16 futásidejű Stripe SDK-hívásból pedig 15 kezeletlen, így élesben minden Stripe-hiba ugyanazzá a `"Internal server error"` sztringgé lapul a tulajdonos képernyőjén — beleértve azt a hibát is (`billingPortal.sessions.create`), amely **garantáltan** eldobódik az első live hívásakor, amíg a Customer Portal nincs elmentve a live Dashboardon. (Ezt a hívást ma még csak a `startPortal()` service-függvény és az RC-checklist smoke-testje éri el — UI-gomb még nincs rá, lásd 3. pont.) Ez utóbbi egyetlen checklistán sem szerepel.*

#### Mi a hiba

**1. Nincs semmilyen test/live mód-ellenőrzés.**
A `server/src/config.ts:40-58` `PRODUCTION_REQUIRED` listája csak a **meglétet** validálja: szerepel benne a `STRIPE_SECRET_KEY`, a `STRIPE_PRICE_ID`, a `STRIPE_WEBHOOK_SECRET` és mind a hat `STRIPE_PRICE_{STARTER,PROFESSIONAL,BUSINESS}_{EUR,HUF}`. A `config.ts:113` sor (`secretKey: readEnv("STRIPE_SECRET_KEY") ?? null`) soha nem nézi meg a kulcs **értékét**. A `config.ts:122-125` kommentje ezt explicit, tudatos feltételezésként rögzíti is: *„Test vs Live is selected by which STRIPE_SECRET_KEY (and therefore which price IDs) the deploy is configured with"* — azaz a helyesség kizárólag a deploy-konfiguráció kézi pontosságán múlik, kód nem őrzi. Repo-szintű grep a `sk_live|sk_test|livemode` mintákra kizárólag dokumentációt, a `server/.env.example:35`-öt, a `server/vitest.config.ts:47`-et és a `server/src/tests/stripeWebhook.test.ts:17`-et találja: **nulla futásidejű ellenőrzés.**

A `stripeClient.ts:11-15` (startup `console.warn`) és `:17-28` (Proxy, amely az első property-hozzáféréskor dob nevesített hibát) csak a *„kulcs hiányzik"* esetet fedi le. A *„kulcs megvan, de rossz módú"* eset — ami éles indulásnál a valószínűbb hiba — teljesen lefedetlen. Következmény: az API elindul, a `/health` zöld, a Checkout „működik", csak épp a Stripe Test accountjában keletkeznek az előfizetések. A `syncSubscription.ts` boldogan visszaírja a Company-ra az `active` státuszt, mert számára egy test-mode subscription ugyanúgy néz ki, mint egy live.

**2. 16 futásidejű Stripe SDK-hívásból pontosan egy kezelt.**
- `server/src/routes/subscription.routes.ts` — 270 sor, **nulla** `try {` és nulla `catch`. Öt hívás: `:134` `customers.create`, `:148` `checkout.sessions.create`, `:187` `checkout.sessions.retrieve` (a `sessionId` a `req.body`-ból jön, `:183` csak truthy-ságra ellenőrzi), `:202` `subscriptions.retrieve`, `:262` `billingPortal.sessions.create`.
- `server/src/services/stripe/subscriptionChange.ts` — 280 sor, nulla try/catch, **kilenc** hívás: `:86` `subscriptionSchedules.release`, `:122`/`:162`/`:196`/`:268` `subscriptions.retrieve`, `:173`/`:273` `subscriptions.update`, `:206` `subscriptionSchedules.create`, `:211` `subscriptionSchedules.update`. A modul `{ ok:false, status, error }` result-típusa (`:41`, `:45`) **kizárólag üzleti szabály sértését** fejezi ki, SDK-throw-t soha.
- `server/src/routes/stripeWebhook.routes.ts:44-51` — az egyetlen kezelt hívás (`constructEvent` → 400 `"Invalid signature"`). A `:67` `subscriptions.retrieve` a `switch`-en **belül**, a `try`-on **kívül** van.
- `server/src/scripts/stripeSetup.ts` további négy hívást tartalmaz (`:41`, `:47`, `:60`, `:67`), de az CLI, amit a `:104` `main().catch(...)` lefed — ez **nem** része ennek a blokkolónak.

**Fontos keretezés: ettől semmi nem omlik össze.** Az `express ^5.1.0` az async route-handlerek elutasított promise-ait automatikusan a globális hibakezelőre továbbítja (`server/src/app.ts:204-218`), ami prodban `{ error: "Internal server error" }`-t ad (`:211-213`), devben `err.message` + `err.stack`-et (`:216-217`). A process stabil. **A tényleges defektus a granularitás és az üzenet**, nem a stabilitás.

**3. A user-látható következmény.**
`src/services/subscription.service.ts:73` → `throw new Error(data.error || "Failed to start checkout")`, és `src/pages/SubscriptionPage.tsx:90` (illetve `src/components/billing/BillingPlansSection.tsx:71` → `SubscriptionPage.tsx:150` `onCheckoutError={setMessage}`) ezt a `error.message`-et rendereli. Prodban a tulajdonos szó szerint a `"Internal server error"` sztringet látja ott, ahol egy kártya-elutasítás lenne a helyes. És a `subscription.routes.ts:262` `billingPortal.sessions.create` **pontosan az a hívás**, amely live módban `"No configuration provided…"` hibával elszáll mindaddig, amíg a Customer Portal konfigurációt el nem mentették a live Stripe Dashboardon. Fontos pontosítás: a `startPortal()` (`src/services/subscription.service.ts:87`) ma **exportált, de sehol nem hívott** függvény — a „Manage" belépési pont még csak terv (`docs/subscription-ux-billing-flow.md:181`, `:222`), tehát ez a hiba jelenleg API-szinten (és az RC-checklist 13. smoke-testjén) csapódik ki, nem a `SubscriptionPage`-en. A mapper épp ezért fontos: mire a gomb bekerül, a helyes üzenet már ott lesz.

**4. Nincs `apiVersion` pin.** `stripeClient.ts:9`: `config.stripe.secretKey ? new Stripe(config.stripe.secretKey) : null` — se `apiVersion`, se livemode-assert.

**5. Checklist-hiány.** `docs/production-checklist.md:43-46` négy Stripe-tétele a `"Checkout → előfizetés aktiválódik → Billing Portal elérhető"` sorral zárul; `docs/release-candidate-checklist.md:118-120` ugyanez a post-checkout smoke test. **Egyikben sincs** előfeltételként „mentsd el a Customer Portal konfigurációt a live Dashboardon", sem „ellenőrizd, hogy a kulcs `sk_live_`". Az egyetlen ilyen sor a `docs/subscription-ux-billing-flow.md:546` — egy tervdokumentum (a `de53cc0` commit óta verziókövetett), nem release-checklist. Közben a `docs/render-deployment.md:100` és a `docs/release-candidate-checklist.md:33` is kézi, deploy-idejű lépésként jelöli a `NODE_ENV=production`-t; `render.yaml` / Dockerfile / IaC nem létezik, tehát minden env-változó kézzel kerül be a Render Dashboardon.

**Amit nem szabad túllihegni:** a `syncSubscription.ts:56-59` a megvásárolt price-ból újraszármaztatja a plan-t, a `:67-69` pedig a `pendingPlan`-t abból, hogy van-e még Schedule csatolva — a `:64-66` kommentje szerint *„the sync layer self-heals instead of trusting the service to have cleaned up"*. A Stripe↔DB drift tehát konvergál, amint a webhook megérkezik. **De** csak akkor, ha a live webhook endpoint be van állítva — ami maga is kézi lépés, tehát pont abban a deploy-szituációban a leggyengébb, amiről B4 szól. Hasonlóan: egy kezeletlen throw a `stripeWebhook.routes.ts:67`-nél 500-at ad a Stripe-nak, ami backoff-fal újrapróbálkozik — végül önjavít, de a dev-módú stack trace beszivárog a Stripe delivery logjába.

#### Érintett fájlok

| Fájl | Sor | Mi történik |
|---|---|---|
| `server/src/config.ts` | 40-58 | `PRODUCTION_REQUIRED` — csak meglét-validáció a Stripe-változókra; érték soha nem vizsgálva |
| `server/src/config.ts` | 70-77 | **A kiterjesztendő fail-fast minta:** `console.error("FATAL: …Refusing to start Axeriva API")` + `process.exit(1)` |
| `server/src/config.ts` | 113 | `secretKey: readEnv("STRIPE_SECRET_KEY") ?? null` — az érték nincs megnézve |
| `server/src/config.ts` | 122-125 | A rést dokumentáló komment — ezt kell átírni a tényleges ellenőrzés leírására |
| `server/src/config/stripeKeyMode.ts` | **ÚJ** | Tiszta (side-effect mentes) döntési függvény: `checkStripeKeyMode()` |
| `server/src/services/stripe/stripeClient.ts` | 9 | `new Stripe(config.stripe.secretKey)` — ide kerül az `apiVersion` pin |
| `server/src/services/stripe/stripeClient.ts` | 11-15, 17-28 | Meglévő „kulcs hiányzik" kezelés — **változatlan marad** |
| `server/src/services/stripe/stripeErrors.ts` | **ÚJ** | `mapStripeError()` tiszta mapper + `stripeErrorHandler` Express error-middleware |
| `server/src/app.ts` | 197 (új sor) | Az új `stripeErrorHandler` regisztrációja a 404-handler (`194-196`) után |
| `server/src/app.ts` | 204-218 | Globális hibakezelő — **változatlan**, ez marad a fallback minden nem-Stripe hibára |
| `server/src/routes/subscription.routes.ts` | 134, 148, 187, 202, 262 | Öt védtelen hívás; a `:187` ráadásul user-input `sessionId`-vel |
| `server/src/services/stripe/subscriptionChange.ts` | 86, 122, 162, 173, 196, 206, 211, 268, 273 | Kilenc védtelen hívás; a result-típus (`:41`, `:45`) SDK-throw-t nem fed le |
| `server/src/routes/stripeWebhook.routes.ts` | 44-51 | Az egyetlen kezelt hívás — mintaként marad |
| `server/src/routes/stripeWebhook.routes.ts` | 67 | `subscriptions.retrieve` a `switch`-en belül, a `try`-on kívül |
| `server/src/services/stripe/syncSubscription.ts` | 22-24 (komment), 25-28 (függvény) | `current_period_end` az **item**-en van, nem a subscription-ön → korlátozza, mire lehet pinelni |
| `server/src/services/stripe/syncSubscription.ts` | 56-59, 67-69 | Self-healing plan/pendingPlan újraszármaztatás — nem kell hozzányúlni |
| `src/services/subscription.service.ts` | 73, 87 | `throw new Error(data.error || "Failed to start checkout")` — a backend `error` mezőjét dobja; a `startPortal()` (87) ma hívó nélküli export |
| `src/pages/SubscriptionPage.tsx` | 90, 150 | `setMessage(error instanceof Error ? error.message : …)`, illetve `onCheckoutError={setMessage}` — ezt látja a user |
| `src/components/billing/BillingPlansSection.tsx` | 71 | Ugyanez a minta a csomagváltó gombokra |
| `server/vitest.config.ts` | 41, 47 | `NODE_ENV="test"` + `STRIPE_SECRET_KEY="sk_test_axeriva_integration_suite"` |
| `server/src/tests/stripeWebhook.test.ts` | 17, 250-252 | A signer kulcs, és a már létező `vi.spyOn(stripe.subscriptions, "retrieve")` minta |
| `server/package.json` | 11 | `"start": "prisma migrate deploy && node dist/index.js"` — **ez a FATAL indoklása** |
| `server/.env.example` | 33-37 | Stripe kulcs kommentblokk (33-36) + `STRIPE_SECRET_KEY=""` (37) — ide kerül az `ALLOW_TEST_STRIPE_KEY` |
| `docs/environment.md` | 22 | `STRIPE_SECRET_KEY` sor a változó-táblában — utána új sor (a fájl **angol**) |
| `docs/production-checklist.md` | 41-46 | `## Stripe` szekció — két új tétel a lista elejére |
| `docs/release-candidate-checklist.md` | 33-34, 118-120 | Deploy-tábla sorok + a 13. smoke-test tétel |
| `docs/render-deployment.md` | 100, 105, 181 | Env-tábla (`NODE_ENV`, `STRIPE_SECRET_KEY`) és a live `stripe:setup` workflow |
| `docs/stripe-webhook-production-readiness.md` | 146, 160-161 | Kulcs- és live-setup leírás — egy mondat a webhook-hibatest megváltozásáról |

#### Tervezett változtatás

Négy külön ellenőrizhető munkatétel. Sorrend számít: **B4.1 → B4.2 → B4.3 → B4.4**.

---

##### B4.1 — Boot-időben ellenőrzött kulcs-mód, dokumentált escape hatch (~2 óra)

**Döntés (jóváhagyott): a rossz módú kulcs FATAL indulásnál, explicit, dokumentált kimenekülési úttal.**

Egy `sk_test_` kulcs `NODE_ENV=production` mellett **megtagadja az indulást**, kivéve ha az `ALLOW_TEST_STRIPE_KEY=true` env-változó be van állítva. Ekkor a staging deploy nem baleset, hanem szándékos, dokumentált döntés.

**Miért fatal és miért nem „csak warning":** a `server/package.json:11` szerint `"start": "prisma migrate deploy && node dist/index.js"`. Renderen ezért egy sikertelen boot a **deployt** buktatja el, és az előző verzió szolgál ki tovább. A fatal tehát nem élő oldalt visz le, hanem egy rossz deployt blokkol — ez a legolcsóbb hely, ahol ez a hiba megfogható. Egy warning ezzel szemben elveszne a Render logjában, és pontosan az a checklist-sor takarná el (`docs/production-checklist.md:57`, „Startup-log tiszta"), amit senki nem néz meg minden deploynál.

**Új fájl: `server/src/config/stripeKeyMode.ts`** — tisztán a döntés, semmi mellékhatás (a tesztelhetőség miatt, lásd „Tesztek"):

```ts
export type StripeKeyModeCheck =
  | { level: "ok" }
  | { level: "warn"; message: string }
  | { level: "fatal"; message: string };

export function stripeKeyMode(key: string | null): "live" | "test" | "unknown" {
  if (!key) return "unknown";
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) return "live";
  if (key.startsWith("sk_test_") || key.startsWith("rk_test_")) return "test";
  return "unknown";
}

export function checkStripeKeyMode(input: {
  nodeEnv: string;
  secretKey: string | null;
  allowTestKey: boolean;
}): StripeKeyModeCheck { /* … */ }
```

A `restricted key` (`rk_`) prefixeket is ismerni kell, mert a Stripe azokat is kiadja és a `stripe:setup` workflow használhatja őket.

**A döntési tábla — pontosan ez legyen implementálva, és pontosan ezt logolja.** Figyelem: a `secretKey === null` ágat a `checkStripeKeyMode()` **a klasszifikáció előtt** kell hogy kezelje, különben a `stripeKeyMode(null) === "unknown"` miatt a hiányzó kulcs is warningot kapna — pedig azt a `PRODUCTION_REQUIRED` már lekezelte:

| `NODE_ENV` | Kulcs módja | `ALLOW_TEST_STRIPE_KEY` | Eredmény | Log |
|---|---|---|---|---|
| bármi | **kulcs hiányzik (`null`)** | bármi | indul, csendben | — (`{ level: "ok" }`; a hiányzó kulcs a `PRODUCTION_REQUIRED` dolga, itt nem duplázzuk) |
| `production` | `test` | nincs / nem `"true"` | **FATAL, `process.exit(1)`** | `FATAL: STRIPE_SECRET_KEY is a TEST-mode key (sk_test_…) but NODE_ENV=production. Refusing to start Axeriva API — real customers would be charged in Stripe Test mode. Set a live key, or set ALLOW_TEST_STRIPE_KEY=true if this is a deliberate staging deploy. See docs/environment.md.` |
| `production` | `test` | `"true"` | indul | `console.warn`: `[stripe] STAGING MODE: running with a TEST-mode Stripe key under NODE_ENV=production because ALLOW_TEST_STRIPE_KEY=true. No real payment can be taken on this deploy.` |
| `production` | `live` | bármi | indul, csendben | — (`{ level: "ok" }`) |
| `production` | `unknown` (kulcs van, de a prefix ismeretlen) | bármi | indul | `console.warn`: `[stripe] Could not classify STRIPE_SECRET_KEY as test or live (unrecognised prefix) — mode check skipped.` |
| `test` | `live` | bármi | **FATAL, `process.exit(1)`** | `FATAL: STRIPE_SECRET_KEY is a LIVE-mode key but NODE_ENV=test. Refusing to start — the integration suite must never touch a live Stripe account.` |
| `development` | `live` | bármi | indul | `console.warn`: `[stripe] WARNING: a LIVE Stripe key is configured on a non-production environment. Any checkout started here creates a REAL subscription and takes REAL money.` |
| bármi | `unknown`/`test` egyébként | — | indul, csendben | — |

**Az inverz eset indoklása (`sk_live_` production-ön kívül).** Ez veszélyesebb, mint a fordítottja: valódi terhelés keletkezhet egy fejlesztői gépről. Mégsem lehet mindenütt fatal, mert a `docs/render-deployment.md:181` egy **dokumentált, legitim** workflow-t ír le — a `npm run stripe:setup` futtatását lokálisan a live `sk_live_…` kulccsal, hogy a live Product+Price létrejöjjön. Ez a script a `config.ts`-t importálja (`stripeSetup.ts:2`), tehát egy `development`-beli fatal ellenőrzés **megtörné a saját élesítési eljárásunkat**. Ezért:
- `NODE_ENV=test` + live kulcs → **fatal**, escape hatch nélkül. A teszt-suite soha nem érhet live accounthoz. (A `vitest.config.ts:47` `sk_test_`-et állít, tehát ez a suite-ot ma nem érinti — épp ezért olcsó bevezetni.)
- `development` + live kulcs → **hangos warning**, indulás engedélyezve. A `stripe:setup` workflow változatlanul működik.

**A `config.ts` beépítése:** a `70-77` fail-fast blokk **után**, a `config` objektum összeállítása **előtt** (tehát ~a 78. sorra):

```ts
const stripeKeyCheck = checkStripeKeyMode({
  nodeEnv,
  secretKey: readEnv("STRIPE_SECRET_KEY") ?? null,
  allowTestKey: readEnv("ALLOW_TEST_STRIPE_KEY") === "true",
});
if (stripeKeyCheck.level === "fatal") {
  console.error(stripeKeyCheck.message);
  process.exit(1);
} else if (stripeKeyCheck.level === "warn") {
  console.warn(stripeKeyCheck.message);
}
```

Az `ALLOW_TEST_STRIPE_KEY` értéke szigorúan a `"true"` sztringgel egyezzen (ne `Boolean(...)`, mert akkor a `"false"` is igaz lenne). A `config.ts:122-125` kommentjét át kell írni: már nem „a deploy-konfigurációra bízzuk", hanem „induláskor ellenőrizzük, lásd `config/stripeKeyMode.ts`".

**Miért a `config.ts` és nem a `stripeClient.ts`?** Nem azért, mert a suite az egyiket importálja, a másikat nem — a `stripeWebhook.test.ts:4` az `app`-on (`app.ts:8`) keresztül a `config.ts`-t **is** betölti, a `:6` pedig a `stripeClient.ts`-t. Az ok az, hogy a `config.ts` a projekt kimondott, egyetlen env-belépési pontja (`config.ts:3-7`), és már ma is `process.exit(1)`-et hív ugyanezen a helyen — a mintát csak folytatjuk, ahelyett hogy egy második, env-olvasó döntési pontot nyitnánk a Stripe-kliensben. A vitest workerét egyik változat sem viszi el (a suite `NODE_ENV=test` + `sk_test_` párost állít, amire egyik ág sem tüzel), a tesztelhetőséget pedig a tiszta függvény kiszervezése adja.

---

##### B4.2 — Egy központi, Stripe-tudatos hiba-mapper (~4 óra)

**Döntés: egyetlen Stripe-tudatos hiba-mapper + egy Express error-middleware. Nem `asyncHandler` wrapper, nem 15 db per-call `try/catch`.**

Indoklás — ez a három lehetőség közül az egyetlen, ami illeszkedik a meglévő architektúrához:
- **`asyncHandler` wrapper felesleges:** az `express ^5.1.0` már magától továbbítja az elutasított promise-okat a globális handlerre (`app.ts:198-203` kommentje ezt ki is mondja). Egy wrapper csak zajt adna, hibaüzenetet nem javítana.
- **Per-call `try/catch` 15 helyen elszáll:** a hívások többsége (9 a 15-ből) a `subscriptionChange.ts`-ben van, aminek a result-típusa (`:36-45`) üzleti szabályokat modellez. Minden hívást beburkolni azt jelentené, hogy 9 helyen kézzel képezünk le SDK-hibát `{ ok:false, status, error }`-ra — pontosan az a duplikáció, amit a modul fejkommentje (`:14-20`, „the ONE place plan-change business logic lives") kerülni akar.
- **Központi mapper mindenre egyszerre hat:** nulla módosítás a 15 hívási helyen, mégis mind a 15 lefedve. A route-ok és a service-ek változatlanok maradnak.

**Új fájl: `server/src/services/stripe/stripeErrors.ts`**, két exporttal (a `server/tsconfig.json` `strict: true`, tehát implicit `any` paraméter nem fordul — a middleware szignatúrája végig típusos):

```ts
import type { NextFunction, Request, Response } from "express";

export type MappedStripeError = { status: number; error: string; code: string; logHint?: string };
export function mapStripeError(error: unknown): MappedStripeError | null;   // null = nem Stripe-hiba
export function stripeErrorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void;                                                                     // 4-arity Express error middleware
```

A middleware regisztrációja az `app.ts`-ben a 404-handler (`194-196`) **után**, a globális handler (`204`) **elé**. Ha `mapStripeError()` `null`-t ad, a middleware `next(error)`-t hív → minden nem-Stripe hiba viselkedése bitre azonos marad.

> **Buktató, amit tesztelés közben verifikáltam és el kell kerülni:** a stripe-node `StripeError.type` mezője a **class nevét** tartalmazza (`"StripeCardError"`; lásd `node_modules/stripe/cjs/Error.js`: `this.type = type || this.constructor.name`, és a `StripeCardError` konstruktora `super(raw, 'StripeCardError')`-t hív), **nem** az API-szintű típust (`"card_error"`). Az API-szintű típus a `rawType` mezőben van, és csak akkor, ha a hiba valódi API-válaszból született. Ezért a mapper **`instanceof Stripe.errors.*`** alapon ágazzon, ne `error.type === "card_error"` alapon — utóbbi némán sosem illeszkedne.

**A leképezés — ez a válasz a „mi lesz a user-látható üzenet" kérdésre:**

| Hiba | Feltétel | HTTP | `error` (ezt látja a tulajdonos) | `code` |
|---|---|---|---|---|
| **Kártya-elutasítás** | `instanceof Stripe.errors.StripeCardError` | 402 | `error.message` **változatlanul** — a Stripe saját szövege már user-safe és lokalizált szándékú (pl. „Your card was declined.") | `card_declined` |
| **Billing Portal nincs konfigurálva** | `StripeInvalidRequestError` **és** az üzenet tartalmazza a `"No configuration provided"` részletet | 503 | `Billing portal is not configured yet — please contact support.` | `portal_not_configured` |
| **Rossz módú / ismeretlen price** | `code === "resource_missing"` és az üzenet `"No such price"` (vagy `param` a `line_items`-re mutat) | 500 | `This plan cannot be purchased right now — please contact support.` | `price_not_found` |
| **Ismeretlen checkout session** | `code === "resource_missing"`, üzenet `"No such checkout.session"` | 404 | `Checkout session not found.` | `session_not_found` |
| **Ismeretlen subscription/customer** | `code === "resource_missing"`, üzenet `"No such subscription"` / `"No such customer"` | 409 | `Your subscription could not be found in Stripe — please contact support.` | `subscription_not_found` |
| **Elutasított kulcs** | `StripeAuthenticationError` | 503 | `Billing is temporarily unavailable.` | `billing_unavailable` |
| **Hálózat / Stripe-oldali / rate limit** | `StripeConnectionError`, `StripeAPIError`, `StripeRateLimitError` | 503 | `Billing is temporarily unavailable — please try again in a moment.` | `billing_unavailable` |
| **Egyéb `StripeError`** | bármi más | 502 | `Billing request failed — please try again.` | `billing_error` |
| **Nem Stripe-hiba** | — | — | `next(error)` → változatlan `app.ts:204-218` viselkedés | — |

A 402-es kód szabad: a read-only guard 403 + `{ error: "READ_ONLY_MODE" }`-t ad (`readOnly.middleware.ts:52-56`), és a frontend `apiFetch` csak a 401-et és a 403-at kezeli globálisan (`src/services/api.ts:66-88`) — a 402/503 egyszerűen a hívó `catch`-ébe fut.

A `resource_missing` alesetek megkülönböztetése üzenet-illesztéssel történik (a Stripe nem ad finomabb kódot). Ez elfogadható kompromisszum: ha egy minta nem illeszkedik, a fallback az általános `billing_error` — ami **még mindig jobb**, mint a mai `"Internal server error"`.

A `logHint` mező a szerver-oldali logba megy (a `console.error` mellé, a `app.ts:205` mintája szerint), nem a válaszba. A `portal_not_configured` esetén a hint nevezze meg a konkrét teendőt: `Stripe Dashboard → Settings → Billing → Customer portal → Save (live mode)`. A `price_not_found` esetén: `likely a test/live key + price ID mismatch — check STRIPE_PRICE_* against the account STRIPE_SECRET_KEY belongs to`.

**Frontend: nulla változtatás szükséges.** A válasz alakja (`{ error: string }`) változatlan, tehát a `subscription.service.ts:73` és a `SubscriptionPage.tsx:90`/`:150` ugyanúgy működik — csak épp a helyes sztringet rendereli. (A portal-üzenetnek egyelőre nincs UI-útvonala, mert a `startPortal()`-nak nincs hívója; az a gomb egy külön munkatétel.) A `code` mező additív; a kód → `hu.json` kulcs i18n-leképezés **nem** része B4-nek, az a billing-UI munkatételéhez tartozik.

**Mellékhatás a webhookra (szándékos):** a `stripeWebhook.routes.ts:67` throw-ja továbbra is nem-2xx-et ad, tehát a Stripe backoff-fal újrapróbál (ez a kívánt önjavítás) — **de** a válasz teste immár a mapper rövid üzenete lesz, nem a dev-módú `err.stack`. Ezzel a stack-szivárgás a Stripe delivery logjába megszűnik.

**Egy apró extra a `subscription.routes.ts:187`-hez:** érdemes a `sessionId`-t a hívás előtt formátumra is ellenőrizni (`cs_` prefix), és `400`-zal elutasítani. Ez csökkenti a Stripe felé küldött, felhasználó által vezérelt lekérdezések felületét. Nem kötelező, de olcsó.

---

##### B4.3 — `apiVersion` pin a `stripeClient.ts:9`-ben (~15 perc)

**Ajánlás: IGEN, pinelni kell — pontosan az SDK-val szállított verzióra, sosem régebbire.**

```ts
const client = config.stripe.secretKey
  ? new Stripe(config.stripe.secretKey, { apiVersion: "2026-05-27.dahlia" })
  : null;
```

A telepített `stripe@22.2.2` beépített API-verziója `2026-05-27.dahlia` (`node_modules/stripe/cjs/apiVersion.js`), és a `StripeConfig.apiVersion` típusa `LatestApiVersion = typeof ApiVersion` (`node_modules/stripe/cjs/lib.d.ts:11,27`) — tehát pontosan ez a sztring az egyetlen, ami fordul is, és a pin **ma nulla viselkedésváltozást** okoz. Épp ezért olcsó és biztonságos most beépíteni.

**Miért kell mégis:** pin nélkül a kliens az adott Stripe **account** default API-verzióját használja, ami a Stripe Dashboardján, tőlünk függetlenül elmozdulhat. A kódunk pedig már ma is verzió-érzékeny: a `syncSubscription.ts:22-24` kommentje kimondja, hogy a `current_period_end` az újabb API-ban a **line item**-re költözött a subscription-ről, és a `:27` sor (`item.current_period_end`) erre épül. Ha a Test és a Live account default verziója eltér — ami két külön időpontban létrehozott accountnál teljesen reális —, ugyanaz a kód a két környezetben más adatot lát: a `current_period_end` `undefined` lesz, amiből `new Date(NaN)`, azaz Invalid Date keletkezik (nem `null` — a `currentPeriodEnd()` csak akkor ad `null`-t, ha egyáltalán nincs item), és ez már a Prisma-írásnál elszáll. A pin ezt kizárja.

**Amit tilos:** régebbi verzióra pinelni. Az visszahozná a subscription-szintű `current_period_end`-et, és azonnal megtörné a `syncSubscription.ts:25-28`-at. A pin értéke mindig kövesse a `stripe` csomag frissítését (a `CHANGELOG.md` jelzi az API-verzió-váltást).

**Livemode-assert a kliensben: NEM.** Az `stripe.accounts.retrieve()`-alapú futásidejű livemode-ellenőrzés hálózati hívást igényelne modul-betöltéskor, ami a teszt-suite-ot és a boot-időt is megfogná. A prefix-alapú B4.1 ellenőrzés ugyanazt a hibát fogja meg, hálózat nélkül.

---

##### B4.4 — Checklist- és dokumentáció-kiegészítések (~1 óra)

**(a) `docs/production-checklist.md` — a `## Stripe` szekció (41. sor) alá, a jelenlegi 43. sor elé, két új tétel, hogy előfeltételként a lista élén álljanak:**

```markdown
- [ ] `STRIPE_SECRET_KEY` **live** kulcs (`sk_live_…`) — a Render env-ben ellenőrizve; az `ALLOW_TEST_STRIPE_KEY` NINCS beállítva (staging kivétel: lásd docs/environment.md)
- [ ] **Customer Portal konfiguráció elmentve a LIVE Stripe Dashboardon** (Settings → Billing → Customer portal → Save) — enélkül a `/subscription/portal` „No configuration provided" hibával áll el
```

Az így 45-48. sorra csúszó négy meglévő tétel változatlan marad.

**(b) `docs/release-candidate-checklist.md` — új táblasor a 34. sor (`Env-validáció`) után:**

```markdown
| Stripe kulcs-mód | prod: `sk_live_…`, különben startup exit(1) | ✅ (config/stripeKeyMode.ts) |
```

**és** a 13. smoke-test tétel (118-120. sor) elé beszúrandó egy előfeltétel-mondat, a lista számozásának megtartásával — a legkevésbé tolakodó forma a meglévő 13. pont szövegének kiegészítése:

```markdown
13. **Stripe:** *(előfeltétel: a live Customer Portal konfiguráció el van mentve a
    Stripe Dashboardon)* Checkout indítása → (live kártyával) előfizetés
    aktiválódik → `Company.plan` frissül → Billing Portal elérhető (ma még csak
    közvetlen API-hívással: `POST /subscription/portal`) → webhook-esemény
    „succeeded" a Stripe Dashboardon.
```

**(c) `docs/environment.md` — új sor a változó-táblában, a `STRIPE_SECRET_KEY` sor (22.) után. A fájl végig angol, a sor is az:**

```markdown
| `ALLOW_TEST_STRIPE_KEY` | no | — | Escape hatch: allows startup with an `sk_test_…` key under `NODE_ENV=production` (staging deploy). Only the exact value `true` has any effect. Never set it on the live deploy. |
```

**(d) `server/.env.example` — a `STRIPE_SECRET_KEY=""` sor (37.) után:**

```
# Staging-only escape hatch: production NODE_ENV + sk_test_ key would normally
# refuse to start (see config/stripeKeyMode.ts). Set to "true" ONLY on a
# deliberate staging deploy — never on the live one.
# ALLOW_TEST_STRIPE_KEY="true"
```

**(e) `docs/render-deployment.md`** — a 105. sor (`STRIPE_SECRET_KEY | sk_live_...`) érték-cellája egészüljön ki azzal, hogy a `sk_test_` kulcs itt **indulási hibát** okoz, valamint a 181. sor körüli live `stripe:setup` szakaszhoz kerüljön oda, hogy ez `NODE_ENV` beállítása nélkül (development módban) futtatandó, ahol a live kulcs csak figyelmeztetést vált ki.

**(f) `docs/stripe-webhook-production-readiness.md`** — a live kulcs/setup szakaszhoz (146., 160-161. sor környéke) egy mondat: a webhook hibaválaszának teste a mapper bevezetése után rövid, generikus üzenet, tehát a részletes ok a Render szerver-logjában keresendő (`console.error` + `logHint`), nem a Stripe delivery logjában.

#### Tesztek

**Előzetes megjegyzés a harness-ről:** a `server/src/tests/helpers/factories.ts` a `createCompany`, `createReadOnlyCompany`, `createUser`, `createEmployee`, `createCustomer`, `createProject`, `createShift`, `createTenant`, `createEmployeeUser`, `createDeveloper`, `authHeader` és a `TEST_PASSWORD` konstans; a `helpers/db.ts` egyedül a `resetDatabase()`-t adja. Nincs Stripe-factory és nincs env-manipuláló helper — amit a tesztek használnak, azt vagy ezekből, vagy a `vi.spyOn`-ból kell építeni. A `src/tests/setup.ts` minden teszt előtt `resetDatabase()`-t futtat, tehát az alább leírt „tiszta" unit tesztek is a meglévő integrációs harness alatt futnak (kell hozzá a teszt-adatbázis) — ez a harness adottsága, nem változtatunk rajta.

**A `process.exit(1)` korlát és a feloldása.** A `config.ts` modul-betöltéskor hívja a `process.exit(1)`-et, tehát a boot-ellenőrzést **nem lehet** úgy tesztelni, hogy a teszt env-változókat állít és importálja a `config.ts`-t: az megölné a vitest workert (a `pool: "forks"`, `maxWorkers: 1` beállítás mellett az egész futást). **Ezért van kiszervezve a döntés a `config/stripeKeyMode.ts`-be**: az a fájl semmit nem importál a `config.ts`-ből, nem olvas `process.env`-et, nem hív `process.exit`-et — csak bemenetből kimenetet képez. A teszt kizárólag ezt a függvényt importálja (`../config/stripeKeyMode`). A `config.ts`-ben maradó rész (log + exit) három sor, aminek a helyessége szemrevételezéssel eldönthető.

**Új fájl: `server/src/tests/stripeKeyMode.test.ts`** — a `checkStripeKeyMode()` tiszta esetei, egy-egy `it` a döntési tábla minden sorára:
1. `production` + `sk_test_…` + `allowTestKey: false` → `level === "fatal"`, és az üzenet tartalmazza a `"Refusing to start"` részletet (ugyanaz a szóhasználat, mint a `config.ts:73`-ban).
2. `production` + `sk_test_…` + `allowTestKey: true` → `level === "warn"`, az üzenet tartalmazza a `"STAGING MODE"`-ot.
3. `production` + `sk_live_…` → `level === "ok"`.
4. `production` + `rk_live_…` (restricted key) → `level === "ok"`.
5. `production` + `"whatever_not_a_stripe_key"` → `level === "warn"` (ismeretlen prefix, nem fatal).
6. `production` + `null` (kulcs hiányzik) → `level === "ok"` — ez a null-ág külön előzi meg a klasszifikációt: a hiányzó kulcsot a `PRODUCTION_REQUIRED` már lekezelte, itt nem szabad duplán hibázni, és nem szabad az „ismeretlen prefix" warningba esnie.
7. `test` + `sk_live_…` → `level === "fatal"`.
8. `development` + `sk_live_…` → `level === "warn"`, az üzenet tartalmazza a `"REAL"` szót.
9. `development` + `sk_test_…` → `level === "ok"`.
10. `allowTestKey` csak a pontos `true` booleanra hasson: a hívó `readEnv(...) === "true"` összehasonlítást ad át — külön teszt arra, hogy `production` + `sk_test_` + `allowTestKey: false` fatal marad (ez a 1. eset megerősítése a „`ALLOW_TEST_STRIPE_KEY=false` nem old fel semmit" szemszögből).

**Új fájl: `server/src/tests/stripeErrors.test.ts`** — két blokk.

*(A) A `mapStripeError()` tiszta esetei.* A Stripe error-osztályok konstruktora publikusan tipizált (`node_modules/stripe/cjs/Error.d.ts:42-51`, `constructor(raw?: StripeRawError)`, és a `StripeRawError` tartalmaz `code`/`message`/`statusCode` mezőt), és példányosítható — ezt verifikáltam:
```ts
new Stripe.errors.StripeCardError({ code: "card_declined", message: "Your card was declined.", statusCode: 402 })
```
Esetek:
1. `StripeCardError` → `status === 402`, és az `error` **szó szerint** a Stripe üzenete (nem generikus sztring).
2. `StripeInvalidRequestError` `"No configuration provided and your live mode default configuration has not been created."` üzenettel → `status === 503`, `code === "portal_not_configured"`.
3. `StripeInvalidRequestError` `code: "resource_missing"`, `"No such price: 'price_x'"` → `status === 500`, `code === "price_not_found"`.
4. `StripeInvalidRequestError` `code: "resource_missing"`, `"No such checkout.session: 'cs_x'"` → `status === 404`, `code === "session_not_found"`.
5. `StripeAuthenticationError` → `status === 503`, `code === "billing_unavailable"`.
6. Ismeretlen `StripeError` alosztály → `status === 502`, `code === "billing_error"`.
7. Sima `new Error("boom")` → `mapStripeError()` `null`-t ad (ez garantálja, hogy a nem-Stripe hibák érintetlenek maradnak).
8. Regressziós őr a fentebb leírt buktatóra: egy `StripeCardError` példány `type` mezője `"StripeCardError"` — a teszt állítsa, hogy a mapper ettől függetlenül 402-t ad (azaz nem az API-szintű `"card_error"` sztringre illeszt).

*(B) Route-szintű leképezés supertesttel.* Autentikált kérés a `createTenant()` + `authHeader(tenant.token)` párossal (a `createTenant` owner-je `BUSINESS_OWNER`, ami mind a `/sync`, mind a `/portal` route-hoz elég; az alapértelmezett company `trialing` + jövőbeli lejárat):
9. `POST /subscription/sync` `{ sessionId: "cs_bogus" }` testtel, `vi.spyOn(stripe.checkout.sessions, "retrieve").mockRejectedValue(<resource_missing hiba>)` → `404`, `body.error === "Checkout session not found."`, és **`body.stack` undefined**.
10. `POST /subscription/portal` egy `stripeCustomerId`-vel rendelkező company-n (a `createTenant` után `prisma.company.update`-tel beállítva, ahogy a `stripeWebhook.test.ts:137-140` is teszi), `vi.spyOn(stripe.billingPortal.sessions, "create").mockRejectedValue(<"No configuration provided…">)` → `503`, `body.code === "portal_not_configured"`. **Ez a legfontosabb teszt az egész blokkolóban** — pontosan azt a hibát rögzíti, ami az első live portal-hívásnál garantáltan bekövetkezik, és mivel a frontenden még nincs hívó, ez az egyetlen hely, ahol ez ma egyáltalán ellenőrizve van.
11. Kontroll-teszt: egy nem-Stripe hiba (pl. `vi.spyOn(prisma.company, "findUnique").mockRejectedValue(new Error("db down"))` a `/subscription/portal`-on — az `authMiddleware` `prisma.user.findUnique`-ot használ, tehát a mock nem üti ki az autentikációt) továbbra is a globális handlerre fut → `500`, tehát az új middleware nem nyeli el az idegen hibákat.

Minden ilyen tesztfájl végén `afterEach(() => { vi.restoreAllMocks(); })`, a `stripeWebhook.test.ts:65-67` mintája szerint.

**Meglévő fájl: `server/src/tests/stripeWebhook.test.ts`** — ide **csak** az tartozik, ami a webhook-út viselkedése. Egy új teszt a meglévő `describe("checkout.session.completed")` blokkba (a `:250-252` spy-minta egysoros variánsa, `mockResolvedValue` helyett `mockRejectedValue`):
12. Ha a `stripe.subscriptions.retrieve` Stripe-hibát dob, a webhook **nem** ad 2xx-et (hogy a Stripe újrapróbáljon), és a válasz teste **nem tartalmaz `stack` mezőt** — ez a dev-módú stack-szivárgás regressziós őre.

**Ami kifejezetten NEM ide tartozik:** a `checkStripeKeyMode` esetei (nincs közük a webhookhoz), és a mapper unit-esetei. A `stripeWebhook.test.ts` fejkommentje (`:9-14`) tudatosan szűk hatókörű — ne hígítsuk fel.

**A leggyakoribb aggály, előre megválaszolva:** a `server/vitest.config.ts:41,47` a `NODE_ENV="test"` és a `STRIPE_SECRET_KEY="sk_test_axeriva_integration_suite"` értéket állítja be, tehát a production-ra kötött ellenőrzés a suite-ot **érintetlenül hagyja** — a teljes teszt-futás ma is, B4 után is pontosan ugyanígy indul. Az egyetlen új szabály, ami a suite-ot elvben érintheti, a „`test` + live kulcs → fatal"; ez jelenlegi konfigurációval soha nem tüzel, és ha valaha tüzelne, az pont a kívánt védelem.

#### Regressziós kockázat

- **Az `apiVersion` pin a legnagyobb egyedi kockázat.** A `syncSubscription.ts:25-28` az `item.current_period_end`-re épül, ami az **újabb** API-viselkedés. A pin értéke ezért kizárólag a telepített SDK verziója (`2026-05-27.dahlia`) lehet; bármi régebbi `undefined`-et adna, amiből `new Date(NaN)`, azaz Invalid Date lesz. Ennek a hatása **nem** jogosulatlan read-only: a `readOnly.ts:43` `subscriptionEndsAt.getTime() < Date.now()` összehasonlítása `NaN`-nal mindig `false`, tehát a `hasActiveSubscription()` igazat adna, és a cég soha nem lenne read-only (fail-open) — a gyakorlatban viszont már a Prisma-írás elszáll az Invalid Date-en, azaz a webhook/sync 500-zal bukik. Mindkét kimenet rossz, de más irányba, mint amire ösztönösen számítanánk. A pinelést a `stripe` csomag minden frissítésekor felül kell vizsgálni.
- **A központi error-middleware minden route-ra hat, nem csak a Stripe-osokra.** Kötelező, hogy `mapStripeError()` `null`-ja esetén `next(error)`-t hívjon. A jelenlegi 140 tesztből egyetlen sem állít 500-as válasz-testre (grep: nincs `"Internal server error"`, `toBe(500)` vagy `.stack` assert a `src/tests/` alatt), tehát a meglévő tesztek nem őrzik ezt a határt — a fenti 11. kontroll-teszt szolgál erre.
- **A `stripeClient.ts:17-28` Proxyja marad.** Az `apiVersion` hozzáadása csak a konstruktor-hívást érinti; a Proxy `bind`-oló viselkedése (`:26`) változatlan. A `vi.spyOn(stripe.subscriptions, "retrieve")` minta a `stripeWebhook.test.ts:251`-ben a Proxyn keresztül működik — ezt B4 nem érinti, de az új spy-alapú tesztek (9., 10. eset) ugyanezen az úton mennek, tehát ha a Proxy valaha megváltozna, több teszt bukna egyszerre. Ez helyes jelzés.
- **A `npm run stripe:setup` live kulccsal (`docs/render-deployment.md:181`) tovább kell működjön.** A script a `config.ts`-t importálja (`stripeSetup.ts:2`), és `NODE_ENV` beállítása nélkül fut → `development` ág → warning, nem fatal. A B4.1 bevezetése után ezt egyszer manuálisan érdemes leellenőrizni egy **test** kulccsal (`npm run stripe:setup` egy test accounton), hogy a `config.ts` nem exitel váratlanul.
- **A staging escape hatch elfelejtése éles deployon néma anyagi kár.** Az `ALLOW_TEST_STRIPE_KEY=true` egy éles Render-környezetben ugyanoda vezet, amit B4 meg akar előzni — csak épp warninggal. Ezért a (a) pont checklist-tétele explicit „**NINCS** beállítva" ellenőrzést kér, nem csak a live kulcs meglétét.
- **Webhook-viselkedés:** a mapper után a Stripe delivery logjában a hibatest megváltozik (rövid, generikus üzenet a stack helyett). A `docs/stripe-webhook-production-readiness.md`-ben leírt hibakeresési eljárás ezért kevesebb információt lát a Stripe felületén — a részletes ok innentől a Render szerver-logjában van (`console.error` + `logHint`). Ezt a doksiban a B4.4 (f) pont rögzíti.
- **Amit nem rontunk el:** a `syncSubscription.ts:56-59` / `:67-69` self-healing logikájához B4 nem nyúl, és a `subscriptionChange.ts` üzleti result-típusához sem. A központi mapper épp azért lett választva, hogy egyik hívási hely kódja se változzon.

#### Kész, ha

- [ ] Létezik `server/src/config/stripeKeyMode.ts` egy tiszta, `process.env`-et nem olvasó, `process.exit`-et nem hívó `checkStripeKeyMode()` függvénnyel, és a `config.ts` a `70-77` fail-fast blokk után meghívja.
- [ ] `NODE_ENV=production` + `sk_test_…` kulcs `ALLOW_TEST_STRIPE_KEY` nélkül → az API `FATAL:` sorral kilép (`exit code 1`), tehát a Render-deploy megbukik és az előző verzió szolgál ki tovább.
- [ ] `ALLOW_TEST_STRIPE_KEY=true` mellett ugyanez elindul, és egyetlen, keresőre jól illeszkedő `STAGING MODE` warningot ír a logba.
- [ ] `NODE_ENV=test` + `sk_live_…` → fatal, escape hatch nélkül; `development` + `sk_live_…` → warning, indulás engedve (a `stripe:setup` live workflow sértetlen); hiányzó kulcs (`null`) → néma `ok` minden környezetben.
- [ ] Létezik `server/src/services/stripe/stripeErrors.ts` a `mapStripeError()` + `stripeErrorHandler` párossal, regisztrálva az `app.ts`-ben a 404-handler és a globális handler **között**, és nem-Stripe hiba esetén `next(error)`-t hív.
- [ ] Mind a 15 korábban védtelen SDK-hívás lefedett — a hívási helyeken **nulla** kódmódosítással; a `subscription.routes.ts` és a `subscriptionChange.ts` diffje üres (a `sessionId` formátum-ellenőrzés opcionális kivételével).
- [ ] Kártya-elutasításnál a `SubscriptionPage` a Stripe saját üzenetét mutatja, nem a `"Internal server error"`-t; a nem konfigurált Billing Portalra a `POST /subscription/portal` `503` + `Billing portal is not configured yet — please contact support.` választ ad (UI-hívó ma nincs rá, ezért ezt a 10. teszt őrzi).
- [ ] A `stripeClient.ts:9` `apiVersion: "2026-05-27.dahlia"`-val hívja a konstruktort, és egy komment rögzíti, hogy az érték a telepített SDK verziója, és sosem csökkenthető.
- [ ] `npm test` zölden fut (a meglévő 140 teszt is); benne az új `stripeKeyMode.test.ts` (10 eset) és `stripeErrors.test.ts` (11 eset), plusz a `stripeWebhook.test.ts` új, stack-szivárgást őrző esete.
- [ ] `docs/production-checklist.md` Stripe-szekciója a live kulcs- és a live Customer Portal-tétellel **kezdődik**; `docs/release-candidate-checklist.md` tartalmazza a kulcs-mód táblasort és a 13. smoke-testhez fűzött előfeltételt; a `docs/stripe-webhook-production-readiness.md` jelzi a webhook-hibatest változását.
- [ ] Az `ALLOW_TEST_STRIPE_KEY` dokumentálva van a `docs/environment.md` táblájában (angolul, a fájl nyelvén) és a `server/.env.example`-ben (kikommentezve, „soha éles deployon" megjegyzéssel).
- [ ] A `config.ts:122-125` komment át van írva: már nem „a deploy-konfigurációra bízva", hanem „induláskor ellenőrizve".

#### Nyitott kérdések (implementáláskor eldöntendő)

- A `code` mezőre épülő i18n-leképezés: a backend ma angol, nyers hibaszövegeket ad vissza, amiket a UI változtatás nélkül renderel (`SubscriptionPage.tsx:90`, `BillingPlansSection.tsx:71`), miközben a `src/i18n/hu.json` `subscription` blokkja magyar. Marad-e a nyers angol sztring v1.0-ra (konzisztens a jelenlegi viselkedéssel, gyors), vagy a frontend a `code` alapján magyar kulcsra képez le (helyesebb, de ~10 új i18n kulcs és a kártya-elutasítás Stripe-szövegének kezelése is kérdés)?
- A `resource_missing` alesetek szétválasztása üzenet-illesztéssel történik ("No such price" / "No such checkout.session" / "No such subscription"). Elfogadható-e ez a törékenység a jobb üzenetért cserébe, vagy elég egyetlen, közös `resource_missing` → 404/409 leképezés?
- Az `unknown` prefixű kulcs production alatt ma warning, nem fatal (fail-open a klasszifikációra). Ha a jövőben csak `sk_`/`rk_` prefixű kulcsokat használunk, szigorítható-e fatalra?
- A `sessionId` formátum-ellenőrzés (`cs_` prefix) a `subscription.routes.ts:187` előtt: bekerül-e B4-be, vagy külön, kisebb hardening-tételként marad?
- A Billing Portal live konfigurációja jelenleg tisztán manuális Dashboard-lépés. Érdemes-e a `scripts/stripeSetup.ts`-t kiegészíteni egy `billingPortal.configurations.create/list` hívással, hogy ez is idempotens scripttel legyen létrehozható — vagy ez már túlnyúlik az ~1 napos kereten?
- Kell-e a `ALLOW_TEST_STRIPE_KEY=true` állapotot a `/health` válaszban vagy egy admin felületen is megjeleníteni, hogy egy staging környezet a UI-ból is felismerhető legyen?

---

### B7 — Adatbázis-mentés és visszaállítás: nincs rutin, a restore soha nem volt kipróbálva (~2–4 óra)

*Súlyosság: magas (adatvesztési kockázat + biztonsági kitettség). Launch-blocker, mert a jelenlegi állapotban egyetlen dokumentált visszaállítási eljárásunk van, és az **bizonyítottan hibás**: pontosan abban a helyzetben hasal el, amiért létezik. Élesben egy elrontott migráció vagy egy hibás tömeges törlés után nincs bizonyítottan működő út vissza. A blocker túlnyomó része dokumentáció- és eljárásmunka, de van benne egy valódi, repo-oldali technikai javítás is. Implementációs sorrend: **6., utolsó** — nem nyúl alkalmazáskódhoz, így nem tudja érvényteleníteni a korábbi blockerek munkáját, a Render-oldali fele pedig azt feltételezi, hogy a production instance már a végleges alakjában áll.*

#### Mi a hiba

**1. Nincs semmilyen automatizálás — sehol.** Nincs backup/dump/restore npm script (`server/package.json:6-13` scriptjei: `dev`, `seed:developer`, `stripe:setup`, `build`, `start`, `test`, `test:watch`; a root `package.json:9-14`-ben `dev`, `build`, `lint`, `preview`). Nincs cron. A `.github/workflows/ci.yml` az egyetlen workflow-fájl a repóban, és a `:10-12` triggere kizárólag `push` és `pull_request` — `schedule:` blokk nincs benne.

**2. A dokumentált visszaállítási parancs hibás. Ez a legfontosabb elem, és repo-oldali javítás.** A `docs/render-deployment.md:243` egy sima `pg_dump "$DATABASE_URL" > backup-$(date +%F).sql` dumpot vesz `--clean` és `-C` **nélkül**, a `:245` pedig `psql "$DATABASE_URL" < backup-....sql`-lel állítja vissza. Egy `--clean` nélküli plain dump csak `CREATE TABLE` + `COPY` utasításokat tartalmaz: ez **kizárólag üres adatbázisba megy be sikeresen**. Egy nem üres adatbázisban — vagyis pontosan abban az incidensben, amire az eljárás való, ahol a séma és a sorok ott vannak, csak rosszak — `relation "Company" already exists` és duplicate key hibák sorozatát kapjuk. Rosszabb: a `psql` alapértelmezés szerint **nem áll meg hibán** (`ON_ERROR_STOP` nincs beállítva), így végigfut, 0-s exit kóddal kilép, és félig visszaállított adatbázist hagy maga után. Ez rosszabb, mint a tiszta hiba, mert sikernek látszik.

**3. A visszaállítás soha nem volt kipróbálva.** A `docs/production-checklist.md:67-71` „## Backups" szakaszának mindhárom pontja bepipálatlan; a `:71` („Visszaállítás egyszer kipróbálva") közvetlen megerősítése annak, hogy a próba nem történt meg. A `:70` ráadásul a rendszeres mentési rutint is *(automatizálása jövőbeli feladat)* megjegyzéssel tolja el. A `docs/release-candidate-checklist.md:69-75` Part 5 fejezetcíme mentést ígér, de az egyetlen tétel a `:75`-ön ugyanaz a deploy előtti `pg_dump` — restore-próba tétel egyáltalán nincs benne.

**4. Az uploads mentése követelményként ki van mondva, eljárás nélkül.** A `render-deployment.md:245-246` szerint „a feltöltött fájlokat külön kell menteni a `/var/data/uploads` mountról" — és ehhez nulla procedúra tartozik. Mióta a DB managed Postgresre költözött (`server/prisma/schema.prisma:6` `provider = "postgresql"` + `env("DATABASE_URL")`, lásd `docs/environment.md:96`), az a disk **már csak uploadokat tart**. A `ProjectAttachment` sorok (`schema.prisma:258-282`, `fileUrl` mező) a diszken lévő fájlokra hivatkoznak, amiket a `server/src/middleware/upload.middleware.ts:17-18` az `UPLOAD_ROOT/projects` alá ír — és **ugyanígy a `Company.logoUrl`**, amit a `server/src/routes/company.routes.ts:212` `/uploads/logos/<fájl>`-ként ment a DB-be, a fájl pedig az `upload.middleware.ts:22` szerinti `UPLOAD_ROOT/logos` alá kerül. Menteni tehát a **teljes `UPLOAD_ROOT`-ot** kell (`projects` + `logos`), nem csak az egyik alkönyvtárat. Csak-DB visszaállítás után minden attachment- és logó-hivatkozás megmarad, de a fájl 404 — az adatbázis és a disk **együtt** konzisztens vagy sehogy.

**5. A DB-tier deklarálatlan, így a backup-képesség ellenőrizhetetlen.** A `render-deployment.md:54-66` kézi dashboard-walkthrough hozza létre az instance-t; plan/tier **sehol nincs kimondva** (a fájlban a `Free|tier|plan|ingyen|30 nap|retention` keresés nem ad találatot), és `render.yaml` / blueprint sincs a repóban. A `:120` egyetlen mondattal intézi el a kérdést: a backup/PITR „a DB-szolgáltató dolga" — procedúra, ütemezés, retention és RPO/RTO nélkül. Vagyis épp az a képesség, amire az egész terv épül, forrásból nem megállapítható és nem verifikálható.

**6. Elavult megfogalmazás: a rollback-terv és a mentési lépés két különböző mechanizmusról beszél.** A `release-candidate-checklist.md:82` (Part 6, Rollback) a Part 5 mentését *disk-mentésnek* nevezi — ez SQLite-korabeli szóhasználat, a Part 5 `:75` viszont egy `pg_dump`. Ugyanez a hiba két másik helyen is ott van: a `production-checklist.md:71` „(backup fájl visszamásolása + restart)" ugyanazt a fájl-visszamásolós mechanizmust írja le, a `render-deployment.md:121` pedig — másik helyesírással, `diszk-mentésé` alakban — szintén erre a megszűnt mechanizmusra hivatkozik. Aki incidensben ezt olvassa, nem azt fogja keresni, ami valójában van.

**7. Biztonsági rés, nem csak ops-kérdés.** Ennek az adatbázisnak a dumpja tartalmazza a `User.password` bcrypt hasheket, a teljes `Customer`-állományt és a Stripe-azonosítókat (`schema.prisma:64-65`: `stripeCustomerId`, `stripeSubscriptionId`). **Sehol nincs kimondva, hogy a dumpok hol tárolódnak, meddig, és titkosítva vannak-e.** A `.gitignore:35-37` a legacy SQLite fájlt kizárja, de dump-mintát (`*.dump`, `backup-*`) nem tartalmaz — a `backup-$(date +%F).sql` a working directoryba íródik, tehát egy figyelmetlen `git add .` commitolhatóvá teszi. A tárolás helye biztonsági döntés.

**Repo-oldal vs. Render-oldal.** A blocker két félből áll, és ezt végig külön kell tartani:
- **Repo-oldal** (egy későbbi session-ben Claude el tudja végezni, kód nem, csak dokumentáció és `.gitignore` változik): a hibás restore-parancs javítása, valódi restore-eljárás verifikációs lépéssel, uploads-eljárás, a DB-tier deklarálása a doksiban, az elavult „disk-mentés" szöveg javítása, retention/RPO/RTO/tárolási hely kimondása.
- **Render-oldal** (**csak Anna tudja megcsinálni**, dashboard-hozzáférés kell): a DB plan/tier megerősítése, annak ellenőrzése, hogy a napi backup és a PITR ténylegesen elérhető és **be van kapcsolva**, valamint a restore **egyszeri, valódi lefuttatása**.

#### Érintett fájlok

| Fájl | Sor | Mi történik |
|---|---|---|
| `docs/render-deployment.md` | 242–246 | A „7. Rollback-stratégia" **Adat** pontja — az egyetlen helyen dokumentált teljes mentés→visszaállítás ciklus. Ezt kell kicserélni a javított parancsokra és rövid összefoglalóra, a részleteket az új `docs/backup-restore.md`-be linkelve. |
| `docs/render-deployment.md` | 243 | `pg_dump "$DATABASE_URL" > backup-$(date +%F).sql` — `--clean`/`-C`/`--format=custom` nélkül. Cserélendő. |
| `docs/render-deployment.md` | 245 | `psql "$DATABASE_URL" < backup-....sql` — a hibás restore. Cserélendő `pg_restore --clean --if-exists --single-transaction`-re. Ugyanez a sor mondja ki procedúra nélkül az uploads külön mentését. |
| `docs/render-deployment.md` | 54–66 | „0. Adatbázis — Render PostgreSQL" kézi walkthrough. Ide kerül egy rövid táblázat: plan/tier, PostgreSQL major verzió, backup-képesség (napi snapshot / PITR) és retention. |
| `docs/render-deployment.md` | 117–121 | „Perzisztens tárolás — miért így": a `:120` „Backup/PITR a DB-szolgáltató dolga" mondat kiegészítendő azzal, *melyik* képesség, *milyen* ütemezéssel és retentionnel, plusz link a `backup-restore.md`-re; a `:121` „nem a diszk-mentésé" tagmondat elavult SQLite-korabeli szöveg, átírandó. |
| `docs/production-checklist.md` | 67–71 | „## Backups" szakasz, mindhárom pont bepipálatlan. A `:69` parancsa javítandó, a `:70` *(automatizálása jövőbeli feladat)* megjegyzése a tudatos döntésre cserélendő, a `:71` „(backup fájl visszamásolása + restart)" megfogalmazása a `pg_restore`-alapú eljárásra írandó át, és a tétel a drill lefuttatása után pipálható. |
| `docs/release-candidate-checklist.md` | 69–75 | „Part 5 — Stripe / Resend / Uploads / Backups": a `:75` parancsa javítandó, és ide kell két új tétel — uploads-mentés és „restore-próba lefutott" (dátummal). |
| `docs/release-candidate-checklist.md` | 82 | „a Part 5 **disk-mentés** visszamásolása + restart" — elavult SQLite-korabeli szöveg, a Part 5 valójában `pg_dump`. Átírandó, és ki kell egészíteni a `prisma migrate deploy` kölcsönhatásával. |
| `.gitignore` | 35–37 | A legacy SQLite blokk után új szakasz: `*.dump`, `backup-*`, `axeriva-*.sql`, `uploads-*.tar.gz` — a dumpok soha ne legyenek commitolhatók. **Blanket `*.sql` NEM használható** (indoklás az A7-ben). |
| `.github/workflows/ci.yml` | 10–12 | `on: push: / pull_request:` — nincs `schedule:`. **Változatlan marad**; a tervben ki kell mondani, hogy tudatosan nem adunk hozzá ütemezett dump-jobot (indoklás lent). |
| `server/package.json` | 6–13 | Scriptek — **változatlan marad**, nem adunk `backup`/`restore` scriptet (indoklás lent). |
| `server/prisma/schema.prisma` | 6, 64–65, 258–282 | Provider `postgresql`; `stripeCustomerId`/`stripeSubscriptionId`; `ProjectAttachment.fileUrl`. Nem módosul — a dump érzékenységének és a DB↔uploads csatolásnak a bizonyítéka. |
| `server/src/middleware/upload.middleware.ts` | 17–18, 22 | `UPLOAD_ROOT` / `UPLOADS_DIR = UPLOAD_ROOT/projects` / `LOGOS_DIR = UPLOAD_ROOT/logos` — a **teljes `UPLOAD_ROOT`** az, amit menteni kell (a logókat a `routes/company.routes.ts:212` írja `/uploads/logos/` alá). Nem módosul. |
| `server/src/app.ts` + `server/src/middleware/signedUploads.middleware.ts` | 124–129, ill. 33–35 | A `/uploads` mount aláírás-ellenőrzés mögött ül: érvényes `exp`/`sig` nélkül **404**. Nem módosul — a drill D6 lépésének elvárását ez határozza meg. |
| `docs/backup-restore.md` | — | **Új fájl.** A mentés/visszaállítás kanonikus leírása: parancsok, restore-eljárás verifikációval, uploads-eljárás, retention/RPO/RTO, tárolási hely, és a restore-drill lépéssora + a lefuttatás naplója. |

#### Tervezett változtatás

**A) Repo-oldal — dokumentáció és `.gitignore` (Claude el tudja végezni)**

**A1. Új fájl: `docs/backup-restore.md`.** Ez legyen az egyetlen kanonikus forrás; a `render-deployment.md`, a `production-checklist.md` és a `release-candidate-checklist.md` csak rövid összefoglalót tart meg + ide linkel. Szakaszai: *Mit mentünk* (DB + uploads, és miért kell a kettő együtt) · *Mentés* · *Visszaállítás* · *Verifikáció* · *Restore-próba (drill)* · *Retention, RPO/RTO, tárolási hely* · *Render-oldali képességek*.

**A2. A mentési parancs javítása.** Az ajánlott alak a custom formátum: egyetlen tömörített fájl, amit a `pg_restore` `--clean`-nel, egy tranzakcióban tud visszatölteni (ugyanezt tudja a `--format=directory` is, csak könyvtárstruktúrában; plain SQL dumpot viszont a `pg_restore` egyáltalán nem olvas):

```bash
# Render External Database URL-lel, a saját gépről (sslmode=require kell — render-deployment.md:61-63)
pg_dump --format=custom --no-owner --no-privileges \
  --file="axeriva-$(date +%F-%H%M).dump" "$DATABASE_URL"
```

PowerShell-változat is kell a doksiba, mert Anna Windowson dolgozik, és a jelenlegi `$(date +%F)` bash-izmus ott egyszerűen nem fut le:

```powershell
$stamp = Get-Date -Format 'yyyy-MM-dd-HHmm'
pg_dump --format=custom --no-owner --no-privileges --file="axeriva-$stamp.dump" $env:DATABASE_URL
```

Indoklás, amit ki kell írni a doksiba: `--no-owner --no-privileges` azért, mert a drill- és a cél-adatbázis role-jai nem azonosak — nélkülük a restore `ALTER ... OWNER TO` hibákat dob. A `pg_dump` kliens verziója legyen **azonos vagy újabb**, mint a szerveré, különben a dump el sem indul (`server version mismatch`) — ezért kell a PostgreSQL major verziót az A5-ben deklarálni.

**A3. A visszaállítási parancs javítása + valódi eljárás.** A `render-deployment.md:245` cseréje:

```bash
pg_restore --clean --if-exists --no-owner --no-privileges \
  --single-transaction --dbname="$DATABASE_URL" axeriva-2026-07-25-1830.dump
```

Doksiban kimondandó, mit old meg mindegyik kapcsoló: `--clean` eldobja a meglévő objektumokat, mielőtt újra létrehozná őket — **ettől működik nem üres adatbázison is**; `--if-exists` miatt üres adatbázison sem hasal el a DROP; `--single-transaction` pedig mindent egyetlen tranzakcióba tesz, tehát vagy teljesen visszaáll, vagy semmi nem változik — nincs félkész állapot (ez implikálja az exit-on-error viselkedést is).

Ha valamiért plain SQL dump kell (olvashatóság, szemrevételezés), akkor a helyes páros — figyelem, ezt már **nem** a `pg_restore`, hanem a `psql` tölti vissza:

```bash
pg_dump --clean --if-exists --no-owner --no-privileges "$DATABASE_URL" > axeriva-2026-07-25.sql
psql --set ON_ERROR_STOP=on --single-transaction --dbname "$DATABASE_URL" --file axeriva-2026-07-25.sql
```

Az `ON_ERROR_STOP=on` nem opcionális: enélkül a `psql` átgázol a hibákon és sikerrel tér vissza.

A **verifikációs lépés** az eljárás kötelező része (ma egyáltalán nincs ilyen). A visszaállítás után:

```sql
-- 18 modell (schema.prisma) + _prisma_migrations = 19
SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';

SELECT 'Company' AS t, COUNT(*) FROM "Company"
UNION ALL SELECT 'User',              COUNT(*) FROM "User"
UNION ALL SELECT 'Customer',          COUNT(*) FROM "Customer"
UNION ALL SELECT 'Project',           COUNT(*) FROM "Project"
UNION ALL SELECT 'ProjectAttachment', COUNT(*) FROM "ProjectAttachment"
UNION ALL SELECT 'Shift',             COUNT(*) FROM "Shift";

-- minden migráció befejezett; a sorok száma = a server/prisma/migrations/ alkönyvtárak száma
SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY started_at;
```

plusz `DATABASE_URL`-t a visszaállított adatbázisra állítva `npx prisma migrate status` → „Database schema is up to date!". (A táblanevek idézőjelesek, mert a séma nem használ `@@map`-et — a Prisma modellnév a táblanév, kis-nagybetű-érzékenyen.)

Végül egy figyelmeztető blokk, ami ma sehol nincs leírva, pedig incidensben ez fog fájni: a Start Command minden induláskor `prisma migrate deploy`-t futtat (`server/package.json:11`). Ha egy régebbi dumpot állítunk vissza, a **következő restart automatikusan újra felviszi a hiányzó migrációkat**. Ha az incidens oka épp egy destruktív migráció volt, akkor a restore után az újraindulás **újra elrontja** ugyanazt. Ezért: a hibás migrációt a repóban vissza kell vonni (vagy a deployt a korábbi buildre kell rögzíteni) **még a restart előtt**. Ez a `render-deployment.md:237-241` „a migrációk csak előre mennek" szabályának a hiányzó másik fele.

**A4. Uploads-mentési eljárás.** Ma követelmény procedúra nélkül. A doksinak konkrét parancsot kell adnia, és a **teljes `UPLOAD_ROOT`-ot** kell mentenie: a `projects` (attachmentek) és a `logos` (cég-logók) alkönyvtár együtt. Két járható út, a döntés Anna-oldali (lásd nyitott kérdések) — az elfogadott változat kerüljön be, a másik alternatívaként:

```bash
# a) Render Shell (Web Service → Shell): a teljes uploads könyvtár tarba csomagolása,
#    majd letöltés a render CLI-vel — a projects/ ÉS a logos/ alkönyvtárral együtt
tar -czf /tmp/uploads-$(date +%F).tar.gz -C /var/data uploads

# b) Visszaállítás (helyben vagy új diskre)
tar -xzf uploads-2026-07-25.tar.gz -C /var/data
```

Ki kell mondani, hogy az uploads-mentés és a DB-dump **ugyanabban az időablakban** készüljön, különben az újonnan feltöltött fájlokra mutató `ProjectAttachment` sorok (és a `Company.logoUrl`) fájl nélkül maradnak (vagy fordítva: árva fájlok maradnak). Teljes RPO szempontból a kettő közül a régebbi számít.

**A5. A DB-tier és a backup-képesség deklarálása.** A `render-deployment.md:54-66` „0." pontja alá egy rövid táblázat, amit Anna a dashboardból tölt ki (üresen hagyott mezőkkel ne maradjon; a kitöltés Render-oldali feladat):

| Tétel | Érték |
|---|---|
| Render PostgreSQL plan/tier | *(kitöltendő)* |
| PostgreSQL major verzió | *(kitöltendő — ehhez kell illeszkedő `pg_dump` kliens)* |
| Napi automatikus backup | van / nincs — retention: *(nap)* |
| Point-in-time recovery (PITR) | van / nincs — ablak: *(nap)* |

A `:120` „Backup/PITR a DB-szolgáltató dolga" mondat maradhat, de kiegészítve: melyik képesség aktív, milyen retentionnel, és hogy ez **nem** helyettesíti a deploy előtti kézi dumpot. A közvetlenül utána álló `:121` „nem a diszk-mentésé" tagmondat viszont elavult (SQLite-korabeli) szembeállítás — a helyére az kerül, hogy a DB-t a szolgáltatói backup + a kézi `pg_dump` fedi, a diszk pedig **az uploadokat** (A4), és a kettő együtt ad teljes mentést.

**A6. Retention / RPO / RTO / tárolási hely kimondása.** A `docs/backup-restore.md`-be konkrét vállalás kell (a számok javaslatok, a döntés Anna-oldali): kézi deploy-előtti dump megőrzése *N* nap; a szolgáltatói napi backup retentionje amennyi a tierhez jár; **RPO** = a szolgáltatói napi mentés köze (ill. 0 a deploy előtti pillanatra, mert ott kézi dump készül); **RTO** = a drillben ténylegesen mért visszaállítási idő, nem becslés. Külön, jól látható biztonsági bekezdés: a dump `User.password` bcrypt hasheket, teljes ügyféladatot és Stripe-azonosítókat tartalmaz — **titkosított tárolóra kerül, megnevezett helyre, megnevezett megőrzési idővel, és a retention lejártakor törlendő**; e-mailben, chatben, felhőmappában, repóban nem tárolható. Ezt támogatja meg az A7 `.gitignore` bejegyzése.

**A7. Konzisztencia-javítások.** (i) `release-candidate-checklist.md:82`: a „disk-mentés" → `pg_dump`-alapú visszaállítás, `render-deployment.md` 7. pontjára hivatkozva, plusz a `migrate deploy` figyelmeztetés egy mondatban. (ii) `release-candidate-checklist.md` Part 5: a `:75` parancs javítása + két új tétel (uploads-mentés; restore-próba lefutott, dátummal). (iii) `production-checklist.md:69-71`: a `:69` parancs javítása, a `:70` *(automatizálása jövőbeli feladat)* megjegyzés cseréje a tényleges döntésre, a `:71` szövegében pedig a „(backup fájl visszamásolása + restart)" — ami ugyanaz az elavult SQLite-korabeli mechanizmus, mint a `:82`-n — cserélendő „(`pg_restore` nem üres adatbázisba, verifikációval)"-ra, a `backup-restore.md` drilljére linkelve. (iv) `.gitignore`, a legacy SQLite blokk után:

```gitignore
# Adatbázis-dumpok és uploads-archívumok — érzékeny adat (bcrypt hashek,
# ügyféladat, Stripe-azonosítók), soha nem kerülhet a repóba.
*.dump
backup-*
axeriva-*.sql
uploads-*.tar.gz

# Belt-and-braces: a Prisma migrációk .sql fájljai KÖVETETTEK és azok is
# maradnak. Blanket `*.sql` mintát ezért tilos felvenni: egy új
# `prisma migrate dev` által generált migration.sql némán kimaradna a
# commitból, és sem a CI globalSetup.ts `migrate deploy`-a, sem a production
# Start Command nem látná a migrációt.
!server/prisma/migrations/**/*.sql
```

**Amit tudatosan NEM csinálunk, és ezt le kell írni.** Nem kerül `backup`/`restore` npm script a `server/package.json`-be és nem kerül `schedule:` a `ci.yml`-be. Egy ütemezett GitHub Actions dump-jobhoz élő production DB-credential kellene GitHub secretként és kifelé nyitott DB-elérés — ez érdemi támadási felületet nyitna egy olyan képességért, amit a managed szolgáltató amúgy is nyújt, ráadásul a dumpot a runner fájlrendszerére tenné. A `ci.yml:23-24` szándékosan `permissions: contents: read`; ezt nem tágítjuk. A rendszeres mentés mechanizmusa a szolgáltatói napi backup (A5), a repo dolga ennek dokumentálása és a visszaállítás bizonyítása. Ha később mégis kell saját ütemezett dump, az önálló feladat, saját threat-modellel.

**B) Render-oldal — csak Anna tudja elvégezni**

- **R1.** Dashboard → a PostgreSQL instance: plan/tier és PostgreSQL major verzió leolvasása, beírása az A5 táblázatba.
- **R2.** Annak ellenőrzése, hogy a napi automatikus backup és a PITR ezen a tieren **ténylegesen elérhető-e és be van-e kapcsolva**, mennyi a retention/ablak. Ha nem elérhető: döntés, hogy tier-váltás jön, vagy tudatosan elfogadjuk a csak-kézi-dump RPO-t — a döntés, indoklással, a `backup-restore.md`-be kerül.
- **R3.** A **restore-drill** egyszeri lefuttatása (lásd „Tesztek"), és az eredmény (dátum + mért RTO) rögzítése.
- **R4.** A dumpok tárolási helyének kijelölése és beállítása (titkosított tároló), a retention érvényesítésével.
- **R5.** A `production-checklist.md:69-71` és a `release-candidate-checklist.md` Part 5 tételeinek bepipálása, miután R1–R4 megvan.

#### Tesztek

**Ez a blocker nem szállít alkalmazáskódot, ezért új vitest teszt nem készül.** A `server/src/tests/` harness (`helpers/factories.ts`, `helpers/db.ts`, `globalSetup.ts`) érintetlen marad, a CI-nak nincs mit futtatnia rá. A „teszt" itt egy **egyszer végrehajtott, pass/fail kritériummal rendelkező restore-drill**, és annak leírása a `docs/backup-restore.md` `## Restore-próba (drill)` szakaszában él — a lefuttatás eredménye (dátum, mért RTO, pass/fail) ugyanoda, egy sorba kerül.

**Fontos: a drill NEM production ellen fut**, és **nem** az `axeriva_test` adatbázis ellen. Utóbbi a vitest suite célpontja: a `server/src/tests/helpers/db.ts` mind a 18 táblát üríti tesztek között, a `globalSetup.ts:33-55` pedig kifejezetten eldobhatónak tekinti minden olyan adatbázist, aminek a nevében szerepel a `test`. A drill saját, külön nevű scratch adatbázist kap: **`axeriva_restore_drill`**, a lokális PostgreSQL-en (ami az integrációs teszteknél amúgy is fel van állítva — `docs/environment.md:85`), tehát a drill nem kerül pénzbe és nem érint Render-erőforrást a dump kiolvasásán kívül. A név szándékosan nem tartalmazza a `test` markert, így a suite ellene el sem indulna; a `TEST_DATABASE_URL`-t **soha ne** állítsuk erre az adatbázisra.

**A drill lényege egy dolog: a restore-t KÉTSZER kell lefuttatni.** Az első futás üres adatbázisba megy — ez a régi, hibás parancscsal is sikerülne, tehát önmagában semmit nem bizonyít. A **második futás egy már feltöltött adatbázisba** megy, és pontosan ez az a helyzet, amiben a jelenlegi `psql < backup.sql` eljárás elhasalna. Az is fontos, hogy a dump **ne legyen üres**: a production az első deploy után üresen indul (`render-deployment.md:68-72`), egy üres dump visszaállítása nem bizonyít semmit.

Lépések:

1. **D0 — forrásadat.** Vagy egy production dump a smoke test után (tehát már van benne cég, user, projekt, legalább egy `ProjectAttachment`), vagy lokálisan összeállított adat: `npm run seed:developer`, majd a UI-ból egy cég regisztrálása, egy customer, egy projekt és **egy feltöltött attachment** (jó, ha egy cég-logó is). Attachment nélkül a drill nem tudja lefedni a DB↔uploads csatolást.
2. **D1 — dump.** Az A2 `pg_dump --format=custom` parancsa. Ellenőrzés: a fájl létezik és a mérete > 0. Uploads oldalról az A4 `tar` a **teljes `UPLOAD_ROOT`-ról** (`projects` + `logos`) — csak a `projects` mentése a logókat elveszítené.
3. **D2 — scratch DB.** `CREATE DATABASE axeriva_restore_drill;` a lokális PostgreSQL-en. **A restore parancs kiadása előtt írasd ki és olvasd el a cél connection stringet** — a `--clean` eldob mindent, amit talál; rossz `DATABASE_URL`-lel ez a production megsemmisítése.
4. **D3 — első restore (üres célba).** Az A3 `pg_restore` parancsa. **Elvárás:** 0-s exit kód, hibaüzenet nélkül.
5. **D4 — verifikáció.** Az A3 lekérdezései: tábla-darabszám = 19; a `Company`/`User`/`Customer`/`Project`/`ProjectAttachment`/`Shift` sorszámok **pontosan** egyeznek a forrás adatbázis ugyanezen számaival; `_prisma_migrations` minden sorában `finished_at IS NOT NULL`, a sorok száma = a `server/prisma/migrations/` alkönyvtárak száma; `npx prisma migrate status` → „Database schema is up to date!".
6. **D5 — MÁSODIK restore (nem üres célba).** Ugyanaz a `pg_restore` parancs, ugyanarra a `axeriva_restore_drill` adatbázisra, most már feltöltött állapotban. **Ez a drill lényegi lépése.** Elvárás: 0-s exit kód, és D4 összes ellenőrzése változatlanul átmegy (nem duplázódtak a sorok, nem maradt félkész állapot).
7. **D6 — alkalmazásszintű ellenőrzés.** A backend indítása a `DATABASE_URL`-t a drill adatbázisra állítva, `UPLOAD_ROOT`-tal a kicsomagolt uploads könyvtárra. Elvárás: (a) bejelentkezés egy ismert, visszaállított fiókkal sikerül — ez bizonyítja, hogy a bcrypt hashek épen jöttek át; (b) a projekt megnyílik és az attachment listázódik; (c) az attachment-lista válaszában visszaadott **aláírt** URL (`?exp=…&sig=…`) a `/uploads` mountról **200-zal** és helyes content type-pal jön vissza — ez bizonyítja, hogy a DB és az uploads együtt konzisztens. Figyelem: a DB-ben tárolt nyers `fileUrl` GET-elése **nem** érvényes ellenőrzés, mert aláírás nélkül szándékosan **404** a válasz (`server/src/app.ts:124-129` a `requireSignedUploadUrl()`-t az `express.static` elé fűzi, a `server/src/middleware/signedUploads.middleware.ts:33-35` pedig hibás/hiányzó aláírásra 404-et ad, hogy ne legyen oracle).
8. **D7 — RTO mérés.** A D3 kezdetétől a D6 végéig eltelt idő; ez a szám kerül a `backup-restore.md` RTO mezőjébe (becslés helyett).
9. **D8 — takarítás.** `DROP DATABASE axeriva_restore_drill;`, a drill dump és a kicsomagolt uploads törlése a gépről (érzékeny adat — lásd A6).

**Pass/fail kritérium:** a drill **akkor és csak akkor sikeres**, ha a D5 (második, nem üres célba futtatott restore) 0-s exit kóddal lefut, **és** utána a D4 minden ellenőrzése átmegy, **és** a D6 mindhárom pontja teljesül. Bármelyik elbukása esetén a `production-checklist.md:71` nem pipálható, és a launch blokkolva marad.

**Kiegészítő, olcsó ellenőrzés (a doksi-munka végén):** `grep -rn "psql .*<\|disz\?k-mentés\|backup-\$(date" docs/` — nem adhat találatot a javítás után. A `disz\?k` azért kell, mert a repóban mindkét írásmód előfordul (`disk-mentés` a `release-candidate-checklist.md:82`-n, `diszk-mentésé` a `render-deployment.md:121`-en), és a szűkebb minta pont az egyiket hagyná bent. Ez fogja meg, ha a régi parancs vagy a régi szóhasználat valamelyik doksiban ottfelejtődött.

#### Regressziós kockázat

**Alkalmazáskódra nézve nulla.** A változás dokumentáció + `.gitignore`; a `server/package.json` és a `.github/workflows/ci.yml` nem módosul, a vitest suite és a CI-pipeline viselkedése változatlan.

A valódi kockázatok a végrehajtásban vannak:

- **A `--clean` rossz adatbázison = teljes adatvesztés.** Ez az egyetlen komoly kockázat az egész blockerben, és épp az új parancs vezeti be (a régi parancs „biztonsága" abból fakadt, hogy nem működött). Mitigáció, amit a doksiba is bele kell írni: a drill kizárólag a lokális `axeriva_restore_drill` ellen fut; a `pg_restore` kiadása előtt a cél connection stringet ki kell íratni és el kell olvasni; production ellen `--clean` csak valódi incidensben, tudatosan.
- **A `.gitignore` túl tág mintája elrejthet egy migrációt.** Blanket `*.sql` esetén egy új `prisma migrate dev` `migration.sql`-je némán kimaradna a commitból, és a hiány csak a következő deploynál (vagy a CI `migrate deploy`-ánál) derülne ki. Ezért csak célzott minták mennek be, plusz a `!server/prisma/migrations/**/*.sql` negáció; a felvétel után egy `git status` / `git check-ignore -v server/prisma/migrations/*/migration.sql` ellenőrzés kötelező.
- **`--single-transaction` és a lockok.** Nagy adatbázisnál a restore végig fogja a lockokat, és amíg fut, az alkalmazás nem használható. Jelen méretnél ez másodpercek kérdése, de az RTO-nál (D7) ezt kell mérni, nem feltételezni.
- **`pg_dump` kliens–szerver verzióeltérés.** Ha a lokális kliens régebbi, mint a Render szervere, a dump el sem indul. Ezért kötelező az A5-ben a major verzió deklarálása.
- **`prisma migrate deploy` visszahozza a hibát.** Régi dump visszaállítása után a restart automatikusan újra felviszi a migrációkat; ha az incidens oka egy destruktív migráció volt, ez újra elrontja. Az A3 figyelmeztető blokkja pontosan ezért nem elhagyható.
- **A tier-váltás nem feltétlenül helyben történik.** Ha az R2 alapján plan-váltás kell, elképzelhető, hogy az új instance új connection stringet jelent — vagyis `DATABASE_URL`-csere és leállás. Ennek pontos menetét a Render dashboardján kell ellenőrizni, mielőtt bármit átkapcsolunk; ne feltételezzük, hogy zökkenőmentes.
- **A drill maga hoz létre érzékeny másolatot.** A dump és a kicsomagolt uploads a fejlesztői gépen landolnak. A D8 takarítás nem opcionális, a `.gitignore`-bejegyzés pedig csak a commitolás ellen véd, a gépen maradás ellen nem.

#### Kész, ha

**Repo-oldal**

- [ ] Létezik `docs/backup-restore.md`, és a `render-deployment.md`, `production-checklist.md`, `release-candidate-checklist.md` mind erre linkel.
- [ ] A `render-deployment.md:243` mentési parancsa `--format=custom --no-owner --no-privileges`-re javítva, PowerShell-változattal együtt.
- [ ] A `render-deployment.md:245` visszaállítási parancsa `pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction`-re javítva, a kapcsolók indoklásával — és sehol nem maradt `psql "$DATABASE_URL" < backup-....sql`.
- [ ] A visszaállítási eljárás tartalmaz **verifikációs lépést** (tábla-darabszám, sorszámok, `_prisma_migrations`, `prisma migrate status`).
- [ ] Le van írva a `prisma migrate deploy` kölcsönhatása: restore után a restart újra felviszi a migrációkat, ezért a hibás migrációt előbb vissza kell vonni.
- [ ] Az uploads mentése/visszaállítása konkrét parancsokkal dokumentált, a **teljes `UPLOAD_ROOT`-ra** (`projects` + `logos`), és ki van mondva, hogy a DB-dumppal egy időablakban kell készülnie.
- [ ] A `render-deployment.md` 0. pontjában ott a DB-tier / PostgreSQL verzió / napi backup / PITR táblázat, a `:120` mondat konkrétumokra cserélve, a `:121` „diszk-mentés" szembeállítása pedig javítva.
- [ ] Ki van mondva a retention, az RPO és az RTO, valamint a dumpok **tárolási helye és titkosítása**, azzal az indoklással, hogy a dump bcrypt hasheket, ügyféladatot és Stripe-azonosítókat tartalmaz.
- [ ] A `release-candidate-checklist.md:82` „disk-mentés" és a `production-checklist.md:71` „backup fájl visszamásolása + restart" megfogalmazása javítva; a Part 5, a Part 6 és a production-checklist ugyanarról a mechanizmusról beszél.
- [ ] A `.gitignore` kizárja a `*.dump`, `backup-*`, `axeriva-*.sql`, `uploads-*.tar.gz` mintákat, **blanket `*.sql` nélkül**, és a `git check-ignore -v server/prisma/migrations/*/migration.sql` nem ad találatot.
- [ ] Le van írva, hogy ütemezett dump-jobot **tudatosan nem** adunk a CI-hoz, indoklással.
- [ ] `grep -rn "psql .*<\|disz\?k-mentés\|backup-\$(date" docs/` nem ad találatot.

**Render-oldal (Anna)**

- [ ] A DB plan/tier és a PostgreSQL major verzió leolvasva és beírva a doksiba.
- [ ] Tisztázva és dokumentálva, hogy a napi automatikus backup és a PITR elérhető-e ezen a tieren, be van-e kapcsolva, és mennyi a retention/ablak — ha nem elérhető, a döntés (tier-váltás vagy vállalt kockázat) le van írva.
- [ ] A dumpok tárolási helye kijelölve és beállítva, titkosítva, a retention érvényesítve.
- [ ] A **restore-drill lefutott**, a D5 (nem üres célba történő második restore) átment, és az eredmény dátummal + mért RTO-val rögzítve a `backup-restore.md`-ben.
- [ ] A `production-checklist.md:69-71` mindhárom pontja — beleértve a `:71` „Visszaállítás egyszer kipróbálva" tételt — bepipálva, mert ténylegesen megtörtént.

#### Nyitott kérdések (implementáláskor eldöntendő)

- Uploads-mentés csatornája: Render Shell + `tar` és letöltés a render CLI-vel, vagy a Shellből közvetlen feltöltés objektumtárolóba? A terv mindkettőre ad parancsot, de a választás (és a hozzá tartozó credential-kezelés) Anna döntése — a doksiba a kiválasztott változat kerüljön be elsődlegesként.
- A jelenlegi Render PostgreSQL plan/tier ismeretlen. Ha kiderül, hogy nincs rajta napi automatikus backup vagy PITR, akkor tier-váltás jön, vagy tudatosan vállaljuk a csak-kézi-dump RPO-t? A váltás ára, és hogy jár-e connection string cserével + leállással, csak a dashboardról derül ki.
- Hol tároljuk a dumpokat, és mivel titkosítjuk? Ez biztonsági döntés, nem ops: a fájl bcrypt hasheket, teljes ügyféladatot és Stripe-azonosítókat tartalmaz. A terv megköveteli, hogy legyen megnevezett hely és titkosítás, de nem választ helyette.
- A konkrét retention / RPO / RTO számok. A terv javasol értékeket és megköveteli, hogy az RTO mért (a drillből származó) legyen, de a vállalás mértéke üzleti döntés.
- Legyen-e később mégis saját ütemezett dump? A terv most tudatosan nemet mond (credential-kitettség a CI-ban), de ha a szolgáltatói backup nem elég, ez külön feladatként visszatér — és akkor el kell dönteni, hol fut és hogyan kapja a DB-credentialt.
- A dokumentáció elhelyezése: külön `docs/backup-restore.md` (a terv ezt javasolja), vagy inkább a `render-deployment.md` 7. pontjának kibővítése? Ha az utóbbi, a `docs/` fájllistája nem nő, viszont a mentés/visszaállítás beleolvad egy deployment-walkthroughba.

---
