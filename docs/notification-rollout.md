# Axeriva — Notification modul: deployment checklist

*Készült: 2026-08-01. A [notification-milestones.md](notification-milestones.md)
mérföldköveinek üzemeltetési kísérője. Mérföldkövenként egy szakasz: mit kell
tenni **a push előtt**, mi történik magától, és hogyan lehet visszaállni.*

---

## 0. A sorozat állapota

| Mérföldkő | Commit | Ops-teendő deploy előtt | Felhasználó látja? |
|---|---|---|---|
| N1.1 — Adatmodell | `d1f7519` | — | nem |
| N1.2 — Backend i18n | `11a2182` | — | nem |
| N1.3 — React Email | `e22d6fa` + `e407af6` | — | **igen** (levelek kinézete, nyelve) |
| N1.4 — pg-boss queue | `6d54642` | ⚠️ **Node 22.12 a Renderen** | nem |
| N1.5 — Notification core | `4096723` | — | nem (kifelé azonos viselkedés, belül a pipeline) |
| N1.6 — Resend webhook | `0b9e291` | ⚠️ **Resend Dashboard + `RESEND_WEBHOOK_SECRET`** | nem |
| N1.7 — API + harang | `85f3180` | — | **igen** (harang a Topbarban, értesítési beállítások) |

*(ADR-001 — `19d2f12` — dokumentum, nincs ops-vonzata.)*

**A sorozat még nincs pusholva.** A `master` hét notification-commitot
tartalmaz a Design C rollout előtti állapot fölött.

---

## 1. Egyetlen blokkoló lépés: Node 22.12 (N1.4)

Ez az egyetlen pont, ahol a sorrend megsértése **bukott deployt** okoz.

**Miért:** a pg-boss 12 ESM-only csomag, a szerver CommonJS. Csak a Node
`require(esm)` támogatásán át tölthető be, ami **22.12-ben** jelent meg.
Régebbi runtime-on az indulás `ERR_REQUIRE_ESM`-mel elszáll — a hibaüzenet
kódhibának látszik, pedig környezeti.

**Teendő, push ELŐTT:**

1. Render Dashboard → a backend Web Service → **Environment**
2. `NODE_VERSION` = `22.12` (vagy újabb) — ha nincs ilyen változó, hozd létre
3. Mentés (ez önmagában nem indít deployt, ha „Save" és nem „Save and deploy")

**Ellenőrzés a deploy után:** a boot-logban meg kell jelennie:
```
[queue] started (schema: pgboss, poll: 10s per worker)
Axeriva API v1.0.0 running on port ... (production)
```
A `[queue] started` sornak a `running on port` **előtt** kell állnia.

⚠️ **A health-check maradjon `/health`.** A `/health/workers` szándékosan
503-at ad, ha a queue leállt — egy háttér-alrendszer nem dönthet el egy
deployt. A `/health/workers` a monitoringé.

---

## 1b. Nem blokkoló, de a push napján elvégzendő: Resend webhook (N1.6)

