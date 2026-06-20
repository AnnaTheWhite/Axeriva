# Stripe Webhook — Production Readiness Útmutató

Ez a dokumentum **csak leírás, kódot nem módosít**. A jelenlegi Stripe-integráció elemzésén alapul, és lépésről lépésre megmutatja, hogyan kell a webhookot élesben (és helyi gépen) helyesen beüzemelni.

## 1. Jelenlegi állapot — mit csinál most a kód

| Komponens | Fájl | Mit csinál |
|---|---|---|
| Webhook route | [server/src/routes/stripeWebhook.routes.ts](server/src/routes/stripeWebhook.routes.ts) | `POST /` — aláírást ellenőriz, majd a `Company` rekordot frissíti |
| Mount + raw body | [server/src/index.ts:27](server/src/index.ts) | `/subscription/webhook` regisztrálva **`express.raw()`-val, az `express.json()` elé** |
| Stripe kliens | [server/src/services/stripe/stripeClient.ts](server/src/services/stripe/stripeClient.ts) | `STRIPE_SECRET_KEY`-ből épül fel |
| Checkout/Portal | [server/src/routes/subscription.routes.ts](server/src/routes/subscription.routes.ts) | `POST /subscription/checkout`, `POST /subscription/portal` (csak BUSINESS_OWNER) |
| .env | [server/.env](server/.env) | jelenleg **teszt** kulcsok + egy **helyi, kitalált** `STRIPE_WEBHOOK_SECRET` |

A teljes webhook URL alapja: **`{API_BASE_URL}/subscription/webhook`** — ez a végpont, amit a Stripe Dashboardban (vagy a Stripe CLI-vel) be kell majd állítani.

A kód jelenleg **3 eseménytípust kezel**, minden mást figyelmen kívül hagy (`default: break`):

- `checkout.session.completed` — az első sikeres előfizetés aktiválása
- `customer.subscription.updated` — státuszváltozás (pl. megújulás, `past_due`, plan-váltás)
- `customer.subscription.deleted` — lemondás/lejárat → `plan: "free"`, `subscriptionStatus: "canceled"`

A `STRIPE_WEBHOOK_SECRET` jelenlegi értéke (`whsec_test_local_dev_secret`) egy **kézzel kitalált, csak a saját tesztjeimhez használt placeholder** — ezt valódi Stripe-eseményre nem fogja elfogadni, mert nem ezzel írta alá a Stripe. Erre a dokumentum 3. és 5. pontja ad megoldást.

---

## 2. Webhook endpoint létrehozása a Stripe Dashboardban

