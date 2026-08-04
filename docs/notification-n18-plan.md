# N1.8 — Stripe billing-értesítések: végleges implementációs terv

*Készült: 2026-08-01. A [notification-n18-mapping.md](notification-n18-mapping.md)
jóváhagyott döntései alapján. **Kód még nem készült.***

---

## 0. Lezárt döntések

| # | Döntés | Következmény |
|---|---|---|
| **K1** | `invoice.paid` **soha nem** hoz létre két ügyfél felé menő értesítést. `billing_reason` szerint útválasztás: `subscription_cycle` → `billing.subscription_renewed`; `subscription_create` → **semmi** (a checkout-ág már küldött); `subscription_update` → `billing.invoice_paid` (csomagváltás-számla) | Egy fizetés = egy levél |
| **K2** | `invoice.payment_failed` dedupeKey = **`event.id`**. Az `invoice.id + attempt_count` **elvetve**, mert a manuális újrapróbálkozás nem jelenik meg benne megbízhatóan | A `customer.subscription.updated → past_due` **nem küld levelet** (az állapotírás marad) |
| **K3** | `invoice.upcoming` dedupeKey = **`subscription.id + period_end`** | `billing.card_expiring` **kimarad** N1.8-ból |
| **K4** | Hatókör: a verifikált típuslista. Sweep-vezérelt értesítések **szigorúan N1.9** | `trial_ending` (×3) és `trial_expired` nincs benne |

### 0.1 ⚠️ Számkorrekció: 12 típus, nem 13

A „13" az én hibám volt az előző dokumentumban: a §1 tábla **14** hatókörön
belüli sort sorolt fel, a prózában 13 szerepelt. A K2 és K3 döntés ebből
kettőt elhagy → **12 új típus**. Tételesen, hogy ellenőrizhető legyen:

| # | Típus | Kiváltó | Státusz |
|---|---|---|---|
| 1 | `billing.trial_started` | regisztráció | ✅ |
| 2 | `billing.subscription_renewed` | `invoice.paid` (`subscription_cycle`) | ✅ |
| 3 | `billing.invoice_paid` | `invoice.paid` (`subscription_update`) | ✅ |
| 4 | `billing.invoice_failed` | `invoice.payment_failed` | ✅ |
| 5 | `billing.renewal_upcoming` | `invoice.upcoming` | ✅ |
| 6 | `billing.payment_method_updated` | `payment_method.attached` | ✅ |
| 7 | `billing.plan_upgraded` | `customer.subscription.updated` (tier ↑) | ✅ |
| 8 | `billing.plan_downgraded` | `customer.subscription.updated` (fázis) | ✅ |
| 9 | `billing.subscription_ended` | `customer.subscription.deleted` | ✅ |
| 10 | `billing.plan_downgrade_scheduled` | `POST /subscription/change-plan` | ✅ |
| 11 | `billing.subscription_cancelled` | `POST /subscription/cancel` | ✅ |
| 12 | `billing.subscription_resumed` | `POST /subscription/resume` | ✅ |
| — | ~~`billing.payment_failed`~~ | — | ❌ K2 |
| — | ~~`billing.card_expiring`~~ | — | ❌ K3 |
| — | `billing.trial_ending` ×3, `billing.trial_expired` | napi sweep | ❌ K4 → N1.9 |
| — | `billing.subscription_created` | checkout | már él (N1.5) |

**12 új típus, 12 új template, ~170–190 új i18n-kulcs (12 × 2 nyelv).**

---

## 1. ⚠️ Egy fordítási kényszer, ami meghatározza a sorrendet

Az `email.channel.ts` végén álló `assertNoEmailTemplate(type: never)`
exhaustiveness-guard (N1.7.1) **minden új registry-kulcsra elhasal**, nem csak
az EMAIL-csatornásokra: a `switch` a teljes `NotificationTypeKey` unión megy.

**Következmény:** nem lehet előbb 12 registry-bejegyzést felvenni, majd utána
template-eket írni — a szerver addig **nem fordul**. Két út van:

- **(A) Szeletenként**: minden típus a saját registry-bejegyzésével,
  template-jével, i18n-kulcsaival, triggerével és tesztjével EGYÜTT landol.
- **(B) Előbb a `switch` szűkítése** EMAIL-csatornás típusokra, aztán szabad
  sorrend.

