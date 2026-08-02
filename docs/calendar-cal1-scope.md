# Axeriva — Calendar CAL1: implementációs hatókör

*Készült: 2026-08-01. Státusz: **JÓVÁHAGYOTT HATÓKÖR — kód még nem
készült.** A tervdokumentum és a döntések:
[calendar-system-plan.md](calendar-system-plan.md).
Ez a dokumentum a `notification-milestones.md` mintáját követi: mit
csinál egy mérföldkő, mikor kész, mivel bizonyítjuk, és mi a kockázata.*

---

## 0. A jóváhagyott döntések, amiket ez a hatókör érvényesít

| # | Finomítás | Melyik mérföldkő valósítja meg |
|---|---|---|
| **R1** | Naptár-szintű permission, globális szerepkörök változatlanok | CAL1.3 |
| **R2** | `PERSONAL` naptár alapból privát | CAL1.3 (feloldási sorrend) + CAL1.1 (nincs default grant) |
| **R3** | A cégtulajdonos konfigurálja a megosztott naptárak jogait | CAL1.4 |
| **R4** | Személyes láthatóság konfigurálható, free/busy szétválasztva | CAL1.3 (jog) + CAL1.4 (`share-level` API) + CAL1.5 (szerializáció) + CAL1.6 (UI) |
| **R5** | Hivatkozás a forrásobjektumokra, nem másolás | CAL1.1 (FK-k) + CAL1.5 (feloldás) + CAL1.7 (forrás-réteg) |
| **R6** | Értesítés a meglévő N1.x rendszeren | **CAL1-ben nem** — CAL2.2 |
| **R7** | Külső szinkron csak roadmap | **CAL1-ben semmi** — lásd §4 |
| **D13** | **Audit: minden jogosultság-változás és esemény-mutáció** | CAL1.1 (tábla + vokabulárium) + CAL1.4 (jogosultság-audit) + CAL1.5 (esemény-audit). Az olvasó felület CAL2.6. |

> **D13 hatása a hatókörre:** az audit **nem tolódik CAL2.6-ra**. A naptár
> **első írási végpontja már auditált** — különben a CAL1.4 és a CAL1.5
> között keletkezne egy ablak, amelyben érzékeny adat változik napló
> nélkül, és az utólag pótolhatatlan. Csak az audit *olvasása* és a
> megőrzési szabály marad CAL2.6-ra.

---

## 1. A bontás elve

Minden mérföldkő négy feltételt teljesít (a `notification-milestones.md`
§1 szabálya, változatlanul):

1. **Önállóan fejleszthető** — nem igényel párhuzamos munkát máson.
2. **Önállóan tesztelhető** — saját tesztekkel zárul, a teljes suite zöld
   marad.
3. **Önállóan review-zható** — egy commit, egy adverzális review-kör.
4. **Önállóan deployolható** — a `master` a mérföldkő után **bármikor
   élesíthető**.

**A „félkész funkció soha nem látszik" szabály:** a CAL1.1–CAL1.5 után a
felhasználó **semmilyen új felületet nem lát**. A `/calendar` útvonal a
CAL1.6-tal jelenik meg, addigra a mögötte lévő adat és jogosultság már
valós és tesztelt.

**Egy CAL1-specifikus szabály, amit ki kell mondani:**
**a jogosultsági réteg (CAL1.3) minden API előtt elkészül.** Ez nem
átrendezhető sorrend-preferencia: egy jogosultság nélkül kiadott végpontot
utólag bekorlátozni visszafelé nem kompatibilis változás, és a
§4.6-os feloldási sorrend a modul egyetlen biztonsági határa.

---

## 2. Mérföldkövek

### CAL1.1 — Adatmodell alapok  🟢 *nulla viselkedésváltozás*

| | |
|---|---|
| **Tartalom** | **9 új Prisma-modell**: `Calendar`, `CalendarMember`, `CalendarEvent`, `CalendarEventOccurrence`, `CalendarParticipant`, `CalendarEventAttachment`, `CalendarEventComment`, `CalendarEventReminder`, **`CalendarAudit`** (D13 — polimorf, nem a szűkebb `CalendarEventAudit`). Egyetlen additív migráció (`…_calendar_module_foundation`). Vokabulárium-fájlok: `constants/calendarTypes.ts`, `constants/calendarEvents.ts`, **`constants/calendarAuditActions.ts`** (13 action + `AUDIT_SOURCES`). **0 meglévő oszlop módosítása.** A `tests/helpers/db.ts` `DELETE_ORDER` bővítése mind a 9 táblával, gyerek→szülő sorrendben. Factory-k a `tests/helpers/factories.ts`-be (`createCalendar`, `createCalendarEvent`). **Az árva `src/pages/CalendarPage.tsx` törlése.** |
| **Kész, ha** | A migráció lefut üres **és** feltöltött DB-n; a Prisma drift-ellenőrzés tiszta; a `@@unique([calendarId, principalType, principalId])` bizonyítottan blokkolja a duplikált grantet; a `@@unique([eventId, originalStartsAt])` blokkolja a duplikált kivételt; a `CalendarAudit` **`actorUserId`-je skalár** (nem reláció) és a sor túléli a user törlését; a `resetDatabase()` FK-hiba nélkül fut; a teljes suite zöld; mindkét build zöld. |
| **Tesztek** | Új: `calendarSchema.test.ts` — a két unique constraint, a tenant-relációk, a `DELETE_ORDER` helyessége (minden tábla ürül), a nullable FK-k viselkedése, és **a `CalendarAudit` túlélése a hivatkozott user és a hivatkozott esemény törlése után** (D13 fő garanciája). |
| **Deploy** | Triviális: additív migráció, egyetlen sor kódot sem olvas belőle semmi. |
| **Kockázat** | **Alacsony.** |
| **Függ** | — |
| **Miért mind a 9 tábla egyszerre?** | Az N1.1 precedense: mind a 6 notification-tábla egy migrációban jött, és a pipeline csak N1.5-ben kötötte be őket. Egy séma-review olcsóbb, mint kettő, és a CAL2.x így nem igényel újabb migrációt. Ára: 5 tábla (`Participant`, `Attachment`, `Comment`, `Reminder`, `Audit`) hetekig üres marad — ez elfogadott, mert üres tábla nem hordoz kockázatot. |
| **Ismert korlát → CAL1.4** | ⚠️ A `Calendar` „egy felhasználónak egy alapértelmezett naptára" szabálya **nem fejezhető ki Prisma-sémában** (parciális unique index kellene, `WHERE isDefault`). Ugyanaz a korlát, amit az N1.1 a `NotificationPreference` NULL-jainál dokumentált. **Következmény:** a CAL1.4 a naptár-létrehozást *find-then-create* úton végzi, nem csupasz `create`-tel, és erre teszt épül. |

