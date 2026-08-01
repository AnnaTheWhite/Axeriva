# Axeriva — Design C rollout: Release Checklist és Rollback terv

*Készült: 2026-07-30. A [checkout-only-upgrades-ux.md](checkout-only-upgrades-ux.md)
(AC1–AC20) implementációjának élesítési terve. Kód: `54c9ed5` + `ff7130b`
a masteren, **push még nem történt**. Tesztek: 236/236, mindkét build zöld.*

---

## 1. Rollout-sorrend (megerősítve)

A kért sorrend helyes, egyetlen kiegészítéssel: a **test-módú validáció a
legelső lépés** — a Stripe-doksi által nem rögzített viselkedéseket (UX-doksi
5. szakasz) olcsóbb test módban megismerni, mint élesben meglepődni.

| # | Lépés | Hol | Miért ez a sorrend |
|---|---|---|---|
| 0 | **Test-módú végigjátszás** (1.1 szakasz) | lokál + test Stripe account | Ha bármelyik nyitott kérdésre rossz válasz jön, még kód-javítás lehetséges push előtt. |
| 1 | **Live `stripe:setup`** (lokálisan, live kulccsal) | CLI | Előállítja az egyetlen értéket (`STRIPE_PORTAL_FLOW_CONFIG_ID`), ami nélkül a deploy bukik. ⚠️ A price-ok `tax_behavior`-ját **visszafordíthatatlanul** beállítja. |
| 2 | **Dashboard-konfiguráció** (3. szakasz) | Stripe Dashboard | A default portál szűkítése a deploy előtt zárja be a csomagváltós hátsó ajtót; a dunning-beállítás az AC17 előfeltétele. |
| 3 | **Render environment** | Render | `STRIPE_PORTAL_FLOW_CONFIG_ID` beállítása — enélkül a boot `FATAL`-lal elszáll. |
| 4 | **`git push`** → automatikus deploy | git / Render | A start command előbb migrál (`prisma migrate deploy`), aztán bootol — a 3. lépés után a validáció átmegy. |
| 5 | **Deploy-verifikáció** (1.4 szakasz) | Render logok + app | Health, boot-log, webhook-kézbesítés. |
| 6 | **Live smoke** (1.5 szakasz) | éles app, Anna kezével | Minimális, valós pénzt mozgató ellenőrzés — a P0.9–P0.11 mintájára. |
| 7 | **Élesítés lezárása + megfigyelési ablak** (1.6 szakasz) | — | 48 óra fokozott figyelés, utána a fejlesztés lezárható. |

---

## 2. Release Checklist

### 1.0 Kiindulási állapot — ✅ kész

- [x] `54c9ed5` (Design C) + `ff7130b` (schedule-restore + refund-morzsák) a masteren
- [x] 236/236 teszt, szerver + frontend typecheck, mindkét build zöld
- [x] Adverzális review lefutott, minden megerősített hiba javítva
- [x] Dokumentáció szinkronban (UX-spec, flows, read-only, environment, render-deployment, backup-restore)

### 1.1 Test-módú validáció (0. lépés — élesítés előtt kötelező)

Lokális futtatás test Stripe accounttal: `stripe:setup` a test kulccsal →
test env-értékek a `server/.env`-be → `npm run dev` + `stripe listen`.

Nyitott Stripe-kérdések (UX-doksi §5 — ezekre a hivatalos doksi nem ad választ):

- [ ] A megerősítő oldal tartalma: látszik-e a „ma fizetendő" prorált összeg és a fizetési mód
- [ ] Fizetési hiba a megerősítő oldalon: érvénybe lép-e a váltás, `past_due` lesz-e, javítható-e a kártya helyben
- [ ] Függő `cancel_at_period_end` sorsa megerősítés után (feltételezés: érintetlen)
- [ ] Schedule-ös előfizetésre kért flow-session pontos hibamódja
- [ ] Trial-lezárás: `end_trial` mellett azonnali terhelés történik-e
- [ ] Kell-e a 6 price a flow-konfiguráció `products` listáján (védekezően rajta van)