**Javaslat: (A).** A guard pont azt a hibát fogja meg, amit N1.7.1-ben
találtunk (típus EMAIL-csatornával, template nélkül, némán „sent"-nek
könyvelve). Szűkíteni azt jelentené, hogy a védelmet gyengítjük, hogy
kényelmesebben tudjunk tömegesen bevinni típusokat — pont rossz irányba.

---

## 2. Fázis 0 — Formázási alap (előfeltétel, típus nélkül)

Ez a fázis **nem ad hozzá notification-típust**, tehát nem ütközik az 1.
pontban leírt fordítási kényszerbe. Külön commit, önállóan tesztelhető.

### 2.1 `server/src/utils/format.ts` (új)

```
formatMoney(amountMinor: number, currency: string, locale): string
formatDate(date: Date | number, locale): string
formatDateTime(date: Date | number, locale): string
```

**Mérve, nem feltételezve** (Node 22.12, `full-icu` beépítve — ellenőrizve):

| Bemenet | Kimenet |
|---|---|
| `Intl.NumberFormat('hu-HU',{currency:'HUF'})` | `12 346 Ft` (0 tizedes, automatikusan) |
| `Intl.NumberFormat('en-GB',{currency:'EUR'})` | `€12,345.60` |
| `Intl.DateTimeFormat('hu-HU',{dateStyle:'long'})` | `2026. szeptember 1.` |
| `Intl.DateTimeFormat('en-GB',{dateStyle:'long'})` | `1 September 2026` |

⚠️ **A Stripe minor unitban küld.** `amount_paid`, `amount_due` a legkisebb
egységben van. A termék **EUR-t és HUF-ot** használ, és a Stripe a HUF-ot is
minor unitban kezeli (100-zal oszthatónak kell lennie) → **mindkettőnél
100-zal osztunk**. A tizedesek számát az `Intl` intézi (HUF: 0, EUR: 2), tehát
nekünk nem kell currency-táblát vezetnünk. **Ha valaha új deviza jön, ez a
feltevés újranyitandó** — a nulla-tizedesű devizák (JPY) nem oszthatók 100-zal.

Az `Intl` **soha nem dob** érvényes locale+currency párra, de érvénytelen
currency-kódra igen → a helper defenzív: ismeretlen deviza esetén
`"{amount} {CURRENCY}"` fallback, és `console.warn`. Egy formázási hiba nem
buktathat el egy fizetési értesítést.

### 2.2 `server/src/emails/components/InfoRow.tsx` (új)

A terv §5.1 nevesíti, soha nem készült el. Címke/érték pár, a `theme`-ből véve
a színeket. Ez lesz a 12 billing-levél gerince (összeg, időszak, csomag,
következő terhelés).

### 2.3 Template-adatszerződések — `server/src/emails/types.ts` (új)

Minden billing-template propjai **egy helyen, típusosan**, hogy a trigger és a
template ne tudjon elcsúszni:

```
BillingEmailBase   { companyName, locale, branding }
InvoiceEmailData   { amountFormatted, currency, periodStart, periodEnd,
                     hostedInvoiceUrl?, invoicePdfUrl?, invoiceNumber? }
FailureEmailData   { attemptNumber, nextAttemptAt?, portalUrl }
CardEmailData      { brand, last4 }
PlanChangeData     { fromPlan, toPlan, effectiveAt }
```

**A formázás a triggerben történik, nem a template-ben.** Indok: a template
snapshot-tesztelt, és egy `Intl` hívás a rendereléskor a tesztet a futtató gép
ICU-verziójától tenné függővé. A trigger már formázott stringet ad át.

### 2.4 Fázis 0 tesztek

`format.test.ts`: HUF/EUR × hu/en mátrix, minor-unit osztás, ismeretlen deviza
fallback, kerekítés. **Nem** snapshot — konkrét várt stringek, mert ezek
ügyfélnek megjelenő pénzösszegek.

---

## 3. Fázis 1–4 — a 12 típus szeletekben

Minden szelet: registry-bejegyzés + template (hu+en) + i18n-kulcsok + trigger +
teszt + mutation-ellenőrzés. Külön commit szeletenként.

### Fázis 1 — Az új webhook-események (5 típus)

**Elsőként a `HANDLED_EVENTS` bővítése**, mert enélkül a kezelő
**idempotencia nélkül** fut (a `wasEventProcessed` gate csak a Setre néz,
stripeWebhook.routes.ts:90):