---

### CAL1.2 — Timezone + recurrence mag  🟢 *nulla viselkedésváltozás*

| | |
|---|---|
| **Tartalom** | `services/calendar/timezone.ts` — UTC ↔ IANA konverzió, all-day határok a naptár időzónájában, a `Company.timezone` **első valódi kiolvasása**, egyetlen helyen kimondott fallback (`Europe/Budapest`). `services/calendar/recurrence.ts` — szűkített RRULE-kibontó (`FREQ=DAILY|WEEKLY|MONTHLY|YEARLY`, `INTERVAL`, `BYDAY`, `COUNT`, `UNTIL`), ablakra bontás, kivétel-alkalmazás, `recurrenceEndsAt` kiszámítása. **Tiszta függvények, nulla adatbázis-hozzáférés, nulla API.** |
| **Kész, ha** | Minden függvény tesztelt; a DST-átállás mindkét iránya bizonyítottan helyes (tavaszi előre-, őszi visszaállás Budapesten); az all-day esemény nem lóg át napot; a végtelen szabály `recurrenceEndsAt = null`-t ad; a kibontás felső korláttal véd a végtelen ciklus ellen. |
| **Tesztek** | Unit: `calendarRecurrence.test.ts` + `calendarTimezone.test.ts`. Kötelező esetek: **2026-03-29 és 2026-10-25 (magyar DST-váltás)**, szökőév (02-29 évenkénti ismétlődés), hónapvégi ismétlődés (31-e rövid hónapban), `COUNT` vs `UNTIL` pontos határa, üres ablak. |
| **Deploy** | Triviális: senki nem hívja. |
| **Kockázat** | **Közepes** — ez a modul legkönnyebben elrontható logikája, viszont tiszta függvény, tehát teljesen tesztelhető. Ezért van külön mérföldkő, API nélkül. |
| **Függ** | CAL1.1 (a mezőnevek miatt) |
| **Eldöntendő indulás előtt** | **Q2** — saját kibontó vagy `rrule` npm-csomag. Javaslat: saját (R7 miatt a teljes RFC-re nincs is szükség). |
| **Eldöntendő indulás előtt** | **Q8** — `Company.timezone` backfill. Javaslat: nem kell, a fallback elég. |

---

### CAL1.3 — Permission-réteg  🟢 *nulla viselkedésváltozás*

> **Ez a széria legfontosabb mérföldköve.** Minden API-döntés ezen áll.

| | |
|---|---|
| **Tartalom** | `constants/calendarPermissions.ts` — a 10 jog (`view_free_busy`, `view_details`, `event.create`, `event.edit_own`, `event.edit_any`, `event.delete_own`, `event.delete_any`, `participant.invite`, `share`, `manage`) + a 7 preset (`OWNER`, `ADMIN`, `MANAGER`, `MEMBER`, `VIEWER`, `FREE_BUSY`, `CUSTOM`) a „string + registry, nem Prisma enum" konvenció szerint. `services/calendar/permissions.ts` — `resolveCalendarAccess(user, calendar) → Set<Permission>` a §4.6 sorrenddel (**a `PERSONAL`-kivétellel, R2**), és `visibleCalendarFilter(user) → Prisma.CalendarWhereInput`. |
| **Kész, ha** | Mind a 8 feloldási lépés tesztelt; a `PERSONAL` naptár **BUSINESS_OWNER-nek is** üres jog-halmazt ad grant nélkül; a `view_details` implikálja a `view_free_busy`-t, fordítva nem; a `CUSTOM` preset jog-listája érvényesül; **DEVELOPER-token idegen bérlő `PERSONAL` naptárára üres halmazt kap**; a `WhereInput` a tenant-szűrést is tartalmazza. |
| **Tesztek** | Új: `calendarPermissions.test.ts`. **A mátrix teljes:** 4 naptártípus × 4 principal-típus × 7 preset, plusz a negatív esetek (nincs grant, archivált naptár, idegen bérlő, DEVELOPER, inaktív user). Kifejezetten bizonyítandó: **a tulajdonos szerepköre önmagában nem nyit `PERSONAL` naptárt** — ez az R2 egyetlen technikai garanciája. |
| **Deploy** | Triviális: senki nem hívja. |
| **Kockázat** | **Alacsony a deploy szempontjából, magas a helyesség szempontjából.** Ezért kap teljes teszt-lefedettséget **még az első végpont előtt**. |
| **Függ** | CAL1.1 |
| **Adverzális review kötelező** | Ez a mérföldkő **külön review-kört kap** az N1.7.1 mintájára, a többi CAL1-mérföldkőtől függetlenül. |

---

### CAL1.4 — Calendar CRUD API  🟡 *új végpontok, felület még nincs*

