# ADR-001 — Tartós job-queue: pg-boss a BullMQ helyett

**Állapot:** Elfogadva · 2026-08-01 · implementálva az N1.4-ben (`6d54642`)
**Érinti:** `server/src/services/queue/`, `server/src/index.ts`, Render-környezet, CI

---

## Kontextus

A Notification modulnak ([notification-system-plan.md](../notification-system-plan.md))
tartós háttérfeldolgozás kell: az e-mail-küldés hálózaton át történik, tehát
hibázhat, és újrapróbálkozást igényel. Ezen felül **ütemezésre** is szükség
van (trial-emlékeztetők 7/3/1 nappal a lejárat előtt, határidő-értesítők).

A kiindulási helyzet:

- **Semmilyen háttérmunka nem létezett.** Nincs cron, nincs worker, nincs
  ütemező; az egyetlen `setInterval` a rate-limiter memóriatakarítója. Az
  e-mailek „fire-and-forget" módon mentek: egy Resend-kiesés véglegesen
  elveszítette az üzenetet, egyetlen `console.error` nyomával.
- **Egyetlen Node-process**, egy Render Web Service + egy Static Site. Nincs
  worker-service, nincs Redis, nincs második adattár.
- **PostgreSQL** (Render Basic-256mb) már fut, PITR-backuppal.
- Várható terhelés: **napi néhány száz e-mail** (~0,005 kérés/s átlag).
- A repó kimondott elve a kevés mozgó alkatrész; a `launch-blockers-plan.md`
  külön rögzíti, hogy ütemezett GitHub Actions-jobot **tudatosan nem**
  vezetünk be (élő DB-credential kerülne CI-secretbe).

## Döntés

**pg-boss 12**, az alkalmazás saját processzében, a meglévő PostgreSQL-ben,
külön `pgboss` sémában.

Kiegészítő döntések, amelyek ehhez tartoznak:

1. **Saját, kicsi connection pool** (`max: 2`), nem a Prisma poolja. A Prisma
   6 nem tesz elérhetővé `pg.Pool`-t; a `$queryRawUnsafe`-en át shimmelés a
   Prisma típus-marshallingját (BigInt, Date) tenné a queue saját SQL-je alá.
2. **Önkiszolgáló séma-migráció** (pg-boss alapértelmezés), nem CLI-lépés a
   start commandban.
3. **Saját seam** (`enqueue()` / `registerWorker()`): a `services/queue`-n
   kívül semmi nem importál pg-boss-t.
4. **Transactional outbox** a tranzakciós enqueue helyett (a pg-boss hivatalos
   Prisma-adaptere Prisma 7-et igényel; a repó 6.15-ön van).

## Következmények

### Amit nyerünk

- **Nulla új infrastruktúra.** Nincs új fizetős szolgáltatás, nincs új
  dashboard, alerting, backup-szemantika, és nincs új hibadomain, ami a
  PostgreSQL-től függetlenül eldőlhet.
- **Az ütemezés benne van.** A trial-emlékeztetőkhöz amúgy is kellett volna
  valami; így nem külön megoldandó feladat.
- **A tartósság a meglévő backup-történetet örökli** (PITR).
- Az e-mailek végre **retry-olhatók**: a mai néma veszteség megszűnik.

### Amit fizetünk érte

- ⚠️ **Node ≥ 22.12 kötelező.** A pg-boss 12 ESM-only csomag, a szerver
  CommonJS — csak a `require(esm)` támogatáson át tölthető be. Ez a döntés
  legdrágább következménye: **futtatókörnyezeti** követelmény, ami a Render
  konfigurációját is érinti, és a rossz sorrendű deploy `ERR_REQUIRE_ESM`-mel
  bukik. Ezért van pinelve a CI `22.12`-re, nem `22`-re.
- **Nincs valódi requests/second rate limiter**, csak konkurencia-korlát és
  throttle. A Resend limitje 10 kérés/s; a várt terhelés ennek töredéke, tehát
  ma nem szűk keresztmetszet — de burst-kritikussá válhat.
- **Üresjárati DB-forgalom**: worker- és karbantartó-ciklusok. A poll 10 mp-re
  állítva (a 2 mp-es alapérték ~43 ezer no-op lekérdezés lenne naponta,
  soronként).
- **Két migrációs rendszer** egy adatbázisban. Külön sémákkal elszigetelve; a
  Prisma drift-ellenőrzés igazoltan nem látja a `pgboss` sémát.
- **A tranzakciós enqueue nem atomi** — az outbox pótolja, egy percenkénti
  sweep zárja a rést.

## Elvetett alternatívák

### BullMQ + Redis (Render Key Value)

A legérettebb megoldás, valódi rate limiterrel és kiforrott admin-felülettel
(Bull Board). Elvetve, mert **új fizetős szolgáltatást** követel: a Render
Key Value **ingyenes szintje nem perzisztens**, tehát durable queue-nak
alkalmatlan. Cserébe egy olyan képességért fizetnénk (rps-limiter), amire a
jelenlegi nagyságrendben nincs szükség — és kapnánk egy második adattárat,
ami külön dőlhet el, külön mentendő és külön figyelendő.

*(Mellékes, de jelzésértékű: a Bull Board jelenlegi kiadása még a BullMQ
5.x-hez van peer-elve, tehát a „BullMQ, mert Bull Board" érv sem áll ma.)*

### BullMQ 6 PostgreSQL-backenddel

Érdekes köztes út: BullMQ API és rate limiter, Redis nélkül. Elvetve, mert a
v6-ban **új** és nem igazolt éles használatban, a séma-migráció automatikus és
visszafelé nem támogatott, és az admin-UI valószínűleg nem működik vele. Ha a
pg-boss rate-limitálását kinőjük, **ez az első hely, ahová visszatérünk** — a
seam (3. döntés) pontosan ezért létezik.

### Saját minimál poller (`NotificationJob` tábla + `setInterval`)

Nulla új függőség, teljes Prisma-kontroll, semmilyen Node-bump. Elvetve, mert
újraírnánk a retryt, a backoffot, a dead-lettert és az ütemezést — az a fajta
kód, ami olcsónak indul és karbantartási teherré válik. A pg-boss kanonikus
felhasználása pontosan ez.

## Visszafordíthatóság

**Közepesen olcsó, ha a seam megmarad.** A váltás menete: leállítjuk az
enqueue-t, a meglévő workerek kiürítik a hátralékot (a mi nagyságrendünkben
percek), a seam mögé új backend kerül. A `singletonKey`/`deadLetter`
fogalmakat kell átfordítani, a `schedule()`-t a másik ütemezőre.

**Amit nem lehet visszacsinálni:** a Node-verzió emelése lefelé nem
visszafordítható a többi függőség érintése nélkül — de a 22.12 LTS, tehát ez
inkább előrelépés, mint adósság.

---

*Kapcsolódó: [notification-system-plan.md](../notification-system-plan.md) 12.
szakasz (a döntés részletes összevetése), [notification-milestones.md](../notification-milestones.md)
N1.4, [notification-rollout.md](../notification-rollout.md) 1. szakasz (a
Node-bump üzemeltetési lépése).*