```
+ "invoice.paid"
+ "invoice.payment_failed"
+ "invoice.upcoming"
+ "payment_method.attached"
```

| Típus | dedupeKey | Stripe-mezők (ellenőrzött útvonalak) |
|---|---|---|
| `billing.subscription_renewed` | `…/{invoice.id}` | `amount_paid`(:158), `currency`(:219), `period_start`(:361), `period_end`(:357), `hosted_invoice_url`(:307), `invoice_pdf`(:311) |
| `billing.invoice_paid` | `…/{invoice.id}` | ua. |
| `billing.invoice_failed` | **`…/{event.id}`** (K2) | `attempt_count`(:178), `next_payment_attempt`(:336), ~~`amount_due`(:150)~~ → **`amount_remaining`(:166)**, lásd alább |
| `billing.renewal_upcoming` | **`…/{subscriptionId}/{period_end}`** (K3) | `invoice.parent.subscription_details.subscription`(:856) — **nincs `invoice.id`** |
| `billing.payment_method_updated` | `…/{paymentMethod.id}` | `card.brand`(:246), `card.last4`, `card.exp_month`(:266) |

> **Slice 3 implementációs korrekció (`amount_due` → `amount_remaining`).** A
> telepített SDK szerint `amount_remaining` = `amount_due − amount_paid`
> (Invoices.d.ts:163-166), tehát örökli az `amount_due` minden jóváírás- és
> `starting_balance`-kezelését, **és** levonja azt, amit már beszedtünk. Egy
> részben kiegyenlített számlán az `amount_due` olyan pénzt nevez meg, amit az
> ügyfél már átadott — pont azon az egyetlen számon, amiért a levél létezik. A
> szokásos dunning-esetben `amount_paid = 0`, tehát a kettő azonos: a
> szigorítás ingyen van. Kiegészül egy elutasítással: `amount_remaining <= 0`
> esetén **nem megy levél** (nincs mit bejelenteni).

