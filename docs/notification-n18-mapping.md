# N1.8 — Stripe billing-értesítések: leképezési terv

*Készült: 2026-08-01. **Ez egy JÓVÁHAGYÁSRA váró terv, nem implementáció.**
A [notification-system-plan.md](notification-system-plan.md) §6.2 + §10 és a
meglévő Stripe-webhook összevetéséből. Minden állítás kód- vagy
dokumentum-hivatkozással.*

---

## 0. A legfontosabb, amit tudni kell, mielőtt bármit jóváhagysz

A terv N1.8-ról **négy helyen beszél, és ezek nem egyeznek**. Ez nem
szőrszálhasogatás: két olyan ütközés van benne, ami **kétszer küldene emailt
ugyanarról az eseményről** az ügyfélnek. Pénzügyi kommunikációnál ez a
legrosszabb hibaosztály.

| # | Ütközés | Következmény, ha nem döntünk |
|---|---|---|
| **K1** | `invoice.paid` → §10 szerint **`billing.invoice_paid` ÉS `billing.subscription_renewed`** (plan:715) | Egy sikeres megújításról **két levél** megy ki |
| **K2** | `invoice.payment_failed` → `billing.invoice_failed` (§6.2), **és** `customer.subscription.updated → past_due` → `billing.payment_failed` (§6.2 #14, plan:712) | Egy sikertelen fizetésről **két levél**, mert a Stripe mindkettőt tüzeli |
| **K3** | `invoice.upcoming` → §6.2 szerint `billing.card_expiring`, §10 szerint `billing.renewal_upcoming` (plan:432 vs :717) | Két teljesen más üzenet ugyanarra az eseményre |
| **K4** | `billing.renewal_upcoming` **csak a §10-ben létezik**, a §6.2 katalógusban nem | A „16 típus" és a §10 leképezés más halmazt ír le (összesen 17 kulcs) |

Ezeken túl **a „16 billing-template" szám hibás** mint N1.8 munkamennyiség:

- `billing.subscription_created` **már kész** (N1.5 óta él) → −1
- `billing.trial_ending` egy sor, de **három üzenet** (7/3/1 nap) → +2
- `billing.trial_ending` és `billing.trial_expired` **sweep-vezérelt** →
  a mérföldkő-terv szerint **N1.9**, nem N1.8 → −2

---

## 1. Hatókör: mi tartozik N1.8-hoz és mi nem

A §6.2 tizenhat típusát a **trigger forrása** szerint osztályozva:

| Forrás | Típusok | N1.8? |
|---|---|---|
| **A négy új webhook-esemény** | `invoice_paid`, `subscription_renewed`, `invoice_failed`, `card_expiring`, `payment_method_updated`, `renewal_upcoming` | ✅ |
| **Már kezelt Stripe-esemény** | `plan_upgraded`, `plan_downgraded`, `subscription_ended`, `payment_failed` | ✅ |
| **REST-útvonal** (`/change-plan`, `/cancel`, `/resume`) | `plan_downgrade_scheduled`, `subscription_cancelled`, `subscription_resumed` | ✅ |
| **Regisztráció** | `trial_started` | ✅ |
| **Napi sweep** | `trial_ending` (×3), `trial_expired` | ❌ **N1.9** |
| **Már kész** | `subscription_created` | — |

**Javaslat:** N1.8 = **minden webhook- vagy kérés-vezérelt billing-értesítés**,
a sweep-vezérelt trial-üzenetek N1.9-ben. Ez **13 új típus**, nem 16.

⚠️ A terv §17 Phase 5-je a sweepeket **ugyanabba a fázisba** teszi a
billing-template-ekkel, a mérföldkő-terv viszont N1.9-be. A mérföldkő-tervet
követem (az az elfogadott végrehajtási bontás), de ez egy explicit eltérés.

---

## 2. A leképezési mátrix

Rövidítések: **M** = mandatory (nem letiltható), **kat.** = kategória.
Címzett mindenhol **OWNER** (Q5: minden `billing.*` owner-only).

### 2.1 A négy ÚJ esemény

| Stripe esemény | Notification típus | Kat. | Súly. | M | dedupeKey | Template-adat |
|---|---|---|---|---|---|---|
| `invoice.paid`<br>`billing_reason = subscription_cycle` | `billing.subscription_renewed` | `billing_receipts` | success | ❌ | `billing.subscription_renewed/{invoice.id}` | összeg, deviza, időszak, `hosted_invoice_url`, `invoice_pdf` |
| `invoice.paid`<br>`billing_reason = subscription_create` | *(nincs — a `subscription_created` már ment a checkoutból)* | — | — | — | — | — |
| `invoice.paid`<br>`billing_reason = subscription_update` | `billing.invoice_paid` | `billing_receipts` | success | ❌ | `billing.invoice_paid/{invoice.id}` | ua. |
| `invoice.payment_failed` | `billing.invoice_failed` | `billing` | critical | ✅ | `billing.invoice_failed/{invoice.id}/{attempt_count}` ⚠️ lásd §4.2 | hányadik kísérlet, `next_payment_attempt`, Portal-link, grace-period |
| `invoice.upcoming` | `billing.renewal_upcoming` | `billing_receipts` | info | ❌ | `billing.renewal_upcoming/{subscription}/{period_end}` ⚠️ nincs invoice.id | összeg, dátum |
| `payment_method.attached` | `billing.payment_method_updated` | `billing_receipts` | info | ❌ | `billing.payment_method_updated/{payment_method.id}` | kártya brand, last4 |

### 2.2 Már kezelt események (új értesítés rájuk)

| Stripe esemény | Típus | Kat. | Súly. | M | dedupeKey |
|---|---|---|---|---|---|
| `customer.subscription.updated` tier ↑ | `billing.plan_upgraded` | `billing` | success | ✅ | `billing.plan_upgraded/{event.id}` |
| `customer.subscription.updated` fázisváltás | `billing.plan_downgraded` | `billing` | info | ✅ | `billing.plan_downgraded/{event.id}` |
| `customer.subscription.deleted` | `billing.subscription_ended` | `billing` | critical | ✅ | `billing.subscription_ended/{event.id}` |
| `customer.subscription.updated` → `past_due` | ~~`billing.payment_failed`~~ | — | — | — | **ELHAGYVA — lásd K2** |

### 2.3 REST-vezérelt

| Kiváltó | Típus | Kat. | Súly. | M | dedupeKey |
|---|---|---|---|---|---|
| `POST /subscription/change-plan` (downgrade) | `billing.plan_downgrade_scheduled` | `billing` | info | ✅ | `…/{companyId}/{effectiveAt}` |
| `POST /subscription/cancel` | `billing.subscription_cancelled` | `billing` | warning | ✅ | `…/{companyId}/{periodEnd}` |
| `POST /subscription/resume` | `billing.subscription_resumed` | `billing` | success | ✅ | `…/{companyId}/{resumedAt}` |
| Regisztráció | `billing.trial_started` | `billing_receipts` | info | ❌ | `…/{companyId}` |

---

## 3. A négy ütközés — javaslat mindegyikre

**K1 — `invoice.paid` két típust ad.** *Javaslat:* **`billing_reason` dönti el**,
melyik megy ki, és soha nem mindkettő. `subscription_cycle` → megújítás,
`subscription_update` → csomagváltás közbeni számla, `subscription_create` →
**semmi** (a checkout már küldött). Ez a §10 „mindkettő" olvasatát felváltja.

**K2 — a sikertelen fizetésnek két triggere van.** A Stripe egy valódi
fizetési hibánál **mindkettőt** tüzeli: `invoice.payment_failed`-et és
`customer.subscription.updated`-et `past_due`-ra. Két típus = két levél.
*Javaslat:* **csak `invoice.payment_failed`** küld emailt. A `past_due`
állapotváltás továbbra is megtörténik (állapotírás), de nem küld. Indok: az
`invoice.payment_failed` hordozza a template-hez kellő adatot (hányadik
kísérlet, mikor a következő), a subscription-esemény nem.

**K3 — `invoice.upcoming` két jelentése.** *Javaslat:* **`billing.renewal_upcoming`**
(§10). A `billing.card_expiring` **kimarad N1.8-ból**: a lejáró kártya
felismerése a `payment_method.card.exp_month/exp_year` összevetése a
következő számlázási dátummal — ez önálló logika, és a §6.2 maga is
bizonytalan a triggerében („`invoice.upcoming` VAGY `payment_method.updated`").
Külön tételként, N1.9+ vagy backlog.

**K4 — a 17. kulcs.** *Javaslat:* `billing.renewal_upcoming` **felvétele a
katalógusba**, és a §6.2 tábla javítása, hogy a két szakasz egyezzen.

---

## 4. Idempotencia — ez a legkockázatosabb rész

### 4.1 A jelenlegi szerződés és két hibája

- `dedupeKey` **globálisan unique** egyetlen oszlopon (schema.prisma:689) — a
  cégenkénti hatókör **csak konvenció a stringben**, nem constraint.
- Ütközéskor a `notify()` **elnyeli a P2002-t és némán visszatér**
  (notify.ts:54-56) — **egyetlen log sor nélkül**. Egy túl tág kulcs tehát
  **láthatatlanul elnyelt emailt** jelent.
- Ma **egyetlen** dedupeKey-konstrukció van production kódban:
  `billing.subscription_created/${event.id}` (stripeWebhook.routes.ts:149) —
  **két szegmens**, miközben a séma (:683) és a terv §3.4 **három**
  szegmenst dokumentál (`<típus>/<hatókör>/<diszkriminátor>`).

**Javaslat N1.8-ra:** (a) a `notify()` P2002-ága kapjon **debug-szintű logot**,
hogy az elnyelt duplikátum látható legyen; (b) a formátum legyen egységesen
`<típus>/<stripe-objektum-id>` vagy `<típus>/<companyId>/<diszkriminátor>`, és
a séma kommentje igazodjon a valósághoz.

### 4.2 ⚠️ A legélesebb kérdés: `invoice.payment_failed`

Két követelmény feszül egymásnak:

1. A Stripe **újraküldi** ugyanazt az eseményt → nem mehet ki kétszer.
2. Egy **második, valódi sikertelen kísérlet** ugyanazon a számlán → **ki KELL
   mennie**.

| Kulcs | Újraküldés-biztos? | Új kísérletet küld? | Probléma |
|---|---|---|---|
| `{event.id}` | ✅ | ✅ | Nem véd a K2 második triggere ellen (ha megtartanánk) |
| `{invoice.id}` | ✅ | ❌ | A 2., 3. kísérletről **soha nem szól** |
| `{invoice.id}/{attempt_count}` | ✅ | ⚠️ **részben** | **A Stripe dokumentációja szerint a manuális újrapróbálkozás NEM növeli az `attempt_count`-ot** |

A harmadik sor a Stripe SDK saját szövegéből:
`Invoices.d.ts:176` — *„only automatic retries increment the attempt count…
manual payment attempts after the first attempt do not affect the retry
schedule"*.

**Következmény:** ha az ügyfél a Portalban **kézzel** újrapróbálja és megint
elbukik, `attempt_count` változatlan → a dedupeKey ütközik → **nem kap
értesítést a második bukásról**.

**Javaslat:** `billing.invoice_failed/{invoice.id}/{attempt_count}` **plusz**
egy tudatosan vállalt korlát a dokumentációban, MERT az automatikus dunning
(ami a valódi eset) helyesen működik, a manuális újrapróbálkozás pedig a
Portalban azonnali visszajelzést ad az ügyfélnek. **Alternatíva, ha ez nem
elfogadható:** `{invoice.id}/{attempt_count}/{event.created}` — minden
esemény külön, de akkor a Stripe egy ritka újraküldése is duplikálna.
**Ez a te döntésed.**

### 4.3 `invoice.upcoming`-nak nincs `id`-ja

Az `invoice.upcoming` egy **előnézeti** számla, nem perzisztált objektum —
nincs stabil `invoice.id`. A dedupeKey ezért az **előfizetés + időszak
végéből** kell álljon: `billing.renewal_upcoming/{subscriptionId}/{period_end}`.
A `subscriptionId` az eseményben csak közvetve érhető el
(`invoice.parent.subscription_details.subscription`) — ezt implementációkor
ellenőrizni kell a telepített SDK típusain.

---

## 5. Új billing-állapot: **nincs**

Ez jó hír, és mérve van:

- `invoice.payment_failed` **ma sem ír `Company`-t**, és nem is kell: a
  `past_due` átmenet külön érkezik `customer.subscription.updated`-en.
- **Nincs** grace-period mező, **nincs** dunning-ablak, **nincs**
  retry-számláló, **nincs** `Invoice` modell a sémában.
- A `NotificationEvent.dedupeKey` a séma szerint kifejezetten a „mikor ment ki
  utoljára" oszlop helyettesítője → **N1.8-hoz nem kell új `Company` mező.**

**Séma-változás tehát nem várható.** Ha implementáció közben mégis kellene, az
a terv újranyitása, nem apró részlet.

---

## 6. Amit meg KELL építeni, mielőtt bármelyik template elkészül

| Hiányzik | Bizonyíték | Miért blokkoló |
|---|---|---|
| **Pénz- és dátumformázás** | **Nulla `Intl.` használat** az egész `server/src`-ben | Minden billing-levél összeget és dátumot mutat, két nyelven, két devizában (EUR/HUF) |
| **`InfoRow` komponens** | A terv §5.1 nevesíti, **soha nem készült el** | Számla-adatok címke/érték párokban — ez a billing-levelek gerince |
| **Számla-/nyugta-elrendezés** | Nincs tábla- vagy tétel-komponens | 13 levél fog ugyanarra a vizuális mintára épülni |

Az `i18n/index.ts:20-23` **név szerint N1.8-ra utalja** a formázást
(„lands with the first template that does — N1.8 billing"). Ez tehát terv
szerinti, nem meglepetés — de **előfeltétel**, nem melléktermék.

**i18n mennyiség:** 13 típus × 2 nyelv ≈ **180–210 új katalógus-kulcs**,
mindegyikre érvényes a meglévő kulcs-paritás teszt.

---

## 7. Integrációs kötöttségek a meglévő webhookból

1. **`HANDLED_EVENTS` bővítése kötelező** — ma három elem
   (stripeWebhook.routes.ts:37-41). Ami nincs benne, az **nem kap
   replay-védelmet**: a `wasEventProcessed` gate csak `HANDLED_EVENTS`-re fut
   (:90). Új eseményt felvenni a `switch`-be a Set bővítése **nélkül** =
   idempotencia nélküli kezelő.
2. **A stale guard NEM generikus.** Inline van a
   `customer.subscription.updated` ágban, és „subscription-alakú" (újralekéri
   az állapotot a Stripe-tól). **Nem vihető át** invoice-eseményekre —
   újra kell definiálni, vagy tudatosan kimondani, hogy az invoice-események
   sorrendfüggetlenek (szerintem azok: minden invoice-esemény önmagában teljes).
3. **Ledger-sorrend.** A checkout-ágban a `markEventProcessed` (:124) **megelőzi**
   a `notify()`-t (:146). A `notify()` szerződés szerint nem dob, tehát nem
   veszik el redelivery — de egy DB-hiba a `notify()`-on belül **némán**
   elnyelődik. Négy új eseménnyel ez a felület megnégyszereződik.
4. **A 2xx nem várhatja meg az emailt** — a `notify()` csak sort ír. Ez a
   `stripe-webhook-production-readiness.md` explicit követelménye, és minden új
   ágnak tartania kell.
5. **Dashboard-koordináció**: a négy új esemény **feliratkozást igényel** a
   Stripe Dashboardon. Ez a Design C rollout mintája szerint **push előtti**
   lépés, és a [notification-rollout.md](notification-rollout.md)-ba kerül.

---

## 8. Mutation-teszt terv (kritikus utak)

A négy review-kör tanulsága szerint itt a hibaosztály a *zölden maradó teszt*.
Minden alábbi teszt **szabotázzsal** lesz ellenőrizve — a javítást elrontom, és
megnézem, hogy a teszt tényleg bukik:

| Kritikus út | Szabotázs | Kell bukjon |
|---|---|---|
| dedupeKey-konstrukció | `{invoice.id}/{attempt_count}` → `{invoice.id}` | „második kísérlet is küld" teszt |
| `billing_reason` szűrés | a feltétel törlése | „első fizetés nem küld megújítás-levelet" |
| Recipient = OWNER | `OWNER` → `COMPANY_USERS` | „EMPLOYEE nem kap billing-levelet" |
| `HANDLED_EVENTS` bővítés | az új esemény kivétele a Setből | „újraküldés nem duplikál" |
| mandatory flag | `true` → `false` a kritikusakon | „kikapcsolt preferencia sem blokkolja" |

---

## 9. Nyitott kérdések — ezekre döntés kell

1. **K1–K4** (§3): elfogadod a négy javaslatot?
2. **§4.2**: a manuális-újrapróbálkozás alul-küldése elfogadható-e, vagy az
   `event.created`-es változatot kéred (és vállalod a ritka duplikátumot)?
3. **Hatókör**: 13 típus (webhook + REST), a trial-sweepek N1.9-ben — jó?
4. **`billing.card_expiring`**: kimarad N1.8-ból (§3 K3) — egyetértesz?
5. **§13-mátrix**: a `subscription-ux-billing-flow.md` §13-ban van két sor
   (Storage Limit, API Limit), amihez **semmilyen notification-típus nem
   tartozik** a tervben. N1.8 kilépési kritériuma viszont „minden §13-sor
   triggerelhető". Ez a két sor **kimarad** (nem billing-esemény), vagy
   `system.*` típust kap?
6. **Formázási infrastruktúra** (§6): külön előkészítő lépésként készüljön,
   vagy az N1.8 első commitjaként?

---

*Amíg ezekre nincs válasz, N1.8 implementációja nem indul.*