Funkcionális végigjátszás (mind a hét folyamat):

- [ ] Regisztráció → trial → „Előfizetés erre: Starter" → Checkout kártyával, trial nélkül → visszatérve Aktív
- [ ] Fizetős Starter → Professional: dialógus → Stripe-oldal → megerősítés → azonnali számla → `?upgrade=confirmed` után azonnal friss csomag
- [ ] Megerősítő oldal elhagyása → semmi nem változik
- [ ] Downgrade ütemezés → „Ütemezve" → visszavonás a „Maradok a jelenlegi csomagon" gombbal
- [ ] Ütemezett downgrade + upgrade-dialógus (törlés-figyelmeztetés); session-hiba szimuláció → schedule helyreáll
- [ ] Cancel → Resume; lemondás alatt upgrade/downgrade → blokk-üzenet
- [ ] Sikertelen kártya (test card `4000 0000 0000 0341`) → `past_due`: ír-képes marad, csomaggombok blokkolva, Portal-gomb működik
- [ ] Portál: fizetési mód + számlák elérhetők, csomagváltás NEM látszik
- [ ] Két fülben checkout: a második session-létrehozás lejáratja az elsőt

### 1.2 Live Stripe (1–2. lépés)

- [ ] Lokál `server/.env`-ben ideiglenesen a **live** `STRIPE_SECRET_KEY` + a live `STRIPE_PRICE_ID` (a legacy price `tax_behavior`-patchhez kell!)
- [ ] `npm run stripe:setup` → kimenet: 6 price + flow-konfiguráció + `STRIPE_PORTAL_FLOW_CONFIG_ID="bpc_…"` sor
- [ ] Dashboard-lépések a 3. szakasz szerint
- [ ] Lokál `.env`-ből a live kulcs eltávolítása

### 1.3 Render (3. lépés)

- [ ] `STRIPE_PORTAL_FLOW_CONFIG_ID` = az 1.2-ben kapott **live** `bpc_…` id (ugyanabból az accountból/módból, mint a `STRIPE_SECRET_KEY` — a `bpc_` id-ben nincs test/live jelölés, rossz módú id-vel a boot sikeres, de minden upgrade elhasal!)

### 1.4 Deploy + verifikáció (4–5. lépés)

- [ ] `git push` → Render deploy zöld (migráció + boot)
- [ ] `/health` 200; boot-log `FATAL` nélkül
- [ ] Stripe Dashboard → Webhooks: a kézbesítések zöldek, a végpont a három eseménytípust kapja (`checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`)
- [ ] Bejelentkezés + `/subscription` oldal betölt, portál-gomb működik

### 1.5 Live smoke (6. lépés — valós pénz, Anna kezével)

A P0.9–P0.11 mintájára, a saját teszt-céggel:

- [ ] Fizetős upgrade a hosted megerősítő oldalon végig (a prorált összeg valós terhelés — utána Dashboard-refund, ha kell)
- [ ] `?upgrade=confirmed` visszatérés: a csomag azonnal frissül
- [ ] Downgrade ütemezés + visszavonás (pénzmozgás nélkül)
- [ ] Portál megnyitás: számlák láthatók, csomagváltás nem

### 1.6 Megfigyelési ablak (7. lépés — 48 óra)

- [ ] Render-logok: `[stripe sync]` / `[billing]` hibasorok (különösen `manualRefundRequired`, „could not be restored")
- [ ] Stripe Dashboard: webhook-hibaarány, sikertelen upgrade-terhelések
- [ ] AuditLog: `SUBSCRIPTION_CHANGED` bejegyzések szúrópróbája
- [ ] Egyszeri lezáró SQL (a deploy-ablak trial-rését zárja): `UPDATE "Company" SET "trialConsumedAt" = "createdAt" WHERE "trialConsumedAt" IS NULL;`

---

## 3. Stripe Dashboard kézi módosítások (megerősítve)

**A `stripe:setup` script végzi (CLI, nem Dashboard):**

1. `tax_behavior = inclusive` mind a 6 új price-on **és** a legacy „Axeriva
   Pro" price-on (⚠️ egyirányú — `unspecified`-ról állítható, utána soha;
   a terhelt összegeket nem változtatja, de e nélkül a portál megtagadja az
   előfizetés-módosítást).
