# Axeriva — Calendar rendszer: architektúra és fejlesztési terv

*Készült: 2026-08-01. Státusz: **JÓVÁHAGYVA — 2026-08-01, hét
finomítással.** Az implementáció a [calendar-cal1-scope.md](calendar-cal1-scope.md)
szerint indulhat.
Széria-jelölés: **CAL1.x** (a meglévő S/C/K/B/P/N sorozatok mintájára).
Módszer: a jelenlegi kódbázis teljes feltérképezése (Prisma-séma, RBAC és
auth-réteg, employee/project/customer/shift modulok, N1.x notification-modul,
billing/plan-access réteg, frontend-struktúra) + a meglévő tervdokumentumok
átolvasása.*

> **Ez a dokumentum terv és jóváhagyott döntés-jegyzőkönyv.** Nem tartalmaz
> kódot, nem módosít meglévő fájlt, és **nem hoz létre migrációt**. A
> végrehajtható bontás külön dokumentumban van:
> [calendar-cal1-scope.md](calendar-cal1-scope.md).

---

## Jóváhagyás — 2026-08-01

A terv **elfogadva**, az alábbi hét finomítással. Ezek a döntések
**véglegesek**; a dokumentum további szakaszai már ezeket tükrözik.

| # | Finomítás | Hol csapódik le |
|---|---|---|
| **R1** | A naptár-szintű permission-réteg marad; a globális szerepkörök **nem változnak**. | D2 véglegesítve, Q1 lezárva. §4 |
| **R2** | A `PERSONAL` naptár **alapértelmezetten privát**. | §4.6, §4.8, Q3 lezárva |
| **R3** | A cégtulajdonos **konfigurálhatja a megosztott naptárak jogosultságait**. | §4.5, §4.8 (jogosultsági hatáskör-szétválasztás) |
| **R4** | Az employee személyes naptárának láthatósága **konfigurálható**, **szabad/foglalt és részletes olvasás szétválasztva**. | §4.3 (jog kettévágva), §4.8 (új szakasz), §6.1, §8 |
| **R5** | Az események **hivatkoznak** a forrás-objektumokra (Shift, Project, Customer) — **nem másolják** az adataikat. | D5 kibővítve, §6.3, §6.5 (új), §7 |
| **R6** | A naptár-értesítések a **meglévő N1.x rendszert** használják. | D6 véglegesítve, §9 |
| **R7** | A külső naptár-szinkron **kizárólag roadmap** marad — a CAL1–CAL3 szériában semmilyen előkészítése nem készül. | §15, §16 (Phase 4 elkülönítve) |

**Ami a jóváhagyással lezárult:** Q1 (R1), Q3 (R2+R4).
**Ami még nyitva van az implementáció közben eldönthetően:** Q2, Q4–Q8 —
lásd a 18. szakaszt.

### Második kör — audit-ellenőrzőpont (**D13**)

A jóváhagyás második lépéseként egy **további tervezési ellenőrzőpont**
került be: a naptár-jogosultságok és az események érzékeny adatok, ezért
**minden jogosultság-változás és esemény-mutáció auditálható** kell
legyen — ki hozta létre, ki módosította a jogokat, ki változtatta a
résztvevőket, előző/új érték, időbélyeg, és a művelet **forrása**
(web / API / rendszer).

Ez a követelmény **kibővítette az eredeti tervet**: a §6.4 szűk
`CalendarEventAudit` táblája nem tudta volna rögzíteni a
jogosultság-változást (nem eseményen történik). A megoldás a polimorf
`CalendarAudit` — a teljes tervezés: **§6.6**.

A CAL1 hatókörére gyakorolt hatás: az audit **nem tolódik CAL2.6-ra**.
A tábla a CAL1.1-ben jön létre, és az **írása a CAL1.4/CAL1.5-tel együtt
élesedik** — vagyis a naptár első írási végpontja már auditált. Csak az
audit *olvasó felülete* marad CAL2.6-ra.

---

## 0. Vezetői összefoglaló

A Calendar **nem egy negyedik nézet a Shift-adatokra**, hanem önálló
operatív modul: saját eseménymodell, saját jogosultsági réteg, saját
ismétlődés-motor, és egy **forrás-réteg**, amely a már meglévő
idő-jellegű adatokat (műszak, határidő, feladat, emlékeztető) *olvasva*
jeleníti meg — nem másolva.

A modul három dolgot hoz be a rendszerbe, ami ma **egyáltalán nincs meg**:

1. **Erőforrás-szintű jogosultság.** Ma a jogosultság egyetlen dimenzió: a
   JWT-ben lévő szerepkör (`requireRole(...)`). Nincs „ki láthatja ezt a
   konkrét sort" fogalom sehol a kódban.
2. **Időzóna-tudatos időkezelés.** A `Company.timezone` létezik, validált,
   és **soha nincs kiolvasva** szerveroldalon. Egy naptár enélkül nem
   helyes — a nyári időszámítás minden ismétlődő eseményt elcsúsztat.
3. **Ütemezett, felhasználóhoz kötött kézbesítés.** Az N1.x modul reaktív
   (esemény történik → értesítés). Az emlékeztető proaktív: *előre* tudjuk,
   mikor kell szólni.

**A tizenkét döntés — mind ✅ jóváhagyva 2026-08-01-én**, az R1–R7
finomításokkal (a ✅⊕ jelölés azt jelenti: elfogadva *és* finomítva):

| # | Döntés | Indok |
|---|---|---|
| **D1** | **Egy `CalendarEvent` tábla + egy `Calendar` konténer** — nem négy tábla naptártípusonként | A vízió négy naptártípusa (personal / company / project / employee) **a konténer tulajdonsága, nem négy adatszerkezet**. Ugyanaz a mező-készlet mind a négyben; a különbség a tulajdonos és a láthatóság. Négy tábla = négyszeres API, négyszeres jogosultság-logika, és egy „hol keressem?" kérdés minden lekérdezésnél. |
| **D2** ✅⊕ | **Két rétegű jogosultság: a 3 globális JWT-szerepkör érintetlen marad, fölé kerül egy naptár-szintű permission-réteg** | Ma **nincs ADMIN és nincs MANAGER szerepkör** (`constants/roles.ts` = DEVELOPER / BUSINESS_OWNER / EMPLOYEE). A vízió Owner/Admin/Manager/Employee/Custom modellje **nem fér bele** a mai RBAC-be. A globális RBAC átírása viszont az auth-middleware-t, a JWT-t és mind a 23 routert érintené — közvetlenül egy kiadás után. Részletes indoklás: 4. szakasz. **R1/R4:** a `calendar.view` jog kettéválik `view_free_busy` és `view_details` jogra. |
| **D3** ✅⊕ | **Minden időpont UTC-ben tárolva + explicit IANA `timezone` string az eseményen** | ⚠️ **Az eredeti indoklás elavult (2026-08-02).** A `Company.timezone` már **nem** halott konfiguráció: az N1.8 Phase 0 (`327d252`) élővé tette — `utils/billingFormat.ts:121-135` (`resolveTimeZone`) olvassa és validálja, a `stripeWebhook.routes.ts:349` pedig a számlázási dátumok rendereléséhez használja. **A naptár a második fogyasztó, nem az első.** A UTC-tárolás + eseményszintű IANA-string melletti érv ettől függetlenül áll (DST-helyesség, §5.1) — de a **fallback-érték egyeztetése kötelezővé vált**, lásd **Q8**. |
| **D4** | **Ismétlődés: RFC 5545 RRULE-string tárolása, kibontás olvasáskor** — nem minden előfordulás materializálása | „Minden hétfő, örökké" nem materializálható. A pruning-hoz egy számított `recurrenceEndsAt` oszlop kell, különben minden lekérdezés a bérlő összes ismétlődő szabályát kibontaná. Részletek: 5.2. |
| **D5** ✅⊕ | **Az esemény HIVATKOZIK a forrás-objektumokra, soha nem másolja őket** | Duplikálás esetén azonnal két igazság lenne ugyanarról a műszakról, és a clock-in/out írási útvonalát is szinkronban kellene tartani. **R5 szerint két szinten érvényes:** (a) a `Shift`/`Task`/`Project`/`Reminder` sorok read-only forrás-rétegen jelennek meg, nem eseménnyé konvertálva; (b) az esemény **egyetlen mezőt sem denormalizál** a hivatkozott objektumokból — a cím, a GPS és a megnevezés olvasáskor oldódik fel. Részletek: 6.5 és 7. |
| **D6** | **A notification-integráció registry-append, nem új modul** — egy új `EVENT_PARTICIPANTS` recipient-stratégia és egy új `calendar` kategória | Az N1.x modul pontosan erre készült: „adding a capability is a registry append, never a migration". Új csatorna, új pipeline, új sablonmotor **nem kell**. |
| **D7** | **Az emlékeztetők ütemezése sweep-pel, nem hosszú életű késleltetett job-bal** | A `enqueue(..., { startAfterSeconds })` létezik, de egy 6 hónapra előre betett job-ot az esemény törlése/átmozgatása árván hagy, és a pg-boss archiválása is elérheti. A percenkénti sweep az N1.x-ben már bevált minta. |
| **D8** | **Csatolmányok: a meglévő `services/storage` + aláírt URL réteg újrahasználata**, `CalendarEventAttachment` táblával a `ProjectAttachment` mintájára | Egy második tárolási útvonal megkerülné az R1.5-ös aláírt-URL védelmet. |
| **D9** ✅⊕ | **Audit: append-only tábla**, a `ProjectActivity` mintájára — nem általános diff-motor | A vízió „audit history"-t kér; a repóban erre már van precedens (`ProjectActivity`, `AuditLog`), ugyanazzal a JSON-string metadata-konvencióval. **D13 kibővítette:** a tábla `CalendarAudit` néven polimorf lett, hogy a jogosultság-változást is rögzítse (§6.6). |
| **D10** | **A naptár magja `starter` csomagtól elérhető**; csak a megosztás/custom permission és a külső szinkron fizetős | A vízió szerint ez **core operational module**. Egy naptár nélküli Starter-csomag nem hiteles termék. A `google_calendar` / `outlook_calendar` feature már ma is létezik a registryben `professional` minimummal. |
| **D11** | **Frontend: marad a `react-big-calendar`** (már telepített függőség), a mai árva `CalendarPage.tsx` **törlendő** | `react-big-calendar@1.20.0` + `@types/react-big-calendar` már a `package.json`-ban van, és a `CalendarPage.tsx` **sehonnan nincs importálva** — halott fájl. Új könyvtár bevezetése nem indokolt. |
| **D12** ✅⊕ | **Sem a DEVELOPER, sem a cégtulajdonos NEM kap automatikus olvasást a személyes naptárakra** | A `companyScope()` ma a DEVELOPER-nek **minden bérlő minden során** átenged. Privát személyes eseményekre ez adatvédelmi probléma, nem kényelmi kérdés. **R2 kiterjeszti a cégtulajdonosra is:** a `PERSONAL` naptár alapértelmezetten privát, és a hozzáférést **az employee állítja**, nem a tulajdonos (§4.8). Részletek: 11.3. |
| **D13** ✅ | **Egyetlen polimorf `CalendarAudit` tábla**, a mutációval **azonos tranzakcióban** írva, szerveroldalon származtatott `source` mezővel | A második jóváhagyási kör követelménye. Az eredeti `CalendarEventAudit` az `eventId`-kulcs miatt a jogosultság-változást nem tudta volna rögzíteni. Az azonos tranzakció tudatos eltérés a `logAudit()` fire-and-forget mintájától: érzékeny adatnál a lyukas napló rosszabb, mint a hiánya. Teljes tervezés: **§6.6**. |

---

## 1. Kiindulási állapot — mit találtam a kódban

Ez a szakasz nem háttér: a terv minden későbbi döntése ezekre a mért
tényekre épül.

### 1.1 Naptár-jellegű adat ma

| Modell | Időmezők | Ki látja ma |
|---|---|---|
| `Shift` (schema.prisma:385) | `start DateTime`, `end DateTime?` | Owner/Developer az egész cégre; EMPLOYEE csak a sajátját (`GET /shifts/me`) |
| `Task` (schema.prisma:475) | `dueDate DateTime?` | Owner Command Center — csak owner/developer |
| `Reminder` (schema.prisma:509) | `dueDate DateTime?` | ugyanaz |
| `Project` (schema.prisma:228) | `deadline DateTime?` | Owner/Developer, illetve a hozzárendelt employee a saját nézetén |
| `CommunicationLog` (schema.prisma:537) | `occurredAt DateTime` | Owner/Developer |

**Következtetés:** öt különböző modellen van ma időpont, és **egyiket sem
lehet egy közös idővonalon látni**. A naptár elsődleges üzleti értéke
pontosan ez az egyesített nézet.

