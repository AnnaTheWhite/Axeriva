# Axeriva — Csomagváltási UX (Design C) — képernyőről képernyőre

*Készült: 2026-07-29. Státusz: **JÓVÁHAGYVA (Anna, 2026-07-29) —
IMPLEMENTÁLVA.** A [checkout-only-upgrades-plan.md](checkout-only-upgrades-plan.md)
technikai terv kísérő dokumentuma, a 2026-07-29-i üzleti döntések szerint.
A képernyők és feliratok a kódból származnak; ami a jóváhagyáskor új volt,
azt **ÚJ** jelöli — ezek a 4. szakasz szerint elfogadva és implementálva.
Éles aktiváláshoz szükséges Stripe-oldali lépések: 5. szakasz.*

---

## 0. Rögzített üzleti szabályok

1. **Fizetéssel járó csomagváltás soha nem történik néma
   `subscriptions.update`-tel.** Minden ilyen váltás előtt a felhasználó a
   Stripe hosztolt felületén látja a váltást és a fizetendő összeget, és ott
   hagyja jóvá:
   - **nincs élő előfizetés** (regisztrációs trial, lejárt, lemondott) →
     **Stripe Checkout**;
   - **van élő előfizetés** (fizetős → fizetős upgrade) → **Stripe hosztolt
     megerősítő oldal** (Customer Portal `subscription_update_confirm` flow).
   - A downgrade nem fizetési esemény (nincs terhelés), ezért ott az
     Axeriva-oldali megerősítő dialógus elegendő — lásd 2.5.
2. **A fel nem használt időszak mindig jóváíródik** — egy cég egy előfizetést
   visz végig, a Stripe prorál.
3. **Az upgrade proration-számlája azonnal kiállításra és terhelésre kerül**
   (`always_invoice` a flow-konfigurációban).
4. **A Starter trial egyszer használható** (`trialConsumedAt` a regisztrációkor
   íródik). A trial után/alatt minden váltás fizetési folyamat, kártyával —
   a Checkout soha többé nem ad `trial_period_days`-t ennek a cégnek.
5. **A normál Customer Portalban nincs csomagváltás** — csak fizetési mód,
   számlák, lemondás, folytatás. Csomagváltás kizárólag az Axeriva Billing
   felületről indul.

---

## 1. Képernyő-katalógus

A folyamatok öt felületen zajlanak; a táblázatokban ezekre hivatkozom.

| Jel | Felület | Mi ez |
|---|---|---|
| **S1** | Axeriva Billing — `/subscription` (`SubscriptionPage`) | A meglévő oldal: TrialBanner (csak `trialing` alatt), inline üzenetsáv (minden visszajelzés ide ír), „Jelenlegi csomag" kártya (státusz-badge-ekkel, lemondás/folytatás gombokkal), Használat, a négy csomagkártya (Starter / Professional / Business / Enterprise), Számlázási adatok, Számlaelőzmények. |
| **S2** | Stripe Checkout (hosztolt) | Kártyaadat-felvétel + fizetés, amikor **nincs** élő előfizetés. A meglévő út: `POST /subscription/checkout` → átirányítás. |
| **S3** | **ÚJ** — Stripe hosztolt megerősítő oldal | `billingPortal.sessions.create` + `flow_data.subscription_update_confirm`, **külön** portál-konfigurációval (`proration_behavior: always_invoice`, `trial_update_behavior: end_trial`; a 6 price felvétele a konfigurációba védekező beállítás — a confirm flow-nál a price-t a flow-adatban adjuk át, lásd 5. szakasz). A felhasználó itt látja az új csomagot, a jóváírást és a **most fizetendő időarányos összeget**, és itt hagyja jóvá. Lokalizált, magyarul is elérhető. |
| **S4** | Stripe Customer Portal (default konfiguráció) | Fizetési mód, számlák, lemondás, folytatás. **Csomagváltás kikapcsolva.** Ma nincs rá gomb a UI-ban — az **ÚJ** belépési pontot a 4. szakasz írja le. |
| **S5** | Visszatérési állapotok az S1-en | Query-paramok alapján: `?checkout=success&session_id=…` (sync + „Az előfizetés frissült."), `?checkout=cancelled` („A fizetési folyamat megszakadt — nem történt terhelés."), **ÚJ** `?upgrade=confirmed` (return-sync + sikerüzenet). |