1. Jelentkezz be a [Stripe Dashboardba](https://dashboard.stripe.com).
2. Bal felül ellenőrizd, hogy **Test mode**-ban vagy-e (amíg nincs élő forgalom, mindent test mode-ban csinálj).
3. Menj a **Developers → Webhooks** menüpontra.
4. Kattints **"Add endpoint"**.
5. **Endpoint URL**: a backended publikusan elérhető címe + `/subscription/webhook`.
   - Helyi gépen ez **nem működik közvetlenül** (a Stripe nem tud `localhost`-ra küldeni) — erre a 4. pont (Stripe CLI) ad megoldást.
   - Élesben (lásd 6. pont) valami ilyesmi lesz: `https://api.crewflow.com/subscription/webhook`.
6. **"Select events"** — válaszd ki pontosan azt a 3 eseményt, amit a kód kezel:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`

   *(Opcionális, jövőbeli bővítéshez érdemes lehet figyelni — de a jelenlegi kód ezekre nem reagál, csak átmennek a `default` ágon, tehát hozzáadásuk most semmilyen hatással nem lenne: `invoice.payment_failed`, `customer.subscription.trial_will_end`. Ha most nem vagy biztos benne, nyugodtan hagyd ki — bármikor visszamehetsz az endpoint szerkesztésébe és hozzáadhatod.)*

7. Kattints **"Add endpoint"**.
8. Az endpoint részletes nézetében jelenik meg a **"Signing secret"** — ez a `whsec_...` érték (lásd 3. pont).

---

## 3. Hogyan szerezd meg a valós `whsec_...` kulcsot

A Stripe **endpointonként külön signing secret-et** generál — ez nem ugyanaz, mint az API kulcs (`sk_...`).

1. A létrehozott endpoint Dashboard-oldalán kattints **"Reveal"** / **"Click to reveal"** a Signing secret mezőnél.
2. Másold ki a teljes `whsec_...` stringet.

**Fontos**: ez **különbözik** attól a secret-től, amit a Stripe CLI ad helyi teszteléshez (lásd 4. pont) — a kettő két különböző mechanizmus, két különböző secret.

⚠️ A signing secret egyszer jelenik meg teljes egészében a felületen utólag is megnézhető (Reveal gombbal bármikor), de **soha nem szabad commit-olni** vagy chatbe/logba beilleszteni élesben.

---

## 4. Hogyan teszteld a webhookot helyi gépen

### 4.1 Stripe CLI telepítése

Windows-on a legegyszerűbb a [Stripe CLI letöltési oldaláról](https://github.com/stripe/stripe-cli/releases/latest) letöltött `.exe`, vagy ha van Scoop-od:

```powershell
scoop install stripe
```

Ellenőrzés:

```powershell
stripe --version
```

### 4.2 Bejelentkezés

```powershell
stripe login
```

Ez megnyit egy böngészőablakot, ahol engedélyezed a CLI-t a Stripe fiókodhoz (test mode-ban dolgozik, amíg nem mondod neki mást).

### 4.3 Forward indítása a helyi szerverre

A backend jelenleg `http://localhost:5000`-en fut ([server/src/index.ts:51](server/src/index.ts)), a webhook route `/subscription/webhook`:

```powershell
stripe listen --forward-to localhost:5000/subscription/webhook
```

A terminál kiír egy sort, kb. így:

```
Ready! Your webhook signing secret is whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx (^C to quit)
```

**Ezt a `whsec_...` értéket** kell betenni a `.env`-be (lásd 5. pont) — ez a CLI-forward-specifikus secret, amíg ez a `stripe listen` parancs fut, ez érvényes.

A `stripe listen` parancsot **futva kell hagyni** egy külön terminálban, amíg helyi teszteket csinálsz — minden Stripe-esemény ezen a csatornán keresztül jut el a géphez.

### 4.4 Tesztesemény kiváltása

Másik terminálban, miközben a `stripe listen` és a `npm run dev` is fut:

```powershell
stripe trigger checkout.session.completed
```

Ez egy szintetikus eseményt küld a CLI-n keresztül a helyi végpontodra. A backend konzolján látnod kell, hogy a kérés megérkezett (vagy hibát logol, ha valami nem stimmel — pl. ha a `metadata.companyId` hiányzik egy generikus `stripe trigger` eseményből, ld. 4.5).

### 4.5 Valódi végpontig terjedő teszt (ajánlott)

A `stripe trigger` szintetikus, generikus adatokkal dolgozik (nincs benne a te `companyId` metadata-d). A **valósághűbb teszt**, ha a tényleges alkalmazás-flow-t futtatod:

1. `npm run dev` (backend) + a frontend dev szerver fut
2. `stripe listen --forward-to localhost:5000/subscription/webhook` fut egy másik terminálban
3. Jelentkezz be BUSINESS_OWNER-ként, nyisd meg a `/subscription` oldalt, kattints **Subscribe**
4. A Stripe-hosztolt checkout oldalon add meg a teszt kártyát: `4242 4242 4242 4242`, bármilyen jövőbeli lejárat, bármilyen CVC
5. Sikeres fizetés után a Stripe elküldi a `checkout.session.completed` eseményt → a `stripe listen` továbbítja a helyi szerverednek → a webhook handler frissíti a `Company` rekordot
6. Ellenőrizd: `GET /subscription` (Bearer tokennel) most `plan: "pro"`, `subscriptionStatus: "active"` legyen

### 4.6 Mit írj a `.env`-be helyi teszteléshez

```env
STRIPE_WEBHOOK_SECRET="whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

(a `stripe listen` kimenetéből másolva) — pontosan ugyanabba a változóba, amit a kód már olvas: [server/src/routes/stripeWebhook.routes.ts:41](server/src/routes/stripeWebhook.routes.ts).

Minden alkalommal, amikor újra elindítod a `stripe listen`-t, **új secret-et generálhat** — ha a CLI-t leállítod és újraindítod, ellenőrizd, hogy a kiírt secret megegyezik-e a `.env`-ben lévővel, és ha nem, frissítsd + indítsd újra a backendet (`npm run dev` automatikusan újraolvassa, mert `ts-node-dev` minden indításkor friss `dotenv.config()`-ot futtat).

---

## 5. Pontosan melyik `.env` változóba kerüljön

Egyetlen változó érintett, és ez **már létezik** a kódban, csak az értékét kell lecserélni:

| Fájl | Változó | Jelenlegi érték (placeholder) | Mire cseréld |
|---|---|---|---|
| [server/.env](server/.env) | `STRIPE_WEBHOOK_SECRET` | `whsec_test_local_dev_secret` | helyi teszthez: a `stripe listen` kimenetéből kapott `whsec_...`; élesben: a Dashboard endpoint signing secret-je |

Ne keverd össze ezekkel a már meglévő, helyesen beállított változókkal:

- `STRIPE_SECRET_KEY` — API kulcs (`sk_test_...` vagy élesben `sk_live_...`)
- `STRIPE_PUBLISHABLE_KEY` — jelenleg nincs frontend Stripe.js használat, csak tárolva van
- `STRIPE_PRICE_ID` — a `npm run stripe:setup` által létrehozott Price ID

Élesben **élő (live) módra váltva** mindhárom Stripe-kulcsot (secret key, webhook secret, és ha újra futtatod a setup scriptet, a price ID-t is) **újra le kell kérni live mode-ban** — a test mode és a live mode Stripe-ban teljesen különálló adatok (külön API kulcsok, külön webhook endpointok, külön Product/Price objektumok). A test mode-ban létrehozott `price_...` ID élesben **nem fog működni**.

---

## 6. Hogyan működjön deploy után

### 6.1 Webhook endpoint élesben

1. Hozz létre egy **második, külön Webhook endpoint-ot** a Stripe Dashboardban, de most **Live mode**-ban (a bal felső kapcsolóval válts át), ugyanazokkal a 3 eseménnyel (2. pont), az URL pedig a tényleges production API domain + `/subscription/webhook` (pl. `https://api.crewflow.com/subscription/webhook`).
2. Ez egy **másik** `whsec_...` secret-et fog adni, mint a test mode endpoint — ezt kell betenni a **production environment** változói közé (nem a helyi `.env`-be — abba a hosting platform saját env var kezelőjébe: pl. Vercel/Render/Railway/Fly.io "Environment Variables" panelje, vagy a szerver gépén egy production `.env`, amit **nem** verziókezelünk).
3. Ugyanide kell a live `STRIPE_SECRET_KEY` (`sk_live_...`) és egy live módban létrehozott `STRIPE_PRICE_ID` (a `stripe:setup` script live kulccsal futtatva újra létrehozza a Product+Price-t live módban is).
4. Az `APP_URL` env var-t is a production frontend URL-jére kell állítani (ez adja a Checkout `success_url`/`cancel_url` és a Billing Portal `return_url` alapját — lásd [server/src/routes/subscription.routes.ts:11-13](server/src/routes/subscription.routes.ts)).

### 6.2 Technikai feltételek, amik gyakran elcsúsznak deploy-nál

- **A raw body middleware sorrendje kritikus.** Az `index.ts`-ben a webhook route-nak **az `express.json()` előtt** kell lennie ([server/src/index.ts:27](server/src/index.ts)), különben a JSON parser már elfogyasztja a body-t, és a Stripe aláírás-ellenőrzés (`stripe.webhooks.constructEvent`) mindig hibázni fog, mert nem a nyers bájtokat kapja. Ha a deploy platform (pl. egy API gateway, reverse proxy, vagy serverless wrapper) **saját body parsingot** végez a kódunk előtt, ugyanez a probléma jöhet elő ott is — ellenőrizni kell, hogy a raw body épségben ér-e el az Express alkalmazásig.
- **HTTPS kötelező.** A Stripe csak `https://` URL-re küld élesben webhookot (test mode-ban a CLI-forward kivétel, mert az nem nyilvános interneten megy).
- **A válasznak gyorsan 2xx-nek kell lennie.** A jelenlegi handler ezt teljesíti (egyszerű DB update, nincs benne lassú külső hívás) — ha a jövőben email küldést vagy egyéb lassú műveletet adnál a webhookhoz, azt **a 2xx válasz elküldése után** (pl. egy háttér worker-rel) érdemes elindítani, mert a Stripe időtúllépés esetén újraküldi az eseményt, és duplikált feldolgozás történhet.
- **Stripe újraküldési (retry) logika**: ha a végpont nem 2xx-szel válaszol, a Stripe automatikusan újrapróbálja (exponenciális backoff-fal, órákon át). Ez azt jelenti, hogy átmeneti DB-hiba esetén nem vész el az esemény — de duplikált eseményt is kaphatsz, ha a Stripe nem kapja meg időben a válaszodat, miközben a feldolgozás már megtörtént. A jelenlegi kód (a `Company.update` mindig a legutóbbi Stripe-állapotot írja felül) ez ellen természeténél fogva védett (idempotens — ugyanazt az eseményt kétszer feldolgozva ugyanaz lesz a végeredmény), tehát nincs szükség extra dedup logikára.
- **Monitorozás**: a Stripe Dashboard → Developers → Webhooks → (endpoint) oldalon látod minden egyes kézbesítési kísérlet státuszát és válaszát — ha élesben valami nem frissül (pl. egy ügyfél fizet, de a `plan` nem vált `"pro"`-ra), ez az első hely, ahol ellenőrizni kell, hogy a Stripe egyáltalán eljutott-e a végpontig, és mit válaszolt rá a szerver.
- **Titokkezelés**: éles `STRIPE_SECRET_KEY` és `STRIPE_WEBHOOK_SECRET` **soha** ne kerüljön git-be, log fájlba, vagy chat-be. A `server/.gitignore` már tartalmazza a `.env`-et — ez élesben is így marad, a production secret-eket a hosting platform saját, titkosított env var tárolójába kell tölteni.

---

## 7. Gyors checklist

- [ ] Stripe Dashboard → Webhooks → Add endpoint (test mode, helyi teszthez ezt kihagyhatod, ha csak CLI-vel dolgozol)
- [ ] 3 esemény kiválasztva: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
- [ ] Helyi tesztelés: `stripe login` → `stripe listen --forward-to localhost:5000/subscription/webhook`
- [ ] A `stripe listen` által kiírt `whsec_...` bekerült a `server/.env` `STRIPE_WEBHOOK_SECRET` változójába
- [ ] `stripe trigger checkout.session.completed` vagy valódi böngészős checkout teszt kártyával (`4242 4242 4242 4242`) lefutott, és a `GET /subscription` válasz frissült
- [ ] Deploy előtt: külön **live mode** webhook endpoint létrehozva a tényleges production domainre
- [ ] Production env vars: live `STRIPE_SECRET_KEY`, live `STRIPE_WEBHOOK_SECRET` (a live endpointból), live `STRIPE_PRICE_ID`, helyes `APP_URL`
- [ ] Ellenőrizve, hogy a raw-body middleware sorrend megmaradt a production build/deploy után is
- [ ] Stripe Dashboard webhook delivery log ismert hely, ahova hiba esetén nézni kell