| | |
|---|---|
| **Tartalom** | `routes/calendars.routes.ts` — `GET/POST /calendars`, `GET/PATCH/DELETE /calendars/:id` (a DELETE **archiválás**, nem fizikai törlés), `GET/POST/PATCH/DELETE /calendars/:id/members`, valamint **`GET/PUT /calendars/:id/share-level`** (R4). Mount az `app.ts`-ben **`tenantWrite`-on át**. Lusta naptár-létrehozás (Q5): a `PERSONAL`/`EMPLOYEE` naptár első használatkor jön létre, *find-then-create* úton (CAL1.1 ismert korlátja). Rate-limit: `CALENDAR_WRITES` a `constants/rateLimits.ts`-be. |
| **Audit (D13)** | `services/calendar/audit.ts` — `writeCalendarAudit(tx, {...})`, **a mutációval azonos tranzakcióban**. Ez a mérföldkő rögzíti: `CALENDAR_CREATED/UPDATED/ARCHIVED`, `MEMBER_GRANTED/UPDATED/REVOKED`, `SHARE_LEVEL_CHANGED`. A jogosultság-változások **kétszintű írása**: `CalendarAudit` + a globális `AuditLog` (`CALENDAR_PERMISSION_CHANGED`, új `AUDIT_ACTIONS` bejegyzés). A `source` a hitelesítési útból származik (`req.user` → `WEB`), **soha nem a kérésből**. |
| **Kész, ha** | Minden végpont a CAL1.3 gate-jén megy át; cross-tenant hozzáférés **404** (nem 403); a `share-level`-t **kizárólag a naptár tulajdonosa** hívhatja — a cégtulajdonos 403/404-et kap a más `PERSONAL` naptárára; a `PRIVATE` szint a grant sor **hiánya**, nem külön oszlop; az `OWNER` grant nem törölhető, amíg nincs másik owner; a read-only cég írásai elbuknak, olvasásai átmennek; **minden jogosultság-írás pontosan egy `CalendarAudit` sort hagy**, `from`/`to` értékkel, és **a tranzakció visszagördül, ha az audit-írás elbukik**. |
| **Tesztek** | Új: `calendarApi.test.ts`. Kötelező: tenant-izoláció minden végponton, a `share-level` hatásköri szabálya (R2/R3/R4 **együtt**), jogosultság-emelés elleni védelem (senki nem adhat magának magasabb presetet, mint amivel bír), read-only viselkedés, lusta létrehozás versenyhelyzetben. **Audit:** minden jogosultság-művelet audit-sort hagy; a `changes` a valós `from`/`to`-t tartalmazza; a `source` **`WEB`** és **nem befolyásolható** kliens-fejléccel (explicit spoofing-teszt); a globális `AuditLog` is megkapja a jogosultság-változást, de **az esemény-mutációkat nem**. |
| **Deploy** | Új végpontok, de **semmilyen UI nem hívja őket**. A felhasználó nem lát változást. |
| **Kockázat** | **Közepes** — ez az első írási felület. Rollback: a router mount kivétele az `app.ts`-ből. |
| **Függ** | CAL1.3 |
| **Eldöntendő indulás előtt** | **Q5** — automatikus vagy lusta naptár-létrehozás. Javaslat: lusta. |

---

### CAL1.5 — Event CRUD API  🟡 *új végpontok, felület még nincs*

| | |
|---|---|
| **Tartalom** | `routes/calendarEvents.routes.ts` — `GET /calendar/events?from=&to=&…` (az ablak-lekérdezés, kibontott előfordulásokkal), `GET/POST/PATCH/DELETE /calendar/events/:id` a `?scope=this\|following\|series` sorozat-szemantikával. `services/calendar/events.ts`. **Free/busy szerializáció (R4):** `view_free_busy`-szintnél a szerver `select`-je eleve nem kéri le a `title`/`description`/`location` mezőket. **Hivatkozás-feloldás (R5):** `resolveEventLocation()` a §6.5 sorrenddel; a válasz a projekt/ügyfél adatait *feloldva* adja vissza, az esemény **nem tárolja** őket. |
| **Audit (D13)** | `EVENT_CREATED`, `EVENT_UPDATED`, `EVENT_DELETED` — ugyanazon a `writeCalendarAudit()`-on, ugyanabban a tranzakcióban. **`EVENT_CREATED` tudatosan eltér** a repó „a `createdAt` úgyis megvan" szabályától (`constants/auditActions.ts` fejléc): az eseményt törölni lehet, és a törléssel a `createdByUserId` is eltűnik — az audit-sor viszont marad. A `changes` **csak a megváltozott mezőket** tartalmazza, nem teljes sor-pillanatképet. |
| **Kész, ha** | A `from`/`to` kötelező és max 366 nap (Q7); az ismétlődés a CAL1.2 motorjával bomlik ki; a három szerkesztési scope helyes (a `following` az eredeti szabály `UNTIL`-jét vágja és új sorozatot nyit); **a free/busy válasz bizonyítottan nem tartalmazza a címet a hálózaton**; a body-ban érkező `projectId`/`customerId`/`employeeId`/`shiftId` **mind újra fel van oldva scope alatt** (a `shifts.routes.ts:137` mintája); a `private` esemény „Foglalt"-ként jelenik meg a jogosulatlannak; **minden esemény-mutáció audit-sort hagy, és a törölt esemény audit-sora olvasható marad**. |
| **Tesztek** | Új: `calendarEvents.test.ts`. Kötelező: a free/busy szerializáció **mező-szintű** ellenőrzése (a tiltott kulcsok hiánya a JSON-ban, nem csak az értékük), a három scope, cross-tenant FK-injektálás mind a 4 id-n, az ablak-korlát, az ismétlődés-bomba elleni felső korlát, a `resolveEventLocation()` mind a 4 ága. **Audit:** create/update/delete mind sort hagy; a `changes` csak a ténylegesen változott mezőket tartalmazza (egy nem-változtató PATCH **nem** ír hamis `from`/`to`-t); a törölt esemény audit-sora túléli. |
| **Deploy** | Új végpontok, UI nélkül. |
| **Kockázat** | ⚠️ **A legnagyobb CAL1-mérföldkő.** Ha túl nagynak bizonyul, bontása: **CAL1.5a** (egyszeri események CRUD + free/busy) és **CAL1.5b** (ismétlődés + sorozat-scope). |
| **Függ** | CAL1.2, CAL1.4 |
| **Eldöntendő indulás előtt** | **Q7** — 366 napos ablak. Javaslat: igen. |