2. A **flow portál-konfiguráció** létrehozása/frissítése (`subscription_update`
   engedélyezve a 6 price-szal, `proration_behavior: always_invoice`,
   `trial_update_behavior: end_trial`; a cancel / payment-method /
   invoice-history funkciókat a script explicit kikapcsolja, a többi a
   Stripe létrehozási alapértelmezése szerint inaktív) — kiírja a
   `STRIPE_PORTAL_FLOW_CONFIG_ID`-t.

**Kézzel, a Dashboardban** (pontos címkékkel, hogy éles helyzetben is
megtalálható legyen):

3. **Default Customer Portal konfiguráció** — *Settings → Billing →
   **Portal*** (dashboard.stripe.com/settings/billing/portal): a „Configure
   subscription management" blokkban a **„Switch plan" kapcsoló KI**;
   maradjon bekapcsolva: **„Payment methods"**, **„Invoice history
   visible"**, **„Cancel subscription"** (periódus végi) — a lemondott
   előfizetés periódus végéig való „renew"-ja adja a Resume-ot.
   *(AC18 — ez zárja be a subscriptions.update-os hátsó ajtót.)*
4. **Dunning-lezárás** — *Billing → Revenue recovery → Retries*: az „If all
   retries fail" beállítás **Cancel subscription** vagy **Mark unpaid**
   legyen — SOHA nem „Leave past-due" *(AC17 előfeltétele: e nélkül a
   past_due türelmi állapot sosem záródna le)*.
5. **Webhook-ellenőrzés** (Developers → Webhooks): a meglévő végpont
   változatlanul jó — új eseménytípus NEM kell, csak ellenőrizni, hogy a
   három kezelt típus kézbesítése zöld.

**Renderben:** `STRIPE_PORTAL_FLOW_CONFIG_ID` (új, kötelező env-változó).

---

## 4. Rollback terv

### 4.1 Döntési szabályok — mikor mi a helyes lépés

| Tünet | Teendő (NEM mindig rollback!) |
|---|---|
| Boot `FATAL: missing … STRIPE_PORTAL_FLOW_CONFIG_ID` | Env-fix a Renderben + újradeploy. A régi verzió szolgál közben — nincs leállás. |
| Upgrade-ek 500-aznak, minden más jó | Valószínűleg rossz módú/hibás `bpc_` id → env-fix, vagy `stripe:setup` újrafuttatás. Nem kód-rollback. |
| A megerősítő oldal Stripe-oldali hibát ad | Flow-konfiguráció ellenőrzése (`tax_behavior` a price-okon? a 6 price a konfigurációban?) → `stripe:setup` újrafuttatás. |
| Széles körű hiba a billing-útvonalakon / adatromlás gyanú | **Kód-rollback** (4.2) + hibafeltárás. |
| Nem-billing regresszió | Normál hotfix-út a masteren. |

### 4.2 Rollback-mechanizmus

**Elsődleges út: `git revert` + push** — a két commit revertálása
(**pontosan ebben a sorrendben: előbb `ff7130b`, aztán `54c9ed5`** — fordított
sorrendben a revert konfliktusokba fut, ellenőrizve), a migrációs mappa
megtartásával:

```bash
git revert --no-commit ff7130b 54c9ed5
git checkout HEAD -- server/prisma/migrations/
git commit -m "revert(billing): Design C rollback (migration kept)"
git push
```