**Stale guard:** a meglévő guard subscription-alakú és **nem vihető át**. Az
invoice-események **önmagukban teljesek** (minden adat a payloadban van, nincs
„aktuális állapot" amit felül lehetne írni), ezért **nem kapnak stale
guardot** — ezt a döntést a kód kommentjében is rögzítjük, hogy ne tűnjön
kihagyásnak.

**Cég-feloldás:** a `stripeCustomerId` → `Company` út. Ha nincs találat, az
esemény **2xx-szel nyugtázva eldobandó** (nem a mi ügyfelünk), nem hiba.

### Fázis 2 — Már kezelt események (3 típus)

`billing.plan_upgraded`, `billing.plan_downgraded`, `billing.subscription_ended`.
Ezek a meglévő `customer.subscription.updated` / `.deleted` ágakba épülnek be.
⚠️ A `notify()` hívás **a `markEventProcessed` UTÁN** kerül, a checkout-ág
mintájára — de a dedupeKey az `event.id`-t hordozza, tehát az at-most-once a
DATA tulajdonsága, nem a vezérlési folyamé.

### Fázis 3 — REST-vezérelt (3 típus)

`plan_downgrade_scheduled`, `subscription_cancelled`, `subscription_resumed` a
`subscription.routes.ts` megfelelő ágaiba. Ezeknek **nincs Stripe event.id-juk**
→ dedupeKey `…/{companyId}/{effectiveAt|periodEnd|resumedAt}`.

### Fázis 4 — `billing.trial_started` (1 típus)

A regisztrációs ágba. dedupeKey `…/{companyId}` (cégenként pontosan egyszer).

---

## 4. Kategória és mandatory — típusonként

A terv §6.2 **nem ad** kategóriát és mandatory flaget típusonként; a Q2 döntés
és a §7.2 kategóriatábla alapján:

| Kategória | Típusok | mandatory |
|---|---|---|
| `billing` (kritikus, **nem letiltható**) | `invoice_failed`, `plan_upgraded`, `plan_downgraded`, `subscription_ended`, `plan_downgrade_scheduled`, `subscription_cancelled`, `subscription_resumed` | ✅ |
| `billing_receipts` (**letiltható**) | `subscription_renewed`, `invoice_paid`, `renewal_upcoming`, `payment_method_updated`, `trial_started` | ❌ |

⚠️ **Ismert ellentmondás, amit N1.8 NEM old meg.** A kódban **két** független
mandatory-mechanizmus van: a per-típus `mandatory` flag (a kapu ezt nézi) és a
kategória-szintű `MANDATORY_CATEGORIES` (a preferencia-API ezt nézi). Egy
`billing_receipts` kategóriájú, `mandatory: false` típus **helyesen** lesz
letiltható — ez a fenti tábla működik. De a `billing` kategória
`MANDATORY_CATEGORIES`-ban van, tehát a preferencia-API **minden** `billing`
típusra elutasítja a beállítást, függetlenül a per-típus flagtől. Ez az
eredeti architektúra-review M1-es találata, **nyitva marad**, és N1.8 nem
súlyosbítja — de érdemes tudni, hogy a két mechanizmus még mindig kettő.

---

## 5. Teszt- és mutation-terv

Minden kritikus úton **szabotázs-ellenőrzés**: elrontom a javítást, és
igazolom, hogy a teszt bukik. A négy review-kör tanulsága szerint itt a
hibaosztály a *zölden maradó teszt*.

| Kritikus út | Szabotázs | Kell bukjon |
|---|---|---|
| `billing_reason` útválasztás (K1) | a feltétel törlése | „első fizetés nem küld megújítás-levelet" |
| `invoice_failed` dedupeKey (K2) | `event.id` → `invoice.id` | „második automatikus kísérlet is küld" |
| `renewal_upcoming` dedupeKey (K3) | `period_end` elhagyása | „következő ciklus újra küld" |
| `HANDLED_EVENTS` | az új esemény kivétele | „újraküldés nem duplikál" |
| Recipient = OWNER | `OWNER` → `COMPANY_USERS` | „EMPLOYEE nem kap billing-levelet" |
| mandatory flag | `true` → `false` a kritikusakon | „kikapcsolt preferencia sem blokkolja" |
| pénzformázás | 100-zal osztás elhagyása | „12 345,60 € nem 1 234 560 €" |

Plusz: **tenant-izolációs teszt** (repó-szabály), és **valós worker-teszt** a
`notificationPipeline.test.ts` mintájára legalább egy billing-típusra —
mert a fixture-ből olvasó teszt már egyszer elrejtett egy halott funkciót.

---

## 6. Deploy

| Lépés | Mikor | Miért |
|---|---|---|
| Stripe Dashboard: 4 új esemény feliratkozás | **push előtt** | Enélkül a kezelő sosem fut |
| `HANDLED_EVENTS` bővítés | a kóddal | Idempotencia |
| Séma-migráció | **nincs** | §5: nem kell új állapot |
| Env-változó | **nincs** | — |

A [notification-rollout.md](notification-rollout.md) kap egy N1.8 szakaszt,
a Design C rollout mintájára (sorrendfüggő lépés + ellenőrzés + rollback).

---

## 7. Kockázatok

| Kockázat | Kezelés |
|---|---|
| **Pénzügyi kommunikáció** — rossz összeg vagy deviza az ügyfélnél | Konkrét-string tesztek, nem snapshot; a formázás triggerben, nem template-ben |
| **Duplikált levél** | K1/K2/K3 döntések + dedupeKey mutation-tesztek |
| 12 típus **egy mérföldkőben** sok | Szeletenkénti commit (§1 A-változat), mindegyik önállóan reviewzható |
| A `notify()` **némán nyeli** a dedupeKey-ütközést | Fázis 0-ban debug-log a P2002-ágra, hogy az elnyelt duplikátum látható legyen |
| `invoice.upcoming` subscription-útvonal | Implementációkor futásidejű ellenőrzés + teszt hiányzó útvonalra |

---

## 8. Sorrend

```
Fázis 0  formázás + InfoRow + adatszerződések + notify() P2002-log   (típus nélkül)
Fázis 1  HANDLED_EVENTS + 5 típus az új eseményekre                  (5 szelet)
Fázis 2  3 típus a már kezelt eseményekre                            (3 szelet)
Fázis 3  3 típus a REST-ágakra                                       (3 szelet)
Fázis 4  trial_started                                               (1 szelet)
Zárás    rollout-doc, mérföldkő-doc, teljes suite + mutation-kör
```

---

*Jóváhagyásra vár. A Fázis 0 az első kódot jelentő lépés.*