---

### CAL1.6 — Frontend MVP  🟡 *itt lesz látható a modul*

| | |
|---|---|
| **Tartalom** | `/calendar` útvonal (`ProtectedRoute`, mindhárom szerepkör) + menüpont a `Sidebar.menusByRole` mindhárom listájába. Új `pages/CalendarPage.tsx` (a CAL1.1-ben törölt árva fájl helyén, **nulla átvett kód**), `components/calendar/` (toolbar, forrás-szűrő, esemény-modal, részletek-panel, ismétlődés-szerkesztő, scope-dialógus, megosztási szint UI). `services/calendar.service.ts` az `apiFetch`-en át. `CalendarContext` — a meglévő `AuthContext`/`ReadOnlyContext` mintájára, **új állapotkezelő könyvtár nélkül**. i18n-kulcsok mindkét nyelvre. A `react-big-calendar` `messages` propja a `useTranslation()`-ből, a `culture` a felhasználó nyelvéből — **nem hardcode-olt `"hu"`**. |
| **Kész, ha** | Hónap/hét/nap nézet működik; esemény létrehozható, szerkeszthető, törölhető; a sorozat-scope dialógus megjelenik ismétlődő eseménynél; a megosztási szint állítható a saját személyes naptáron; a free/busy elemek cím nélkül, semleges stílussal jelennek meg; a read-only bannerrel a vezérlők letiltottak; **mindkét nyelv teljes** (kulcs-paritás). |
| **Tesztek** | ⚠️ **A repóban ma nincs frontend teszt** (`src/` alatt egy sem), és ez a mérföldkő **nem vezet be frontend teszt-infrastruktúrát** — az önálló döntés lenne. Helyette: a backend-végpontok teljes tesztlefedettsége (CAL1.4–1.5) + **kézi ellenőrzési lista**, amit az N1.3 mintájára ide jegyzünk fel. A lint-hibaszám **nem nőhet**. |
| **Deploy** | 🟡 **Az első mérföldkő, amit a felhasználó észrevesz.** Új menüpont, új oldal. |
| **Kockázat** | **Közepes** — nagy felület. Rollback: az útvonal és a menüpont kivétele (a backend maradhat). |
| **Függ** | CAL1.5 |

---

### CAL1.7 — Forrás-réteg  🟡 *a meglévő adatok megjelennek*

| | |
|---|---|
| **Tartalom** | `services/calendar/sources.ts` — read-only adapterek a `Shift`, `Task.dueDate`, `Reminder.dueDate`, `Project.deadline` sorokhoz, szintetikus azonosítóval (`shift:412`). **Nem ír, nem másol, nem konvertál (R5).** Az elemek a saját moduljuk jogosultságát öröklik: EMPLOYEE csak a saját műszakját látja, a `Task`/`Reminder` owner-only marad. Frontend: forrás-szűrő (rétegek ki/be). |
| **Kész, ha** | A nyitott műszak (`end === null`) „folyamatban" jelöléssel jelenik meg — **nem `Invalid Date`-ként** (a törölt árva oldal hibája); a forrás-elemek nem szerkeszthetők a naptárban; egy EMPLOYEE nem látja más műszakját; a `Task`/`Reminder` nem szivárog ki EMPLOYEE felé. |
| **Tesztek** | Új: `calendarSources.test.ts`. Kötelező: a nyitott műszak kezelése, a szerepkörönkénti láthatóság mind a 4 forrásra, tenant-izoláció, a szintetikus id feloldhatatlansága írásra. |
| **Deploy** | A naptár „megtelik" a meglévő operatív adattal. |
| **Kockázat** | **Alacsony** — csak olvas. |
| **Függ** | CAL1.6 |

---

## 3. Függőségi sorrend

```
CAL1.1 ──> CAL1.2 ──┐
   │                ├──> CAL1.5 ──> CAL1.6 ──> CAL1.7
   └──> CAL1.3 ──> CAL1.4 ──┘
```

**Nem átrendezhető:** CAL1.3 minden API előtt (§1).
**Párhuzamosítható:** CAL1.2 és CAL1.3 egymástól függetlenek — ha ketten
dolgoznak rajta, ez a két szál mehet egyszerre.

---

## 4. Hatókörön kívül — amit a CAL1 kifejezetten NEM tartalmaz

Ez a lista ugyanolyan kötelező, mint a fenti hatókör. Ha egy PR bármelyiket
érinti, az **visszautasítandó**, és külön mérföldkövet kap.

| Tétel | Hova tartozik |
|---|---|
| Résztvevők, meghívás, RSVP | CAL2.1 |
| **Bármilyen értesítés-küldés** (R6) | CAL2.2 |
| Emlékeztető-sweep, pg-boss queue | CAL2.3 |
| Kommentek, csatolmányok (a táblák léteznek, de nincs API) | CAL2.4 |
| Megosztás-UI a *megosztott* naptárakra, `shared_calendars` feature-gate | CAL2.5 |
| Audit **olvasó** végpont (`GET /calendars/:id/audit`) és UI — az **írás** viszont CAL1-ben van (D13) | CAL2.6 |
| `CalendarAudit` megőrzési/ritkítási sweep (**Q10**) | CAL2.6 |
| Szabad/foglalt **kereső** (`/calendar/availability`) | CAL3.1 |
| Erőforrás-nézet, drag & drop | CAL3.2 |
| Szabadság/távollét jóváhagyási folyamat | CAL3.3 |
| **Bármilyen külső szinkron, OAuth, `externalId` oszlop** (R7) | Phase 4 — saját PLAN körrel |
| Mobil push csatorna | Külön széria, a naptáron kívül |
| Globális ADMIN/MANAGER szerepkör | Külön széria (`RBAC1.x`), ha egyáltalán kell |
| Cégszintű házirend-minimum a személyes naptárakra | **Q9**, CAL2.5 után |
| Frontend teszt-infrastruktúra bevezetése | Önálló döntés, nem a naptáré |