Az eredmény ellenőrzötten megegyezik a Design C előtti fával, egyetlen
kivétellel: a már alkalmazott `20260729120000_checkout_mandatory_upgrades`
migráció fájlja a helyén marad. A megtartása nem hibaelkerülés — a
`prisma migrate deploy` a hivatalos dokumentáció szerint szó nélkül tolerálja,
ha egy adatbázisban alkalmazott migráció hiányzik a lokális mappából —,
hanem higiénia: a migrációs történet konzisztens marad, és a roll-forward
triviális.

**Alternatív út: a Render „Rollback to this deploy" gombja.** Működne (a
régi image `migrate deploy`-a a fentiek miatt nem akad fenn az új
migráción), de két mellékhatása van, amit tudni kell: (1) a service-szintű
env-változókat is a célzott deploy állapotára állítja vissza — itt ártalmatlan,
mert a régi kódnak nem kell a `STRIPE_PORTAL_FLOW_CONFIG_ID`; (2) a
Dashboard-rollback **kikapcsolja az autodeploy-t**, amit a roll-forward push
előtt vissza kell kapcsolni. A `git revert` utat ajánlom elsődlegesnek, mert
úgy a master marad az egyetlen igazságforrás arról, mi fut élesben.

**Adatbázis:** NEM kell (és nem szabad) visszamigrálni. A migráció additív —
a `trialConsumedAt` oszlopot és a `ProcessedStripeEvent` táblát a régi kód
nem ismeri és nem is zavarja (a Prisma explicit oszlop-listákkal ír/olvas).

**Stripe-oldal:** semmit nem kell visszaállítani. A flow-konfiguráció és a
`tax_behavior` a régi kódot nem érinti; a szűkített default portál a régi
kóddal is helyes (sőt: a csomagváltós hátsó ajtó zárva marad). A Render
env-ben maradó `STRIPE_PORTAL_FLOW_CONFIG_ID`-t a régi kód egyszerűen nem
olvassa.

### 4.3 A régi kód viselkedési mellékhatásai rollback alatt — ezek TUDATOS vállalások

- **A Design C üzleti szabály felfüggesztődik:** az upgrade újra azonnali
  `subscriptions.update` (create_prorations, következő számlán elszámolva) —
  a Stripe-oldali megerősítés kimarad. Rollback alatt ez elfogadott.
- **`past_due` cégek:** a rollback pillanatában **azonnal** read-only-ba
  kerülnek (a régi read-only szabály kérésenként, élőben számolódik a
  státuszból — nem webhookra vár); a csomagjuk emellett a következő
  webhook-eseményüknél `free`-re vált. Kevés céget érinthet; roll-forwardkor
  a read-only azonnal, a csomag a következő eseménynél áll helyre.
- **Trial-elnyomás kiesik:** a régi kód a Starter-checkoutnál újra ad 14 nap
  trialt kártya nélkül. Rövid ablakban vállalható; roll-forward után az 1.6
  lezáró SQL rendezi az időközben regisztráltakat.
- **Webhook-idempotencia és sorrend-védelem kiesik** (a régi kód nem írja/
  olvassa a ledgert) — a korábbi, éles-ben eddig is futó viselkedés tér
  vissza.
- **Folyamatban lévő hosted megerősítés:** ha egy ügyfél a rollback
  pillanatában a Stripe megerősítő oldalán van és jóváhagy, a
  `customer.subscription.updated` eseményt a RÉGI webhook is helyesen dolgozza
  fel (price → plan leképezés változatlan) — a váltás nem vész el.

### 4.4 Roll-forward (visszatérés a Design C-re)

A revert-commit revertálása + push. Utána: az 1.6 lezáró SQL újrafuttatása
(a rollback-ablakban regisztrált cégek `trialConsumedAt`-ja), és az 1.4
deploy-verifikáció megismétlése. Stripe-oldali teendő nincs.

---

*A checklist minden pontjának kipipálása után a Design C fejlesztés lezárt;
a maradék ismert korlátok a UX-doksi 7. szakaszában, a jövőbeli finomítások
a post-launch backlogban követhetők.*
