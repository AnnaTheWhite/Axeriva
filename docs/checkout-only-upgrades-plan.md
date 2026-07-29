# Checkout-kötelező upgrade — technikai terv

*Készült: 2026-07-27. Státusz: **TERV — implementáció nem kezdődött el.**
Módszer: állapot-térkép a valós kódból → három független design → adverzális
bírálat mindegyikre. A bírálat kettőt elutasított, egyet feltételekkel
elfogadott.*

---

## 0. A lényeg egy bekezdésben

A kért szabály **két, gyökeresen különböző nehézségű részre bomlik**. Ahol a
cégnek **nincs** élő Stripe-előfizetése (regisztrációs trial, lejárt trial,
lemondott előfizetés), ott a Checkout-kötelezettség **ma is teljesül** — ez
kész. Ahol **van** élő előfizetés (fizetős Starter → Professional stb.), ott
a Stripe egy kemény korlátba ütközik: a `mode: "subscription"` Checkout
Session **mindig új előfizetést hoz létre**, és **nem tud prorálni egy másik
előfizetéshez képest**. Emiatt az „mindig Checkout" szabály szó szerinti
teljesítése azt jelentené, hogy **az ügyfél elveszíti a már kifizetett,
fel nem használt időszakát** — hacsak nem írunk hozzá jóváírás-kezelést,
ami ma sehol nincs a kódbázisban.

**Ez üzleti döntés, nem technikai.** A terv végén három út van, mindegyik
becsült költséggel és kockázattal.

---

## 1. Ami már ma helyes — a kérésed 1. és 2. pontja

| Átmenet | Van élő Stripe-sub? | Ma mi történik |
|---|---|---|
| Regisztráció → Starter trial | Nincs | `auth.routes.ts` — `trialing` + 14 nap, **kártya nélkül**, Stripe-objektum nélkül ✅ |
| Trial (lejárt) → fizetős Starter | Nincs | `changePlan` (b) ág → `requires_checkout` → Checkout ✅ |
| Trial → Professional / Business | Nincs | upgrade ág, `hasLiveSubscription()` false → `requires_checkout` → Checkout ✅ |
| Lemondott / lejárt → bármi | Nincs | ugyanaz ✅ |

**A kérésed 2. pontja tehát nagyrészt teljesül** — egyetlen, de súlyos
kivétellel, lásd a 2. szakaszt.

Ami **nem** teljesül, és amiről a terv szól:

| Átmenet | Ma | Kérés szerint |
|---|---|---|
| Fizetős Starter → Professional | `subscriptions.update` (azonnali, prorált) | Checkout |
| Fizetős Starter → Business | ugyanaz | Checkout |
| Professional → Business | ugyanaz | Checkout |
| Stripe-oldali trial → magasabb csomag | ugyanaz | Checkout |

---

## 2. Három hiba, amit a tervezés előtt kell rendezni

Ezek **függetlenek** attól, melyik designt választod — a mai kódban is élnek.

### 2.1 A trial → fizetős Starter átmenet ma nem azt csinálja, amit hiszünk 🔴

Nincs `trialConsumedAt` (vagy hasonló) oszlop a `Company`-n, és a
`PLAN_TRIAL_DAYS.starter = 14` **feltétel nélkül** érvényesül minden Starter
Checkoutra. Következmény: aki a regisztrációs trial alatt „fizetős Starterre
vált", az **újabb 14 nap ingyen trialt kap** — ráadásul a
`payment_method_collection: "if_required"` miatt **kártya megadása nélkül**.

**Ez pontosan a kérésed 2. pontját teszi működésképtelenné.** Kell egy
`trialConsumedAt` oszlop (Prisma-migráció), és a Checkoutnak el kell
hagynia a `trial_period_days`-t, ha a cég már fogyasztott trialt.

### 2.2 A `POST /checkout`-nak nincs szerveroldali védelme 🟠

Az endpoint **soha nem ellenőrzi**, hogy a cégnek van-e már élő
előfizetése. Ma csak az véd, hogy a frontend kizárólag `requires_checkout`
válasz után hívja. Egy közvetlen API-hívás **ma is** tud duplikált
előfizetést létrehozni. Bármelyik design mellett kell egy szerveroldali
guard.

### 2.3 A Billing Portal egy szabályozatlan hátsó ajtó 🟠

Ha a live Customer Portal konfigurációjában engedélyezve van a
csomagváltás, az ügyfél **ott is** tud upgradelni — és azt a Stripe
`subscriptions.update`-ként hajtja végre, teljesen megkerülve az új
szabályt. Ez **konfiguráció, nem kód**: a teszteknek és a code review-nak
láthatatlan. A portál csomagváltás-funkcióját ki kell kapcsolni (a
fizetési mód, számlák és lemondás maradhat).

---

## 3. A kemény probléma