---

## 5. Amit a CAL1 összesen létrehoz

**Backend — új fájlok:**

```
server/prisma/migrations/…_calendar_module_foundation/migration.sql
server/src/constants/calendarTypes.ts
server/src/constants/calendarEvents.ts
server/src/constants/calendarAuditActions.ts      (D13)
server/src/constants/calendarPermissions.ts
server/src/services/calendar/timezone.ts
server/src/services/calendar/recurrence.ts
server/src/services/calendar/permissions.ts
server/src/services/calendar/audit.ts             (D13)
server/src/services/calendar/events.ts
server/src/services/calendar/sources.ts
server/src/routes/calendars.routes.ts
server/src/routes/calendarEvents.routes.ts
server/src/tests/calendarSchema.test.ts
server/src/tests/calendarTimezone.test.ts
server/src/tests/calendarRecurrence.test.ts
server/src/tests/calendarPermissions.test.ts
server/src/tests/calendarApi.test.ts
server/src/tests/calendarEvents.test.ts
server/src/tests/calendarSources.test.ts
```

**Backend — módosított fájlok (mind additív):**

```
server/prisma/schema.prisma          +9 modell
server/src/app.ts                    +2 router-mount (tenantWrite-on át)
server/src/constants/rateLimits.ts   +1 bejegyzés (CALENDAR_WRITES)
server/src/constants/auditActions.ts +1 bejegyzés (CALENDAR_PERMISSION_CHANGED, D13)
server/src/tests/helpers/db.ts       +9 sor a DELETE_ORDER-be
server/src/tests/helpers/factories.ts +2 factory
```

**Frontend — új fájlok:**

```
src/pages/CalendarPage.tsx           (a törölt árva helyén, új tartalom)
src/components/calendar/*            (8 komponens)
src/services/calendar.service.ts
src/context/CalendarContext.tsx
```

**Frontend — módosított fájlok:**

```
src/app/router/index.tsx             +1 útvonal
src/components/Sidebar.tsx           +1 menüpont × 3 szerepkör
src/i18n/en.json, src/i18n/hu.json   +naptár-kulcsok
```

**Törölt fájl:** `src/pages/CalendarPage.tsx` (a CAL1.1-ben; a CAL1.6
újat ír a helyére, nulla átvett kóddal).

**Amit a CAL1 NEM módosít:** egyetlen meglévő Prisma-oszlopot,
`constants/roles.ts`-t, `middleware/auth.middleware.ts`-t,
`middleware/role.middleware.ts`-t, `utils/scope.ts`-t, a notification-modul
egyetlen fájlját sem, és a Stripe/billing réteget sem.

---

## 6. Indulás előtt eldöntendő

| Kérdés | Kell hozzá | Blokkolja |
|---|---|---|
| **Q2** — saját RRULE-kibontó vagy `rrule` csomag | döntés | CAL1.2 |
| **Q8** — `Company.timezone` backfill kell-e | döntés | CAL1.2 |
| **Q5** — lusta vagy automatikus naptár-létrehozás | döntés | CAL1.4 |
| **Q7** — 366 napos ablak-korlát | döntés | CAL1.5 |
| **🔴 B-1** — shadow-database (P3014) | **döntés + egy parancs** | **CAL1.1 — kemény blokkoló** |
| **🔴 B-2** — külön teszt-adatbázis a CAL1-nek | **döntés + egy DB létrehozása** | **CAL1.1 — kemény blokkoló** |
| **Q8** ⚠️ — a `Company.timezone` fallback ütközése az N1.8-cal (UTC vs. Europe/Budapest) | döntés, és **integrációs egyeztetés**, mert az N1.8 fájljához nyúlhat | CAL1.2 |

~~**A CAL1.1 és a CAL1.3 egyik kérdéstől sem függ** — ez a két mérföldkő
azonnal indulhat.~~

⚠️ **Felülírva 2026-08-02:** a **CAL1.3 továbbra is azonnal indulhat** (tiszta
logika, se séma, se adatbázis), **a CAL1.1 viszont NEM** — előbb a B-1 és a
B-2 blokkolót kell feloldani (§7.9).

---

## 7. CAL1.1 — végrehajtási előkészítés

> **Ez a szakasz az implementáció specifikációja, nem az implementáció.**
> Kód, séma-módosítás és migráció **nem készült**. Ami itt le van írva,
> azt a jóváhagyás után egy az egyben át kell vezetni.

### 7.1 Egy pontosítás, amit előre ki kell mondani

A „**0 meglévő tábla módosítása**" állítás **adatbázis-szinten** igaz: a
migráció kizárólag `CREATE TABLE`-öket és az új táblákon lévő
idegenkulcsokat hoz létre, meglévő oszlopot nem érint.

A `schema.prisma` viszont **kap sorokat a meglévő modellekbe**: a Prisma
minden relációt kétoldalúan követel meg, így a `Company`, `Project`,
`Customer`, `Employee` és `Shift` modellek **vissza-reláció mezőket**
kapnak (pl. `calendars Calendar[]`). Ezek **nem generálnak SQL-oszlopot** —
kliensoldali navigációs mezők. Ugyanez történt az N1.1-ben is (`Company`
ott is kapott hat `NotificationEvent[]`-szerű sort).