A két Stripe-út sémája:

```
Nincs élő előfizetés (trial / lejárt / lemondott):
  S1 gomb ─▶ POST /change-plan ─▶ requires_checkout ─▶ POST /checkout ─▶ S2 (fizetés)
     ◀─ ?checkout=success ─ POST /sync (azonnali DB-írás) ─ webhookok párhuzamosan

Élő fizetős előfizetés (upgrade):
  S1 gomb ─▶ ÚJ dialógus ─▶ POST /change-plan ─▶ ÚJ requires_upgrade_confirmation {url}
     ─▶ S3 (Stripe mutatja az összeget, felhasználó jóváhagyja — EZ a váltás pillanata)
     ◀─ ?upgrade=confirmed ─ ÚJ return-sync (azonnali DB-írás) ─ webhookok párhuzamosan
```

---

## 2. Folyamatok

Táblázat-oszlopok: mit lát a felhasználó / mi történik a háttérben. Minden
folyamat végén egy **Idővonal** sor válaszolja meg: mikor van Stripe-oldal,
mikor a tényleges váltás, mikor fut webhook, mikor frissül az Axeriva.

### 2.1 Starter Trial → Fizetős Starter

Kiindulás: regisztrációs trial — `plan: starter`, `subscriptionStatus:
trialing`, `subscriptionEndsAt` = regisztráció + 14 nap, **nincs** Stripe-objektum,
`trialConsumedAt` kitöltve (ÚJ, regisztrációkor).

| # | Felület | Mit lát a felhasználó | Háttér |
|---|---|---|---|
| 1 | S1 | TrialBanner (**ÚJ tartalommal**: „Próbaidőszak — vége: {dátum}" + „Előfizetés indítása" CTA); a Starter kártyán **ÚJ**: aktív **„Előfizetés erre: Starter"** gomb (ma ez tiltott „Jelenlegi csomag" — a *saját* csomagra a trial alatt ma nem lehet előfizetni; magasabb csomagra Checkouttal ma is lehet váltani). | — |
| 2 | S1 | Kattintás → gomb: „Feldolgozás…" | `POST /change-plan {plan:"starter"}` → **ÚJ szabály**: élő Stripe-előfizetés nélkül a saját csomag újraválasztása is `requires_checkout` (ma a futó trial alatt 400-at ad). A kliens `POST /checkout`-ot hív → session **`trial_period_days` nélkül, kártya kötelező** (`trialConsumedAt` miatt) → átirányítás. |
| 3 | S2 | Stripe Checkout: „Starter — 7 990 Ft / hó" (vagy €29.99 EUR-nál), kártyaadatok, fizetés. Megszakítás: vissza az S1-re, „nem történt terhelés", a trial fut tovább. | Fizetéskor a Stripe létrehozza az előfizetést és **azonnal terheli az első havidíjat**. |
| 4 | S1 (S5) | Visszatérés `?checkout=success&session_id=…` → „Az előfizetés frissült." | `POST /subscription/sync`: session + subscription lekérése Stripe-ból → `applySubscriptionUpdate` → `plan: starter`, `status: active`, periódus vége mentve. Párhuzamosan webhook: `checkout.session.completed` (megerősítő e-mail) és `customer.subscription.updated` — idempotens echo. |
| 5 | S1 | Státusz-badge „Aktív", TrialBanner eltűnik, Starter kártya: „Jelenlegi csomag". | — |

**Idővonal:** Stripe-oldal a 3. lépés · tényleges váltás a Checkout-fizetés
pillanata · webhook másodperceken belül · Axeriva a visszatéréskor azonnal
frissül (sync), a webhook csak megerősít.