`checkout.sessions.create({ mode: "subscription" })` **mindig új
Subscription objektumot hoz létre.** Ha a cégnek már van élő fizetős
előfizetése, ez azt jelenti:

1. Rövid ideig **két élő előfizetés** van → dupla számlázás veszélye.
2. Az újat a Stripe **nem tudja prorálni** a régihez képest — nincs rá
   paraméter. A már kifizetett, fel nem használt időszak **elveszik**,
   hacsak nem írunk jóváírást (coupon / customer balance), ami ma nincs.
3. A régit le kell szedni — és minden hiba ebben a lépésben **néma dupla
   számlázás**.

A mai kód épp ezért korlátozza a Checkoutot arra az esetre, amikor nincs
élő előfizetés (`subscriptionChange.ts` kommentje: *„never create a
duplicate subscription here"*).

---

## 4. A három vizsgált design és a bírálat

### Design A — Checkout hozza az újat, a webhook lelövi a régit
**Verdikt: ELUTASÍTVA.** Három végzetes hiba:
- A teardown maga generál egy `active` státuszú `customer.subscription.updated`
  eseményt a **régi** előfizetésre, ami átcsúszik a javasolt védelmen és
  visszaírja a régi csomagot.
- **Két nyitva hagyott Checkout-fül** → a marker mindkettőben ugyanaz →
  az egyik fizetős előfizetés véglegesen árván marad, tovább számlázva.
- A `past_due` (dunning alatti) előfizetések nem számítanak „élőnek", így
  **marker nélkül** maradnak → garantált duplikátum.
- Plusz: a fel nem használt időszak jóváírása coupon/balance kóddal
  megoldható lenne, de az **teljesen új, nem létező kódterület**, HUF-nál
  a 100-as oszthatósági szabállyal együtt.

### Design B — `mode: "payment"` Checkout a proration-különbözetre, utána `subscriptions.update`
**Verdikt: ELUTASÍTVA.** A központi ötlete helyes (a `payment` mód nem hoz
létre előfizetést, tehát a duplikátum-probléma **megszűnik**), de:
- **Az összeg nagy valószínűséggel hibás**: az `invoices.createPreview`
  `amount_due` mezője nem azonos az „upgrade most fizetendő" összeggel —
  egy teljes havidíjjal is eltérhet.
- **Dupla terhelés** két párhuzamos session-nel, amit az idempotencia-
  ellenőrzés némán elnyel.
- Egy **elavult, később kifizetett session visszaminősít** egy már magasabb
  csomagon lévő ügyfelet — pénz elvéve, csomag lefelé.
- Kétfázisú pénzmozgás **kompenzáló út nélkül**: a fizetés után a
  csomagváltás külön API-hívás, ami elbukhat.

### Design C — Checkout ott, ahol nincs előfizetés; Stripe-hosztolt megerősítés a fizetős→fizetős útra
**Verdikt: FELTÉTELEKKEL ÉLETKÉPES** — az egyetlen, amit a bírálat nem
utasított el. Architektúrája helyes: **egy cég egy előfizetést tart a teljes
életciklusán át**, ezért a fel nem használt időszak **jóváíródik** (ezt
Checkout-alapú megoldás nem tudja), és az `applySubscriptionUpdate` marad
az egyetlen írási út.

A megerősítés a Stripe **saját, hosztolt** oldalán történik
(`billingPortal.sessions.create` + `flow_data.subscription_update_confirm`):
az ügyfél a Stripe felületén látja a pontos, prorált összeget és ott hagyja
jóvá. **Mi magunk sosem hajtjuk végre a váltást a háta mögött.**

Négy javítandó pont a bírálat szerint:
- A guard `past_due` cégeket átenged → duplikátum. Szigorítani kell
  „van-e egyáltalán `stripeSubscriptionId`" alapra.
- A hosztolt megerősítő oldal **nem tudja törölni a függő lemondást**
  (`cancel_at_period_end`) — külön kezelendő, különben az ügyfél fizet egy
  prorationt egy előfizetésért, ami a periódus végén meghal.
- A függő downgrade schedule feloldása a hosztolt oldal **előtt** kell
  megtörténjen; ha az ügyfél elhagyja az oldalt, a downgrade elveszett, de
  a UI még mutatja.
- `always_invoice` + a mostani státusz-leképezés = **egy sikertelen
  upgrade-terhelés azonnal read-only módba teszi az egész céget**
  (bármely nem-`active`/`trialing` státusz → `plan: "free"`).

---

## 5. Ajánlás

**Design C, megkeményítve** — de csak akkor, ha elfogadod, hogy a
fizetős→fizetős upgrade **nem Checkout-oldalon**, hanem a Stripe hosztolt
megerősítő oldalán történik.

**Miért ezt ajánlom:** a célod („az ügyfél kifejezetten lássa és hagyja jóvá
a magasabb díjat, a hitelesítést a Stripe kezelje") **így teljesül** — és
közben az ügyfél **nem veszíti el** a már kifizetett időszakát. A szó
szerinti „mindig `mode: subscription` Checkout" ezzel szemben azt jelentené,
hogy vagy elveszik a maradék, vagy egy nem létező jóváírás-alrendszert
kell megírni és üzemeltetni, HUF-kerekítéssel együtt.

**Ha viszont ragaszkodsz a szó szerinti Checkouthoz**, akkor Design A
megkeményített változata a járható út, de az lényegesen nagyobb munka
(supersede-modul, idempotencia, jóváírás-kezelés, esemény-id tár) és
nagyobb pénzügyi kockázat.

---

## 6. Változtatások listája (Design C mellett)

### Módosuló backend

| Fájl | Mi változik |
|---|---|
| `services/stripe/subscriptionChange.ts` | Az upgrade ág **nem hív** `subscriptions.update`-et: élő előfizetésnél új `{ kind: "requires_upgrade_confirmation", url }` eredményt ad (hosztolt megerősítő oldal), élő előfizetés nélkül a meglévő `requires_checkout`. Downgrade, `downgrade_cancelled`, `isManuallyManaged`, enterprise-elutasítás **változatlan**. |
| `routes/subscription.routes.ts` | `POST /checkout`: **új szerveroldali guard** (van-e `stripeSubscriptionId` → 409); trial-elnyomás, ha a cég már fogyasztott trialt; a Checkout pénznemének rögzítése a meglévő előfizetéséhez. `POST /change-plan`: az új `kind` átvezetése. |
| `routes/stripeWebhook.routes.ts` | A `customer.subscription.updated` marad a fő út (a hosztolt megerősítés ezt váltja ki). **Idempotencia-őr** bevezetése (lásd lent). |
| `services/stripe/syncSubscription.ts` | `markSubscriptionCanceled` legyen **id-tudatos**: csak akkor írjon `free`/`canceled`-et, ha az esemény a cég **aktuális** előfizetéséről szól. |
| `prisma/schema.prisma` | **Migráció:** `trialConsumedAt DateTime?` a `Company`-n. Opcionálisan egy `ProcessedStripeEvent` tábla az idempotenciához. |
| `routes/auth.routes.ts` | A regisztrációs trial indításakor `trialConsumedAt` beállítása. |

### Módosuló frontend

| Fájl | Mi változik |
|---|---|
| `services/subscription.service.ts` | A `PlanChangeResponse` unió új ága: `requires_upgrade_confirmation`. |
| `components/billing/BillingPlansSection.tsx` | Az új `kind` kezelése (átirányítás a Stripe hosztolt oldalára), és az upgrade gomb felirata egyértelműsítse, hogy fizetési lépés következik. |

### Változatlan

`POST /cancel`, `POST /resume`, `POST /portal` (kód), `GET /subscription`,
a downgrade-ütemezés, a `readOnly` szabály, a pénznem-rögzítés
(`resolveTargetPrice`), a legacy plan-leképezés, a Founder/Enterprise
védelem.

### Stripe-oldali konfiguráció (kód nélkül)

- A **default** Customer Portal konfigurációban a csomagváltás **kikapcsolása**
  (2.3 pont).
- Egy **külön** portál-konfiguráció a megerősítő flow-hoz, a hat price-szal.

### Tesztek

- `subscriptionChange.test.ts`: a 2 upgrade-teszt átírása (ma
  `subscriptions.update`-et állítanak) az új `kind`-ra; a downgrade- és
  guard-tesztek maradnak.
- Új: trial-elnyomás, `POST /checkout` duplikátum-guard, id-tudatos
  `markSubscriptionCanceled`, webhook-idempotencia.

---

## 7. Eldöntendő kérdések

1. **Elfogadod-e**, hogy a fizetős→fizetős upgrade a Stripe **hosztolt
   megerősítő oldalán** történik, nem `mode: subscription` Checkouton?
   *(Ha nem: Design A megkeményítve, nagyobb munka és kockázat.)*
2. **A fel nem használt időszak** jóváírandó (Design C: automatikus), vagy
   elfogadható az elvesztése (Design A)?
3. **Azonnali terhelés vagy következő számlán?** A mai `create_prorations`
   nem terhel azonnal; a megerősítő flow-hoz `always_invoice` illik — ez
   viselkedésváltozás a meglévő ügyfeleknek.
4. **Stripe-oldali trial alatti upgrade**: a megerősítő oldal „0 Ft most
   fizetendő"-t mutatna. Zárjuk le a trialt az upgrade-nél, vagy maradjon?
5. **Prisma-migráció** éles adatbázison (`trialConsumedAt`) — mikor?