Ezt azért kell előre kimondani, mert a review-ban különben úgy néz ki,
mintha megsértenénk a saját szabályunkat.

### 7.2 A 9 modell — mezőszintű specifikáció

A hivatkozott konvenciók: `Int` autoincrement PK · **nincs Prisma enum**
(string + `constants/`) · JSON = `String?` + `JSON.stringify` ·
append-only modellen **nincs `updatedAt`** · ami túléli a user törlését,
az **skalár, nem reláció**.

| # | Modell | `companyId`? | Kulcsmezők | Constraint / index |
|---|---|---|---|---|
| 1 | `Calendar` | ✅ `Int` | `type`, `name`, `description?`, `color?`, `timezone?`, `ownerUserId?` (skalár), `projectId?`, `employeeId?`, `isDefault`, `archivedAt?` | `@@index([companyId, type])`, `@@index([ownerUserId])`, `@@index([projectId])`, `@@index([employeeId])` |
| 2 | `CalendarMember` | ✅ `Int` | `calendarId`, `principalType`, `principalId` (**String**), `preset`, `permissions?` (JSON-string), `grantedByUserId?` (skalár) | `@@unique([calendarId, principalType, principalId])`, `@@index([companyId, principalType, principalId])` |
| 3 | `CalendarEvent` | ✅ `Int` | `calendarId`, `title`, `description?`, `startsAt`, `endsAt`, `allDay`, `timezone?`, `recurrenceRule?`, `recurrenceEndsAt?`, `status`, `visibility`, `createdByUserId` (skalár), `projectId?`, `customerId?`, `employeeId?`, `shiftId?`, `location?`, `latitude?`, `longitude?`, `metadata?` | `@@index([calendarId, startsAt])`, `@@index([companyId, startsAt])`, `@@index([projectId])`, `@@index([customerId])`, `@@index([employeeId])`, `@@index([shiftId])`, `@@index([recurrenceEndsAt])` |
| 4 | `CalendarEventOccurrence` | ❌ | `eventId`, `originalStartsAt`, `cancelled`, felülíró mezők (`startsAt?`, `endsAt?`, `title?`, `location?`) | `@@unique([eventId, originalStartsAt])` |
| 5 | `CalendarParticipant` | ❌ | `eventId`, `userId?` (skalár), `employeeId?`, `email?`, `response`, `isOrganizer` | `@@unique([eventId, userId])`, `@@index([eventId])` |
| 6 | `CalendarEventAttachment` | ❌ | `eventId`, `userId` (skalár), `fileName`, `fileType`, `fileSize`, `fileUrl`, `category` | `@@index([eventId])` |
| 7 | `CalendarEventComment` | ❌ | `eventId`, `userId` (skalár), `content` — **append-only, nincs `updatedAt`** | `@@index([eventId])` |
| 8 | `CalendarEventReminder` | ❌ | `eventId`, `userId?` (skalár), `minutesBefore`, `channel` | `@@index([eventId])` |
| 9 | **`CalendarAudit`** | ✅ `Int` | `calendarId`, `targetType`, `targetId`, `action`, `actorUserId?` (skalár), `source`, `requestId?`, `changes?` (JSON-string) — **append-only, nincs `updatedAt`** | `@@index([calendarId, createdAt])`, `@@index([companyId, createdAt])`, `@@index([targetType, targetId])`, `@@index([actorUserId])` |

**Miért nincs `companyId` a 4–8. modellen?** Mind az öt a
`CalendarEvent` gyereke, a bérlő tehát a szülőn át elérhető. Precedens a
repóban: az `EmailEvent` sem hordoz `companyId`-t, mert a
`NotificationDelivery` gyereke. Denormalizálni itt csak konzisztencia-
kockázatot adna (a gyerek `companyId`-je elcsúszhatna a szülőétől),
haszon nélkül — ezekre a táblákra soha nem megy közvetlen,
bérlő-szűrt lekérdezés.

**A `CalendarAudit` viszont kap `companyId`-t**, mert megy rá közvetlen
lekérdezés (cégszintű audit-áttekintés), és mert **túl kell élnie** a
hivatkozott esemény törlését — a szülőn át tehát nem lenne elérhető.

### 7.3 Vokabulárium-fájlok

```
constants/calendarTypes.ts
  CALENDAR_TYPES     = PERSONAL | COMPANY | PROJECT | EMPLOYEE

constants/calendarEvents.ts
  EVENT_STATUSES     = confirmed | tentative | cancelled
  EVENT_VISIBILITIES = default | private | confidential
  PARTICIPANT_RESPONSES = needs_action | accepted | declined | tentative
  PRINCIPAL_TYPES    = USER | EMPLOYEE | ROLE | COMPANY

constants/calendarAuditActions.ts                                  (D13)
  CALENDAR_AUDIT_ACTIONS = CALENDAR_CREATED | CALENDAR_UPDATED
                         | CALENDAR_ARCHIVED | EVENT_CREATED
                         | EVENT_UPDATED | EVENT_DELETED
                         | MEMBER_GRANTED | MEMBER_UPDATED
                         | MEMBER_REVOKED | SHARE_LEVEL_CHANGED
                         | PARTICIPANT_ADDED | PARTICIPANT_REMOVED
                         | PARTICIPANT_RESPONDED
  AUDIT_TARGET_TYPES     = CALENDAR | EVENT | MEMBER | PARTICIPANT
  AUDIT_SOURCES          = WEB | API | SYSTEM
```

⚠️ Az `API` forrás **a CAL1-ben nem érhető el** (nincs API-kulcsos
hitelesítés). A vokabuláriumban azért van benne az első naptól, hogy a
megérkezésekor ne kelljen migrálni — ugyanaz az érv, mint a
`NOTIFICATION_CHANNELS` `PUSH`/`SMS` értékeinél.