**Variáns — Starter Trial → Professional / Business:** lépésről lépésre
ugyanez, csak a Professional/Business kártya gombjával indul („Váltás erre:
{csomag}") és az ár 16 990 / 34 990 Ft (€59.99 / €119.99). Szerveroldalon itt
semmi nem új — az upgrade ág élő előfizetés nélkül ma is `requires_checkout`-ot
ad; az egyetlen **ÚJ** elem a Checkout trial-elnyomása (`trialConsumedAt`).
A futó trial a fizetéssel véget ér — az új fizetős előfizetés felülírja az
állapotot. Trial itt amúgy sincs (a Professional/Business-nek soha nem volt).

**Variáns — lejárt trial:** ugyanez az út, csak a read-only állapotból indul
(globális read-only sáv, TrialBanner már nincs); a Starter kártyán ma is
megjelenő „Előfizetés erre: Starter" gombbal → 2.1 lépései, kártyával, trial
nélkül.

### 2.2 Fizetős Starter → Professional (mintafolyamat minden fizetős → fizetős upgrade-hez)

Kiindulás: élő fizetős Starter (`stripeSubscriptionId` van, `status: active`),
nincs függő lemondás vagy visszaváltás (ha van: 3. szakasz). Egy Stripe-oldali
`trialing` előfizetés (a mai, feltétel nélküli trial-osztogatás öröksége)
szintén ezen az úton megy: a megerősítéskor a trial lezárul
(`trial_update_behavior: end_trial`) és az első díj azonnal terhelődik —
a 4. üzleti szabály szerint.

| # | Felület | Mit lát a felhasználó | Háttér |
|---|---|---|---|
| 1 | S1 | Professional kártya: „Váltás erre: Professional". | — |
| 2 | S1 | **ÚJ upgrade-dialógus** (redirect előtt): *„Váltás erre: Professional — Átirányítunk a Stripe biztonságos oldalára, ahol látod a most fizetendő, időarányos összeget, és ott hagyhatod jóvá a váltást. A Starter fel nem használt időszaka jóváíródik."* CTA: „Tovább a Stripe oldalára" / „Mégse". | — |
| 3 | S1 | „Tovább" → „Feldolgozás…" | `POST /change-plan {plan:"professional"}` → **ÚJ**: `{kind:"requires_upgrade_confirmation", url}`. A szerver flow-session-t készít: a cél-price **az előfizetés saját pénznemében** (f9b3396 szabály, nem a UI-nyelv szerint), `after_completion.redirect` → `/subscription?upgrade=confirmed`, `locale` a felhasználó nyelvén. **Nem történik `subscriptions.update`.** |
| 4 | S3 | Stripe megerősítő oldal: az új csomag (Professional), a Starter maradék idejének jóváírása + a Professional időarányos díja = **most fizetendő összeg**, és a megerősítő gomb (várhatóan a mentett fizetési móddal — a pontos oldaltartalmat az 5. szakasz tesztköre rögzíti). Ha elhagyja az oldalt: semmi nem történik, marad a Starter (a meg nem nyitott link 5 perc után lejár; megnyitva az utolsó aktivitás után 1 órával). | — |
| 5 | S3 | Megerősítés. | **Ez a tényleges csomagváltás pillanata.** A Stripe végrehajtja a váltást, `always_invoice` → azonnali proration-számla + terhelés (3DS-t a Stripe kezeli). Webhookok: `customer.subscription.updated` → `applySubscriptionUpdate` → `plan: professional`; `invoice.*` eseményeket ma nem dolgozzuk fel (nyugtázzuk). |
| 6 | S1 (S5) | Visszairányítás `?upgrade=confirmed` → „Csomagváltás sikeres — az új limitek azonnal érvényesek." | **ÚJ return-sync**: a cég előfizetésének friss lekérése Stripe-ból + `applySubscriptionUpdate` — a UI nem függ a webhook érkezésétől (a Checkout-sync mintájára). |
| 7 | S1 | Professional: „Jelenlegi csomag"; limitek, megújítási dátum frissülve. | — |

**Idővonal:** Stripe-oldal a 4. lépés · tényleges váltás az 5. lépés
(megerősítés) pillanata · webhook közvetlenül utána · Axeriva a webhookkal
és a visszatéréskor (return-sync) is frissül — amelyik előbb ér oda.

### 2.3 Fizetős Starter → Business

Lépésről lépésre azonos a 2.2-vel; a Business kártyáról indul, az S3-on a
Business időarányos díja és a Starter-jóváírás különbözete a most fizetendő.

**Idővonal:** mint 2.2 — Stripe-oldal a megerősítő oldal, tényleges váltás a
megerősítéskor, webhook közvetlenül utána, Axeriva webhookból + return-syncből.

### 2.4 Professional → Business

Azonos a 2.2-vel; nagyobb jóváírás (a Professional maradék ideje), a
különbözet a Business felé fizetendő.

**Idővonal:** mint 2.2.

### 2.5 Downgrade (pl. Business → Professional) — változatlan a mai működéshez képest

Nincs Stripe-oldal, nincs fizetés — a már kifizetett időszak végigfut, ez
önmagában teljesíti a „nem vész el a kifizetett idő" szabályt.

| # | Felület | Mit lát a felhasználó | Háttér |
|---|---|---|---|
| 1 | S1 | Professional kártya: „Visszaváltás erre: Professional" (másodlagos gomb). | — |
| 2 | S1 | Meglévő ConfirmModal: *„Visszaváltás erre: Professional?" — „A jelenlegi csomagod a számlázási időszak végéig aktív marad, utána az előfizetésed átvált erre: Professional. Semmi nem törlődik — az adataid megmaradnak."* CTA: „Visszaváltás ütemezése" / „Maradok a jelenlegi csomagon". | — |
| 3 | S1 | „A visszaváltás a számlázási időszak végére ütemezve." Badge: „Visszaváltás erre: Professional"; a célkártyán „Ütemezve" badge; „Következő csomag" sor a jelenlegi-csomag kártyán. | `POST /change-plan` → `downgrade_scheduled`: Stripe Subscription Schedule két fázissal (jelenlegi ár a periódus végéig → új ár), `pendingPlan` mentve. Webhook-echo: `customer.subscription.updated`. |
| 4 | — | (Periódus vége.) | A Stripe fázist vált → `customer.subscription.updated` → `applySubscriptionUpdate`: `plan: professional`, `pendingPlan` törlődik (self-heal). A következő számla már az alacsonyabb díj. |
| 5 | S1 | Következő betöltéskor: Professional a jelenlegi csomag. | — |

**Idővonal:** nincs Stripe-oldal · tényleges váltás a periódus végén ·
webhook a fázisváltáskor · Axeriva a webhookból frissül (a köztes állapotot
a 3. lépésben azonnal mutatja).

**Visszavonás:** a jelenlegi csomag kártyáján **ÚJ**: függő visszaváltás
alatt a gomb aktív, felirata „Maradok a jelenlegi csomagon" (ma tiltott
„Jelenlegi csomag") → `downgrade_cancelled` → „A függő visszaváltás törölve —
a jelenlegi csomagodon maradsz."

### 2.6 Cancel — változatlan a mai működéshez képest

| # | Felület | Mit lát a felhasználó | Háttér |
|---|---|---|---|
| 1 | S1 | Jelenlegi-csomag kártya: „Előfizetés lemondása" (piros). | — |
| 2 | S1 | Meglévő ConfirmModal: *„Lemondod az előfizetést?" — „A csomagod eddig marad aktív: {dátum}. Addig bármikor folytathatod, az adataid pedig mindig megmaradnak."* CTA: „Lemondás" / „Megtartom az előfizetést". | — |
| 3 | S1 | „A lemondás ütemezve — a hozzáférés a számlázási időszak végéig megmarad." Badge: „Lemondás folyamatban"; „Lemondás dátuma" piros dátummal; a gomb helyén „Előfizetés folytatása". | `POST /cancel` → `subscriptions.update(cancel_at_period_end: true)` + függő downgrade-schedule feloldása, `pendingPlan` törlés → **azonnali DB-írás** (nem vár webhookra). Webhook-echo: `customer.subscription.updated`. |
| 4 | — | (Periódus vége.) | `customer.subscription.deleted` → `markSubscriptionCanceled`: `status: canceled`, `plan: free` → a cég read-only módba kerül. |
| 5 | Minden oldal | Globális read-only sáv: „A céged csak olvasható módban van." + „Ugrás a számlázáshoz". Visszaút: a korábbi csomag kártyáján „Előfizetés erre: {csomag}", a magasabbakén „Váltás erre: {csomag}" — mindkettő Checkoutra visz (2.1 lépései; kártyával és trial nélkül az **ÚJ** trial-elnyomással — ma egy lemondott cég Starterre újra 14 nap ingyen trialt kapna, ezt zárja a `trialConsumedAt`). **ÚJ**: a visszatérő ügyfél Checkoutja a korábbi előfizetés pénznemét használja, nem a UI-nyelvét (terv 6. szakasz). | — |

**Idővonal:** nincs Stripe-oldal (a lemondás nem fizetési esemény) · a
hozzáférés a periódus végéig él · webhook a lemondáskor (echo) és a periódus
végén (deleted) · Axeriva a 3. lépésben azonnal, a periódus végén webhookból
frissül. **Alternatív út:** a Stripe Portalban (S4) is lemondhat — az a
webhookon át ugyanide fut be; az Axeriva UI a következő betöltéskor frissül.
Kivétel: amíg ütemezett visszaváltás (schedule) él az előfizetésen, a Portal
nem tud sem módosítani, sem lemondani (Stripe-korlát) — olyankor csak az app
saját „Előfizetés lemondása" gombja működik, az feloldja a schedule-t.

### 2.7 Resume — változatlan a mai működéshez képest

| # | Felület | Mit lát a felhasználó | Háttér |
|---|---|---|---|
| 1 | S1 | Lemondás alatt: „Az előfizetésed ekkor ér véget: {dátum}." + „Előfizetés folytatása" gomb. | — |
| 2 | S1 | Kattintás (nincs dialógus) → „Feldolgozás…" → „Az előfizetés folytatódik." A „Lemondás folyamatban" badge eltűnik, a megújítási dátum visszaáll. | `POST /resume` → `subscriptions.update(cancel_at_period_end: false)` → **azonnali DB-írás** + webhook-echo. |

**Idővonal:** nincs Stripe-oldal, nincs fizetés · azonnali · webhook echo ·
Axeriva azonnal. Resume csak a periódus vége **előtt** lehetséges; utána már
csak új Checkout van (2.6/5. lépés). A Portalban (S4) is elérhető — a 2.6-nál
írt schedule-kivétellel.

---

## 3. Kereszt-szabályok és peremhelyzetek

- **Függő lemondás + upgrade → BLOKK (kétlépcsős UX, megvizsgálva és
  eldöntve 2026-07-29).** Amíg `cancelAtPeriodEnd` igaz, az upgrade gombok
  kattintásra inline üzenetet adnak: *„Csomagváltás előtt folytasd az
  előfizetést."* Két explicit kattintás: Folytatás → Váltás.
  *Az egylépcsős összevonás vizsgálatának eredménye:* a Stripe hivatalos
  API-referenciája szerint a `subscription_update_confirm` flow teljes
  paraméterfelülete a subscription + egyetlen tétel + kedvezmények — **nincs**
  paraméter, ami a lemondást is visszavonná, és „resume" flow-típus sem
  létezik. A 2018-02-28-as Stripe-changelog óta egy előfizetés-módosítás
  dokumentáltan **nem** törli a függő lemondást; hogy a hosztolt flow
  egyáltalán elindul-e lemondás alatt, azt a doksi egyik irányban sem
  rögzíti. A „nem dokumentált = nem támogatott" szabály szerint az
  összevonás (akár előzetes auto-resume-mal, akár webhook utáni
  kompenzációval) elvetve: az előbbi a felhasználó kifejezett szándéka
  ellenére éleszthetné újra az előfizetést egy elhagyott oldalnál, az
  utóbbi pénzmozgás után futó, hibázni képes kompenzáló lépést igényelne.
- **Függő downgrade + upgrade.** Az upgrade-dialógus (2.2/2. lépés) külön
  sorban közli: *„Az ütemezett visszaváltás törlésre kerül."* A szerver a
  flow-session létrehozása **előtt** feloldja a schedule-t és törli a
  `pendingPlan`-t (Stripe-korlát: ütemezett előfizetés nem frissíthető a
  flow-val). Ha a felhasználó a Stripe oldalán mégsem hagy jóvá, a
  visszaváltás törölve marad — ezt a dialógus előre kimondja.
- **Sikertelen terhelés az S3 oldalon.** A kártyahibát és a 3DS-t a Stripe
  hosztolt oldala kezeli — részben ezért ezt a flow-t választjuk. Ha az
  előfizetés ennek ellenére `past_due`-ba kerülne, a technikai terv 4.
  javítási pontja szerint a cég **nem** eshet emiatt azonnal `free`/read-only
  állapotba — a státuszleképezés finomítása az implementáció része. A
  fizetési módot a Portalban (S4) lehet rendezni.
- **`past_due` cég (pl. sikertelen megújítás) + csomaggombok → BLOKK.** Ma a
  `past_due` cég read-only-ban van, de a csomagkártyák gombjai aktívak, és a
  kattintás Checkoutra vinne — duplikált előfizetést létrehozva. **ÚJ**:
  amíg a cégnek van le nem zárt Stripe-előfizetése, de az nem `active`/`trialing`
  (tipikusan `past_due`), a csomaggombok kattintásra inline üzenetet adnak:
  *„Először rendezd a fizetési módot."* + a Portal-gomb (S4). Sem Checkout,
  sem megerősítő flow nem indul.
- **Webhook-késés.** Egyik folyamat UI-ja sem függ a webhook érkezésétől:
  Checkout után a meglévő sync, a megerősítő flow után az új return-sync ír
  azonnal. A webhook mindenhol idempotens megerősítés.
- **Elhagyott Stripe-oldal.** S2-nél: `?checkout=cancelled` üzenet, semmi nem
  változott. S3-nál: a felhasználó egyszerűen visszanavigál — semmi nem
  változott; a meg nem nyitott flow-link 5 perc után lejár, a megnyitott
  munkamenet az utolsó aktivitás után 1 órával.
- **Founder / Enterprise.** Minden önkiszolgáló út zárva marad („Az Axeriva
  kezeli" gomb, szerveroldali elutasítás) — változatlan.
- **Duplikátum-védelem.** `POST /checkout` új szerveroldali guardot kap.
  A pontos feltétel (a terv bírálati pontját és a fenti visszautakat
  összebékítve): **409, ha a cégnek van `stripeSubscriptionId`-ja ÉS a tárolt
  előfizetés nincs lezárva** (`canceled`). Így a `past_due` cég is blokkolva
  van (nem születhet duplikátum), a lemondott/lejárt cég viszont újra tud
  fizetni Checkouttal — fontos, mert a `markSubscriptionCanceled` nem törli a
  `stripeSubscriptionId`-t. *Ez a pontosítás a technikai terv 6. szakaszába is
  átvezetendő (ott ma a szigorúbb, a visszautat blokkoló megfogalmazás áll).*

---

## 4. Új / változó UI-elemek — ezekre kérem a jóváhagyást

1. **Upgrade-dialógus** minden fizetős → fizetős váltás előtt (2.2/2. lépés
   szövegével) — jelzi, hogy fizetési lépés következik, és hogy az összeg a
   Stripe oldalán jelenik meg.
2. **Trial alatt aktív „Előfizetés erre: Starter" gomb** a Starter kártyán +
   TrialBanner-frissítés (lejárati dátum + „Előfizetés indítása" CTA). Ma a
   trial alatt a *saját* (Starter) csomagra nem lehet előfizetni, csak
   lejárat után — magasabb csomagra Checkouttal már ma is lehet váltani.
3. **`?upgrade=confirmed` visszatérési út + return-sync endpoint** — a
   megerősített váltás azonnal látszódjon, webhook nélkül is.
4. **„Számlák és fizetési mód" gomb** (a Számlázási adatok kártyán) → Stripe
   Customer Portal (S4, default konfiguráció). A Számlaelőzmények üres
   állapota is ide tereljen. Ma a portálnak nincs belépési pontja a UI-ban,
   pedig a lemondáson kívül minden számlakezelés ott lesz.
5. **Blokk-üzenet** lemondás alatti upgrade-kísérletre (3. szakasz, 1. pont).
6. **„Maradok a jelenlegi csomagon" gomb** függő visszaváltás alatt a
   jelenlegi csomag kártyáján (ma ebben az állapotban tiltott a gomb, így a
   visszavonás nem érhető el a felületről).
7. **Blokk-üzenet `past_due` állapotban** a csomaggombokra: „Először rendezd
   a fizetési módot." + Portal-terelés (3. szakasz).

---

## 5. Stripe-oldalon, implementáció előtt ellenőrizendő

Az implementáció első lépése egy teszt-módú végigjátszás. Egy pont a doksi
szerint **előfeltétel**, a többi nyitott kérdés:

1. **`tax_behavior` a price-okon — előfeltétel.** A Stripe-doksi szerint a
   portál nem enged előfizetés-módosítást, ha a price `tax_behavior`-a
   `unspecified` — és a kódbázisban sehol nincs `tax_behavior` beállítva,
   tehát a 6 price-on ezt előbb rendezni kell, különben az egész S3 flow
   elakadhat. (docs.stripe.com/customer-management, Limitations.)
2. A megerősítő oldal pontos tartalma — van-e explicit „ma fizetendő" sor,
   látszik-e a mentett fizetési mód.
3. Fizetési hiba viselkedése a megerősítő oldalon (érvénybe lép-e a váltás,
   `past_due`-ba kerül-e az előfizetés, javítható-e a kártya helyben).
4. Megerősítéskor mi történik egy függő `cancel_at_period_end`-del
   (feltételezés: érintetlen marad — ezért a blokk-szabály).
5. Trial-lezárás: a doksi szerint a portál alapviselkedése is az, hogy a
   `trialing` előfizetés módosítása lezárja a trialt és azonnal számláz —
   a flow-konfigurációban ettől függetlenül explicit
   `trial_update_behavior: end_trial`-t állítunk be; tesztben megerősítendő.
6. Ütemezett (schedule-ös) előfizetésre kért flow-session pontos hibamódja.
7. Kell-e egyáltalán a 6 price-t a flow-konfiguráció
   `subscription_update.products` listájára venni (a confirm flow a price-t a
   flow-adatban kapja; a felvétel védekező beállítás).
8. **Dunning-lezárás (AC17 előfeltétele):** a Stripe Dashboardban a
   *Billing → Revenue recovery → Retries → „If all retries fail"* beállítás
   **cancel** vagy **mark unpaid** legyen — a „leave as-is" opció mellett a
   `past_due` türelmi állapot sosem záródna le, és a cég korlátlan ideig
   megtartaná az írási hozzáférést fizetés nélkül.

---

## 7. Ismert korlátok (implementáció után rögzítve, 2026-07-30)

- **Flow-session hiba = elveszett ütemezett visszaváltás.** A Stripe-korlát
  miatt a függő downgrade schedule-t a flow-session létrehozása *előtt* kell
  feloldani; ha maga a session-létrehozás hiúsul meg (Stripe-kiesés, rossz
  konfiguráció-id), a visszaváltás már törlődött, és csak hibaüzenet jelenik
  meg — a felhasználónak újra kell ütemeznie. Ritka, pénzt nem veszít, de
  meglepő lehet.
- **Duplikátum-ablak maradéka.** A nyitott Checkout-sessionök lejáratása +
  a completion-kori egyeztetés (a beérkező duplikátum-előfizetés azonnali
  törlése) lezárja a dupla-előfizetés útjait, de a duplikátum *első* terhelése
  megtörténhet — az audit log `manualRefundRequired` jelzéssel rögzíti, a
  visszatérítés kézi lépés.
- **`ProcessedStripeEvent` növekedés.** A webhook-idempotencia tábla lassan,
  de korlát nélkül nő; időnkénti prune elegendő (ops-jegyzet a
  render-deployment.md-ben).
- **Legacy egy-price flow.** A `STRIPE_PRICE_ID`-s örökölt checkout-út nem kap
  pénznem-rögzítést (egyetlen fix price); a törölt-customer öngyógyítás arra
  is érvényes.

---

## 6. Átvételi kritériumok (Acceptance Criteria)

### Trial és Checkout

- **AC1** — Regisztrációkor a `trialConsumedAt` kitöltődik; a cég ezután
  soha többé nem kap trialt Checkoutban (`trial_period_days` nincs, kártya
  kötelező).
- **AC2** — Aktív regisztrációs trial alatt a Starter kártyán aktív
  „Előfizetés erre: Starter" gomb van; kattintás → Checkout; sikeres fizetés
  után a státusz `active`, a TrialBanner eltűnik.
- **AC3** — `POST /checkout` 409-cel elutasít, ha a cégnek van
  `stripeSubscriptionId`-ja és az előfizetés nincs lezárva (`canceled`);
  lemondott/lejárt cég viszont újra tud fizetni.
- **AC4** — Visszatérő (korábban előfizetett) cég Checkoutja a korábbi
  előfizetés pénznemét használja, a UI-nyelvtől függetlenül.

### Fizetős → fizetős upgrade

- **AC5** — Élő fizetős előfizetésnél a `POST /change-plan` upgrade-re
  **soha** nem hív `subscriptions.update`-et; `requires_upgrade_confirmation`
  eredményt és URL-t ad.
- **AC6** — Az URL a Stripe hosztolt megerősítő oldalára visz, amely a
  célcsomagot és a most fizetendő prorált összeget mutatja; jóváhagyás
  nélkül semmilyen váltás nem történik (elhagyott oldal = nincs változás).
- **AC7** — Jóváhagyáskor a proration-számla azonnal kiállításra és
  terhelésre kerül (`always_invoice`); a fel nem használt időszak jóváíródik.
- **AC8** — A visszairányított felhasználó (`?upgrade=confirmed`) a
  webhook megérkezése nélkül is azonnal a friss csomagot látja (return-sync).
- **AC9** — Az upgrade a meglévő előfizetés pénznemében történik.
- **AC10** — Stripe-oldali `trialing` előfizetés upgrade-jekor a trial
  lezárul és az első díj azonnal terhelődik (`end_trial`).

### Blokk-szabályok

- **AC11** — `cancelAtPeriodEnd` alatt az upgrade blokkolva van („előbb
  folytasd az előfizetést") — kliens- **és** szerveroldalon.
- **AC12** — `past_due` alatt a csomaggombok blokkolva („először rendezd a
  fizetési módot" + Portal-terelés); sem Checkout, sem flow nem indul.
- **AC13** — Függő downgrade + upgrade: a dialógus jelzi a visszaváltás
  törlését; a schedule a flow-session létrehozása előtt feloldódik; ha a
  felhasználó nem hagy jóvá a Stripe oldalán, a downgrade törölve marad, és
  a UI ezt tükrözi.

### Downgrade / Cancel / Resume (változatlan viselkedés bizonyítása)

- **AC14** — A downgrade továbbra is periódus végére ütemeződik (schedule),
  fizetés nélkül; a periódus végén webhookból vált a csomag; visszavonható a
  „Maradok a jelenlegi csomagon" gombbal.
- **AC15** — Cancel/Resume változatlan (`cancel_at_period_end`, azonnali
  DB-írás); a periódus végi `customer.subscription.deleted` webhook csak
  akkor ír `canceled`/`free`-t, ha az esemény a cég **aktuális**
  előfizetéséről szól (id-tudatos `markSubscriptionCanceled`).

### Webhook és állapot

- **AC16** — Webhook-idempotencia: ugyanaz az event kétszer kézbesítve nem
  okoz második írást és nem küld második megerősítő e-mailt.
- **AC17** — `past_due` státusz nem írja át a csomagot `free`-re és nem
  teszi azonnal read-only-ba a céget (türelmi idő a Stripe dunning alatt);
  `canceled`/`unpaid` továbbra is read-only.

### Stripe-konfiguráció

- **AC18** — A default Customer Portal konfigurációban a csomagváltás
  kikapcsolva; fizetési mód, számlák, lemondás, folytatás elérhető.
- **AC19** — A flow-konfigurációban `proration_behavior: always_invoice` és
  `trial_update_behavior: end_trial`; mind a 6 price `tax_behavior`-a
  beállítva.
- **AC20** — Founder/Enterprise cégeknél minden önkiszolgáló út
  változatlanul zárva.

---

*A jóváhagyás után az implementáció a technikai terv 6. szakasza szerint
indul; ez a dokumentum adja hozzá a képernyő- és szövegszintű specifikációt.*
