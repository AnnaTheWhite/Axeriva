# Axeriva — Notification & Email rendszer: architektúra és fejlesztési terv

*Készült: 2026-08-01. Státusz: **TERV — implementáció nem kezdődött el.**
Széria-jelölés: **N1.x** (a meglévő S/C/K/B/P sorozatok mintájára).
Módszer: a jelenlegi kódbázis teljes feltérképezése (email-réteg, esemény- és
háttérmunka-infrastruktúra, adatmodell, multi-tenancy, meglévő
notification-specifikációk) + külső technológiai kutatás (pg-boss vs BullMQ,
React Email, Resend) hivatalos forrásokból.*

---

## 0. Vezetői összefoglaló

A rendszer **egy Notification modul**, amelyben az email csak az első csatorna.
A mag egy csatorna-független orchestrátor: a domain kód *eseményt* jelent be
(„trial 3 nap múlva lejár"), a modul dönti el, **kinek**, **milyen
csatornán**, **milyen nyelven** és **mikor** megy ki, majd végigköveti a
kézbesítést a szolgáltatói visszajelzésig.

**A nyolc legfontosabb döntés, amit jóvá kell hagynod:**

| # | Döntés | Indok |
|---|---|---|
| D1 | **pg-boss** a queue (nem BullMQ) | Nincs Redis; a pg-boss a meglévő PostgreSQL-t használja, és **egyben megoldja az ütemezést is**, ami ma teljesen hiányzik. Ára: Node ≥ 22.12 kikötése. Részletes összevetés: 12. szakasz. |
| D2 | **Transactional outbox**: a `NotificationEvent` sor a domain-tranzakcióban íródik | Így egy webhook/route soha nem veszíthet értesítést crash esetén, és a Prisma 6 → 7 upgrade elkerülhető. |
| D3 | **A `NotificationType` és a template-ek kódban élnek, nem DB-táblában** | A repó kimondott elve: „commercial changes live in registries… **Adding a feature = append a key. Never a migration.**" A DB-alapú template-tábla csak akkor indokolt, ha a bérlők maguk szerkeszthetnék a szövegeket — ez nincs a célok között. |
| D4 | **Új `NotificationPreference` tábla**, a `Company` három meglévő kapcsolója pedig **globális kill-switch** marad | A három boolean ma **halott konfiguráció** — semmilyen küldő út nem olvassa. A terv az első, ami tiszteletben tartja őket. |
| D5 | **Backend i18n bevezetése** `hu`/`en` katalógusokkal + **új `User.language` oszlop** | Ma a backendnek nulla i18n-je van, minden email angol, és nincs megbízható nyelv-jelzés (a `Company.language` írható, de szerveroldalon soha nem olvassuk). |
| D6 | **Kötelező vs. opcionális kategóriák** szétválasztása | Biztonsági és számlázási értesítésekről nem lehet leiratkozni (jogi és üzemeltetési okból); marketing/digest opt-out-olható. |
| D7 | **A trial-emlékeztetőkhöz napi ütemezett sweep kell** | A trial lejárta ma **nem generál semmilyen eseményt** (tisztán származtatott állapot). A `subscription-ux-billing-flow.md` §13 által ígért 7/3/1 napos emlékeztetőknek nincs időforrása. |
| D8 | **Az `invoice.*` Stripe-események felvétele** a webhookba | A §13 mátrix öt sora (Payment Failed/Successful, Subscription Renewed, Invoice Paid/Failed) ma **nem rendelkezik triggerrel** — ma csak 3 eseménytípust dolgozunk fel. |

---

## 1. Kiindulási állapot — mit találtam a kódban

Ez a szakasz nem háttérinformáció: a terv minden későbbi döntése ezekre a
mért tényekre épül.

### 1.1 A mai email-réteg

| Tény | Következmény a tervre |
|---|---|
| `server/src/services/email/` — interfész + `ResendEmailService` + `MockEmailService`, 5 metódus (`sendInvitationEmail`, `sendWelcomeEmail`, `sendVerificationEmail`, `sendPasswordResetEmail`, `sendSubscriptionConfirmedEmail`) | Az interfész **pozicionális primitíveket** vesz át (`to`, `link`, `companyName`) — nincs locale, nincs companyId, nincs attachment. Új, általános `send(message)` felület kell; a régi 5 metódus migrálható adapterként. |
| Template-ek: TS-függvények, template literállal HTML-t adnak vissza (`templates/layout.ts` → `emailLayout()`, `ctaButton()`) | Van már **layout + CTA primitív** — a React Email BaseLayout ennek a vizuális örököse (sötét fejléc `#0f172a`, kártya, `Axeriva` wordmark). |
| **Minden szöveg angol.** Nulla i18n a backenden. | D5: teljes backend i18n-réteg kell. |
| A küldés **fire-and-forget** minden hívási helyen (`.catch(console.error)`), egy kivétellel (`resend-verification` awaited) | A „soha ne buktassa el a business műveletet" konvenció helyes — de ma **a hiba elveszik**. A queue ezt orvosolja: az enqueue gyors és megbízható, a küldés retry-olható. |
| `resend ^6.14.0` már telepítve; `RESEND_API_KEY`/`RESEND_FROM_EMAIL` production-kötelező | A transport adott, a domain (`axeriva.com`) SPF/DKIM-mel verifikálva (`production-checklist.md`). |
| **Nincs semmilyen retry, queue vagy ütemezés** | A modul teljes háttér-infrastruktúrája új. |

### 1.2 Esemény- és háttérmunka-infrastruktúra

- **Stripe-webhook**: pontosan **3** eseménytípus (`checkout.session.completed`,
  `customer.subscription.updated`, `customer.subscription.deleted`);
  `ProcessedStripeEvent` idempotencia-ledger; friss-lekérés az esemény
  pillanatképe helyett; stale-event guardok. **Ezt a mintát a Resend-webhook
  1:1-ben örökli.**
- **`stripe-webhook-production-readiness.md`** kimondja: *„ha a jövőben email
  küldést vagy egyéb lassú műveletet adnál a webhookhoz, azt a 2xx válasz
  elküldése után (pl. egy háttér worker-rel) érdemes elindítani"* — a terv
  pontosan ezt valósítja meg.
- **`AuditLog`** a meglévő append-only log-precedens: `action` string,
  `metadata` **JSON-string** (nem `Json` típus), `logAudit()` soha nem dob.
- **Deployment**: egyetlen Render Web Service (`prisma migrate deploy && node
  dist/index.js`) + egy Static Site. **Nincs worker service, nincs Render Cron
  Job.** Fizetős instance (perzisztens disk), tehát nem alszik el.
- **Nincs SIGTERM-kezelés, nincs graceful shutdown.** Egy redeploy ma
  félbevágja a futó munkát — a worker bevezetése ezt **kötelezővé teszi**.
- **`app.ts` import-mellékhatás-mentes** (a Supertest emiatt tud rá mountolni);
  minden egyszer-per-process indítás az `index.ts`-ben él. A worker bootstrap
  helye tehát az `index.ts`.

### 1.3 Adatmodell és multi-tenancy

- Konvenciók: `id Int @id @default(autoincrement())`; **nincs egyetlen Prisma
  enum sem** (string + `constants/*.ts` validáció, hogy a bővítés ne migráció
  legyen); JSON = `String?` + `JSON.stringify`; append-only modelleken **nincs
  `updatedAt`**; indexek **additívak, soha nem constraint-ek**; új modelleken a
  `companyId Int` **kötelező** (nem opcionális).
- Tenant-scope: **nincs tenant-middleware**, `companyScope(req)` /
  `resolveCompanyId(req)` per-query. Cross-tenant olvasás **404**, nem 403.
- `tenantWrite = [authMiddleware, blockWritesWhenReadOnly]` — egy új router
  ezen keresztül mountolva **automatikusan** örökli a read-only védelmet.
- **Az „owner" lekérdezése** ma egyetlen inline minta:
  `prisma.user.findFirst({ where: { companyId, role: BUSINESS_OWNER } })`.
  Nincs `Company.ownerId`, nincs helper. A modulnak sajátot kell adnia.
- ⚠️ **Törölt felhasználók tombstone-olt email-címet kapnak**
  (`deleted+12+1750000000__real@example.com`). Bármely fan-out **kötelezően**
  szűr `active: true`-ra, különben ilyen címre küld.
- `Company.language` létezik, de **szerveroldalon soha nem olvassuk**;
  `User`-en **nincs** nyelv-mező. `Company.timezone` sincs sehol felhasználva.

### 1.4 A `Company` három notification-kapcsolója: halott konfiguráció

`notificationsEnabled`, `emailNotificationsEnabled`,
`desktopNotificationsEnabled` — mindhárom létezik, írható a
`PUT /company/settings`-en, megjelenik a UI-ban… és **egyetlen küldő út sem
olvassa**. A master kapcsoló csak a React `disabled` propon keresztül gátolja a
másik kettőt; az API elfogadja a `{notificationsEnabled:false,
emailNotificationsEnabled:true}` kombinációt is.

**A terv ezt rendezi** (D4): ezek lesznek a *cég szintű* kapcsolók, a
felhasználó szintű finomhangolás pedig az új `NotificationPreference` táblába
kerül.

### 1.5 Amit a meglévő specifikációk már megígértek

A `subscription-ux-billing-flow.md` §13 egy **16 eseményosztályos mátrixot**
tartalmaz (Email / In-app / Banner csatornákkal, Info–Success–Warning–Critical
súlyossággal, eseményenként **pontosan egy elsődleges CTA**-val), plus egy
Topbar-harang notification centert. Ez **jóváhagyott design, sosem épült meg**.
A terv ezzel **konzisztens marad**, három korrekcióval:

1. **`trialEndsAt` nem létezik** — a specifikáció végig erre hivatkozik. A
   valóságban: `subscriptionStatus === "trialing"` + `subscriptionEndsAt`
   (+ `trialConsumedAt` az egyszeri trialhoz).
2. **A trial DB-only**, nincs mögötte Stripe-objektum → a Stripe **soha nem
   küld** trial-eseményt (`trial_will_end` sem).
3. **Öt mátrix-sornak nincs triggere** ma (lásd D8).

---

## 2. Architektúra — rétegek és adatfolyam

```
 ┌─ DOMAIN ─────────────────────────────────────────────────────────┐
 │ auth.routes · invites.routes · stripeWebhook.routes · syncSub…   │
 │ projects.routes · (jövőben: bármi)                               │
 │                                                                   │
 │        notify({ type, companyId, context, dedupeKey })            │
 └───────────────────────────┬──────────────────────────────────────┘
                             │  ugyanabban a Prisma-tranzakcióban
                             ▼
 ┌─ OUTBOX ────────────────────────────────────────────────────────┐
 │ NotificationEvent  (append-only, dedupeKey @unique)              │
 └───────────────────────────┬─────────────────────────────────────┘
                             │  outbox-drainer (pg-boss cron, 10 s)
                             ▼
 ┌─ NOTIFICATION SERVICE ──────────────────────────────────────────┐
 │ 1. registry lookup   NOTIFICATION_TYPES[type]                   │
 │ 2. recipient resolve owner / all users / employee / developer   │
 │ 3. preference gate   company toggles → user prefs → mandatory   │
 │ 4. suppression gate  bounced / complained címek kiszűrése       │
 │ 5. locale resolve    User.language → Company.language → "en"    │
 │ 6. channel fan-out   EMAIL · IN_APP · (PUSH · SMS később)       │
 └───────┬──────────────────────────────────┬──────────────────────┘
         │                                  │
         ▼ (azonnal, DB-írás)               ▼ (job/csatorna)
 ┌─ IN-APP ──────────────┐        ┌─ QUEUE (pg-boss) ─────────────┐
 │ Notification sor      │        │ notify:email · notify:push…   │
 │ (olvasatlan badge)    │        │ retry + backoff + DLQ         │
 └───────────────────────┘        └───────────┬───────────────────┘
                                              ▼
                                  ┌─ EMAIL CHANNEL ───────────────┐
                                  │ render (React Email + locale) │
                                  │ → EmailService.send()         │
                                  │ → Resend (Idempotency-Key)    │
                                  └───────────┬───────────────────┘
                                              ▼
                                  ┌─ NotificationDelivery ────────┐
                                  │ status, providerMessageId,    │
                                  │ attempts, lastError           │
                                  └───────────┬───────────────────┘
                                              ▲
                    Resend webhook (Svix) ─────┘
                    → EmailEvent (delivered/bounced/opened/…)
                    → suppression lista karbantartása
```

**Öt szigorú réteghatár:**

1. A domain kód **kizárólag** a `notify()`-t ismeri — nem tud template-ről,
   csatornáról, Resendről.
2. A Notification Service nem tud arról, **hogyan** megy ki egy csatorna
   üzenete — csak a `NotificationChannel` interfészt hívja.
3. Az Email Channel nem tud arról, **miért** megy ki az üzenet — csak renderel
   és küld.
4. Az `EmailService` (meglévő) tiszta **transport** marad: cím, tárgy, HTML,
   text, attachment, idempotency key. Semmi üzleti logika.
5. A template-ek **tiszta függvények**: props + locale → HTML/text. Nincs
   DB-hozzáférésük.

**Amiért ez így jó:** a Push csatorna hozzáadása = egy új fájl a `channels/`
alatt + egy sor a registryben. A `NotificationService`, a template-ek, a
preferenciák és az API **nem változnak**.

---

## 3. Notification Service (a mag)

### 3.1 A publikus felület

Egyetlen belépési pont, amit a domain kód hív:

```
notify({
  type:       NotificationTypeKey,   // registry-kulcs
  companyId:  number,
  context:    Record<string, unknown>,  // template-változók
  dedupeKey?: string,                // idempotencia (lásd 3.4)
  actorUserId?: number,              // ki váltotta ki (audit)
  tx?:        PrismaTransactionClient // ha domain-tranzakcióban vagyunk
})
```

Nem dob hibát a hívó felé (a `logAudit` mintája szerint) — a hiba a
`NotificationEvent` sorban és a logban marad. A `notify()` egyetlen dolga:
**egy sor beírása**. Minden más aszinkron.

### 3.2 Recipient resolver

A registry minden típusnál megmondja, **kinek** szól:

| Recipient stratégia | Feloldás | Példa típus |
|---|---|---|
| `OWNER` | `user.findFirst({ companyId, role: BUSINESS_OWNER, active: true })` | minden billing |
| `COMPANY_USERS` | `user.findMany({ companyId, active: true })` | `system.company_suspended` |
| `USER` | explicit `userId` a contextben | `auth.password_changed` |
| `EMAIL` | nyers cím (még nincs User-sor) | `auth.invitation`, `auth.verify_email` |
| `EMPLOYEE` | `employee → user`, ha van login | `projects.project_assigned` |
| `DEVELOPER` | platform-operátor(ok) | `ops.webhook_error` |

**Kötelező szűrők minden stratégiánál:** `active: true`,
`company.active: true`, és tombstone-védelem (a `deleted+…__` prefixű címek
kizárása) — lásd 1.3.

### 3.3 Preferencia- és suppression-kapu

Sorrend (az első „nem" megállítja a láncot):

```
1. NotificationType.mandatory === true?  → ÁTENGED (biztonság/jog: nem letiltható)
2. Company.notificationsEnabled === false → BLOKK (globális kill-switch)
3. Company.emailNotificationsEnabled === false és csatorna = EMAIL → BLOKK
4. NotificationPreference (user × category × channel) → enabled?
5. EmailSuppression (bounced/complained) tartalmazza a címet? → BLOKK
6. → KÜLDÉS
```

Minden blokkolás **rögzül** a `NotificationDelivery` sorban
(`status = "suppressed"`, `suppressionReason`) — így megválaszolható a
„miért nem kapta meg?" kérdés, ami support-szempontból a legdrágább.

### 3.4 Idempotencia — a `dedupeKey`

Ez a terv gerince. A `NotificationEvent.dedupeKey` **unique** — a második
beszúrás P2002-vel elbukik és csendben eldobódik. Formátum:

```
<type>/<scope-id>/<discriminator>
```

| Eset | dedupeKey | Mit garantál |
|---|---|---|
| Stripe-webhook | `billing.subscription_created/evt_1P…` | Az esemény újrakézbesítése nem küld második emailt (a meglévő AC16 garancia kiterjesztése) |
| Trial-emlékeztető | `billing.trial_ending/42/3d` | A napi sweep bármennyiszer futhat: cégenként és küszöbönként **pontosan egy** email. Ez a `subscription-ux-billing-flow.md:554` által előírt „last reminder sent marker" — külön oszlop nélkül. |
| Deadline-emlékeztető | `projects.deadline/proj_17/2026-08-05` | Napi sweep, projektenként egy |
| Jelszó-reset | *(nincs dedupe)* | Szándékosan újraküldhető |

**Ez oldja meg a „hol a marker?" kérdést**: a marker maga az esemény-tábla
unique indexe.

---

## 4. Email Service (transport)

A meglévő `services/email/` megmarad, de **szűkül**: tiszta transport lesz,
üzleti logika nélkül.

### 4.1 Új interfész

A jelenlegi 5 pozicionális metódus helyett egy általános:

```
send(message: OutboundEmail): Promise<{ providerMessageId: string }>

OutboundEmail = {
  to, subject, html, text,
  replyTo?, cc?, bcc?,
  attachments?: { filename, content|path, contentId? }[],
  idempotencyKey: string,      // = a pg-boss job id
  tags: { name, value }[],     // companyId, type, env — max 256 kar./mező
  headers?: Record<string,string>  // List-Unsubscribe
}
```

A régi 5 metódus **vékony adapterként** megmarad a migráció idejére, majd
törlődik (a hívási helyek átállnak a `notify()`-ra).

### 4.2 Resend-specifikus szabályok (mind hivatalos dokumentációból)

| Szabály | Miért |
|---|---|
| `Idempotency-Key` = **a pg-boss job id** | A queue at-least-once retryjait végponttól végpontig biztonságossá teszi. ⚠️ **A kulcs 24 óra után lejár** — a teljes retry-ablak (retryLimit × maxDelay) ezért **jóval 24 óra alatt** kell maradjon. |
| `409 concurrent_idempotent_requests` → **retryable** | Ugyanaz a kulcs épp fut; később sikerül. |
| `409 invalid_idempotent_request` → **permanens** (DLQ) | Ugyanaz a kulcs más payloaddal = programhiba, retry nem segít. |
| `429` → retry, `retry-after` figyelembevételével | A Resend limit **10 req/s per team**. Napi pár száz emailnél (~0,005 req/s átlag) ez nem szűk keresztmetszet, de burst esetén (pl. cég-szintű fan-out) igen. |
| `daily_quota_exceeded` / `monthly_quota_exceeded` → **hosszú halasztás + riasztás** | Órákig értelmetlen retryzni. |
| Attachment: **40 MB/email, base64 után** | PDF-számlánál ~30 MB valós bájt a plafon. |
| **A batch endpoint nem támogat attachmentet** | A PDF-es számlaértesítők nem batchelhetők. |
| Tracking (open/click) a **tranzakciós** aldomainen **ki** | URL-átírás + tracking pixel rontja a kézbesíthetőséget és adatvédelmileg is kérdéses jelszó-resetnél. |

### 4.3 PDF-számla támogatás

**A Stripe már generál számlát** (`always_invoice` az upgrade-eknél) és ad
hozzá hosztolt URL-t + PDF-linket. Két lehetőség:

| Megoldás | Mikor |
|---|---|
| **(A) Link a Stripe hosztolt PDF-jére** — *ajánlott v1-re* | `invoice.paid` webhookban jön az `invoice.invoice_pdf` és `hosted_invoice_url`. Nincs letöltés, nincs tárolás, nincs 40 MB-os limit, nincs GDPR-kérdés. A gomb a Stripe hitelesített oldalára visz. |
| **(B) Csatolt PDF** | Ha üzletileg kötelező a levélben a számla: a worker letölti az `invoice_pdf`-et, base64-eli, csatolja. Ára: a worker kimenő HTTP-hívása, méret-ellenőrzés, és a PDF átmeneti memóriában/diszken tartása. |

A terv **(A)-t javasolja**, (B)-t az architektúra támogatja (az
`OutboundEmail.attachments` mező már benne van), de nem v1 scope.

---

## 5. Template rendszer (React Email)

### 5.1 Struktúra

```
server/src/emails/
├─ components/
│  ├─ BaseLayout.tsx        ← <Html lang> <Head> color-scheme, <Body>, kártya
│  ├─ Header.tsx            ← logó (cég-branding vagy Axeriva fallback)
│  ├─ Footer.tsx            ← jogi sor, cégadatok, unsubscribe (ha opcionális)
│  ├─ CtaButton.tsx         ← EGY elsődleges CTA (a §13 szabálya)
│  ├─ InfoRow.tsx           ← címke/érték sor (számlaadatok, csomagváltás)
│  └─ theme.ts              ← színek, tipográfia, spacing (a mai layout.ts örököse)
├─ templates/
│  ├─ auth/                 ← welcome, verifyEmail, passwordReset, passwordChanged
│  ├─ billing/              ← trialStarted, trialEnding, subscriptionCreated, …
│  ├─ system/               ← companySuspended, companyReactivated
│  ├─ projects/             ← projectAssigned, deadlineReminder
│  └─ employees/            ← invitation, employeeAdded
├─ render.ts                ← render(type, locale, props) → {subject, html, text}
└─ preview/                 ← dev-only: minden template minden locale-on
```

### 5.2 BaseLayout — mit old meg

| Elem | Megvalósítás |
|---|---|
| **Header** | Cég-logó, ha a `Company.logoUrl` ki van töltve (a branding mezők **kifejezetten ezért készültek** — `project-overview.md`), különben Axeriva wordmark. |
| **Branding** | `Company.primaryColor` / `accentColor` a CTA-gombra és az akcentusokra. ⚠️ **Kontraszt-ellenőrzés kell** — egy világos brandszín fehér gombszövegen olvashatatlan; fallback a mai narancs. |
| **Footer** | Cégnév, jogi sor, „miért kaptad ezt" magyarázat, és **opcionális** kategóriánál leiratkozó link. |
| **CTA** | Pontosan **egy** elsődleges gomb (a §13 kikötése), plusz a nyers URL szövegként (kliensek, amik nem kattinthatók). |
| **Localization** | `<Html lang={locale} dir="ltr">` — ⚠️ a React Email doksi kifejezetten kéri, hogy **a `Body`-ra is** kerüljön ugyanaz, mert egyes kliensek levágják a `html` taget. |
| **Dark mode** | `<meta name="color-scheme" content="light dark">` + `prefers-color-scheme` blokk. ⚠️ **Őszintén: a React Emailnek nincs hivatalos dark-mode támogatása vagy útmutatása.** Apple Mail / Outlook.com tiszteletben tartja, a **Gmail viszont saját színinvertálást** végez. Gyakorlati szabály: soha ne használjunk tiszta `#ffffff`/`#000000`-t, minden konténeren legyen explicit `background-color`, a logó átlátszó hátterű PNG legyen. **Teljes dark-mode paritást nem ígérünk** — valós kliens-tesztelés kell (Litmus/Email on Acid). |

### 5.3 Lokalizáció a template-ekben

A React Emailnek **nincs saját i18n primitívje** — a dokumentált minta a
props-alapú: `locale` prop + üzenet-katalógus + `t()`.

```
server/src/i18n/
├─ index.ts        ← t(locale, key, vars) — {{var}} interpoláció (a frontend engine mintájára)
├─ en/notifications.json
└─ hu/notifications.json
```

**Kulcs-konvenció** a frontend mintájára: `notifications.billing.trialEnding.subject`,
`…​.heading`, `…​.body`, `…​.cta`. A tárgysor is a katalógusból jön.

⚠️ **A Tailwind-komponens context-gotchája**: ha i18n-providert használnánk,
annak **a `<Tailwind>` fölött** kell lennie. A terv ezt elkerüli: a template
nem providert használ, hanem **előre feloldott stringeket** kap propként —
egyszerűbb, tesztelhetőbb, és a worker-kontextusban (ahol nincs request)
természetesebb.

### 5.4 Technikai előfeltételek (őszintén: ez nem nulla költség)

| Előfeltétel | Részlet |
|---|---|
| `server/tsconfig.json` → `"jsx": "react-jsx"` | Ma **nincs `jsx` beállítás** — egyetlen `.tsx` sem fordul le. |
| `react` + `react-dom` a szerver **`dependencies`-be** | A `render()` futásidőben a React DOM szerver-renderelőjét hívja. `@types/react` devDependency. |
| React Email **6.x**: minden a `react-email` csomagból importálódik | A 6.0.0 (2026-04) összevonta a csomagokat; a `@react-email/components`-es tutorialok elavultak. |
| CommonJS kompatibilitás | A `react-email@6` **dual export map**-et ad (`require` → `.cjs`), tehát a jelenlegi CommonJS build működik. |
| `render()` **async** | A worker `await`-el, nem gond. |
| Plain-text változat | `toPlainText(html)` vagy `render(..., { plainText: true })`. **Minden emailhez kötelező** (a mai template-ek is adnak `text`-et). |

---

## 6. Notification Types — a katalógus

**Registry, nem tábla** (D3). Egy bejegyzés minden metaadatot hordoz:

```
NOTIFICATION_TYPES = {
  "billing.trial_ending": {
    category:   "billing",
    severity:   "warning",
    mandatory:  false,
    recipients: "OWNER",
    channels:   ["EMAIL", "IN_APP"],
    template:   "billing/trialEnding",
    cta:        { key: "choosePlan", path: "/subscription" },
  }, …
}
```

### 6.1 Authentication (mind **mandatory** — biztonsági, nem letiltható)

| Kulcs | Címzett | Csatorna | Trigger ma | Template |
|---|---|---|---|---|
| `auth.welcome` | EMAIL | Email | ✅ `auth.routes` register | migrálandó |
| `auth.verify_email` | EMAIL | Email | ✅ register + resend | migrálandó |
| `auth.password_reset` | EMAIL | Email | ✅ forgot-password | migrálandó |
| `auth.password_changed` | USER | Email + In-app | ❌ **új** — reset-complete után | új |
| `auth.new_device_login` | USER | Email | ❌ **új, opcionális** (P2) | új |

### 6.2 Billing (a §13 mátrix teljes lefedése)

| Kulcs | Súlyosság | Trigger | Ma létezik? |
|---|---|---|---|
| `billing.trial_started` | info | regisztráció (T1) | ❌ új |
| `billing.trial_ending` (7/3/1 nap) | info→warning→critical | **napi sweep** (D7) | ❌ nincs időforrás |
| `billing.trial_expired` | critical | napi sweep | ❌ nincs időforrás |
| `billing.subscription_created` | success | `checkout.session.completed` | ✅ *(az egyetlen mai billing email)* |
| `billing.subscription_renewed` | success | `invoice.paid` | ❌ **esemény nincs feliratkozva** |
| `billing.plan_upgraded` | success | `customer.subscription.updated` (tier ↑) | ⚠️ esemény van, email nincs |
| `billing.plan_downgrade_scheduled` | info | `POST /change-plan` → `downgrade_scheduled` | ⚠️ |
| `billing.plan_downgraded` | info | `customer.subscription.updated` (fázisváltás) | ⚠️ |
| `billing.subscription_cancelled` | warning | `POST /cancel` | ⚠️ |
| `billing.subscription_resumed` | success | `POST /resume` | ⚠️ |
| `billing.subscription_ended` | critical | `customer.subscription.deleted` | ⚠️ |
| `billing.invoice_paid` | success | `invoice.paid` | ❌ |
| `billing.invoice_failed` | critical | `invoice.payment_failed` | ❌ |
| `billing.payment_failed` | critical | `customer.subscription.updated` → `past_due` | ⚠️ |
| `billing.card_expiring` | warning | `invoice.upcoming` v. `payment_method.updated` | ❌ |
| `billing.payment_method_updated` | info | `payment_method.attached` | ❌ |

**Kötelező-e a billing?** Javaslat: **igen, mandatory** — a fizetési
problémáról szóló értesítés kikapcsolása a felhasználó saját kárára válna
(read-only mód figyelmeztetés nélkül). A „Payment Successful"/„Invoice Paid"
típusú *nyugtázó* levelek viszont opcionálisak lehetnek.

### 6.3 System / Employees / Projects

| Kulcs | Címzett | Trigger |
|---|---|---|
| `system.company_activated` | OWNER | admin művelet — ❌ új |
| `system.company_suspended` | COMPANY_USERS | `companyArchive` / admin — ⚠️ |
| `system.company_reactivated` | COMPANY_USERS | admin — ❌ új |
| `employees.invitation` | EMAIL | ✅ `POST /invites` |
| `employees.employee_added` | OWNER | invite elfogadás — ❌ új |
| `employees.access_revoked` | USER | ✅ audit-esemény létezik, email nincs |
| `projects.project_assigned` | EMPLOYEE | `ProjectAssignment` create — ❌ új |
| `projects.deadline_reminder` | OWNER + hozzárendeltek | **napi sweep** a `Project.deadline` / `Task.dueDate` / `Reminder.dueDate` mezőkre — ❌ új |

⚠️ A `Reminder` modell séma-kommentje ma kimondja: *„Notification delivery
(push/PWA) is a future extension point; this only stores the reminder itself."*
**Ez a modul az a kiterjesztési pont** — a napi sweep végre kézbesíti őket.

### 6.4 Ops (soha nem ügyfél felé)

| Kulcs | Címzett | Trigger |
|---|---|---|
| `ops.webhook_error` | DEVELOPER | webhook DLQ-ba került esemény |
| `ops.delivery_failure_spike` | DEVELOPER | bounce/complaint arány küszöb felett |
| `ops.duplicate_subscription` | DEVELOPER | a Design C `manualRefundRequired` audit-bejegyzés |

### 6.5 Jövőbeli AI-értesítések (csak a kiterjesztési pont)

Az `ai.*` névtér fenntartva (`ai.weekly_insight`, `ai.anomaly_detected`).
Ezek **digest-jellegűek**, tehát opt-in kategóriába kerülnek, és a
digest-aggregátoron mennek át (7.3) — nem eseményenként.

---

## 7. Notification Preferences

### 7.1 A háromszintű modell

```
Szint 1 — CÉG (meglévő Company oszlopok, végre kikényszerítve)
   notificationsEnabled          globális kill-switch
   emailNotificationsEnabled     email csatorna ki/be
   desktopNotificationsEnabled   push csatorna ki/be (előkészítés)

Szint 2 — CÉG-ALAPÉRTELMEZÉS kategóriánként (owner állítja)
   NotificationPreference (userId = NULL, companyId = X)

Szint 3 — FELHASZNÁLÓ (saját felülbírálás)
   NotificationPreference (userId = Y)
```

Feloldás: **user-sor → cég-alapértelmezés → registry-alapérték**. A `mandatory`
kategóriák minden szintet felülírnak.

### 7.2 Kategóriák

| Kategória | Letiltható? | Tartalom |
|---|---|---|
| `security` | **Nem** | jelszó, belépés, hozzáférés-visszavonás |
| `billing` | **Nem** (a kritikusak) | trial, fizetés, csomagváltás |
| `billing_receipts` | Igen | sikeres fizetés, számla-nyugta |
| `projects` | Igen | hozzárendelés, határidő |
| `employees` | Igen | meghívás elfogadva, új munkatárs |
| `digest` | Igen (alap: **ki**) | heti összefoglaló |
| `marketing` | Igen (alap: **ki**, opt-in) | termékhírek |
| `ops` | — | csak DEVELOPER, nem konfigurálható |

⚠️ **Jogi megjegyzés:** a marketing kategória az egyetlen, ami valódi
opt-in-t igényel, és **kötelező** hozzá a `List-Unsubscribe` +
`List-Unsubscribe-Post` fejléc (RFC 8058 egykattintásos leiratkozás). A
tranzakciós levelek ez alól dokumentáltan mentesülnek.

### 7.3 Digest (aggregálás)

A `digest` kategóriájú típusok nem küldenek azonnal: a
`NotificationDelivery` `status = "queued_for_digest"` állapotba kerül, és egy
heti ütemezett job egyetlen levélben összesíti őket. **Ez az egyetlen
védelem a notification fatigue ellen**, amit a §13 kockázati tábla is
nevesít.

---

## 8. Database — Prisma modellek

**Konvenciók, amiket követek** (a repó meglévő gyakorlata alapján):
`Int autoincrement` id; **nincs Prisma enum** (string + `constants/`
validáció); JSON = `String?`; append-only modelleken **nincs `updatedAt``;
`companyId Int` kötelező; index-kommentek a kiszolgált lekérdezéssel;
`@@index` additív, soha nem `@unique` meglévő adaton.

### 8.1 `NotificationEvent` — az outbox és az esemény-napló

| Mező | Típus | Megjegyzés |
|---|---|---|
| `id` | `Int @id @default(autoincrement())` | |
| `type` | `String` | registry-kulcs, pl. `billing.trial_ending` |
| `companyId` | `Int` + reláció | tenant-scope |
| `dedupeKey` | `String @unique` | **az idempotencia gerince** (3.4) |
| `context` | `String?` | JSON-string (AuditLog-minta) |
| `actorUserId` | `Int?` | **scalar, nem reláció** (AuditLog-minta: túléli a user törlését) |
| `status` | `String @default("pending")` | `pending` → `fanned_out` → `failed` |
| `processedAt` | `DateTime?` | |
| `createdAt` | `DateTime @default(now())` | |

Indexek: `@@index([status, createdAt])` (az outbox-drainer lekérdezése),
`@@index([companyId, createdAt])` (admin-nézet).

### 8.2 `Notification` — in-app értesítés (a harang mögötti feed)

| Mező | Típus |
|---|---|
| `id`, `companyId` (+reláció), `userId` (**Int, scalar**) | |
| `eventId` | `Int` + reláció a `NotificationEvent`-re |
| `type`, `severity`, `title`, `body` | `String` — **renderelt, lokalizált szöveg** |
| `ctaLabel`, `ctaPath` | `String?` — egy CTA (§13) |
| `readAt` | `DateTime?` |
| `createdAt` | `DateTime @default(now())` |

Index: `@@index([userId, readAt])` — az olvasatlan badge lekérdezése;
`@@index([companyId, createdAt])`.

⚠️ **Miért tárolt és nem származtatott?** A §13.2 „derived v1"-et javasolt,
de a shipped modellben ez nem működik: nincs `trialEndsAt`, nincs
olvasott/olvasatlan állapot, és az egyszeri események (pl. *Downgrade
Scheduled*) nem rekonstruálhatók az aktuális állapotból. A
`subscription-system-design.md` maga adja meg a kiskaput: *„a
`SubscriptionEvent` history table can be added additively later"*.

### 8.3 `NotificationDelivery` — csatornánkénti kézbesítési rekord

| Mező | Típus | Megjegyzés |
|---|---|---|
| `id`, `eventId` (+reláció), `companyId` | | |
| `channel` | `String` | `EMAIL` \| `IN_APP` \| `PUSH` \| `SMS` |
| `recipientUserId` | `Int?` | |
| `recipientAddress` | `String` | email/telefon/device-token — **maszkolva logolva** |
| `locale` | `String` | amivel renderelt |
| `status` | `String @default("pending")` | `pending` → `sent` → `delivered` \| `bounced` \| `failed` \| `suppressed` |
| `suppressionReason` | `String?` | `company_toggle` \| `user_preference` \| `suppression_list` — **ez válaszolja meg a „miért nem kapta meg?" kérdést** |
| `providerMessageId` | `String?` | Resend id — a webhook join-kulcsa |
| `attempts` | `Int @default(0)` | |
| `lastError` | `String?` | |
| `sentAt`, `deliveredAt` | `DateTime?` | |

Indexek: `@@index([providerMessageId])` (webhook-feloldás),
`@@index([companyId, status, createdAt])`, `@@index([status])` (retry/monitoring).

### 8.4 `EmailEvent` — nyers szolgáltatói események

| Mező | Típus |
|---|---|
| `id` | `String @id` — **a Svix esemény-id** (a `ProcessedStripeEvent` mintája: külső azonosító = PK, egyben idempotencia) |
| `deliveryId` | `Int?` + reláció (a `providerMessageId`-n keresztül feloldva) |
| `type` | `String` — `email.delivered`, `email.bounced`, … |
| `payload` | `String` — JSON-string |
| `occurredAt`, `receivedAt` | `DateTime` |

⚠️ A Resend **19 eseménytípust** küld (nem 7). Külön figyelendő: `email.sent`
= *„az API-hívás sikeres volt"*, **nem** kézbesítés — a felhasználónak soha
ne mutassuk „kézbesítve"-ként. Az `email.failed`, `email.suppressed` és a
`suppression.*` pár a bounce-kezelés alapja.

### 8.5 `NotificationPreference`

| Mező | Típus |
|---|---|
| `id`, `companyId` (+reláció) | |
| `userId` | `Int?` — **NULL = cég-alapértelmezés** |
| `category` | `String` |
| `channel` | `String` |
| `enabled` | `Boolean` |
| `createdAt`, `updatedAt` | *(mutable modell → van `updatedAt`)* |

`@@unique([companyId, userId, category, channel])` — ez **új táblán**
biztonságos (a repó „indexek additívak" szabálya meglévő adatra vonatkozik).

### 8.6 `EmailSuppression`

| Mező | Típus |
|---|---|
| `id`, `email` (`String @unique`) | |
| `reason` | `String` — `bounced` \| `complained` \| `manual` |
| `companyId` | `Int?` — ha bérlő-specifikus |
| `createdAt` | |

**Globális kapu minden email előtt.** A `email.bounced` / `email.complained` /
`suppression.added` webhookok töltik.

### 8.7 Amit **nem** javaslok táblának

| Kért modell | Javaslat | Indok |
|---|---|---|
| `NotificationTemplate` | **Kód** (`server/src/emails/templates/`) | Type-safe, review-zható, verziózott a git-tel. DB-tábla akkor kellene, ha a bérlők szerkesztenék a szövegeket — ez nincs a célok között. Escape hatch: `NotificationTemplateOverride` tábla később, additívan. |
| `NotificationType` | **Registry** (`constants/notificationTypes.ts`) | A repó kimondott elve: *„Adding a feature to a plan = append a key. **Never a migration.**"* A `FEATURES` registry a precedens. |
| `EmailQueue` | **pg-boss `job` tábla** + `NotificationDelivery` | Két külön táblában vezetni ugyanazt a munkát duplikált könyvelés és kettős igazságforrás. A **transport-állapot** a pg-bossé, a **domain-állapot** a `NotificationDelivery`-é. |
| `NotificationLog` | `NotificationDelivery` + `EmailEvent` | Ugyanaz az igény, két rétegben: mit próbáltunk (delivery) és mit mondott a szolgáltató (event). |

---

## 9. Event rendszer

### 9.1 A teljes lánc (a kért Stripe-példával)

```
Stripe webhook  POST /subscription/webhook
      │  ① Svix/Stripe aláírás-ellenőrzés (raw body)
      │  ② ProcessedStripeEvent ledger — duplikátum? → 200, kilép
      │  ③ applySubscriptionUpdate()  ─┐
      │  ④ notify({...})              ─┤ EGY Prisma-tranzakcióban
      │                                 └→ NotificationEvent sor (dedupeKey = evt_id)
      │  ⑤ 200 OK  ◄── a válasz NEM várja meg az emailt
      ▼
outbox-drainer (pg-boss cron, 10 mp)
      │  pending eseményekre: recipient + preference + suppression + locale
      ├→ IN_APP:  Notification sor (azonnal, DB)
      └→ EMAIL:   pg-boss job  →  notify:email queue
                        │
                        ▼
              email worker (localConcurrency 2–3)
                 render (React Email + locale) → EmailService.send()
                 → Resend (Idempotency-Key = job id)
                 → NotificationDelivery: sent + providerMessageId
                        │
                        ▼
              Resend webhook  POST /notifications/webhook/resend
                 → EmailEvent + NotificationDelivery.status frissítés
                 → bounce/complaint → EmailSuppression
```

**A ④ lépés a kulcs**: az értesítési szándék ugyanabban a tranzakcióban
rögzül, mint az állapotváltozás. Ha a process a ⑤ előtt meghal, a Stripe
újraküld, a ledger kiszűri a duplikátumot — de ha a tranzakció commitolt, az
esemény **már a DB-ben van**, és a drainer felveszi.

### 9.2 Miért outbox és nem közvetlen enqueue

A pg-boss hivatalos Prisma-adaptere (`fromPrisma()`) **Prisma 7-et igényel**;
a repó Prisma 6.15-ön van. Közvetlen `boss.send()` a tranzakción kívül azt
jelentené: commit megtörtént, de a job elveszett (vagy fordítva). Az outbox
ezt kivédi **Prisma-upgrade nélkül** — és ráadásul ad egy lekérdezhető
esemény-naplót, ami amúgy is kellene.

### 9.3 Ütemezett események (D7)

pg-boss `schedule()`, 5-mezős cron, `tz: "Europe/Budapest"`:

| Job | Cron | Mit csinál |
|---|---|---|
| `sweep:trial-reminders` | `0 8 * * *` | `subscriptionStatus = "trialing"` ÉS `subscriptionEndsAt` a 7/3/1 napos sávban → `notify()` küszöbönkénti dedupeKey-jel |
| `sweep:trial-expired` | `0 8 * * *` | `trialing` + lejárt `subscriptionEndsAt` → egyszeri értesítés |
| `sweep:deadlines` | `0 7 * * *` | `Project.deadline`, `Task.dueDate`, `Reminder.dueDate` a következő 24-48 órában |
| `sweep:card-expiring` | `0 9 * * 1` | Stripe `payment_method` lejárat (ha az `invoice.upcoming` nem elég) |
| `digest:weekly` | `0 8 * * 1` | `queued_for_digest` deliveryk összesítése |
| `maintenance:prune` | `0 3 * * 0` | `EmailEvent` és `ProcessedStripeEvent` retenció (**a ma nyitott, dokumentált növekedési kérdés**) |

⚠️ **A repó „nincs cron" álláspontjával való viszony.** A dokumentált
elutasítás (`launch-blockers-plan.md`) **kifejezetten a GitHub Actions-ben
futó DB-dumpra** vonatkozik, azzal az indokkal, hogy élő production
DB-credential kerülne CI-secretbe. **Ez a terv nem sérti ezt**: az ütemezés
az alkalmazás saját processzében, a meglévő DB-kapcsolattal fut, új
credential-kitettség nélkül. A `read-only-mode.md` „requires no cron"
állítása továbbra is igaz marad — a read-only *kikényszerítése* nem lesz
ütemezéstől függő, csak az *emlékeztetők*.

---

## 10. Stripe integráció — eseményenkénti leképezés

| Stripe esemény | Ma? | Notification | Címzett | Template-adatok |
|---|:--:|---|---|---|
| `checkout.session.completed` | ✅ | `billing.subscription_created` | OWNER | csomagnév, ár, pénznem, következő számlázás, portál-link |
| `customer.subscription.updated` → tier ↑ | ✅ | `billing.plan_upgraded` | OWNER | régi/új csomag, prorált összeg, új limitek |
| `customer.subscription.updated` → fázisváltás | ✅ | `billing.plan_downgraded` | OWNER | új csomag, mely funkciók szűntek meg |
| `customer.subscription.updated` → `past_due` | ✅ | `billing.payment_failed` | OWNER | **türelmi idő magyarázata (AC17)**, Portal-link a kártyához |
| `customer.subscription.updated` → `cancel_at_period_end` | ✅ | `billing.subscription_cancelled` / `_resumed` | OWNER | meddig aktív, Resume-link |
| `customer.subscription.deleted` | ✅ | `billing.subscription_ended` | OWNER | read-only magyarázat, adatmegőrzés, újraaktiválás |
| `invoice.paid` | ❌ **fel kell venni** | `billing.invoice_paid` + `billing.subscription_renewed` | OWNER | összeg, időszak, **`hosted_invoice_url` + `invoice_pdf`** |
| `invoice.payment_failed` | ❌ **fel kell venni** | `billing.invoice_failed` | OWNER | hányadik próbálkozás, mikor a következő, Portal-link |
| `invoice.upcoming` | ❌ **fel kell venni** | `billing.renewal_upcoming` *(opcionális kategória)* | OWNER | összeg, dátum — csökkenti a meglepetés-chargebacket |
| `invoice.created` / `finalized` | ❌ | **nincs email** | — | csak `EmailEvent`-szintű naplózás, ha egyáltalán |
| `payment_method.attached` | ❌ | `billing.payment_method_updated` | OWNER | kártya utolsó 4 jegye, márka |
| `payment_method.automatically_updated` | ❌ | *(nincs)* | — | a hálózat frissítette — nem hír |
| `customer.subscription.trial_will_end` | ❌ | **NEM használható** | — | ⚠️ A trial DB-only, nincs mögötte Stripe-előfizetés → **soha nem fog megérkezni**. A 7/3/1 napos emlékeztető **csak** a saját sweepből jöhet. |

**Két operatív következmény:**

1. **Stripe Dashboard-módosítás kell** — a webhook-végpont ma pontosan 3
   eseményre van feliratkozva; az `invoice.*` és `payment_method.attached`
   hozzáadása Dashboard-művelet (a Design C rolloutjának mintájára külön
   ops-lépés).
2. **A `HANDLED_EVENTS` és a ledger bővül** — minden új típus ugyanazt az
   idempotencia- és stale-guard védelmet kapja, amit a meglévő három.

---

## 11. Logging

Három, egymásra épülő szint:

| Szint | Hol | Mit válaszol meg |
|---|---|---|
| **Esemény** | `NotificationEvent` | „Mi történt, és akartunk-e róla szólni?" |
| **Kézbesítés** | `NotificationDelivery` | „Kinek, milyen csatornán, milyen nyelven, milyen státusszal — és ha nem ment ki, **miért nem**?" |
| **Szolgáltatói** | `EmailEvent` | „Mit mondott a Resend?" (delivered / bounced / complained / opened / clicked) |

**Státusz-életciklus** (`NotificationDelivery.status`):

```
pending ──▶ sent ──▶ delivered
   │          │  └──▶ bounced ──▶ (suppression lista)
   │          └─────▶ complained ──▶ (suppression lista)
   ├──▶ suppressed   (preferencia/toggle/suppression — soha nem hívtuk a Resendet)
   └──▶ failed       (retryk elfogytak → DLQ)
```

- **Retry-szám**: `attempts` a delivery soron (a pg-boss `retryCount`
  tükre) + `lastError`.
- **Opened/Clicked**: az adatmodell **készen áll** rá (`EmailEvent`), de a
  tracking a tranzakciós aldomainen **kikapcsolva** marad (4.2) — csak
  marketing/digest streamen kapcsolható be.
- **Bounce / Spam**: automatikus suppression-listára kerülés + `ops.*`
  riasztás, ha az arány küszöb fölé megy.
- **PII**: a címek a logokban **maszkolva** (`maskEmail` — létező util); a
  DB-ben teljes cím, mert a support-kérdés megválaszolásához kell.

---

## 12. Queue — pg-boss vs BullMQ, és az indoklás

### 12.1 Az összevetés

| Szempont | **pg-boss 12** | BullMQ 6 + Redis | BullMQ 6 + Postgres backend |
|---|---|---|---|
| Új menedzselt szolgáltatás | **nincs** | ⚠️ fizetős Render Key Value (**a free tier nem perzisztens → használhatatlan durable queue-ként**) | nincs |
| Új hibadomain | nincs | ⚠️ a Redis külön dőlhet el | nincs |
| Tartósság | a meglévő PostgreSQL + PITR-backup | külön backup-történet | PostgreSQL |
| **Ütemezés (cron)** | ✅ beépített, tz + óra-eltérés detektálás | ✅ Job Scheduler | ✅ |
| Rate limiting (req/s) | ⚠️ csak konkurencia + throttle | ✅ natív | ✅ |
| Node-verzió | ⚠️ **≥ 22.12** (ESM-only csomag) | ≥ 14.17 | ≥ 14.17 |
| Tranzakciós enqueue Prismával | ⚠️ hivatalos adapter **Prisma 7**-et kér | nem lehetséges (más adattár) | nem tisztázott |
| Admin UI | `@pg-boss/dashboard` (újabb) | Bull Board — ⚠️ **ma BullMQ 5-höz peer-elt** | valószínűleg nem |
| Érettség erre a use case-re | **magas** — ez a kanonikus felhasználása | magas (Redis úton) | ⚠️ v6-ban új, ellenőrizendő |

### 12.2 A döntés: **pg-boss**

**Indoklás — három ok, fontossági sorrendben:**

1. **Egyszerre oldja meg a queue-t és az ütemezést.** A rendszernek napi
   sweepre *mindenképp* szüksége van (trial-emlékeztetők, határidők) — ma
   semmi nem ketyeg. BullMQ-val is megkapnánk, de csak Redis árán; saját
   `setInterval`-lal pedig újraírnánk a leader-electiont, a retryt és a
   backoffot.
2. **Nulla új infrastruktúra.** A repó teljes filozófiája a kevés mozgó
   alkatrész (nincs Redis, nincs Sentry még, egy web service). Egy fizetős
   Key Value instance új dashboard, új alerting, új backup-szemantika és új
   hibadomain — mindezt napi pár száz emailért.
3. **A rate limiting nem érv itt.** A Resend limit 10 req/s; a várt terhelés
   ~0,005 req/s átlag. `localConcurrency: 2–3` + 429-kezelés bőven elég. Ha
   valaha burst-kritikussá válik, ott a migrációs út (12.4).

### 12.3 Két előfeltétel, amit a munka részének tekintek

| Előfeltétel | Teendő |
|---|---|
| **Node ≥ 22.12** | A pg-boss 12 ESM-only, CommonJS-ből csak a `require(esm)` támogatással hívható. `engines` mindkét `package.json`-ban + Render `NODE_VERSION`. *(A CI már Node 22-t pinel — ellenőrizendő, hogy ≥ 22.12.)* |
| **Tranzakciós enqueue** | Outbox-minta (9.2) — így a Prisma 7 upgrade **elkerülhető**. |

**Explicit beállítások** (nem az alapértékekre hagyva):
`pollingIntervalSeconds: 10` (email-latencia toleráns; 5× kevesebb üresjárati
DB-lekérdezés), `retryLimit: 5` + `retryBackoff: true` + `retryDelayMax`
(a teljes ablak **24 óra alatt**, a Resend idempotency-kulcs lejárata miatt),
`deadLetter: "notify:dlq"`, és a `db` opció a **meglévő pool** átadásával,
hogy a `Basic-256mb` Postgres kapcsolat-budget ne nőjön.

### 12.4 Migrációs út, ha kinőjük

A queue **saját interfész mögé kerül** (`enqueue()` / `registerWorker()`) —
route vagy service **soha nem hívja közvetlenül a `boss.send()`-et**. Ez az
egész migrációs költség, előre kifizetve. Ha kell: BullMQ 6 **Postgres
backenddel** (ugyanaz az API, továbbra sincs Redis), onnan pedig egy factory
cseréjével Redisre.

---

## 13. Folder structure

```
server/src/
├─ emails/                          ← React Email template-ek (.tsx)
│  ├─ components/  BaseLayout, Header, Footer, CtaButton, InfoRow, theme
│  ├─ templates/   auth/ billing/ system/ projects/ employees/
│  ├─ render.ts    render(type, locale, props) → {subject, html, text}
│  └─ preview/     dev-only preview minden locale-on
│
├─ i18n/                            ← ÚJ: backend fordítások
│  ├─ index.ts     t(locale, key, vars)
│  ├─ en/notifications.json
│  └─ hu/notifications.json
│
├─ services/
│  ├─ notifications/
│  │  ├─ notify.ts               ← a publikus notify() (outbox-írás)
│  │  ├─ registry.ts             ← NOTIFICATION_TYPES katalógus
│  │  ├─ dispatcher.ts           ← outbox-drainer: recipient→pref→fan-out
│  │  ├─ recipients.ts           ← OWNER / COMPANY_USERS / EMPLOYEE / …
│  │  ├─ preferences.ts          ← 3-szintű feloldás + mandatory
│  │  ├─ suppression.ts          ← bounce/complaint lista
│  │  ├─ locale.ts               ← User.language → Company.language → "en"
│  │  └─ channels/
│  │     ├─ channel.ts           ← NotificationChannel interfész
│  │     ├─ email.channel.ts
│  │     ├─ inApp.channel.ts
│  │     └─ (push.channel.ts · sms.channel.ts — később)
│  │
│  ├─ queue/
│  │  ├─ boss.ts                 ← pg-boss singleton, start/stop
│  │  ├─ enqueue.ts              ← a vékony seam (12.4)
│  │  ├─ workers.ts              ← worker-regisztráció
│  │  └─ schedules.ts            ← cron-definíciók
│  │
│  └─ email/                     ← MEGLÉVŐ, transporttá szűkítve
│     ├─ EmailService.ts         ← új send(OutboundEmail) felület
│     ├─ ResendEmailService.ts
│     └─ MockEmailService.ts
│
├─ routes/
│  ├─ notifications.routes.ts    ← in-app feed + preferenciák
│  └─ resendWebhook.routes.ts    ← Svix-verifikált delivery-események
│
├─ constants/
│  ├─ notificationTypes.ts       ← a registry adatai
│  └─ notificationCategories.ts
│
└─ index.ts                      ← ITT indul a worker + itt a SIGTERM-drain
```

**Frontend** (a §13 által már specifikált felületek):

```
src/
├─ components/notifications/  NotificationBell, NotificationList, NotificationItem
├─ pages/NotificationSettingsPage.tsx     (vagy a Settings egy szekciója)
├─ services/notification.service.ts
└─ context/NotificationContext.tsx        (olvasatlan szám, polling/refetch)
```

---

## 14. API

Minden végpont `tenantWrite`-on keresztül mountolva (auth + read-only
öröklés), `companyScope()` szerint szűrve, cross-tenant esetben **404**.

| Metódus | Útvonal | Szerep | Leírás |
|---|---|---|---|
| `GET` | `/notifications` | minden bejelentkezett | Saját feed, lapozva (`?cursor=&limit=`), `?unreadOnly=true` |
| `GET` | `/notifications/unread-count` | minden | A harang badge száma |
| `POST` | `/notifications/:id/read` | tulajdonos | Egy elem olvasottra |
| `POST` | `/notifications/read-all` | tulajdonos | Összes olvasottra |
| `GET` | `/notifications/preferences` | minden | Feloldott preferenciák (cég + user + registry-alap) |
| `PUT` | `/notifications/preferences` | minden | Saját felülbírálás (allow-list!) |
| `PUT` | `/notifications/preferences/defaults` | BUSINESS_OWNER | Cég-alapértelmezés |
| `POST` | `/notifications/webhook/resend` | **publikus**, Svix-aláírt | Delivery-események |
| `GET` | `/notifications/unsubscribe/:token` | publikus | Leiratkozó oldal (aláírt token) |
| `POST` | `/notifications/unsubscribe/:token` | publikus | RFC 8058 egykattintás (200/202, üres válasz) |
| `GET` | `/admin/notifications/deliveries` | DEVELOPER | Kézbesítési napló szűrve (support) |
| `POST` | `/admin/notifications/deliveries/:id/retry` | DEVELOPER | DLQ-ból újraküldés |
| `GET` | `/admin/notifications/stats` | DEVELOPER | Bounce-arány, DLQ-mélység, csatorna-bontás |

⚠️ **A Resend-webhook mountja**: `express.raw({ type: "application/json" })`
**az `express.json()` ELŐTT** — pontosan úgy, ahogy a Stripe-webhooké ma. A
Svix aláírás a nyers bájtokra érvényes; JSON parse + re-stringify
**érvényteleníti**.

---

## 15. Security

| Terület | Intézkedés |
|---|---|
| **Rate limiting** | A meglévő `rateLimit.middleware` mintájára, minden limit a `constants/rateLimits.ts`-be. Új: `notification-prefs` (per user), `unsubscribe` (per IP). |
| **Email abuse prevention** | **Cégenkénti napi email-kvóta** (`NotificationDelivery` count) — egy hibás ciklus vagy kompromittált fiók sem tudja elégetni a Resend-kvótát és a domain-reputációt. Kvóta felett: `ops.*` riasztás + további küldés blokkolása. |
| **Verifikáció** | Nem verifikált email-címre **csak** a verifikációs levél megy ki (a `User.emailVerified` kapu) — így egy támadó nem használhat minket spam-relaynek. |
| **Replay protection** | Kétrétegű: (1) Svix `svix-timestamp` toleranciaablak; (2) `EmailEvent.id` = Svix esemény-id **primary key** → az újrakézbesítés no-op (a `ProcessedStripeEvent` mintája). |
| **Aláírt tokenek** | A leiratkozó link tokenje HMAC-elt (`userId + category + secret`), lejárattal. Az egykattintásos POST-végpont **definíció szerint nem hitelesített** (a mailszolgáltató hívja) → a token az egyetlen védelem, és a kezelőnek idempotensnek kell lennie. |
| **Secrets** | Új: `RESEND_WEBHOOK_SECRET` (Svix), `NOTIFICATION_TOKEN_SECRET`. Mindkettő a `config.ts` egyetlen forrásán át; **production-kötelező**, hiányuk startup-hiba. |
| **Tenant-izoláció** | Minden lekérdezés `companyId`-scope-olt; a `tenantIsolation.test.ts`-be **kötelező** új eset (a repó szabálya). |
| **PII a logokban** | `maskEmail()` minden log-soron; a template-context sosem kerül logba nyersen. |
| **Template-injekció** | A React Email alapból escape-el (nem string-konkatenáció, mint a mai `escapeHtml`-es megoldás) — de a `dangerouslySetInnerHTML` **tiltott** a template-ekben (lint-szabály). |

---

## 16. Monitoring

| Mit | Hogyan | Küszöb / riasztás |
|---|---|---|
| **DLQ-mélység** | `notify:dlq` queue mérete | > 0 → DEVELOPER-riasztás |
| **Kézbesítési hibaarány** | `failed / sent` az elmúlt 24 órában | > 5% → riasztás |
| **Bounce-arány** | `EmailEvent` bounce / delivered | > 2% → **domain-reputációs kockázat**, azonnali riasztás |
| **Complaint-arány** | spam-jelölés / delivered | > 0,1% → azonnali riasztás |
| **Outbox-lemaradás** | `NotificationEvent.status = pending` legrégebbi kora | > 5 perc → a drainer megállt |
| **Worker-életjel** | pg-boss `getQueueStats()` | a `/health` **bővítése** worker-státusszal (ma szándékosan DB-mentes → külön `/health/workers`) |
| **Resend-kvóta** | `x-resend-monthly-quota` fejléc | 80% → figyelmeztetés |

**Admin dashboard** (`/admin/notifications`): kézbesítési napló szűrhetően,
DLQ-elemek újraküldési gombbal, csatorna- és típus-bontású statisztika.

⚠️ **Függőség**: érdemi riasztáshoz kell egy hibakövető (Sentry vagy
egyenértékű) — ez ma **nyitott backlog-tétel (#0b)**, és a
`post-launch-backlog.md` maga mondja ki: *„a következő »nulla user«-osztályú
hibát riasztásnak kell jeleznie, nem ügyfélnek."* Addig a riasztás csatornája
maga az email (`ops.*` a DEVELOPER-nek) — ami körkörös függés, ezért a
kritikus ops-riasztásoknak **a queue-t megkerülve, közvetlenül** kell menniük.

---

## 17. Roadmap

| Fázis | Tartalom | Szállítandó | Kockázat |
|---|---|---|---|
| **1 — Architektúra** | Ez a dokumentum + a nyitott kérdések (18.) eldöntése | jóváhagyott terv | — |
| **2 — Database** | 6 Prisma-modell + migráció; `User.language` oszlop; `DELETE_ORDER` bővítés; tenant-izolációs teszt | migráció + zöld suite | alacsony (additív) |
| **3 — Template Engine** | tsconfig `jsx`, `react`/`react-dom` függőség; BaseLayout + komponensek; backend i18n (`hu`/`en`); az **5 meglévő email** migrálása React Emailre — **változatlan viselkedéssel** | 5 template + preview + snapshot-tesztek | ⚠️ build-lánc változás (13.4) |
| **4 — Notification Service** | pg-boss bekötése (+Node-bump, SIGTERM-drain); outbox + dispatcher; email + in-app csatorna; preferenciák; suppression; API + frontend harang | működő rendszer a meglévő 5 típussal | ⚠️ **a legnagyobb fázis** — érdemes 4a (queue+dispatcher) és 4b (API+UI) bontásra |
| **5 — Stripe Integráció** | `invoice.*` + `payment_method.attached` felvétele (kód + Dashboard); 16 billing-template; a napi sweepek (trial, határidő) | teljes §13 mátrix | ⚠️ Dashboard-lépés = ops-koordináció |
| **6 — Testing** | Integrációs tesztek (vitest + supertest + valós PostgreSQL); template-snapshotok mindkét nyelven; webhook-aláírás tesztek; idempotencia- és preferencia-mátrix tesztek; **kézi kliens-teszt** (Gmail/Outlook/Apple Mail, világos+sötét) | zöld CI + kliens-mátrix | frontend teszt-harness ma **nincs** (backlog #4) |
| **7 — Production** | Resend aldomain-szétválasztás (tranzakciós/marketing) + DNS; DMARC ramp (`p=none` → `quarantine` → `reject`); webhook-endpoint regisztráció; monitoring-küszöbök; rollout-checklist + rollback-terv (a Design C mintájára) | élesítés | ⚠️ DNS-változás átfutási idő |

**Javasolt sorrend-módosítás a kérthez képest:** a Phase 3 (template) **előbb**
kerüljön, mint a Phase 4 (service) — így a meglévő 5 email már React Emailen
fut, mielőtt bármi új infrastruktúra épülne rá. Ez ad egy **önmagában
szállítható, alacsony kockázatú** első értéket (szebb, brandelt, kétnyelvű
levelek), és a nagy fázis (4) már bizonyított renderelőre épül.

---

## 18. Nyitott kérdések — döntést igényelnek az implementáció előtt

| # | Kérdés | Miért kell dönteni |
|---|---|---|
| Q1 | **Node ≥ 22.12 bump elfogadható?** | A pg-boss 12 előfeltétele. Ha nem, a queue vagy BullMQ (Redis árán), vagy saját minimál poller. |
| Q2 | **A billing-értesítések letilthatók legyenek?** | Javaslatom: a kritikusak (fizetési hiba, trial lejárat) **nem**, a nyugták igen. |
| Q3 | **Kell-e PDF-csatolmány, vagy elég a Stripe-link?** | Javaslatom: link (4.3/A). A csatolmány +1 külső letöltés a workerben. |
| Q4 | **Külön aldomain a marketing-levelekre?** | A Resend ezt **kifejezetten javasolja** reputáció-szegmentálásra. DNS-munka. |
| Q5 | **Az employee-k (nem owner) kapjanak-e emailt?** | Ma minden email az ownernek megy. A projekt-értesítések értelme a munkatársaknak szólni — de ez megsokszorozza a volument. |
| Q6 | **`User.language` bevezetése** vagy elég a `Company.language`? | Javaslatom: `User.language` (nullable) + cég-fallback — egy vegyes nyelvű csapatnál a cégszintű nyelv rossz választás. |
| Q7 | **A meglévő 5 email átírása egy körben, vagy fokozatosan?** | Javaslatom: egy körben (Phase 3), mert a két renderelő párhuzamos üzemeltetése drágább, mint a migráció. |
| Q8 | **Retenció**: meddig őrizzük a `NotificationDelivery` / `EmailEvent` sorokat? | Javaslatom: delivery 12 hónap (support), raw event 90 nap. A `ProcessedStripeEvent` ma dokumentáltan korlátlanul nő — ezt is ez a prune-job rendezné. |

---

*Terv vége. Implementáció nem kezdődött el. A 18. szakasz kérdéseinek
megválaszolása után a Phase 2 (Database) indulhat — a Design C-nél bevált
mintában: terv → jóváhagyás → implementáció adverzális review-val → rollout-
és rollback-dokumentum.*