### 7.4 `DELETE_ORDER` — a pontos beszúrás

A `server/src/tests/helpers/db.ts` listájának **elejére**, a
notification-blokk elé. Indok: a naptár-táblák hivatkoznak a `Shift`,
`Project`, `Customer`, `Employee` és `Company` sorokra, tehát mindegyiknél
korábban kell ürülniük; rájuk viszont semmi nem hivatkozik.

```
// CAL1.1 — naptár-modul: gyerekek előbb, majd az esemény, a tagság és
// végül a konténer. A CalendarAudit elöl, mert a Calendar-ra mutat.
calendarAudit
calendarEventOccurrence
calendarParticipant
calendarEventAttachment
calendarEventComment
calendarEventReminder
calendarEvent
calendarMember
calendar
  ↓ (innen a meglévő lista változatlanul)
emailEvent
…
```

### 7.5 Factory-k (`tests/helpers/factories.ts`)

A meglévő stílust követve (`createProject(companyId, overrides)`):

```
createCalendar(companyId, overrides?)        → alap: type "COMPANY", isDefault false
createCalendarEvent(calendarId, companyId, overrides?)
                                             → alap: 1 órás, nem ismétlődő,
                                               status "confirmed",
                                               visibility "default"
```

### 7.6 A CAL1.1 teszt-esetek listája (`calendarSchema.test.ts`)

| # | Eset | Mit bizonyít |
|---|---|---|
| 1 | Duplikált `CalendarMember` ugyanarra a (calendar, principalType, principalId) hármasra → `P2002` | a grant-unicitás |
| 2 | Duplikált `CalendarEventOccurrence` ugyanarra a (eventId, originalStartsAt) párra → `P2002` | a kivétel-unicitás |
| 3 | Két `PERSONAL` naptár két különböző userhez ugyanabban a cégben → **engedett** | nem szűkítettük túl |
| 4 | `CalendarEvent` létrehozása mind a 4 opcionális FK-val (`projectId`, `customerId`, `employeeId`, `shiftId`) | a relációk élnek |
| 5 | `CalendarEvent` létrehozása mind a 4 FK nélkül | a nullable FK-k tényleg opcionálisak |
| 6 | **A hivatkozott `User` törlése után a `CalendarAudit.actorUserId` sor megmarad** | D13 fő garanciája: a skalár mező |
| 7 | **A hivatkozott `CalendarEvent` törlése után a `CalendarAudit` sor megmarad** | az audit túléli a törlést |
| 8 | `resetDatabase()` teli adatbázison FK-hiba nélkül lefut | a `DELETE_ORDER` helyes |
| 9 | Két bérlő naptárai nem látják egymást `companyId`-szűréssel | tenant-reláció |

### 7.7 Indulási ellenőrzőlista

- [ ] **🔴 ELŐFELTÉTEL: a shadow-database kérdés megoldva** — lásd §7.9.
      Enélkül a következő sor **nem teljesíthető**.
- [ ] A migráció neve: `<timestamp>_calendar_module_foundation`
- [ ] `npx prisma migrate dev` **üres** és **feltöltött** adatbázison is lefut
- [ ] `npx prisma migrate diff` drift-mentes
- [ ] `TEST_DATABASE_URL` be van állítva (a neve tartalmazza a „test" szót,
      különben a `globalSetup.ts` el sem indul)
- [ ] A teljes backend suite zöld, és a tesztszám **pontosan 9-cel nőtt
      ahhoz a committhoz képest, amelyről a CAL1.1 leágazott** — a SHA-t ide
      kell írni. (Abszolút számot megadni értelmetlen: az N1.8 párhuzamosan
      növeli a suite-ot. Ellenőriztem: **semmilyen teszt nem állít
      darabszámot**, tehát ez nem törhet el — csak kipipálhatatlan lenne.)
      Bázis-SHA: `________`
- [ ] Backend és frontend build zöld
- [ ] A frontend lint-hibaszám **nem nőtt** (az árva `CalendarPage.tsx`
      törlésével inkább csökken)
- [ ] `git status` — a commit **kizárólag** a CAL1.1 fájljait tartalmazza

### 7.8 Amit a CAL1.1 kifejezetten NEM tesz

- ❌ Egyetlen route, service vagy controller sem születik.
- ❌ Egyetlen sor sem olvassa a 9 új táblát.
- ❌ Az `app.ts` **nem** módosul (a router-mount a CAL1.4-é).
- ❌ Nincs jogosultság-logika (az a CAL1.3).
- ❌ Nincs audit-**író** (az a CAL1.4/CAL1.5) — csak a tábla és a
  vokabulárium.
- ❌ Nincs frontend-változás, **egy kivétellel**: az árva
  `src/pages/CalendarPage.tsx` törlése.

---

## 7.9 🔴 Két blokkoló, amit a határ-audit talált (2026-08-02)

Mindkettőt **méréssel** igazoltam, nem következtetéssel.

### B-1 — `prisma migrate dev` nem fog lefutni (P3014)

| Mérés | Eredmény |
|---|---|
| `shadowDatabaseUrl` a `schema.prisma`-ban / `prisma.config.ts`-ben / `server/.env`-ben | **nincs sehol** |
| `SELECT rolname, rolcreatedb, rolsuper FROM pg_roles` | `axeriva createdb=false super=false` · `postgres createdb=true super=true` |

A Prisma PostgreSQL-en **minden `migrate dev` híváshoz shadow-adatbázist
hoz létre**. Az `axeriva` szerepkör ezt nem teheti meg, és nincs
konfigurált shadow-URL → a parancs **P3014-gyel elhasal**, mielőtt egyetlen
naptár-tábla létrejönne.

**Három megoldás, választani kell:**