- A `Shift.end` **nullable** (nyitott műszak clock-in után). Bármely
  naptár-megjelenítésnek kezelnie kell — a mai árva `CalendarPage.tsx:35`
  ezt **nem teszi**: `new Date(shift.end)` egy `null`-ra `Invalid Date`-et
  ad.
- `Reminder`-ből ma **semmilyen kézbesítés nincs** — a
  `project-overview.md` §7 ezt nyíltan ki is mondja („a Reminder csak
  tárol, kézbesítés nincs"). A naptár emlékeztetője **nem lehet egy
  második ilyen halott modell**.

### 1.2 RBAC — a legnagyobb hézag

```
constants/roles.ts:  DEVELOPER | BUSINESS_OWNER | EMPLOYEE      ← mind a 3
role.middleware.ts:  requireRole(...roles)  → 403 ha nincs a listában
```

- **Nincs ADMIN, nincs MANAGER szerepkör.** A vízió öt szintje (Owner,
  Admin, Manager, Employee, Custom) ma **kettőbe** fér bele.
- **Nincs erőforrás-szintű jogosultság sehol.** Minden ellenőrzés vagy
  szerepkör-lista, vagy tenant-scope (`companyScope`) — soha nem „ez a
  felhasználó ehhez a sorhoz".
- **Nincs `Company.ownerId`.** A tulajdonos lekérdezése egyetlen inline
  minta: `findFirst({ where: { companyId, role: BUSINESS_OWNER } })`.
- ⚠️ **Ellentmondás a kereskedelmi modellel:** a Limit Registry már ma
  tartalmaz `admin_users` limitet (`limits.ts:43` — starter 1,
  professional 3, business 10, enterprise ∞), miközben **ADMIN szerepkör
  nem létezik**. A kereskedelmi terv tehát már számol több adminnal; a
  technikai réteg nem.
- `companyScope(req)` (`utils/scope.ts:5`) a DEVELOPER-nek **üres
  where-t** ad vissza → minden bérlő minden sora. Ez a mai modulokban
  szándékos (platform-üzemeltetés), naptárnál viszont újragondolandó
  (D12).

### 1.3 Notification-modul (N1.x) — kész és bővíthető

Ez a terv legjobb hírei közé tartozik: a naptárnak **nem kell értesítési
infrastruktúrát építenie**.

- `notify({ type, companyId, context, dedupeKey, actorUserId })`
  (`services/notifications/notify.ts:36`) — **soha nem dob**, csak egy
  outbox-sort ír. Biztonságosan hívható request-handlerből is.
- Registry: `services/notifications/registry.ts` — típusonként kategória,
  súlyosság, `mandatory`, recipient-stratégia, csatornák, in-app kulcsok.
- Recipient-stratégiák ma: `OWNER`, `COMPANY_USERS`, `USER`, `EMAIL`
  (registry.ts:18-28). **Résztvevő-alapú stratégia nincs** → a naptárnak
  egy `EVENT_PARTICIPANTS` bejegyzést kell hozzáadnia.
- Csatornák: `EMAIL` + `IN_APP` élesben; `PUSH` és `SMS` a szótárban már
  benne van (`constants/notifications.ts:16`), de **transport nincs
  mögöttük**, és a `CONFIGURABLE_CHANNELS` szándékosan nem tartalmazza
  őket. A mobil push tehát **a naptár-terven kívüli, önálló munka**.
- i18n: `server/src/i18n/{en,hu}/notifications.json`, `{{változó}}`
  interpolációval.
- Ütemezés: pg-boss, `requireBoss().schedule(QUEUE, "* * * * *")`
  (`workers.ts:62`) — 5 mezős cron, perc a legfinomabb felbontás.
- `enqueue(queue, data, { startAfterSeconds })` létezik
  (`services/queue/index.ts:65`) — késleltetett job technikailag
  lehetséges (lásd D7, miért nem ezt választjuk).
- Idempotencia két szinten: `NotificationEvent.dedupeKey @unique` és
  `Notification @@unique([eventId, userId])`.

### 1.4 Halott konfiguráció, amit a naptár élővé tesz

A `Company` modellen a C1.4/C1.5 kör felvett öt mezőt, amit **szerveroldalon
soha nem olvasunk**:

| Mező | Állapot ma | A naptár mire használja |
|---|---|---|
| ~~`timezone` (schema:46)~~ | ⚠️ **MÁR NEM HALOTT** (2026-08-02): az N1.8 Phase 0 óta olvassa a `utils/billingFormat.ts:121-135` és a `stripeWebhook.routes.ts:349`. Ez a sor **érvénytelen** — a maradék négy továbbra is helyes. | A naptár a **második** fogyasztó; a fallback egyeztetendő (**Q8**) |
| `firstDayOfWeek` (schema:53) | csak UI-preferencia | A naptár heti nézetének kezdőnapja szerveroldali lekérdezésekhez is |
| `defaultWorkStart` / `defaultWorkEnd` (schema:54-55) | csak UI | Munkaidő-sáv a nézetben; szabad-idősáv keresés (Phase 3) |
| `defaultShiftMinutes` (schema:56) | csak UI | Új esemény alapértelmezett hossza |

Ez ugyanaz a minta, amit az N1.x terv a három notification-kapcsolónál
talált és rendezett. **A naptár az első modul, amely a maradék négyet
ténylegesen használja** — ez önmagában is érv a modul mellett.

> ⚠️ **Frissítés, 2026-08-02.** A `timezone` sor menet közben elavult: az
> N1.8 Phase 0 megelőzte a naptárat, és a mezőt élővé tette. Ez nem rontja
> el a modul indoklását (a másik négy mező változatlanul halott), **de egy
> valós ütközést hozott létre**: a `billingFormat.ts:115` a
> `DEFAULT_BILLING_TIME_ZONE = "UTC"` értéket deklarálja, írásba adott
> indoklással („UTC rather than a European default: an invoice period
> boundary shown in the wrong zone can name the wrong DAY"), miközben a
> CAL1.2 terve az `Europe/Budapest` fallbacket nevezi meg egyetlen
> igazságként. **Ugyanaz a bérlői mező, két dokumentált alapértelmezés.**
> Feloldás a CAL1.2 indulása előtt — **Q8**.

### 1.5 Séma-konvenciók (kötelezőek az új modellekre)

A `schema.prisma` és az N1.x terv által rögzített, betartandó szabályok:

- `id Int @id @default(autoincrement())` — **nincs UUID/cuid sehol**.
- **Nincs egyetlen Prisma `enum` sem.** Státusz/típus = `String` +
  `constants/*.ts` validáció az API-rétegben, hogy a bővítés adatváltozás
  legyen, ne migráció.
- JSON = `String?` + `JSON.stringify` (`AuditLog.metadata`,
  `ProjectActivity.metadata`, `NotificationEvent.context`) — **soha nem a
  `Json` oszloptípus**.
- Append-only modelleken **nincs `updatedAt`**.
- **Indexek additívak, soha nem constraint-ek** *meglévő* táblán. Új,
  üres táblán a constraint megengedett — a `Notification
  @@unique([eventId, userId])` pontosan ezt teszi, és a séma indokolja is
  (schema:766).
- Új modelleken a `companyId Int` **kötelező** (nem opcionális) — kivéve,
  ha a sor bizonyíthatóan tenant nélküli entitáshoz tartozik.
- Ami túlélni köteles a felhasználó törlését: **skalár `userId`, nem
  reláció** (`AuditLog.userId`, `Notification.userId`).
- Cross-tenant olvasás → **404, nem 403**.
- ⚠️ Törölt felhasználók tombstone-olt e-mail-címet kapnak
  (`deleted+12+175…__real@example.com`) — bármely fan-out **kötelezően**
  szűr `active: true`-ra.

### 1.6 Billing / plan-access

- Minden csomag-döntés **kizárólag** `services/planAccess.ts`-en át:
  `hasFeature()`, `getLimit()`, `isWithinLimit()`. Kód **soha nem
  hasonlít plan-stringet**.
- A Feature Registry **már tartalmazza**:
  `google_calendar` (professional), `outlook_calendar` (professional),
  `ai_scheduling` (business, `futureModule: true`) — `features.ts:124-156`.
  A Phase 4 és a Phase 3+ AI tehát **kereskedelmileg már be van árazva**;
  új feature-kulcs ezekhez nem kell.
- Read-only mód: `tenantWrite = [authMiddleware, blockWritesWhenReadOnly]`
  (`app.ts:198`). Egy ezen keresztül mountolt új router **automatikusan**
  örökli a védelmet — GET/HEAD/OPTIONS mindig átmegy.

### 1.7 Csatolmányok és tárolás

- `services/storage` — `FileStorage` interfész (`toKey`, `signUrl`,
  `signUrlOrNull`). A route-ok **csak ezt ismerik**; az R2-re váltás így
  nem érint route-ot.
- `requireSignedUploadUrl()` az `/uploads` mount előtt fut (`app.ts:143`)
  — aláírás nélküli kérés nem ér el a fájlrendszerig.
- multer, max **20 fájl/upload**, MIME-whitelist, UUID-fájlnevek.
- `ProjectAttachment` a követendő táblaminta (fileName/fileType/fileSize/
  fileUrl/category).

### 1.8 Frontend

- React 19 + Vite + Tailwind v4 + React Router 7.
- **Nincs react-query, nincs zustand, nincs redux.** Az állapotkezelés
  Context API (`AuthContext`, `ReadOnlyContext`) + lokális `useState`;
  az adatelérés `src/services/*.service.ts` fetch-wrapperek `apiFetch`-en át.
- `apiFetch` központilag kezeli a 401-et (session törlés + redirect) és a
  `READ_ONLY_MODE` 403-at (globális esemény).
- Menü: `Sidebar.tsx:8` `menusByRole` — **szerepkör-kulcsos**, azaz egy
  naptár-menüpont ma csak szerepkör szerint jeleníthető meg, jogosultság
  szerint nem.
- Útvonalak: `ProtectedRoute roles={[...]}` — szintén szerepkör-alapú.
- i18n: `src/i18n/{en,hu}.json` + `useTranslation()`.
- ⚠️ **`src/pages/CalendarPage.tsx` árva fájl**: sehol nincs importálva,
  a routerben nem szerepel, `/schedule` a `SchedulePage`-re megy. A
  `react-big-calendar` **kizárólag** ebben az árva fájlban van használva.
- Frontend teszt **nincs** (`src/` alatt egyetlen teszt sincs); a
  lint-gate `continue-on-error: true`.

---

## 2. Architektúra — rétegek és adatfolyam

```
┌─ FRONTEND ────────────────────────────────────────────────────────────┐
│  CalendarPage (hónap/hét/nap/agenda)   EventModal   PermissionsPanel  │
│  useCalendar() ─ CalendarContext ─ calendar.service.ts (apiFetch)     │
└──────────────────────────────┬────────────────────────────────────────┘
                               │ REST, Bearer JWT
┌─ API ─────────────────────────▼───────────────────────────────────────┐
│  routes/calendars.routes.ts   routes/calendarEvents.routes.ts         │
│  mount: tenantWrite = [authMiddleware, blockWritesWhenReadOnly]       │
└──────────────────────────────┬────────────────────────────────────────┘
                               │
┌─ PERMISSION GATE (új) ────────▼───────────────────────────────────────┐
│  services/calendar/permissions.ts                                     │
│    resolveCalendarAccess(user, calendar) → Set<Permission>            │
│    Sorrend: owner → USER-grant → EMPLOYEE-grant → ROLE-grant →        │
│             COMPANY-grant → deny.  Default: DENY.                     │
└──────────────────────────────┬────────────────────────────────────────┘
                               │
┌─ DOMAIN ──────────────────────▼───────────────────────────────────────┐
│  services/calendar/                                                   │
│    events.ts        CRUD + validáció                                  │
│    recurrence.ts    RRULE kibontás ablakra + kivételek                │
│    timezone.ts      UTC ↔ IANA, all-day szemantika                    │
│    sources.ts       read-only feed: Shift / Task / Project / Reminder │
│    reminders.ts     esedékesség-számítás                              │
│    audit.ts         append-only CalendarAudit (polimorf)              │
└───────┬───────────────────────────────────────────┬───────────────────┘
        │                                           │
┌───────▼─────────────┐                   ┌─────────▼────────────────────┐
│ PostgreSQL (Prisma) │                   │ notify()  → N1.x pipeline    │
│ Calendar            │                   │  registry-append:            │
│ CalendarMember      │                   │   calendar.event_invitation  │
│ CalendarEvent       │                   │   calendar.event_updated     │
│ CalendarEventOccur… │  (csak kivétel)   │   calendar.event_cancelled   │
│ CalendarParticipant │                   │   calendar.event_reminder    │
│ CalendarEventAttach…│                   │  új stratégia:               │
│ CalendarEventComment│                   │   EVENT_PARTICIPANTS         │
│ CalendarAudit       │                   │  új kategória: calendar      │
└─────────────────────┘                   └──────────────────────────────┘
        ▲
        │  percenkénti sweep (pg-boss cron, az N1.x mintájára)
┌───────┴──────────────────────────────────────────────────────────────┐
│  calendar/reminder-sweep  → esedékes emlékeztetők → notify()          │
└──────────────────────────────────────────────────────────────────────┘
```

**Az egyetlen szabály, ami az egészet összetartja:** semmilyen route nem
olvas `calendarEvent`-et közvetlenül. Minden olvasás és írás a permission
gate-en megy át, amely egy `Prisma.CalendarEventWhereInput` szűrőt is vissza
tud adni — így a jogosultság a *lekérdezésbe* kerül, nem utólagos
szűrésbe. (Utólagos szűrésnél a lapozás és a darabszámok hazudnának.)

---

## 3. A négy naptártípus egyetlen absztrakcióban (D1)

A vízió négy naptárt kér. Ezek **nem négy adatszerkezet** — ugyanaz az
esemény-alakzat, más tulajdonossal és más alapértelmezett láthatósággal:

| `Calendar.type` | Tulajdonos | Alapértelmezett láthatóság | Automatikus létrejövetel |
|---|---|---|---|
| `PERSONAL` | egy `User` | csak a tulajdonos | felhasználó létrejöttekor (lusta: első használatkor) |
| `COMPANY` | a `Company` | minden aktív cégfelhasználó (olvasás) | cég létrejöttekor, „Céges naptár" néven |
| `PROJECT` | egy `Project` | a projekthez rendelt employee-k + owner | projekt létrejöttekor |
| `EMPLOYEE` | egy `Employee` | az employee saját magáé + owner/manager | employee létrejöttekor |

**Miért konténer és nem csak egy `type` mező az eseményen?**
Mert a jogosultság a konténerhez tapad, nem az eseményhez. „Péter láthatja
a Kovács-projekt naptárát" egy mondat, egy sor (`CalendarMember`). Ha a
típus csak az eseményen lenne, ugyanezt minden egyes eseményre külön
kellene kimondani.

**Egy esemény pontosan egy naptárhoz tartozik** (`calendarId` kötelező),
de **relációi többfelé mutathatnak** (`projectId`, `customerId`,
`employeeId` — mind opcionális). Egy projekt-naptárban lévő esemény tehát
hivatkozhat ügyfélre is; egy személyes esemény hivatkozhat projektre.
Ez a kettő nem ugyanaz a kérdés:

- `calendarId` → **kié, és ki láthatja**
- `projectId` / `customerId` / `employeeId` → **miről szól** (szűrés,
  riport, jövőbeli számlázás)

---

## 4. Permission-modell (D2) — a terv legfontosabb szakasza

### 4.1 A probléma

A vízió ezt kéri:

> Owner / Admin / Manager / Employee / Custom permissions
> — view calendar, create event, edit event, delete event, invite
> participants, share calendar. A tulajdonos dönti el: ki lát mit, ki
> hozhat létre, ki szerkeszthet, ki törölhet.

A mai rendszerben ebből **semmi nincs meg**: három globális szerepkör, és
nulla erőforrás-szintű jogosultság.

### 4.2 Két út, és miért a másodikat javaslom

**(A) Globális RBAC-bővítés** — új `ADMIN` és `MANAGER` szerepkör a
`constants/roles.ts`-be, `User.role` értékkészletének bővítése.

- Érinti: JWT-payload, `auth.middleware.ts`, `requireRole` **mind a 23
  routerben**, `ProtectedRoute`, `menusByRole`, meghívó-folyamat,
  `admin_users` limit-érvényesítés, minden létező teszt.
- Kockázat: **magas**. Egy szerepkör hozzáadása minden meglévő
  `requireRole(BUSINESS_OWNER, DEVELOPER)` hívást felülvizsgálandóvá tesz
  — egy kifelejtett helyen az új ADMIN vagy túl sokat kap, vagy semmit.
- Időzítés: közvetlenül az első production kiadás után a legrosszabb
  pillanat erre.

**(B) Naptár-szintű permission-réteg** ✅ **javasolt**

- A három JWT-szerepkör **változatlan**. Az auth-middleware, a JWT és a
  meglévő routerek **egyetlen sorral sem módosulnak**.
- A naptár saját, erőforrás-szintű jogosultsági rétege dönt — a
  `BUSINESS_OWNER` implicit Owner minden cégnaptáron, egy `EMPLOYEE`
  pedig **kaphat Manager-szintű jogot egy konkrét naptárra** anélkül,
  hogy globális adminná válna.
- A vízió minden felsorolt képessége teljesül, `Custom`-ostul.
- **Migrációs út marad**: ha később mégis kell globális ADMIN (az
  `admin_users` limit már várja), az önálló széria lesz, és a naptár
  permission-rétege változatlanul működik fölötte — a `ROLE` típusú
  grant egyszerűen több szerepkört ismer majd.

> **Ez a döntés jóváhagyást igényel.** Ha az üzleti prioritás mégis a
> globális ADMIN/MANAGER szerepkör, azt **külön, a naptár előtti
> szériaként** javaslom (`RBAC1.x`), nem a naptár részeként.

### 4.3 A permission-registry

`server/src/constants/calendarPermissions.ts` — a séma-konvenció szerint
**string + registry, nem Prisma enum**:

```
calendar.view_free_busy    — CSAK az idősávok: „foglalt 9:00–10:30”, cím és
                             leírás nélkül, résztvevők nélkül
calendar.view_details      — a teljes esemény-tartalom olvasása
calendar.event.create      — új esemény létrehozása
calendar.event.edit_own    — saját létrehozású esemény szerkesztése
calendar.event.edit_any    — bármely esemény szerkesztése a naptárban
calendar.event.delete_own  — saját esemény törlése
calendar.event.delete_any  — bármely esemény törlése
calendar.participant.invite— résztvevők hozzáadása/eltávolítása
calendar.share             — a naptár megosztása másokkal (grant írása)
calendar.manage            — a naptár átnevezése, archiválása, beállításai
```

**A `view_free_busy` / `view_details` szétválasztás (R4) a modell
sarokköve, nem megjelenítési finomság.** Ez az egyetlen mód, ahogy az
ütemezés (mikor ér rá valaki) és a magánszféra (mit csinál) egyszerre
teljesülhet: a tulajdonos a beosztáshoz elég információt kapja, az
esemény tartalmát viszont nem látja. A kettő **külön jog**, tehát a
`view_details` **soha nem következik** a `view_free_busy`-ból.

Hierarchia: `view_details` **magában foglalja** a `view_free_busy`-t (aki
a részleteket látja, a foglaltságot is). Fordítva nem.

Az `_own` / `_any` szétválasztás sem kozmetika: e nélkül a „Manager"
vagy mindent törölhet (beleértve a tulajdonos privát bejegyzését), vagy
semmit.

### 4.4 Szerepkör-presetek (bundle-ök, nem JWT-szerepkörök)

`CALENDAR_ROLE_PRESETS` — a vízió öt szintje mint jogosultság-csomag:

| Preset | Tartalmazott jogok |
|---|---|
| `OWNER` | mind a 10 |
| `ADMIN` | mind, kivéve `calendar.manage` (a naptár maga nem törölhető) |
| `MANAGER` | `view_free_busy`, `view_details`, `create`, `edit_own`, `edit_any`, `delete_own`, `participant.invite` |
| `MEMBER` | `view_free_busy`, `view_details`, `create`, `edit_own`, `delete_own` |
| `VIEWER` | `view_free_busy`, `view_details` |
| **`FREE_BUSY`** | `view_free_busy` **— és semmi más** (R4) |
| `CUSTOM` | üres preset + explicit jog-lista a `CalendarMember.permissions` mezőben |

A `FREE_BUSY` preset az R4 finomítás közvetlen leképezése: ez az a szint,
amit egy employee a saját személyes naptárán a cégnek adhat anélkül, hogy
bármit felfedne a tartalmából.

A preset **feloldáskor** bomlik ki jog-halmazzá. Ha egy preset később
bővül, minden meglévő grant automatikusan örökli — ugyanaz az elv, mint a
Feature Registrynél.

### 4.5 Grantee-típusok — „ki lát mit"

A `CalendarMember.principalType` négy értéke adja a vízió teljes
rugalmasságát:

| `principalType` | `principalId` | Jelentés |
|---|---|---|
| `USER` | `User.id` | egy konkrét felhasználó |
| `EMPLOYEE` | `Employee.id` | a munkavállalóhoz kötött login |
| `ROLE` | `"EMPLOYEE"` \| `"BUSINESS_OWNER"` | mindenki az adott JWT-szerepkörrel |
| `COMPANY` | `Company.id` | a bérlő minden aktív felhasználója |

Egy céges naptár tehát **egyetlen sor**: `COMPANY` principal, `VIEWER`
preset. Az owner ezt egy kattintással `MEMBER`-re emelheti („mindenki
hozhat létre céges eseményt").

### 4.6 Feloldási sorrend — a legspecifikusabb nyer

```
1. DEVELOPER?                                 → lásd D12 / 11.3
2. calendar.ownerUserId == user.id?           → OWNER preset, kész
3. BUSINESS_OWNER a naptár cégében
   ÉS calendar.type != "PERSONAL"?            → OWNER preset, kész   (R2)
4. CalendarMember(USER, user.id)              → megtalálva? kész
5. CalendarMember(EMPLOYEE, user.employeeId)  → megtalálva? kész
6. CalendarMember(ROLE, user.role)            → megtalálva? kész
7. CalendarMember(COMPANY, user.companyId)    → megtalálva? kész
8. DENY (üres jog-halmaz)
```

**A 3. lépés `PERSONAL`-kivétele az R2 finomítás** — és ez a modell
legfontosabb egyetlen sora. Nélküle a „személyes naptár" csak elnevezés
lenne: a tulajdonos szerepköre alapján automatikusan mindent látna. Így
viszont a `PERSONAL` naptárhoz **kizárólag** a 4–7. lépés valamelyikén
lehet hozzáférni, azaz **csak explicit, az employee által adott grant
útján** (§4.8).

**Alapértelmezés mindenhol: DENY.** Nincs implicit olvasás.

### 4.7 Esemény-szintű láthatóság

A naptár-szintű jogosultság fölött az egyes események saját láthatóságot
kapnak (iCal-kompatibilis szemantika):

| `CalendarEvent.visibility` | Jelentés |
|---|---|
| `default` | a naptár jogosultsága dönt |
| `private` | csak a létrehozó és a résztvevők látják a részleteket; mindenki más **„Foglalt" blokkot** lát cím nélkül |
| `confidential` | csak a létrehozó és a résztvevők látják, hogy egyáltalán van itt valami |

Ez az, ami a „private events" követelményt megoldja **anélkül**, hogy a
személyes eseményeket külön táblába kellene tenni.

### 4.8 Jogosultsági hatáskörök szétválasztása (R2, R3, R4)

A jóváhagyás legfontosabb szerkezeti következménye: **nem egy hatóság van
a rendszerben, hanem kettő**, és a naptár típusa dönti el, melyik illetékes.

| Naptártípus | A jogosultság hatósága | Indok |
|---|---|---|
| `COMPANY` | **cégtulajdonos** (R3) | Céges adat, céges felelősség. |
| `PROJECT` | **cégtulajdonos** (R3) | Ügyfél- és projektadat. |
| `EMPLOYEE` (beosztás) | **cégtulajdonos** (R3) | A munkabeosztás munkáltatói hatáskör. |
| `PERSONAL` | **maga a felhasználó** (R2) | A tartalom nem üzleti adat. A tulajdonos szerepköre itt **nem** ad hozzáférést (§4.6, 3. lépés). |

**Ez a szétválasztás nem opcionális finomság.** Enélkül a „személyes
naptár" puszta címke lenne: a `BUSINESS_OWNER` a szerepköre alapján
mindent látna, és a „privát" szó a felületen valótlan állítás volna.

#### A három megosztási szint

A személyes naptár tulajdonosa három szint közül választhat, hogy mit
lásson belőle a cég:

| Szint | Mit lát a cég | Grant a háttérben |
|---|---|---|
| **`PRIVATE`** *(alapértelmezés, R2)* | **semmit** — a naptár létezését sem | *nincs sor* |
| **`FREE_BUSY`** | csak idősávokat („foglalt 9:00–10:30"), cím, leírás és résztvevők nélkül | `CalendarMember(COMPANY, companyId, preset: FREE_BUSY)` |
| **`DETAILS`** | a teljes tartalmat | `CalendarMember(COMPANY, companyId, preset: VIEWER)` |

**A szint nem külön oszlop és nem külön érvényesítési út** — a szint
*maga a grant sor*. A `GET/PUT /calendars/:id/share-level` végpont
kényelmi felület, amely a `COMPANY` grantet olvassa és írja. Ennek az az
oka, hogy egy `Calendar.shareLevel` oszlop **elcsúszhatna** a tényleges
grant-soroktól, és a rendszerben két igazság keletkezne arról, ki mit
lát — pontosan az a hibaminta, amit a repó a halott
`Company.notificationsEnabled` kapcsolóknál már egyszer elszenvedett
(§1.4). Így viszont az érvényesítés **egyetlen** kódúton megy: a §4.6
feloldási sorrenden.

**Alapértelmezés = `PRIVATE` = a sor hiánya.** Nem kell „kikapcsolni" a
megosztást: alapból nincs mit kikapcsolni. Egy új employee személyes
naptára tehát semmilyen migrációt vagy backfillt nem igényel ahhoz, hogy
privát legyen.

#### Amit a cégtulajdonos ilyenkor is lát

Semmit a `PERSONAL` naptárból, **de** a beosztáshoz szükséges információ
ettől függetlenül megvan neki, mert az **más forrásból** jön:

- a `Shift` sorok (a `EMPLOYEE` naptáron és a forrás-rétegen át),
- a `PROJECT` naptárak eseményei,
- az `EMPLOYEE` naptár távollét-bejegyzései (CAL3.3).

Vagyis a munkáltatói ütemezés **nem függ** attól, megosztja-e valaki a
magánnaptárát. A `FREE_BUSY` szint ehhez ad plusz pontosságot (pl. orvosi
időpont miatti elérhetetlenség), önkéntes alapon.

#### Egy tudatosan elhalasztott tétel

Felmerülhet, hogy a cég **megkövetelhesse** a `FREE_BUSY` szintet
(céges házirend). Ez védhető igény, de:

1. új fogalmat vezet be (cégszintű házirend-minimum), amit ma semmi nem
   modellez;
2. munkajogi kérdés is, nem csak technikai;
3. a CAL1 hatókörét érdemben növelné.

**Ezért a CAL1-ben nem épül meg.** Külön eldöntendő tételként rögzítve:
**Q9** (18. szakasz). Ha megépül, a felső korlátja akkor is `FREE_BUSY`
lehet — tartalom kikényszerítve soha nem osztható meg.

---

## 5. Esemény-modell: idő, ismétlődés, all-day

### 5.1 Időzóna (D3)

- **Tárolás: `DateTime` UTC-ben** (Prisma/Postgres `timestamptz`), plusz
  egy `timezone String` mező az eseményen (IANA név,
  pl. `"Europe/Budapest"`).
- **Miért kell a string is, ha UTC-ben tárolunk?** Mert egy ismétlődő
  esemény („minden hétfő 9:00") **helyi idő szerint** ismétlődik. Ha csak
  az UTC-instans lenne meg, az október végi óraátállítás után minden
  további előfordulás 8:00-ra vagy 10:00-ra csúszna. A szabályt a helyi
  időzónában kell kibontani, és csak utána UTC-re váltani.
- Az esemény alapértelmezett időzónája: `Company.timezone` → ha üres,
  `"Europe/Budapest"` (a termék elsődleges piaca), és ezt a fallbacket
  **egyetlen helyen** kell kimondani (`services/calendar/timezone.ts`).
- **All-day esemény**: nem 00:00–23:59 UTC. Külön `allDay Boolean`, és a
  határokat a naptár időzónájában értelmezzük. Enélkül egy magyar
  all-day esemény egy UTC-ben olvasó kliensen két napra lóg át.

### 5.2 Ismétlődés (D4)

**Tárolás: RFC 5545 `RRULE` string** (`recurrenceRule String?`), pl.
`FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231T230000Z`.

**Miért nem materializáljuk az előfordulásokat?**
Mert egy `UNTIL` nélküli szabály végtelen. Egy „minden hétfő" esemény
10 év alatt 520 sor — bérlőnként, eseményenként. Egy sorozat
szerkesztése ilyenkor tömeges `UPDATE`-té válik.

**Miért nem elég a puszta kibontás olvasáskor?**
Mert a „mi van 2026 márciusában?" kérdéshez különben a bérlő **összes**
ismétlődő szabályát ki kellene bontani, hogy kiderüljön, melyik ér bele
az ablakba.

**A megoldás — pruning-oszlop:**
`recurrenceEndsAt DateTime?` — a szabályból *írás időpontjában* számított
utolsó előfordulás vége; `null`, ha a szabály végtelen. Így a lekérdezés:

```
WHERE calendarId IN (:látható naptárak)
  AND startsAt <= :ablakVége
  AND (
        endsAt >= :ablakEleje                        -- egyszeri esemény
     OR recurrenceRule IS NOT NULL
        AND (recurrenceEndsAt IS NULL
             OR recurrenceEndsAt >= :ablakEleje)     -- ismétlődő jelölt
  )
```

Az így kapott **jelölt-halmazt** bontja ki a `recurrence.ts` az ablakra,
Node-ban. A jelöltek száma a bérlő ismétlődő eseményeinek száma —
nagyságrendekkel kevesebb, mint az előfordulásoké.

**Kivételek és felülírások:** `CalendarEventOccurrence` tábla, kizárólag
az *eltéréseket* tárolja:

| Eset | Sor |
|---|---|
| „Ez az egy alkalom elmarad" | `originalStartsAt` + `cancelled: true` |
| „Ez az egy alkalom máskor / máshol lesz" | `originalStartsAt` + felülíró mezők |
| minden más előfordulás | **nincs sor** — a szabályból számítódik |

A kibontás minden találatra megnézi, van-e felülíró sor az adott
`originalStartsAt`-ra.

**Sorozat-szerkesztés három módban** (a felhasználó választ, mint minden
ismert naptárban): *csak ez az alkalom* / *ez és a további* / *az egész
sorozat*. A középső a szokásos megoldással: az eredeti szabály `UNTIL`-je
a vágási pontra kerül, és **új sorozat** jön létre onnantól.

**Könyvtár:** az `rrule` npm-csomag a de facto szabvány, de **új
függőség** — a jóváhagyás része. Alternatíva: saját, szűkített kibontó
(csak `DAILY`/`WEEKLY`/`MONTHLY`/`YEARLY` + `BYDAY` + `INTERVAL` +
`COUNT`/`UNTIL`), ami a valós igények ~95%-át fedi és nulla függőség. A
`date-fns` már telepítve van, és a kibontáshoz elég.
**Javaslat: saját szűkített kibontó a Phase 1-ben**, `rrule` csak akkor,
ha a Phase 4 külső szinkron ténylegesen igényli a teljes RFC-t.

### 5.3 Ütközés-detektálás

Nem a séma dolga, hanem lekérdezésé: két esemény ütközik, ha ugyanarra a
résztvevőre `start < other.end AND end > other.start`. A Phase 1 csak
**jelzi** (figyelmeztetés a modalban), nem tiltja — egy szolgáltató
cégnél a párhuzamos beosztás gyakran szándékos.

---

## 6. Adatbázis — Prisma modell-javaslat

> **Ez javaslat, nem migráció.** Minden mező a 1.5-ös konvenciók szerint.
> A táblák mind újak és üresek, ezért a `@@unique` constraint-ek
> megengedettek (a `Notification` precedens, schema:766).

### 6.1 `Calendar` — a konténer

| Mező | Típus | Megjegyzés |
|---|---|---|
| `id` | `Int @id @default(autoincrement())` | |
| `companyId` | `Int` | **kötelező** (konvenció); a `PERSONAL` naptár is a bérlőhöz tartozik |
| `type` | `String` | `PERSONAL` \| `COMPANY` \| `PROJECT` \| `EMPLOYEE` — `constants/calendarTypes.ts` |
| `name` | `String` | |
| `description` | `String?` | |
| `color` | `String?` | hex, a `Company.primaryColor` validátorát újrahasználva |
| `timezone` | `String?` | null = `Company.timezone` öröklése |
| `ownerUserId` | `Int?` | skalár, nem reláció (túléli a user törlését) |
| `projectId` | `Int?` | `PROJECT` típusnál kitöltve |
| `employeeId` | `Int?` | `EMPLOYEE` típusnál kitöltve |
| `isDefault` | `Boolean @default(false)` | a felhasználó/cég elsődleges naptára |
| `archivedAt` | `DateTime?` | soft-delete, a repó mintája szerint |
| `createdAt` / `updatedAt` | | |

Indexek: `@@index([companyId, type])`, `@@index([ownerUserId])`,
`@@index([projectId])`, `@@index([employeeId])`.
Constraint: `@@unique([companyId, type, ownerUserId, projectId, employeeId])`
— **jóváhagyandó**, mert a `null`-ok Postgresben nem ütköznek, így ez nem
akadályozza meg a több `PERSONAL` naptárat. Ha az „egy user = egy
alapértelmezett naptár" szabály kell, azt részleges indexszel
(`WHERE isDefault`) érdemes kikényszeríteni — ez viszont raw SQL a
migrációban.

### 6.2 `CalendarMember` — a jogosultsági sor

| Mező | Típus | Megjegyzés |
|---|---|---|
| `id` | `Int` | |
| `calendarId` | `Int` | reláció `Calendar`-ra |
| `companyId` | `Int` | denormalizált, hogy a tenant-szűrés join nélkül menjen |
| `principalType` | `String` | `USER` \| `EMPLOYEE` \| `ROLE` \| `COMPANY` |
| `principalId` | `String` | **string**, mert a `ROLE` principal értéke `"EMPLOYEE"`, nem szám |
| `preset` | `String` | `OWNER` \| `ADMIN` \| `MANAGER` \| `MEMBER` \| `VIEWER` \| `CUSTOM` |
| `permissions` | `String?` | JSON-string, **csak** `CUSTOM` presetnél |
| `grantedByUserId` | `Int?` | skalár — ki adta a jogot (audit) |
| `createdAt` / `updatedAt` | | |

`@@unique([calendarId, principalType, principalId])` — egy principal
egy naptáron pontosan egy grantet kap.
`@@index([companyId, principalType, principalId])` — ez szolgálja ki a
„milyen naptárakat lát ez a user?" lekérdezést, ami minden
naptár-olvasás első lépése.

### 6.3 `CalendarEvent` — a mag

| Mező | Típus | Megjegyzés |
|---|---|---|
| `id` | `Int` | |
| `calendarId` | `Int` | kötelező — ez dönt a jogosultságról |
| `companyId` | `Int` | denormalizált tenant-szűrés |
| `title` | `String` | |
| `description` | `String?` | |
| `startsAt` | `DateTime` | UTC |
| `endsAt` | `DateTime` | UTC — **nem nullable**, ellentétben a `Shift.end`-del |
| `allDay` | `Boolean @default(false)` | |
| `timezone` | `String?` | null = a naptáré |
| `recurrenceRule` | `String?` | RRULE |
| `recurrenceEndsAt` | `DateTime?` | pruning (5.2); null = végtelen |
| `status` | `String @default("confirmed")` | `confirmed` \| `tentative` \| `cancelled` |
| `visibility` | `String @default("default")` | `default` \| `private` \| `confidential` |
| `createdByUserId` | `Int` | skalár |
| `projectId` | `Int?` | reláció — **hivatkozás, nem másolat** (R5) |
| `customerId` | `Int?` | reláció — ugyanaz |
| `employeeId` | `Int?` | reláció — ugyanaz |
| `shiftId` | `Int?` | **R5-ben felvéve** — ha az esemény egy konkrét műszakhoz tartozik |
| `location` | `String?` | **csak eseti helyszín.** Ha `null` és van `projectId`/`customerId`, a cím olvasáskor onnan oldódik fel (§6.5) |
| `latitude` / `longitude` | `Float?` | ugyanaz a szabály; a `Project` geofence-mezőinek mintájára |
| `metadata` | `String?` | JSON-string (konvenció) |
| `createdAt` / `updatedAt` | | |

Indexek — a lekérdezési alakzatokhoz szabva:
`@@index([calendarId, startsAt])` (a fő ablak-lekérdezés),
`@@index([companyId, startsAt])` (cégszintű idővonal),
`@@index([projectId])`, `@@index([customerId])`, `@@index([employeeId])`,
`@@index([shiftId])`, `@@index([recurrenceEndsAt])`.

### 6.4 A többi tábla (rövidítve)

| Tábla | Kulcsmezők | Megjegyzés |
|---|---|---|
| `CalendarEventOccurrence` | `eventId`, `originalStartsAt`, `cancelled`, felülíró mezők | `@@unique([eventId, originalStartsAt])` |
| `CalendarParticipant` | `eventId`, `userId?`, `employeeId?`, `email?`, `response` (`needs_action`/`accepted`/`declined`/`tentative`), `isOrganizer` | `@@unique([eventId, userId])`; a külső résztvevő `email`-lel jön, fiók nélkül |
| `CalendarEventAttachment` | `ProjectAttachment` mezőinek másolata | `services/storage`-on át, aláírt URL-lel |
| `CalendarEventComment` | `eventId`, `userId`, `content`, `createdAt` | append-only → **nincs `updatedAt`** |
| `CalendarEventReminder` | `eventId`, `userId?` (null = mindenki), `minutesBefore`, `channel` | a résztvevő saját emlékeztetője |
| `CalendarAudit` | lásd **§6.6** — a jóváhagyási kör bővítette ki `CalendarEventAudit`-ról | append-only, polimorf cél (`CALENDAR`/`EVENT`/`MEMBER`/`PARTICIPANT`) |

**Összesen 9 új tábla, 0 meglévő tábla módosítása.** Ez szándékos: a
naptár bevezetése **nem érint egyetlen meglévő oszlopot sem**, így a
rollback egyszerű (a modul kikapcsolása), és a meglévő 387 teszt
viselkedése nem változhat.

### 6.5 A hivatkozási szabály (R5)

> **Az esemény hivatkozik a forrás-objektumra. Soha nem másolja.**

Ez a szabály **kikényszerítendő a code review-ban**, mert a séma önmagában
nem tudja megakadályozni a megsértését. Konkrétan:

**TILOS** az eseményre denormalizálni:

| Amit tilos másolni | Honnan jön helyette olvasáskor |
|---|---|
| ügyfélnév, ügyfél-cím, telefonszám | `customerId` → `Customer` |
| projektnév, projekt-státusz, határidő | `projectId` → `Project` |
| employee neve | `employeeId` → `Employee` |
| a műszak kezdete/vége/jegyzete | `shiftId` → `Shift` |
| a projekt címe és GPS-koordinátái | `projectId` → `Project.address/latitude/longitude` |

**A helyszín feloldási sorrendje** (az egyetlen hely, ahol a szabály
árnyalt, ezért egy függvényben, `resolveEventLocation()`, kimondva):

```
1. event.location / event.latitude / event.longitude   ← eseti helyszín, ha ki van töltve
2. project.address / project.latitude / project.longitude   ← ha van projectId
3. customer.address                                     ← ha van customerId
4. null
```

Az esemény saját `location` mezője tehát **felülírás, nem másolat**: csak
akkor töltjük ki, ha az esemény *ténylegesen máshol* van, mint a projekt.
Egy „a projekt helyszínén" esemény `location`-je `null` marad — és ha a
projekt címe később megváltozik, az esemény **automatikusan követi**.

**Miért ez a szabály fontosabb, mint amilyennek látszik:** egy szolgáltató
cégnél az ügyfél címe és telefonszáma változik. Ha ezeket egyszer
átmásoltuk az eseményre, minden múltbeli és jövőbeli esemény a régi adatot
őrzi, és a technikus a rossz címre megy ki. A hivatkozás ezt szerkezetileg
teszi lehetetlenné.

**Amit viszont az esemény SAJÁT adata** (tehát nem másolat, és nem is kell
feloldani): `title`, `description`, `startsAt`, `endsAt`, `allDay`,
`timezone`, `status`, `visibility`, ismétlődés. Ezek az eseményről szólnak,
nem a hivatkozott objektumról.

### 6.6 Audit-modell (**D13** — a 2026-08-01-i második jóváhagyási kör)

> **Követelmény:** a naptár-jogosultságok és az események érzékeny adatok,
> ezért **minden jogosultság-változás és minden esemény-mutáció
> auditálható** kell legyen — ki hozta létre, ki módosította a jogokat, ki
> változtatta a résztvevőket, mi volt az előző és az új érték, mikor, és
> **milyen forrásból**.

#### Miért egy tábla, polimorf céllal

Az eredeti terv `CalendarEventAudit`-ja **nem elég**: `eventId`-re volt
kulcsolva, így a jogosultság-változást (ami a `Calendar`-on vagy a
`CalendarMember`-en történik, nem eseményen) **nem tudta volna rögzíteni**.

A megoldás egy `CalendarAudit` tábla `targetType` + `targetId` párral —
ugyanaz a minta, amit az `OwnerNoteConversion` már használ a repóban
(schema:599). Előnye, hogy a „mi történt ezen a naptáron?" **egyetlen
lekérdezés**, egyetlen megőrzési szabállyal és egyetlen olvasási
jogosultsággal.

#### A tábla

| Mező | Típus | Megjegyzés |
|---|---|---|
| `id` | `Int` | |
| `companyId` | `Int` | tenant-szűrés |
| `calendarId` | `Int` | **mindig kitöltve**, tag- és résztvevő-változásnál is — ez teszi lehetővé a naptáronkénti idővonalat |
| `targetType` | `String` | `CALENDAR` \| `EVENT` \| `MEMBER` \| `PARTICIPANT` |
| `targetId` | `Int` | a megváltozott sor azonosítója |
| `action` | `String` | `constants/calendarAuditActions.ts` (registry, nem enum) |
| `actorUserId` | `Int?` | **skalár, nem reláció** — túléli a felhasználó törlését (`AuditLog.userId` precedens). `null` = rendszer |
| `source` | `String` | `WEB` \| `API` \| `SYSTEM` — **szerveroldalon származtatva** |
| `requestId` | `String?` | a `req.id` korrelációs azonosító (`app.ts:64`) — egy kérés összes audit-sora összefűzhető |
| `changes` | `String?` | JSON-string: `{ mező: { from, to } }` |
| `createdAt` | `DateTime` | az időbélyeg |

**Nincs `updatedAt`** — append-only, a repó konvenciója szerint.

Indexek: `@@index([calendarId, createdAt])` (a fő idővonal),
`@@index([companyId, createdAt])`, `@@index([targetType, targetId])`
(„mi történt ezzel az eseménnyel?"), `@@index([actorUserId])`.

#### Az action-vokabulárium

```
CALENDAR_CREATED      CALENDAR_UPDATED      CALENDAR_ARCHIVED
EVENT_CREATED         EVENT_UPDATED         EVENT_DELETED
MEMBER_GRANTED        MEMBER_UPDATED        MEMBER_REVOKED
SHARE_LEVEL_CHANGED
PARTICIPANT_ADDED     PARTICIPANT_REMOVED   PARTICIPANT_RESPONDED
```

#### `EVENT_CREATED` — tudatos eltérés a repó eddigi szabályától

A `constants/auditActions.ts` fejlécében kimondott szabály:

> *„Entity-creation events … are NOT listed here — the timeline derives
> those straight from each row's `createdAt`."*

A naptárnál **szándékosan eltérünk ettől**, mert az indoklás itt nem áll:
a projekt/employee/customer sorokat nem töröljük, az **eseményeket
viszont igen**. Törlés után a `createdByUserId` és a `createdAt` a sorral
együtt eltűnik, és pont az a kérdés marad megválaszolatlan, amiért az
audit létezik: *ki hozta létre azt, amit aztán töröltek?* Az audit-sor
**túléli a törlést**.

#### A `source` mező — és a legfontosabb szabálya

| Érték | Mikor | CAL1-ben elérhető? |
|---|---|---|
| `WEB` | a kérés JWT-vel érkezett (`req.user` kitöltve) | ✅ igen |
| `API` | jövőbeli API-kulcsos hitelesítés | ❌ **nem** — nincs mögötte hitelesítési út |
| `SYSTEM` | nincs kérés: worker, sweep, cron, webhook | ✅ igen |

> ⚠️ **A `source` értéket SOHA nem veheti át kliens fejlécből vagy
> request-body-ból.** Kizárólag szerveroldalon származtatható abból,
> *melyik hitelesítési úton* érkezett a hívás. Egy kliens által állítható
> `source` mező az egész audit-táblát hazuggá tenné — pontosan azt a
> mezőt, amiért a vizsgálat elindulna.

Az `API` érték a vokabulárium része az első naptól, hogy a csatorna
megérkezésekor **ne kelljen migrálni** — ugyanaz az érvelés, amiért a
`NOTIFICATION_CHANNELS` már ma tartalmazza a `PUSH`/`SMS` értéket
(`constants/notifications.ts:16`).

#### `changes` — csak a megváltozott mezők

```json
{"startsAt":{"from":"2026-08-05T07:00:00Z","to":"2026-08-05T09:00:00Z"},
 "location":{"from":null,"to":"Budapest, Fő utca 1."}}
```

**Nem teljes sor-pillanatkép.** Egy before/after snapshot minden
módosításnál lemásolná az esemény teljes tartalmát — beleértve a `private`
események címét és leírását —, és a tárolás a valós tartalom sokszorosára
nőne. A mező-szintű különbözet ugyanazt a kérdést válaszolja meg,
töredék méretben.

Jogosultság-változásnál ugyanez a formátum:
`{"preset":{"from":"VIEWER","to":"MANAGER"}}`.

#### Írási garancia — eltérés a `logAudit()` szerződésétől

A meglévő `logAudit()` **fire-and-forget**: sosem dob, és ha az írás
elbukik, a művelet attól még sikeres (`services/audit/auditLog.ts:28`).

**A `CalendarAudit`-ra ez nem elég.** A követelmény szerint minden
jogosultság-változásnak és esemény-mutációnak auditálhatónak kell lennie;
egy csendes lyukakkal teli audit-napló rosszabb, mint a hiánya, mert nem
lehet megmondani, *hol* vannak a lyukak.

**Döntés: az audit-sor a mutációval AZONOS tranzakcióban íródik.** Ha az
audit-írás elbukik, a mutáció visszagördül. „Nincs audit → nincs
változás." Ez egyetlen `INSERT` többletköltség olyan műveleteknél, amelyek
amúgy is tranzakcióban futnak.

Ez **tudatos eltérés** a `logAudit()` mintájától, és az ára is kimondandó:
egy audit-tábla-probléma a naptár írásait is megállítja. Ezt a
kompromisszumot az érzékeny-adat besorolás indokolja.

#### Olvasási jogosultság

Az audit-napló olvasása **`calendar.manage` jogot igényel** az adott
naptáron. Ezen felül, amíg az esemény létezik, a `private`/`confidential`
eseményekre a §4.7 láthatósági szabálya az audit-válaszra **is**
érvényes — különben az audit-végpont megkerülné a láthatósági modellt, és
a `calendar.manage` joggal bíró tag kiolvashatná a privát események címét
a változás-naplóból. Törölt eseménynél `calendar.manage` az egyetlen
kapu.

#### Kétszintű írás: mi kerül a globális `AuditLog`-ba is

| Művelet | `CalendarAudit` | globális `AuditLog` |
|---|---|---|
| esemény létrehozás/módosítás/törlés | ✅ | ❌ |
| résztvevő-változás | ✅ | ❌ |
| **jogosultság-változás** (`MEMBER_*`, `SHARE_LEVEL_CHANGED`) | ✅ | ✅ |

A jogosultság-változás **biztonsági esemény**, és oda tartozik, ahol az
üzemeltető a biztonsági eseményeket nézi (`/admin/logs`). Az
esemény-mutációk viszont nem: a volumenük elárasztaná a biztonsági naplót,
amelyben ma naponta néhány sor van. Ehhez egy új `AUDIT_ACTIONS`
bejegyzés kell (`CALENDAR_PERMISSION_CHANGED`).

#### Megőrzés — nyitott tétel

A `CalendarAudit` korlátlanul nő. Az N1.9 mérföldkő a notification-modulra
már tervezett megőrzési sweepet; a naptárnak ugyanez kell. **A CAL1-ben
nem épül meg** (üres táblán nincs mit takarítani) — a **Q10** tétel
rögzíti (§18.2), és a CAL2.6-tal, az olvasó felület megjelenésével együtt
esedékes.

---

## 7. Forrás-réteg: a meglévő adatok megjelenítése (D5)

`services/calendar/sources.ts` — read-only adapterek, amelyek a meglévő
sorokat naptár-elemmé alakítják **a lekérdezés pillanatában**:

| Forrás | Feltétel | Megjelenés |
|---|---|---|
| `Shift` | `employee.companyId` scope | `end === null` → „folyamatban" jelölés, nem `Invalid Date` |
| `Project.deadline` | nem null | all-day mérföldkő |
| `Task.dueDate` | nem null | all-day teendő, prioritás-színnel |
| `Reminder.dueDate` | nem null | all-day emlékeztető |

Ezek az elemek **szintetikus azonosítót** kapnak (`shift:412`,
`task:88`), nem szerkeszthetők a naptárban, és a saját moduljuk
jogosultságát öröklik — egy EMPLOYEE csak a saját műszakját látja, mert a
`GET /shifts/me` szabálya érvényes rájuk is.

**Miért nem másolás?** Mert a clock-in/out `Shift`-et ír. Ha másolnánk,
minden clock-out után szinkronizálni kellene, és egy elmaradt szinkron
után a naptár hazudna. A forrás-réteg **nem tud elavulni**.

---

## 8. API-terv

Mount: `app.ts`-ben `tenantWrite`-on át — így a read-only mód
automatikusan öröklődik (GET mindig átmegy).

```
GET    /calendars                       a hívó által látható naptárak
POST   /calendars                       új naptár (jogosultság: cég-szintű)
GET    /calendars/:id                   metaadat + a hívó effektív jogai
PATCH  /calendars/:id                   calendar.manage
DELETE /calendars/:id                   archiválás (soft), calendar.manage

GET    /calendars/:id/members           calendar.share
POST   /calendars/:id/members           grant, calendar.share
PATCH  /calendars/:id/members/:mid      calendar.share
DELETE /calendars/:id/members/:mid      calendar.share

GET    /calendars/:id/share-level       R4 — a PERSONAL naptár megosztási
PUT    /calendars/:id/share-level       szintje: PRIVATE|FREE_BUSY|DETAILS.
                                        Kizárólag a naptár tulajdonosa
                                        hívhatja (a cégtulajdonos NEM).
                                        A COMPANY grant sorát írja (§4.8).

GET    /calendar/events?from=&to=&calendarIds=&projectId=&employeeId=
                                        AZ ablak-lekérdezés; kibontott
                                        előfordulásokat ad vissza
GET    /calendar/events/:id             egy sorozat definíciója
POST   /calendar/events                 calendar.event.create
PATCH  /calendar/events/:id?scope=…     scope = this|following|series
DELETE /calendar/events/:id?scope=…     ugyanaz

POST   /calendar/events/:id/participants        participant.invite
DELETE /calendar/events/:id/participants/:pid   participant.invite
POST   /calendar/events/:id/respond             saját RSVP (jog nem kell)

GET    /calendar/events/:id/comments
POST   /calendar/events/:id/comments
POST   /calendar/events/:id/attachments         multer, storage-on át
DELETE /calendar/events/:id/attachments/:aid
GET    /calendar/events/:id/audit               calendar.manage (+ §4.7 a
                                                private eseményekre)
GET    /calendars/:id/audit                     calendar.manage — a naptár
                                                teljes idővonala: esemény-,
                                                jogosultság- és résztvevő-
                                                változások együtt (§6.6).
                                                CAL2.6, nem CAL1.

GET    /calendar/availability?employeeIds=&from=&to=   szabad/foglalt (Phase 3)
```

**Kötelező szabályok minden végponton:**

1. `from`/`to` **kötelező** az esemény-listán, és a maximális ablak
   **korlátozott** (javaslat: 366 nap). Korlát nélkül egy `from=1970`
   kérés a teljes ismétlődés-kibontást elindítaná.
2. Minden `:id` feloldás `companyScope(req)`-kel; nem található → **404**,
   nem 403 (repó-konvenció).
3. Idegen bérlő `projectId`/`customerId`/`employeeId` a body-ban:
   ugyanaz a hiba, mint a `shifts.routes.ts:137` `resolveScopedProjectId`
   mintájában — **a body-ban érkező minden id-t újra fel kell oldani
   scope alatt**, nem elég, hogy a szerkesztett sor a miénk.
4. Írások rate-limitje a `constants/rateLimits.ts`-be kerül
   (`CALENDAR_WRITES`), nem a route-fájlba.
5. **(R4)** A `view_free_busy`-szintű hozzáférésnél a szerializáló
   **a szerveren** dobja el a `title`, `description`, `location`,
   résztvevő- és csatolmány-mezőket, és `"busy"` jelöléssel adja vissza a
   sort. A kliens **soha nem kap** olyan mezőt, amit el kellene rejtenie —
   egy elrejtett, de leszállított cím a hálózati fülön egy kattintás. Ez a
   `@@index([calendarId, startsAt])`-en futó ugyanazon lekérdezés, csak
   szűkebb `select`-tel.

---

## 9. Notification-integráció (D6, D7)

> **R6 véglegesítve:** a naptár **a meglévő N1.x rendszert használja**.
> Nem épül párhuzamos értesítési út, nem hívunk közvetlenül
> `EmailService`-t, és nem keletkezik új értesítési tábla. A naptár
> egyetlen belépési pontja a `notify()` — ugyanaz, amit ma az auth, a
> meghívó és a billing használ. Ha egy CAL-mérföldkő PR-jában közvetlen
> e-mail-küldés jelenik meg, az hatókörön kívüli.

### 9.1 Registry-append — ennyi az egész

`services/notifications/registry.ts` bővítése:

| Típus | Kategória | Súlyosság | Címzett | Csatornák |
|---|---|---|---|---|
| `calendar.event_invitation` | `calendar` | `info` | `EVENT_PARTICIPANTS` | EMAIL, IN_APP |
| `calendar.event_updated` | `calendar` | `info` | `EVENT_PARTICIPANTS` | IN_APP |
| `calendar.event_rescheduled` | `calendar` | `info` | `EVENT_PARTICIPANTS` | EMAIL, IN_APP |
| `calendar.event_cancelled` | `calendar` | `warning` | `EVENT_PARTICIPANTS` | EMAIL, IN_APP |
| `calendar.event_reminder` | `calendar` | `info` | `EVENT_PARTICIPANTS` | IN_APP (+EMAIL preferencia szerint) |
| `calendar.assignment_created` | `calendar` | `info` | `USER` | EMAIL, IN_APP |

Ehhez kell:

1. **Új kategória** `calendar` a `NOTIFICATION_CATEGORIES`-ba
   (`constants/notifications.ts:34`). **Nem** `mandatory`, **nem**
   `OPT_IN` → alapból be, kikapcsolható. Ez az a beállítás, amit a
   felhasználók tényleg állítgatni fognak.
2. **Új recipient-stratégia** `EVENT_PARTICIPANTS` a
   `RECIPIENT_STRATEGIES`-be (registry.ts:18) + a feloldás a
   `recipients.ts`-ben: az esemény résztvevői → `User`-ök, **kötelezően
   `active: true` szűréssel** (1.5, tombstone-cím).
3. **i18n-kulcsok** a `server/src/i18n/{en,hu}/notifications.json`-ba.

> ⚠️ **Javítva 2026-08-02.** Itt eredetileg egy negyedik pont állt:
> „**Semmi más.**" Ez **architektúrálisan igaz** (nincs új csatorna, új
> pipeline vagy új tábla — D6 áll), **a fájl-listaként viszont téves**, és
> alábecsülte a CAL2.2 méretét. A tényleges érintett felület:
>
> | Fájl | Miért kötelező |
> |---|---|
> | `channels/email.channel.ts` | A `send()` az `isNotificationType()`-pal a **teljes** `NotificationTypeKey` unióra szűkít (`email.channel.ts:123`), a switch végén pedig `assertNoEmailTemplate(type: never)` áll (`:213`). Ezért **minden** registry-kulcs kell egy `case`-t — **még a csak-IN_APP típusok is**, különben a `tsc` bukik. |
> | `recipients.ts` | Az `EVENT_PARTICIPANTS` feloldása. |
> | `tests/notificationRecovery.test.ts` | Kézzel karbantartott EMAIL allow-list (`:68-75`) és IN_APP copy-ellenőrzés (`:39-51`). |
> | `src/i18n/{en,hu}.json` | A **frontend** katalógusok — az eredeti lista ezeket teljesen kihagyta. |
>
> A D6 („registry-append, nem új modul") **építészeti kijelentésként
> érvényes**, de a CAL2.2 becslésére nem használható.

⚠️ **Mindhárom `email.channel.ts`/`registry.ts`/`recipients.ts` fájl az
N1.8 aktív munkaterülete** (az `email.channel.ts` írás közben is módosult:
`+32/-11`). A CAL2.2 **csak teljesen lezárt N1.8 után** indulhat — lásd a
[calendar-cal1-scope.md](calendar-cal1-scope.md) workstream-szakaszát.

### 9.2 Emlékeztetők ütemezése (D7)

**Elvetett megoldás:** minden emlékeztetőre egy késleltetett pg-boss job
(`startAfterSeconds`). Működne, de: egy fél évre előre betett job-ot az
esemény törlése vagy áthelyezése **árván hagy**, és a job-táblát is
feleslegesen hizlalja.

**Javasolt megoldás — percenkénti sweep**, pontosan az N1.x
`notify/sweep` mintájára (`workers.ts:62`):

```
calendar/reminder-sweep   cron: "* * * * *"
  1. esedékes emlékeztetők keresése egy szűk ablakban
     (most-2perc … most), a késés-tűrés miatt
  2. az ismétlődő események következő előfordulásának kibontása
  3. notify({ type: "calendar.event_reminder",
              dedupeKey: `calendar.event_reminder/${eventId}/${occurrenceStart}/${userId}` })
```

A `dedupeKey` **az egész megbízhatóság** — a `NotificationEvent.dedupeKey
@unique` miatt a sweep tetszőleges sokszor futhat (átfedő futások, újra-
indítás, óraátállítás) és **előfordulásonként pontosan egy** emlékeztető
megy ki. Ugyanaz a mechanizmus, ami a trial-emlékeztetőket teszi
biztonságossá.

> ⚠️ **Új mellékhatás az N1.8 Phase 0 után (2026-08-02).** A `notify.ts`
> mostantól **minden** P2002-ütközésre `console.warn`-ol
> („suppressed as a duplicate (dedupeKey: …)"), kifejezetten azért, hogy egy
> **túl tág** billing-dedupeKey diagnosztizálható legyen. A fenti sweep-terv
> viszont **tervezetten ütközik**: 1 perces cron + 2 perces visszatekintő
> ablak ⇒ minden esedékes emlékeztető ~2 további körben újra nekifut, azaz
> emlékeztetőnként ~2 WARN sor **normál üzemben** — pontosan azt a jelzést
> fullasztva el, amiért az N1.8 bevezette.
>
> Feloldás a CAL2.3-ban, három lehetőség: **(a)** nem átfedő sweep-ablak;
> **(b)** a már értesített előfordulások kiszűrése `notify()` hívása
> **előtt** (javasolt — az idempotencia így hálóból tartalékká válik, nem
> normál üzemmódból); **(c)** egyeztetés az N1.9-cel a log szintjéről.
> A `dedupeKey` **marad**; csak nem szabad rá normál működésként támaszkodni.

A queue neve `calendar/reminder-sweep` — perjeles névtér (pg-boss v12 a
kettőspontot elutasítja), a `services/calendar/queues.ts`-ben deklarálva,
a `NOTIFY_QUEUES` mintájára. Retry: `retryLimit: 0`, `deadLetter: null`
— egy kihagyott sweep-futást a következő úgyis lefed.

### 9.3 Mobil push

A `PUSH` csatorna a szótárban létezik, de **transport nincs mögötte**, és
a `CONFIGURABLE_CHANNELS` szándékosan kihagyja. A mobil push tehát
**önálló munka, a naptár-terven kívül** — a naptár csak annyit tesz, hogy
a típusai a `channels` tömbben már ma is felvehetnék, amint a csatorna
megérkezik. Semmilyen naptár-kód nem változik akkor.

---

## 10. Frontend-terv

### 10.1 Útvonalak és menü

| Útvonal | Szerepkör (route-guard) | Tartalom |
|---|---|---|
| `/calendar` | BUSINESS_OWNER, EMPLOYEE, DEVELOPER | fő naptárnézet |
| `/calendar/settings` | BUSINESS_OWNER | naptárak, megosztás, jogosultságok |

> ⚠️ **Fontos korlát:** a `ProtectedRoute` és a `Sidebar.menusByRole`
> **szerepkör-alapú**, a naptár viszont **jogosultság-alapú**. A route-guard
> ezért csak durva szűrő marad; a valódi döntés a szerveré. A menüpont
> megjelenítéséhez a frontendnek meg kell kérdeznie, van-e legalább egy
> látható naptár — ezt a `GET /calendars` üres/nem-üres válasza adja.
> **A szerver a jogosultság egyetlen forrása**; a frontend csak elrejt.

### 10.2 Komponensek

```
pages/CalendarPage.tsx            fő nézet (hónap/hét/nap/agenda)
components/calendar/
  CalendarToolbar.tsx             nézetváltó, dátumnavigáció, szűrők
  CalendarSourceFilter.tsx        naptárak + forrás-rétegek ki/be
  EventModal.tsx                  létrehozás/szerkesztés
  EventDetailsPanel.tsx           részletek, résztvevők, kommentek
  RecurrenceEditor.tsx            ismétlődés beállítása
  RecurrenceScopeDialog.tsx       „csak ez / ez és a további / mind"
  ParticipantPicker.tsx           employee + külső e-mail
  ReminderEditor.tsx              emlékeztetők
  CalendarPermissionsPanel.tsx    megosztás, grantek (owner)
```

### 10.3 Állapotkezelés

A repóban **nincs react-query és nincs zustand** (1.8). A naptár **nem
vezet be új állapotkezelő könyvtárat** — a minta a meglévő
`AuthContext`/`ReadOnlyContext`:

- `CalendarContext` — a betöltött naptárak, a hívó effektív jogai, az
  aktuális nézet/ablak.
- `useCalendarEvents(from, to)` — ablakonkénti fetch + egyszerű,
  `Map`-alapú memoizálás a már betöltött ablakokra.
- Optimista frissítés **csak** drag & drop áthelyezésnél; minden más
  művelet a szerver válaszára vár.

> **Megjegyzés, nem ennek a tervnek a hatásköre:** ha a projekt később
> mégis bevezet egy szerver-állapot könyvtárat, a naptár lesz az első
> modul, amely érdemben profitálna belőle (ablak-cache, invalidálás,
> háttér-újratöltés). Ezt **külön döntésként** javaslom felvetni, nem a
> naptár részeként.

### 10.4 A `react-big-calendar` kérdése (D11)

- **Már telepítve** (`react-big-calendar@1.20.0` + típusok), és a repóban
  **egyetlen** használója a routerből kilógó árva `CalendarPage.tsx`.
- Tud hónap/hét/nap/agenda nézetet, drag & drop-ot (addon), és
  erőforrás-nézetet (`resources` prop) — utóbbi a „employee-nként egy
  oszlop" beosztás-nézethez pontosan elég.
- **A CAL1.1 első feladata az árva fájl törlése**, nem a bővítése: a mai
  tartalma (shift-only, hardcode-olt magyar `messages`, `any[]` state,
  `Invalid Date` a nyitott műszakokon) semmilyen részében nem
  újrahasznosítható.
- A hardcode-olt magyar feliratok helyett a `messages` propot a
  `useTranslation()`-ből kell feltölteni, a `culture`-t pedig a
  felhasználó nyelvéből — nem `"hu"` fixen.

---

## 11. Multi-tenant izoláció és biztonság

### 11.1 A szűrés a lekérdezésben van, nem utána

Minden esemény-olvasás **kötelezően** két szűrőt kap:

```
companyId: <a scope-ból>          ← tenant-izoláció
calendarId: { in: <látható naptárak> }   ← jogosultság
```

A látható naptárak halmazát a permission-gate adja **egy** lekérdezésből
(`CalendarMember` a `@@index([companyId, principalType, principalId])`-en).
Utólagos szűrés tilos: a lapozás és a darabszámok akkor hazudnának.

### 11.2 Konkrét támadási felületek és a válasz

| Kockázat | Válasz |
|---|---|
| Idegen bérlő `calendarId`-je a body-ban | A naptár feloldása `companyScope`-pal, **404** |
| Idegen bérlő `projectId`/`employeeId`/`customerId`-je | Minden body-beli id újrafeloldása scope alatt — a `shifts.routes.ts:137` már bevált mintája |
| Jogosultság-emelés grant írásával | `calendar.share` kell hozzá, és **saját magának senki nem adhat magasabb presetet, mint amivel rendelkezik** |
| A naptár tulajdonosának eltávolítása | Az `OWNER` grant nem törölhető, amíg nincs másik owner |
| `private` esemény kiszivárgása listán | A szerializáló réteg **a lekérdezésben** cseréli le a címet/leírást „Foglalt"-ra, nem a kliensen |
| Csatolmány elérése URL kitalálásával | A meglévő `requireSignedUploadUrl` + `signUrl` réteg; új tárolási útvonal tilos (D8) |
| Ismétlődés-bomba (DoS) | Kötelező `from`/`to`, max 366 napos ablak, és `COUNT`/`UNTIL` nélküli szabálynál felső korlát a kibontott előfordulásokra |
| Résztvevő-felsorolás e-maillel | A résztvevő-hozzáadás **nem árulja el**, létezik-e a cím a rendszerben |
| Írás read-only cégben | `tenantWrite` mount → automatikus |
| **Audit-napló meghamisítása** (D13) | A `source` **kizárólag** szerveroldalon származtatott, soha nem kliens-fejlécből; az `actorUserId` a JWT-ből, nem a body-ból; a tábla **append-only**, nincs UPDATE/DELETE végpont rajta |
| **Privát esemény kiszivárgása az audit-naplón át** (D13) | Az audit-olvasás `calendar.manage`-t igényel, **és** a §4.7 láthatósági szabálya az audit-válaszra is érvényes (§6.6) |

### 11.3 DEVELOPER- és tulajdonosi hozzáférés (D12, R2)

`companyScope()` a DEVELOPER-nek ma **minden bérlő minden sorát** átengedi.
A meglévő moduloknál ez indokolt (platform-üzemeltetés). A naptárnál nem:
a `PERSONAL` naptár privát eseményeket tartalmaz, amelyek **nem üzleti
adatok**.

**Döntés (véglegesített):**

- DEVELOPER a `COMPANY`/`PROJECT`/`EMPLOYEE` naptárakat továbbra is látja
  (támogatási igény valós).
- A `PERSONAL` naptárak eseményeit **sem a DEVELOPER, sem a
  cégtulajdonos** nem látja — csak azt, hogy a naptár létezik. A
  tulajdonos kizárása az R2 finomítás (§4.6, 3. lépés).
- Ha a támogatás mégis igényli, az **explicit, naplózott** művelet legyen
  (`AuditLog`), ne csendes alapértelmezés.

⚠️ **Ez a rendszer első helye, ahol a `companyScope()` alapértelmezése
nem elegendő.** A naptár-lekérdezések ezért **nem hívhatják közvetlenül**
a `companyScope()`-ot: a permission-gate saját `WhereInput`-ot állít elő,
amely a tenant-szűrést is tartalmazza. Ezt a CAL1.3 tesztjeinek
bizonyítaniuk kell — DEVELOPER-tokennel egy idegen bérlő `PERSONAL`
naptárának eseményére **404**, nem 200.

### 11.4 Adatmegőrzés és törlés

- Employee offboarding (B1): a login visszavonásakor az illető
  `CalendarMember`-grantjei is visszavonandók. **A `PERSONAL` naptára
  nem törlődik** (a cég eseménytörténete), de archiválódik.
- Fiók-törlés: a `createdByUserId` skalár, tehát az események túlélik —
  ugyanaz az elv, mint az `AuditLog`-nál.
- Cég-archiválás: a naptárak a céggel együtt inaktívvá válnak, mert a
  belépés maga tiltott (`auth.middleware.ts:99`).

---

## 12. Skálázhatóság

| Kérdés | Válasz |
|---|---|
| Mekkora a fő lekérdezés? | Egy hónapnyi ablak egy közepes cégnél néhány száz sor. A `@@index([calendarId, startsAt])` pontosan ezt szolgálja ki. |
| Mi a legdrágább művelet? | Az ismétlődés-kibontás. Ezért van a `recurrenceEndsAt` pruning (5.2) és a kötelező ablak. |
| Hol lesz a következő szűk keresztmetszet? | A „látható naptárak" halmaz, ha egy cégnek több száz naptára lesz (projektenként egy). Megoldás, ha eljön: a halmaz cache-elése kérésen belül — nem korai optimalizáció, mert egy kérés ma is csak egyszer számolja. |
| Sweep-terhelés? | Percenként egy indexelt lekérdezés egy szűk időablakra. Az N1.x sweep ugyanígy fut ma. |
| Mikor kell anyagiasított előfordulás-tábla? | Ha a szabad/foglalt keresés (Phase 3) sok emberre, sok hétre fut. Akkor sem az összesre: egy **gördülő, N hónapos** materializált ablak a helyes lépés. Ez a Phase 3 döntése, nem a Phase 1-é. |

---

## 13. Billing-integráció (D10)

A naptár **core module**, ezért a magja minden csomagban benne van.
A `planAccess.ts` a **kizárólagos** kapu.

| Képesség | Feature-kulcs | Minimum csomag | Új kulcs kell? |
|---|---|---|---|
| Személyes + céges naptár, események, emlékeztetők | *(nincs gate)* | starter | nem |
| Projekt- és employee-naptárak | *(nincs gate)* | starter | nem |
| Naptár-megosztás, custom permission | `shared_calendars` | professional | **igen — 1 sor** |
| Google Calendar szinkron | `google_calendar` | professional | **nem — már létezik** |
| Outlook szinkron | `outlook_calendar` | professional | **nem — már létezik** |
| AI-ütemezés | `ai_scheduling` | business | **nem — már létezik** |

Limit-javaslat (`constants/limits.ts`, egy sor):
`calendars: { starter: 5, professional: 50, business: 500, enterprise: ∞ }`.

Esemény-darabszámra **nem** javaslok limitet: a naptár használatának
büntetése rossz termékösztönző, és a tárolási költség elhanyagolható.

> **Jóváhagyandó:** a `shared_calendars` professional-hez kötése
> kereskedelmi döntés. Ellenérv, hogy a megosztás nélküli céges naptár
> fél termék; érv mellette, hogy ez a legtermészetesebb upgrade-ok.

---

## 14. Jövőbeli AI-ütemezés

Az `ai_scheduling` feature **már létezik** a registryben (business,
`futureModule: true`). A naptár-adatmodell az alábbiakat teszi lehetővé
anélkül, hogy ma bármit építenénk:

1. **Szabad idősáv keresés** — a `Shift` + `CalendarEvent` + a `PERSONAL`
   naptárak szabad/foglalt vetülete együtt adja a valós elérhetőséget.
   Ez **nem AI**, csak lekérdezés, és a Phase 3-ban amúgy is elkészül.
2. **Útvonal-tudatos beosztás** — a `latitude`/`longitude` az eseményen
   (és a `Project` geofence-mezői) elég ahhoz, hogy egy optimalizáló
   figyelembe vegye az utazási időt.
3. **Terhelés-kiegyenlítés** — a `CalendarAudit` és a `Shift`
   előzmények adják a tanuló adathalmazt.
4. **Természetes nyelvű esemény-létrehozás** („jövő kedd délelőtt Kovács
   úrhoz") — tisztán a bemeneti rétegen ül, a modell nem változik.

**Amit ma kell megtenni ezért: semmit.** Ez a szakasz azért van itt, hogy
a modell-döntések (GPS az eseményen, audit-tábla) tudatosak legyenek, ne
utólag hiányozzanak.

---

## 15. Külső integrációk (Phase 4) — **kizárólag roadmap (R7)**

> **R7 döntés:** a külső naptár-szinkron **nem része a CAL1–CAL3
> szériának**, és **semmilyen előkészítése nem készül el** addig. Sem
> OAuth-infrastruktúra, sem `externalId`/`externalSource` oszlop, sem
> szinkron-absztrakció. Ez a szakasz **iránymutatás egy jövőbeli
> tervhez**, nem elvégzendő munka.
>
> Amit ez a gyakorlatban jelent: ha egy CAL1–CAL3 pull request bármit
> tartalmaz, ami „majd a szinkronhoz kell", az **hatókörön kívüli** és
> visszautasítandó. A spekulatív felület ára valós — a repó ezt a
> `services/storage` interfészénél már egyszer kimondta („widening the
> abstraction before the R2 migration actually needs it would be
> speculative design").

| Rendszer | Protokoll | Megjegyzés |
|---|---|---|
| Google Calendar | Google Calendar API + OAuth 2.0, `watch` push-csatorna | `google_calendar` feature már létezik |
| Outlook / Microsoft 365 | Microsoft Graph API + OAuth 2.0, webhook subscription | `outlook_calendar` már létezik |
| Apple Calendar | **CalDAV** — nincs modern REST API | Lényegesen több munka; javaslat: **iCalendar (.ics) feed** aláírt URL-lel, egyirányú. Ez az Apple Naptárban, és minden más kliensben is működik. |

**Az egyetlen dolog, amit a Phase 1 emiatt tesz — és ez nem többletmunka:**

Az esemény-modell **RFC 5545-kompatibilis elnevezéseket** használ
(`RRULE`, `status`, `visibility`, résztvevő-`response`). Ez nem
előkészítés, hanem névválasztás: ugyanannyi munka, mint bármilyen más
elnevezés, viszont a jövőbeli leképezés mezőnkénti lesz, nem
újratervezés.

**Amit a Phase 1 emiatt kifejezetten NEM tesz (R7):**

- ❌ `externalId` / `externalSource` oszlop — spekulatív felület.
- ❌ OAuth token-tárolás, refresh-logika.
- ❌ Szinkron-absztrakció, „provider" interfész.
- ❌ Konfliktus-feloldási modell. A kétirányú szinkron
  konfliktus-feloldást igényel (ki nyer, ha mindkét oldalon módosult) —
  ez a **Phase 4 első jóváhagyandó döntése**, nem a Phase 1-é.

---

## 16. Roadmap — CAL1.x mérföldkövek

A jelölés az N1.x mintáját követi:
🟢 nulla viselkedésváltozás · 🟡 látható változás · 🔴 ops-teendő

### Phase 1 — Calendar MVP

| # | Mérföldkő | Tartalom | Jelzés |
|---|---|---|---|
| **CAL1.1** | Adatmodell-alapok | 9 új tábla, 0 meglévő módosítása. Semmi nem olvassa őket. Az árva `CalendarPage.tsx` **törlése**. | 🟢 |
| **CAL1.2** | Timezone + recurrence mag | `timezone.ts`, `recurrence.ts` — tiszta függvények, teljes unit-teszttel (DST-átállás, all-day határok, szökőév). Nincs API. | 🟢 |
| **CAL1.3** | Permission-réteg | `calendarPermissions.ts`, `permissions.ts`, feloldási sorrend a `PERSONAL`-kivétellel (R2), `view_free_busy`/`view_details` szétválasztás (R4), `WhereInput`-generálás. Teljes teszt-lefedettség **API előtt**. | 🟢 |
| **CAL1.4** | Calendar CRUD API | `/calendars` + tagság-végpontok + `share-level` (R4), `tenantWrite` mounttal. | 🟡 |
| **CAL1.5** | Event CRUD API | `/calendar/events`, ablak-lekérdezés, free/busy szerializáció, sorozat-szerkesztés három módban, hivatkozás-feloldás (R5). | 🟡 |
| **CAL1.6** | Frontend MVP | `/calendar` útvonal, hónap/hét/nap nézet, esemény-modal, megosztási szint UI, i18n (HU/EN). | 🟡 |
| **CAL1.7** | Forrás-réteg | Shift/Task/Project/Reminder read-only megjelenítése, szűrőkkel (R5). | 🟡 |

**A Phase 1 vége = egy működő, jogosultság-tudatos naptár**, amely a
meglévő operatív adatokat is egy idővonalon mutatja.

Részletes, végrehajtható bontás — fájllistákkal, elfogadási feltételekkel
és teszt-követelményekkel: **[calendar-cal1-scope.md](calendar-cal1-scope.md)**.

### Phase 2 — Team collaboration

| # | Mérföldkő | Tartalom | Jelzés |
|---|---|---|---|
| **CAL2.1** | Résztvevők + RSVP | `CalendarParticipant`, meghívás, válasz. | 🟡 |
| **CAL2.2** | Notification-integráció | Registry-append, `EVENT_PARTICIPANTS`, `calendar` kategória, i18n-kulcsok. | 🟡 |
| **CAL2.3** | Emlékeztető-sweep | `calendar/reminder-sweep`, `dedupeKey` idempotenciával. | 🟡 |
| **CAL2.4** | Kommentek + csatolmányok | A meglévő storage-rétegen át. | 🟡 |
| **CAL2.5** | Megosztás UI | `CalendarPermissionsPanel`, grant-kezelés, `shared_calendars` feature-gate. | 🟡 |
| **CAL2.6** | Audit **olvasó** felület | `GET /calendars/:id/audit` + megjelenítés + megőrzési szabály (Q10). Az audit **írása** már a CAL1.4/CAL1.5-ben él (D13). | 🟢 |

### Phase 3 — Advanced scheduling

| # | Mérföldkő | Tartalom | Jelzés |
|---|---|---|---|
| **CAL3.1** | Szabad/foglalt + elérhetőség | `/calendar/availability`, `PERSONAL` naptárak szabad/foglalt vetülete. | 🟡 |
| **CAL3.2** | Erőforrás-nézet | employee-nkénti oszlopos beosztás, drag & drop. | 🟡 |
| **CAL3.3** | Szabadság/távollét | `EMPLOYEE` naptár típusú távollét-események, jóváhagyási folyamattal. | 🟡 |
| **CAL3.4** | Ütközés-kezelés + munkaidő | `defaultWorkStart/End`, `firstDayOfWeek` élővé tétele. | 🟡 |
| **CAL3.5** | Sablonok, tömeges műveletek | ismétlődő beosztás-minták. | 🟡 |

### Phase 4 — External integrations · **ROADMAP ONLY (R7)**

> **Nem ütemezett, nem becsült, nem előkészített.** Ez a szakasz azért van
> itt, hogy a termék iránya látszódjon — nem azért, hogy dolgozzunk rajta.
> A Phase 4 **saját PLAN → APPROVAL körrel** indul majd, ha eljön az ideje.

| # | Mérföldkő | Tartalom | Jelzés |
|---|---|---|---|
| **CAL4.1** | iCalendar (.ics) feed | egyirányú, aláírt URL — **ez fedi le az Apple Naptárt is**. | 🟡 |
| **CAL4.2** | OAuth-infrastruktúra | token-tárolás, refresh, visszavonás — közös Google/Microsoft alap. | 🔴 |
| **CAL4.3** | Google Calendar kétirányú | `google_calendar` feature-gate, `watch` csatorna, konfliktus-feloldás. | 🔴 |
| **CAL4.4** | Outlook kétirányú | `outlook_calendar` feature-gate, Graph webhook. | 🔴 |

**Mobil/PWA push**: külön széria, a naptáron kívül (9.3).

### Függőségi sorrend

```
CAL1.1 → CAL1.2 → CAL1.3 → CAL1.4 → CAL1.5 → CAL1.6 → CAL1.7
                     ↓
                  CAL2.1 → CAL2.2 → CAL2.3
                     ↓        ↓
                  CAL2.5   CAL2.4, CAL2.6
                     ↓
                  CAL3.x → CAL4.1 → CAL4.2 → CAL4.3 → CAL4.4
```

A **CAL1.3 (permission) minden API előtt** van, és ez nem
átrendezhető: egy jogosultság nélkül kiadott végpontot utólag
bekorlátozni visszafelé nem kompatibilis változás.

---

## 17. Fejlesztési folyamat

A repó folyamata: **PLAN → APPROVAL → IMPLEMENTATION → ADVERSARIAL
REVIEW → ROLLOUT**.

| Fázis | Állapot | Teendő |
|---|---|---|
| **PLAN** | ✅ **Ez a dokumentum.** | — |
| **APPROVAL** | ✅ **LEZÁRVA 2026-08-01.** | D1–D12 elfogadva, R1–R7 finomításokkal. Q1 és Q3 lezárva. |
| **IMPLEMENTATION** | ⏳ **Itt tartunk — de kód még nem készült.** | A végrehajtható bontás: [calendar-cal1-scope.md](calendar-cal1-scope.md). Mérföldkövenként (CAL1.1 → CAL1.7), a sorrend kötött, mérföldkövenként külön commit, backend-teszttel. |
| **ADVERSARIAL REVIEW** | ⬜ | Az N1.7.1–N1.7.3 mintája szerint: a review találatai **saját remediációs mérföldkövet** kapnak (`CAL1.x.1`), és a remediációt újra kell verifikálni. A permission-réteg (CAL1.3) és a multi-tenant izoláció (11.) a review elsődleges célpontja. |
| **ROLLOUT** | ⬜ | `docs/calendar-rollout.md` — deployment checklist + rollback terv, a `notification-rollout.md` mintájára. |

**Munkaszabályok az implementációra** (a `launch-blockers-plan.md`
mintájára):

1. **Egy mérföldkő = egy commit.** Mérföldkövek nem keverednek.
2. **Nincs meglévő oszlop módosítása** a CAL1.x szériában. Ha kiderül,
   hogy mégis kell, az **külön jóváhagyás**.
3. **Minden új végpont teszttel érkezik**, valós PostgreSQL ellen
   (`server/src/tests/`, `TEST_DATABASE_URL`).
4. **A permission-réteg tesztjei az API előtt készülnek el** (CAL1.3).
5. A `docs/project-overview.md` a széria végén frissítendő.

---

## 18. Nyitott kérdések

### 18.1 Lezárva a 2026-08-01-i jóváhagyással

| # | Kérdés | **Döntés** |
|---|---|---|
| **Q1** | Elfogadható-e a naptár-szintű permission-réteg a globális ADMIN/MANAGER szerepkör helyett (D2)? | ✅ **Igen (R1).** A globális szerepkörök nem változnak. Ha később mégis kell globális ADMIN, az önálló széria. |
| **Q3** | Láthatja-e a cégtulajdonos a munkavállalók `PERSONAL` naptárának tartalmát (§4.6)? | ✅ **Alapból nem (R2).** A láthatóság **konfigurálható**, három szinten, és a szintet **az employee állítja** (R4, §4.8). A tulajdonos szerepköre önmagában nem ad hozzáférést. |

### 18.2 Nyitva — de nem blokkolják a CAL1 indulását

Ezek mind eldönthetők az érintett mérföldkő előtt; a CAL1.1–CAL1.3
egyikét sem érintik.

| # | Kérdés | Javaslatom | Mikor kell dönteni |
|---|---|---|---|
| **Q2** | Kell-e `rrule` npm-függőség, vagy elég a szűkített saját kibontó (5.2)? | **Saját kibontó**; `rrule` csak ha a Phase 4 igényli — ami R7 miatt most amúgy sem téma. | CAL1.2 előtt |
| **Q4** | A `shared_calendars` feature valóban `professional`-tól (D10)? | Igen, de ez kereskedelmi döntés — a tiéd. | CAL2.5 előtt |
| **Q5** | Létrejöjjön-e minden employee-hoz automatikusan `EMPLOYEE` naptár? | **Lustán**, első használatkor — különben 200 employee-nál 200 üres naptár. | CAL1.4 előtt |
| **Q6** | A távollét/szabadság a naptár része (CAL3.3) vagy önálló HR-modul? | A naptáré **a megjelenítés**, a jóváhagyási folyamat HR-jellegű: jelenjen meg a naptárban, de a jóváhagyás külön széria. | CAL3.3 előtt |
| **Q7** | Maximális lekérdezési ablak: 366 nap elég (§8)? | Igen. Az éves nézet a leghosszabb valós igény. | CAL1.5 előtt |
| **Q8** ⚠️ **átminősítve** | A `Company.timezone` fallback-értéke — **ütközés az N1.8-cal.** A `billingFormat.ts:115` `"UTC"`-t deklarál („an invoice period boundary shown in the wrong zone can name the wrong DAY"), a CAL1.2 terve `Europe/Budapest`-et. Ugyanaz a mező, két „egyetlen igazság". | Három lehetőség: **(a)** a CAL1.2 importálja a `resolveTimeZone`-t a `billingFormat.ts`-ből és örökli a UTC-t; **(b)** mindkettő felkerül egy közös `utils/timezone.ts`-be egyetlen névvel; **(c)** a naptár tudatosan eltér, és a doksi **leírja, miért**. Javaslat: **(b)** — de ez az N1.8 fájljához nyúl, tehát **integrációs pont, egyeztetést igényel**. Backfill továbbra sem kell. | **CAL1.2 előtt, blokkoló** |
| **Q9** | **Új (R4 nyomán):** megkövetelhesse-e a cég házirendből a `FREE_BUSY` szintet a személyes naptárakon? | **A CAL1-ben nem épül meg** (§4.8). Ha megépül, felső korlátja `FREE_BUSY` — tartalom kikényszerítve soha. Munkajogi kérdés is. | CAL2.5 után, önállóan |
| **Q10** | **Új (D13 nyomán):** mennyi ideig őrizzük a `CalendarAudit` sorokat, és ki takarítja? | Az N1.9 megőrzési sweepjének mintájára, de **a CAL1-ben nem sürgős** (üres táblán nincs mit takarítani). Javaslat: 24 hónap, majd a jogosultság-változások megtartása és az esemény-mutációk ritkítása. | CAL2.6-tal együtt |

---

## 19. Amit ez a terv szándékosan NEM tartalmaz

Az őszinteség kedvéért, hogy a hatókör vitatható legyen:

- **Nincs mobil push** — külön csatorna-munka, a naptáron kívül (9.3).
- **Nincs offline mód / PWA** — a Phase 4 után értelmezhető.
- **Nincs videokonferencia-link generálás** (Meet/Teams/Zoom) — a Phase 4
  OAuth-infrastruktúrájára épülne.
- **Nincs ügyfél-önkiszolgáló időpontfoglalás** (publikus foglalási
  oldal). Ez önálló, nagy termékmodul; a naptár az alapja lenne.
- **Nincs számlázási integráció** — a vízió „Billing (future)"-ként
  jelöli. A `CalendarEvent.projectId`/`customerId` a jövőbeli
  „esemény → számlázható tétel" leképezés horgonya, de a leképezés maga
  külön terv.
- **Nincs globális RBAC-átalakítás** (D2) — ha kell, önálló széria.

---

*Következő lépés: a D1–D12 döntések és a Q1–Q8 kérdések jóváhagyása.
Addig sem kód, sem migráció nem készül.*