Ez **nem** buktatja el a deployt, és szándékosan nem is: a
`RESEND_WEBHOOK_SECRET` hiánya esetén a végpont 400-at ad, elveszik a
kézbesítési telemetria, de az API fut tovább (lásd N1.6 „Eltérés a tervtől").
Ha viszont kimarad, **csendben** marad ki: nem lesz `delivered`/`bounced`
állapot, a bounce-olt címek nem kerülnek suppression-listára, és ez csak
hetekkel később, romló domain-reputációként jelentkezik.

**Teendő:**

1. Resend Dashboard → **Webhooks** → *Add endpoint*
2. URL: `https://<backend-host>/notifications/webhook/resend`
3. Események: legalább `email.delivered`, `email.bounced`, `email.complained`
   (az `email.sent` felvehető, de **soha nem** jelenik meg „kézbesítve"-ként)
4. A megjelenő **signing secret** (`whsec_…`) → Render → Environment →
   `RESEND_WEBHOOK_SECRET`
5. Deploy

**Ellenőrzés:** a Resend Dashboard *Send test event* gombja után
`SELECT COUNT(*) FROM "EmailEvent";` nő eggyel. Hamis titokkal küldött kérés
400-at kap — ezt a suite valós Svix-aláírással már bizonyítja, hálózat nélkül.

---

## 1a-bis. ⚠️ N1.8 Slice 1–2 — Stripe Dashboard: `invoice.paid` feliratkozás

**Ez blokkoló, és a kóddal EGY lépésben végzendő.**

A Slice 1 kezelője az `invoice.paid` eseményre reagál (megújulási nyugta). A
`HANDLED_EVENTS` bővítése a kódban **nem elég**: ha a Stripe endpoint nincs
feliratkozva az eseményre, a Stripe **el sem küldi**, a `case` soha nem fut, és
**egyetlen megújulási nyugta sem megy ki** — miközben a teljes tesztsuite zöld
marad, mert a tesztek aláírt payloadot POST-olnak közvetlenül az útvonalra, és
így az endpoint feliratkozását nem látják.

Ez ugyanaz a hibaosztály, ami az N1.6 kézbesítés-követését két mérföldkövön át
működésképtelenül hagyta: **a kód kész, a funkció nem fut.**

**Teendő, push előtt:**

1. Stripe Dashboard → **Developers → Webhooks** → a meglévő endpoint
2. **"Select events"** → `invoice.paid` hozzáadása a meglévő három mellé
3. Mentés

**Ellenőrzés a deploy után:** a Dashboard *Send test event* → `invoice.paid`
után `SELECT COUNT(*) FROM "ProcessedStripeEvent" WHERE type='invoice.paid';`
nő eggyel. Ha nem: az endpoint nincs feliratkozva.

A kanonikus eseménylista a `HANDLED_EVENTS` halmaz
(`server/src/routes/stripeWebhook.routes.ts`) — minden további N1.8-szelet
bővíti, és mindegyik ugyanezt a Dashboard-lépést igényli.

### Slice 2 (`billing.invoice_paid`) — **nincs új Dashboard-teendő**

Ezt kifejezetten leírjuk, mert a fenti bekezdés („minden további szelet
bővíti") önmagában az ellenkezőjét sugallja, és egy üzemeltető joggal keresné a
Slice 2 lépését.

A Slice 2 **ugyanazt az `invoice.paid` eseményt** dolgozza fel, csak másik
`billing_reason` ágon (`subscription_update` → csomagváltás-számla, a
`subscription_cycle` → megújulás mellett). A `HANDLED_EVENTS` halmaz
**változatlan**, tehát ha a Slice 1 feliratkozása megtörtént, a Slice 2 minden
további nélkül él.

⚠️ **Amitől viszont a Slice 2 függ, és a Dashboardon él:** a
`subscription_update` számla csak azért jön létre egyáltalán, mert az
upgrade-megerősítő portál-konfiguráció `proration_behavior: "always_invoice"`
beállítású (`server/src/scripts/stripeSetup.ts`). Ha ez valaha `create_prorations`-re
változik, a Stripe a prorációt a **következő ciklusszámlára** teszi, a
`subscription_update` ok soha nem érkezik meg, és a csomagváltás-nyugta némán
megszűnik — kód-változás nélkül. Ellenőrzés a deploy után: egy éles
csomagváltás után
`SELECT COUNT(*) FROM "NotificationEvent" WHERE type='billing.invoice_paid';`
nő eggyel.

### Slice 3 (`billing.invoice_failed`) — ⚠️ **ÚJ Dashboard-esemény, blokkoló**

A Slice 2-vel ellentétben ez **új Stripe-eseménytípust** vesz fel a
`HANDLED_EVENTS` halmazba:

```
+ "invoice.payment_failed"
```

Amíg az endpoint nincs feliratkozva rá, a Stripe **el sem küldi**, a `case`
soha nem fut, és **egyetlen sikertelen-fizetés figyelmeztetés sem megy ki** —
miközben a tesztsuite zöld marad. Ez a mérföldkő legfontosabb levele: a
dunning végén az előfizetés `canceled`/`unpaid` lesz, és a cég **csak olvasható
módba** kerül (`services/readOnly.ts`). Aki nem kapja meg, figyelmeztetés
nélkül veszíti el az írási jogot.

**Teendő:**

1. Stripe Dashboard → **Developers → Webhooks** → a meglévő endpoint
2. **"Select events"** → `invoice.payment_failed` hozzáadása
3. Mentés

**Ellenőrzés a deploy után:** *Send test event* → `invoice.payment_failed`, majd
`SELECT COUNT(*) FROM "ProcessedStripeEvent" WHERE type='invoice.payment_failed';`
nő eggyel.

#### ⚠️ Sorrend: itt a „push előtt" szabály alól **kivételt javaslunk**

A fenti §1a-bis és a terv §6 egységesen azt mondja, hogy a feliratkozás **push
előtt** történjen — azért, hogy el ne felejtődjön. Erre az eseményre ez
**adatvesztést okoz**, és a két kockázat nem egyenrangú:

| Sorrend | Kockázat |
|---|---|
| Feliratkozás **a deploy ELŐTT** | A régi kód a `default:` ágon **200-zal nyugtázza** az eseményt → a Stripe nem próbálja újra → az ablakban beeső valódi fizetési hibáról **nem megy ki levél**. Némán történik: se hibalog, se sorbanálló elem. |
| Feliratkozás **a deploy UTÁN** | A Stripe addig el sem küldi az eseményt, tehát semmi nem vész el; az egyetlen kockázat, hogy **elfelejtjük** — ezt viszont a lenti ellenőrző lekérdezés kimutatja. |

**Javaslat: deploy → azonnal feliratkozás → ellenőrző lekérdezés.**

⚠️ **Pontosítás, mert a korábbi megfogalmazás túlzott:** a deploy előtti ablak
**visszamenőleg helyrehozható**. A `default:` ág nem ír `ProcessedStripeEvent`
sort (csak a `HANDLED_EVENTS`-beli típusok kerülnek a főkönyvbe), tehát az
érintett eseményeket a Stripe Dashboard **Resend** funkciójával újra le lehet
küldeni, és az új kód normálisan feldolgozza őket — az idempotencia-őr nem
nyeli el. A helyreállítás viszont **feltételezi, hogy valaki észreveszi**: nincs
riasztás, ami szólna. A javaslat tehát nem „az adatvesztés visszafordíthatatlan"
alapon áll, hanem azon, hogy a felejtést egy lekérdezés kimutatja, az elmaradt
levelet viszont csak kézi átvizsgálás.

#### Előfeltétel: `APP_URL`

A levél **egyetlen** CTA-ja a `${APP_URL}/subscription` oldalra mutat
(`config.frontendUrl`). Ha az `APP_URL` nincs beállítva, a config
`http://localhost:5173`-ra esik vissza — vagyis egy kritikus levél egyetlen
gombja a semmibe mutat. Éles környezetben az `APP_URL` megléte ennek a
szeletnek **előfeltétele**, nem opció.

> Miért nem Stripe Billing Portal-link a gombban: a portál-session URL rövid
> életű és egyszer használatos, tehát egy levélbe sütve mire elolvassák, halott
> link. Ezért a saját `/subscription` oldalunkra megyünk, ahonnan az ügyfél
> hitelesítve nyit portál-sessiont.

### Slice 4 (`billing.renewal_upcoming`) — ⚠️ **ÚJ esemény ÉS egy rejtett Dashboard-beállítás**

Ez a szelet **két** Dashboard-függőséggel rendelkezik, és a második az, amelyik
némán megölheti.

**(1) Új eseménytípus a `HANDLED_EVENTS`-ben:**

```
+ "invoice.upcoming"
```

Ugyanaz a teendő és ugyanaz a sorrend-javaslat, mint a Slice 3-nál (deploy →
feliratkozás → ellenőrzés).

**(2) ⚠️ A LEAD TIME — ez nincs sehol a kódban.** A Stripe az
`invoice.upcoming`-ot *X nappal* a következő számla előtt küldi, ahol X egy
**fiókszintű Dashboard-beállítás**
(Settings → Billing → Subscriptions and emails), és a telepített SDK ezt szó
szerint le is írja (`Events.d.ts:1554`: „Occurs X number of days before a
subscription is scheduled to create an invoice … where X is determined by your
subscriptions settings").

**A repóban ennek semmilyen reprezentációja nincs**: nem env-változó, nem a
`stripeSetup.ts` állítja, teszt nem látja. Ha X = 0 / ki van kapcsolva, a
Slice 4 **készen, zölden, és teljesen működésképtelenül** áll élesben.

**Teendő, és írd is be ide a számot, hogy egy későbbi változás diffelhető
legyen:**

- Beállított lead time: `____ nap` (kitöltendő az ellenőrzéskor)

**Ellenőrzés az első valós ciklusforduló után:**

```
SELECT COUNT(*) FROM "ProcessedStripeEvent" WHERE type='invoice.upcoming';
SELECT COUNT(*) FROM "NotificationEvent"    WHERE type='billing.renewal_upcoming';
```

Az első azt mutatja, hogy megérkezik-e egyáltalán; a második, hogy át is jut-e a
kapukon.

> **Ezért mond a levél KONKRÉT DÁTUMOT és nem azt, hogy „3 nap múlva".** Ha az
> operátor átállítja X-et 3-ról 30-ra, egy „3 nap múlva" szöveg kód-változás
> nélkül, némán hazuggá válik. Egy dátum nem.

**Nyitott kérdés, amit az első ciklus válaszol meg:** küld-e a Stripe
`invoice.upcoming`-ot olyan előfizetésre, aminél a `cancel_at_period_end` be van
állítva. A kezelő mindenképp elnémítja ezt az esetet (különben egy már lemondott
ügyfélnek ígérnénk terhelést), és ilyenkor `warn`-t logol — tehát a naplóból egy
cikluson belül kiderül, hogy a kapu élő-e vagy holt kód.

---

## 1c. N1.7 — nincs ops-teendő

Séma-változás nincs, migráció nincs, új env-változó nincs, Dashboard-lépés
nincs. A mérföldkő hét végpontot és a frontend harangot adja hozzá. Egyetlen
üzemeltetési vonzata, hogy a `/notifications` prefix innentől **két** mountot
szolgál ki: a publikus, nyers-body-s Resend webhookot (`/webhook/resend`,
korábban mountolva) és a hitelesített routert. A sorrend megfordulása
csendben 401-esítené a webhookot — ezért van rá `dist` elleni boot-ellenőrzés
a mérföldkő zárásában, és ezért maradjon a `/notifications/webhook/resend`
`app.ts`-beli mountja **az `express.json()` előtt**.

---

## 2. Ami magától megtörténik

| Mi | Mikor | Megjegyzés |
|---|---|---|
| `20260801100000_notification_module_foundation` migráció | a start command `prisma migrate deploy` lépésében | Additív: egy nullable oszlop + hat új tábla. Meglévő sort nem ír át. |
| `pgboss` séma létrehozása | az első `startQueue()`-nál, boot közben | pg-boss saját migrációi. Külön sémában, a Prisma `public`-jától elszigetelve — a drift-ellenőrzés ezt igazoltan nem látja. |
| A `notify/dlq` sor létrehozása | minden boot | Idempotens. |

**Új env-változó a queue-hoz nincs** — a meglévő `DATABASE_URL`-t használja.
Az egyetlen új változó a sorozatban a `RESEND_WEBHOOK_SECRET` (N1.6, lásd
1b.), és az sem kötelező a boothoz.

---

## 3. Deploy utáni ellenőrzés (5 perc)

- [ ] `/health` → 200
- [ ] `/health/workers` → 200, `{"status":"ok"}`
- [ ] Boot-log: `[queue] started` a `running on port` előtt, `FATAL` nélkül
- [ ] Egy regisztráció végigmegy (a welcome + verifikációs levél megérkezik)
- [ ] A levelek a helyes nyelven érkeznek (magyar cégnyelv → magyar levél)
- [ ] DB: `SELECT COUNT(*) FROM pgboss.job;` fut hibátlanul
- [ ] **N1.5:** `SELECT status, COUNT(*) FROM "NotificationDelivery" GROUP BY 1;`
      — a friss sorok `sent`/`delivered`, nem `pending`-ben ragadva
- [ ] **N1.6:** `POST /notifications/webhook/resend` aláírás nélkül → **400**
      (nem 401 — ha 401, a mount-sorrend elromlott, lásd 1c.)
- [ ] **N1.6:** a Dashboard *Send test event* után `"EmailEvent"` nő
- [ ] **N1.7:** bejelentkezve a harang megjelenik a Topbarban;
      `GET /notifications/unread-count` token nélkül → **401**
- [ ] **N1.7:** Beállítások oldal → „Értesítési beállítások" szekció betölt,
      egy kapcsoló mentése 200-at ad és újratöltés után is megmarad

---

## 4. Rollback

**Kód:** `git revert` a mérföldkő-commitokra, fordított sorrendben, a
migrációs mappa megtartásával — ugyanaz a minta, mint a Design C rolloutnál:

```bash
git revert --no-commit 85f3180 0b9e291 4096723 6d54642 e407af6 e22d6fa 11a2182 d1f7519
git checkout HEAD -- server/prisma/migrations/
git commit -m "revert(notifications): N1.1-N1.7 rollback (migration kept)"
```

**Részleges rollback.** A mérföldkövek szándékosan önállóan deployolhatók, így
a teljes sorozat visszavonása ritkán a helyes válasz:

| Mit vonsz vissza | Parancs | Mi marad |
|---|---|---|
| Csak a harang (N1.7) | `git revert 85f3180` | A pipeline megy tovább, in-app sorok keletkeznek, csak nem látszanak |
| Harang + webhook (N1.7, N1.6) | `git revert 85f3180 0b9e291` | A levelek mennek, a kézbesítési telemetria áll |
| A pipeline is (N1.5-től) | `git revert 85f3180 0b9e291 4096723` | Az 5 email visszaáll a közvetlen küldésre |

⚠️ N1.5 visszavonása után a `NotificationEvent` sorok `pending`-ben maradnak;
ártalmatlanok (senki nem olvassa őket), és a re-deploy után a sweep felveszi
azt, ami még nem járt le.

**Adatbázis:** nem kell visszamigrálni. A migráció additív, a régi kód a hat
új táblát és a `User.language` oszlopot nem ismeri és nem is zavarja (a Prisma
explicit oszlop-listákkal ír).

**`pgboss` séma:** maradhat. A régi kód nem nyúl hozzá. Törölni csak akkor,
ha végleg elvetjük a queue-t — és csak üres `job` táblával
(`SELECT COUNT(*) FROM pgboss.job WHERE state IN ('created','active');`).

**Node-verzió:** a `NODE_VERSION=22.12` maradhat a Renderen rollback után is
— a régi kód is elfut rajta (`engines: >=20` volt, a 22.12 ezt kielégíti).

**`RESEND_WEBHOOK_SECRET`:** maradhat a Renderen. A régi kód nem olvassa. A
Resend Dashboard webhook-endpointja is maradhat — a végpont eltűnése után a
Resend 404-et kap és leáll az újrapróbálkozással.

**Mellékhatás rollback alatt:** a levelek visszaállnak angolra és a régi,
string-alapú sablonokra. Pénzt vagy adatot nem érint. A harang eltűnik; a már
megírt `Notification` sorok megmaradnak és a re-deploy után újra látszanak
(az olvasott-állapot is), mert a rollback egyetlen sort sem töröl.

---

## 5. Nyitott tétel (nem blokkoló)

- **N1.3 kézi kliens-teszt** — Gmail + Apple Mail, világos/sötét. Eszközök:
  `npm run emails:preview`, illetve `npm run emails:test-send -- <cím>`.
  Anna végzi; az eredmény a `notification-milestones.md` N1.3 sorába kerül.
- **WCAG:** a jelenlegi CTA-gomb (fehér `#f97316`-on) 2,83:1 — AA-bukás.
  Design-döntést igényel, lásd N1.3 „Ismert korlát".

---

*A későbbi mérföldkövek (N1.8-tól) saját szakaszt kapnak itt, amint
elkészülnek. Az N1.8 Stripe Dashboard-koordinációt igényel (négy új
esemény felvétele), tehát ott újra lesz blokkoló, sorrendfüggő lépés.*