| # | Megoldás | Ár |
|---|---|---|
| a | `ALTER ROLE axeriva CREATEDB;` **postgres** szerepkörrel | legolcsóbb; egy jogosultsággal többet ad a dev-szerepkörnek |
| b | Dedikált shadow-adatbázis + `shadowDatabaseUrl` a datasource-ban | tiszta, de **`schema.prisma`-t módosít** — az N1.8 nem nyúl hozzá, tehát biztonságos |
| c | `prisma migrate diff --script` + `prisma migrate resolve --applied` | shadow DB nélkül működik; kézi SQL, több hibalehetőség |

**Javaslat: (a)** — egyszeri, visszafordítható, és nem módosít verziózott
fájlt. Ellenőrzés a döntés után: `npx prisma migrate dev --create-only`.

### B-2 — a két stream **egy** teszt-adatbázison osztozik

A `globalSetup.ts` `prisma migrate deploy`-t futtat a `TEST_DATABASE_URL`
ellen, ami egyetlen lokális adatbázisra mutat. **Nincsenek feature-branchek**
— az N1.8 a `master` munkafáján dolgozik.

A konkrét meghibásodási lánc:

1. A CAL1.1 migrációja **véglegesen** bekerül az `axeriva_test`-be
   (a `migrate deploy` csak előre gördít).
2. Visszaváltasz az N1.8-ra, ahol a `schema.prisma` **nem ismeri** a
   `Calendar` táblát.
3. A `migrate deploy` „No pending migrations" üzenetet ír — **nem figyelmeztet**.
4. A `resetDatabase()` `prisma.company.deleteMany()`-je **P2003-mal elszáll
   a `Calendar_companyId_fkey`-en**, mert a `Calendar.companyId` kötelező FK,
   és a repó minden kötelező FK-t `ON DELETE RESTRICT`-tel generál
   (bizonyíték: `migrations/20260801100000_notification_module_foundation/migration.sql:132`).
5. Az N1.8 **minden** tesztje pirosra vált egy olyan tábla miatt, ami abban
   a checkoutban nem is létezik és a kódban nem grepelhető.

**Megoldás:** a CAL1 külön, eldobható adatbázist kap
(pl. `axeriva_test_cal1` — a név tartalmazza a „test"-et, tehát az
`assertDisposableDatabase` átengedi), a `TEST_DATABASE_URL`-t **inline**
átadva. A `globalSetup.ts` **nem módosul** (az N1.8 közös felülete).

---

## 8. Workstream-izoláció (CAL1 ↔ N1.8)

A határ-audit fő megállapítása, előre: **ma a két stream nulla fájlon
osztozik.** Egyetlen fájlt sem szerkeszt mindkettő. Amit a CAL1 érint
(`schema.prisma`, `tests/helpers/db.ts`, `factories.ts`, `rateLimits.ts`,
`auditActions.ts`, `app.ts`), abból az N1.8 **egyiket sem** — nem szállít
migrációt és nem ad új router-mountot.

**A valódi kockázat tehát nem szöveges ütközés, hanem a közös
teszt-adatbázis (B-2) és a piszkos munkafa.**

### Szabályok a CAL1 implementációjára

1. **Soha ne ágazz le piszkos fáról.** Az N1.8 folyamatosan ír a `master`
   munkafájára (a mérés közben az `email.channel.ts` `+32/-11`-gyel
   módosult). Egy `git add -A` befogna egy félkész billing-sablont.
   **Fájlonként adj hozzá**, a §7.7 fájllistája szerint.
2. **A commit előtt mindig `git status` + `git diff`** — nem a munka
   elején, hanem közvetlenül a commit előtt.
3. **Idegen módosítást soha ne állíts vissza, ne stage-elj, ne „takaríts".**
   Hagyd, és jelentsd.
4. **Tiltott terület a CAL1.1–CAL1.7 alatt:** minden a
   `server/src/services/notifications/` alatt, a `server/src/emails/`, a
   `server/src/i18n/` (a **szerver**-katalógusok), a `utils/billingFormat.ts`
   és a Stripe/billing réteg. Egy ide nyúló CAL1-es PR **látatlanban
   elutasítandó**, amíg az N1.8 nyitva van.
5. **Ütemezés:** a CAL1.1 vagy **szigorúan az N1.8 következő szelete előtt**,
   vagy **az N1.8 lezárása után** landoljon — soha két szelet között. Nem
   merge-okok miatt, hanem mert a CAL1.1 migrációt alkalmaz és a
   `resetDatabase()` viselkedését változtatja, miközben minden N1.8-szelet
   teljes suite-futással zárul. Piros suite-ot olcsóbb debugolni, ha csak
   az egyik stream mozdította el az alapot.
6. **A CAL2.2 a veszélyes pont, nem a CAL1.** A `registry.ts`, az
   `email.channel.ts` és a `notificationRecovery.test.ts:68-75` mind
   **ugyanabba a literálba** fűznek be, amit az N1.8 tizenkétszer ír át.
   A CAL2.2 **csak teljesen lezárt N1.8-ra rebase-elve** indulhat, és a
   naptár-blokkot **minden literál VÉGÉRE** kell fűzni.

### Aszimmetria, amit a CAL2.2-nek meg kell tanulnia

Ugyanabban a modulban az egyik bővítési pont **hangosan**, a másik
**némán** bukik:

- registry-kulcs `case` nélkül az `email.channel.ts`-ben → **`tsc` bukik**
  (a switch a teljes unióra szűkít, `assertNoEmailTemplate(type: never)`).
- `EVENT_PARTICIPANTS` a `RECIPIENT_STRATEGIES`-ben a `recipients.ts`
  feloldó ága nélkül → **fut, és nem kézbesít**.

A CAL2.2 tesztjeinek a másodikra kell külön esetet írniuk; az elsőt a
fordító elkapja.

---

*Állapot: **a CAL1.1 elő van készítve, kód nem készült.** A B-1 és a B-2
blokkolót az implementáció megkezdése előtt fel kell oldani.*
