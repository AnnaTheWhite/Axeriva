# Axeriva — Subscription Architecture (S1.1 audit + design)

*Audit + tervezés az előfizetési alaphoz. Kódot nem módosít. Állapot:
`19ae420`. Kapcsolódó: [project-overview.md](project-overview.md),
[stripe-webhook-production-readiness.md](stripe-webhook-production-readiness.md).*

---

## 1. Jelenlegi architektúra (audit)

### 1.1 Adatmodell — az előfizetés MÁR a cégen ül
A `Company` modellen ([schema.prisma](../server/prisma/schema.prisma)) minden
billing-mező jelen van; a `User`-en **semmi** billing nincs:

| Mező | Típus | Szerep |
|---|---|---|
| `plan` | String `@default("free")` | jelenleg `"free"` / `"pro"` értékek |
| `subscriptionStatus` | String `@default("inactive")` | Stripe státusz (active/trialing/past_due/canceled…) |
| `stripeCustomerId` | String? | Stripe Customer |
| `stripeSubscriptionId` | String? | Stripe Subscription |
| `subscriptionEndsAt` | DateTime? | aktuális periódus vége |
| `active` / `deletedAt` | soft-delete | tenant-életciklus (K2.1.5) |

➡️ **A „subscriptions belong to companies, never users" elv már teljesül** —
ez az alap, amire építeni kell, nem átalakítani.

### 1.2 User / RBAC
- 3 szerep ([roles.ts](../server/src/constants/roles.ts)): `DEVELOPER`
  (platform-operátor = **founder**, cég nélkül, `companyId: null`),
  `BUSINESS_OWNER` (cégtulaj), `EMPLOYEE`.
- Enforcement: backend `requireRole(...)`
  ([role.middleware.ts](../server/src/middleware/role.middleware.ts)),
  frontend `<ProtectedRoute roles={[...]}>`
  ([router](../src/app/router/index.tsx)).
- A `DEVELOPER`-nek nincs cége → nincs előfizetése; az auth-middleware a
  cég-aktivitás-ellenőrzést kihagyja rá (K2.1.5).

### 1.3 Stripe-implementáció (teljes, egy termékre)
- **Kliens:** [stripeClient.ts](../server/src/services/stripe/stripeClient.ts)
  — lazy Proxy, konfigurálatlanul érthető hibát dob.
- **Szinkron (single source of truth):**
  [syncSubscription.ts](../server/src/services/stripe/syncSubscription.ts) —
  `applySubscriptionUpdate` / `markSubscriptionCanceled` írja a Company
  billing-mezőit. `planForStatus`: `active|trialing → "pro"`, egyébként
  `"free"`.
- **Route-ok:** [subscription.routes.ts](../server/src/routes/subscription.routes.ts)
  — `GET /` (státusz), `POST /checkout` (BUSINESS_OWNER, egyetlen
  `STRIPE_PRICE_ID`), `POST /sync` (post-checkout reconcile), `POST /portal`
  (Billing Portal). Auth + `requireRole(BUSINESS_OWNER, DEVELOPER)` mögött.
- **Webhook:** [stripeWebhook.routes.ts](../server/src/routes/stripeWebhook.routes.ts)
  — 3 esemény (`checkout.session.completed`, `customer.subscription.updated`,
  `customer.subscription.deleted`), raw body + aláírás-ellenőrzés.

### 1.4 Feature/limit gating — MA a teljes „feature-flag" rendszer
[planLimits.ts](../server/src/utils/planLimits.ts): **két hardkódolt szám**
- `FREE_PLAN_PROJECT_LIMIT = 1`, `FREE_PLAN_EMPLOYEE_LIMIT = 2`.
- `isProjectLimitReached` / `isEmployeeLimitReached`: ha `company.plan !==
  "free"` → korlátlan; egyébként count-alapú ceiling.
- Enforcement **létrehozáskor**: [projects.routes.ts](../server/src/routes/projects.routes.ts)
  (projekt-create) és [invites.routes.ts](../server/src/routes/invites.routes.ts)
  (meghívó). Nem retroaktív (downgrade nem töröl).
- **Nincs** boolean feature-flag, nincs plan→capability map, nincs tier a
  „free/pro"-n túl, nincs central capability-service.

### 1.5 Frontend
- `SubscriptionPage` — plan/status/endsAt + Checkout/Portal/Sync gombok
  ([subscription.service.ts](../src/services/subscription.service.ts)).
- `SettingsPage` — CompanyProfile / Branding / DangerZone (billing **nincs**
  itt; külön `/subscription` oldal).
- Admin (DEVELOPER): `/admin/companies` (plan+status+count lista),
  `/admin/users`, `/admin/logs`, `/admin/billing`
  ([admin.routes.ts](../server/src/routes/admin.routes.ts)). A lista
  **minden** céget mutat, szűrés nélkül.

---

## 2. Osztályozás

### ✅ Létezik és újrahasználható
Company-scoped billing-mezők; a teljes Stripe Checkout/Portal/Webhook/sync
életciklus; az idempotens közös `applySubscriptionUpdate`; a planLimits
gating-minta; a 3-szerep RBAC + company-izoláció; az audit-logging.

### ♻️ Újratervezendő / bővítendő
- **Plan-modell:** a `plan` szabad String, de a gating csak `!== "free"`-t
  néz → nem skálázik több tierre. Kell egy **strukturált plan→
  limits+features map** és **central capability-service**.
- **Feature-flag rendszer:** a 2 hardkódolt szám helyett bővíthető,
  deklaratív flag/limit készlet.
- **Enterprise:** nincs ilyen érték; kézi (nem Stripe-Checkout) aktiválás
  kell.
- **Founder/internal hiding:** a founder ne jelenjen meg ügyfélként/
  tenantként a billing-felületeken, és sose essen plan-gating alá.
- **Webhook-guard:** ma bármely Stripe-esemény felülírja a `plan`-t →
  egy **kézi Enterprise** (Stripe-subscription nélkül) tévesen `free`-re
  esne. Ezt guard kell védje.

### 🔒 Soha nem változhat
- Előfizetés a **cégen**, nem a felhasználón.
- Webhook aláírás-ellenőrzés + raw-body sorrend (express.raw a json előtt).
- Az `applySubscriptionUpdate` mint egyetlen írási forrás (webhook + sync
  ugyanazt hívja).
- Company-active enforcement (K2.1.5) és a K2.1 auth-biztonság.
- A 3-szerep RBAC és a meglévő API-kontraktusok.

---

## 3. Ajánlott architektúra

### Alapelvek
1. **Subscription = Company** (megőrizve).
2. **Founder rejtett:** a founder (DEVELOPER, ill. bármely `hidden` cég)
   soha nem billing-alany, korlátlan hozzáférés, kimarad a customer-
   listákból és a billing-metrikákból.
3. **Enterprise kézi:** nincs self-serve Stripe-Checkout; DEVELOPER
   állítja be, `manualPlan` jelzővel, amit Stripe-esemény nem ír felül.

### Rétegek
```
constants/plans.ts        → PLAN definíciók (tier → limits + feature flags)
services/planAccess.ts    → capability-service: getPlan / limitFor / hasFeature
                            (founder/hidden → unlimited/all-true short-circuit)
routes/*                  → a create-endpointok limitFor()-t hívnak
                            GET /subscription (v. /me/capabilities) → a hatályos
                            plan + capabilities a frontendnek (UI-gating)
admin (manual)            → DEVELOPER endpoint: plan=enterprise + manualPlan=true
webhook/sync              → manualPlan guard: kézi plant nem ír felül
```

---

## 4. Adatbázis-változások (additív, S1.2+-ban implementálandó)

A `Company`-ra **három** additív mező (nincs adat-backfill, defaultok
helyesek):

| Mező | Típus | Default | Miért |
|---|---|---|---|
| `hidden` | Boolean | `false` | founder/internal cég kizárása a customer-listákból, billing-metrikákból és a gatingből |
| `manualPlan` | Boolean | `false` | kézi (Enterprise) plan jelölése — a webhook/sync ezt **nem írja felül** |
| `planUpdatedAt` | DateTime? | `null` | audit: mikor/hogyan változott a plan (opcionális, de ajánlott) |

A `plan` marad String (nem Prisma enum) — a projekt bevált mintája szerint
a megengedett értékeket **API-szinten** validáljuk (`constants/plans.ts`),
így új tier bevezetése adatváltozás, nem migráció. Megengedett értékek:
`"free"`, `"pro"`, `"enterprise"`.

**Dedikált `Subscription` tábla:** most **nem** ajánlott — a denormalizált
Company-mezők elegendők a v1-hez; history-igény esetén később additívan
hozzáadható a meglévő adat érintése nélkül.

---

## 5. Feature-flag stratégia

### `constants/plans.ts` (deklaratív)
```
PLANS = {
  free:       { limits: { projects: 1,  employees: 2 },  features: { customBranding:false, advancedReports:false, apiAccess:false } },
  pro:        { limits: { projects: ∞,  employees: ∞ },  features: { customBranding:true,  advancedReports:true,  apiAccess:false } },
  enterprise: { limits: { projects: ∞,  employees: ∞ },  features: { customBranding:true,  advancedReports:true,  apiAccess:true  } },
}
```
- **Limit** = numerikus ceiling (∞ = nincs korlát). **Feature** = boolean
  képesség. Bővítés = egy sor a mapben, nincs migráció.

### `services/planAccess.ts` (central capability-service)
- `getEffectivePlan(company)` → founder/`hidden` cég esetén virtuális
  „unlimited"; egyébként `company.plan`.
- `limitFor(company, key)` → szám vagy ∞.
- `hasFeature(company, key)` → boolean.
- **Short-circuit:** `hidden === true` (founder/internal) → minden limit ∞,
  minden feature true, billingből kizárva.

### Enforcement + kitettség
- A meglévő `isProjectLimitReached`/`isEmployeeLimitReached` átíródik a
  generic `limitFor`-ra (viselkedés-megőrző; a jelenlegi 1/2 limit a `free`
  mapből jön).
- A hatályos plan + capabilities visszaadva `GET /subscription`-ben (vagy új
  `GET /me/capabilities`), hogy a frontend UI-gating ne hardkódoljon (a
  „Upgrade to Pro" promptok innen jöjjenek).

---

## 6. Migrációs stratégia

- **Egyetlen additív Prisma-migráció**: `Company.hidden` + `manualPlan`
  (+ opcionális `planUpdatedAt`). Meglévő sorok a defaultokat kapják →
  minden ügyfél látható, minden plan „stripe-forrású", semmi nem törik.
- **Backfill (adat, nem séma):** a founder/internal cég `hidden=true`;
  bármely már létező kézi Enterprise `manualPlan=true`.
- **Constants + service:** nem igényel migrációt.
- **Webhook-guard** a kézi planhez ugyanabban a lépésben, amikor a
  `manualPlan` mező bekerül — különben egy Stripe-esemény `free`-re ejtené.
- A `prisma migrate deploy` a Render start-parancsában automatikusan fut
  (meglévő).
- **Visszafelé kompatibilis, nem destruktív** — rollback-barát.

---

## 7. Implementációs sorrend (S-széria javaslat)

1. **`constants/plans.ts`** — tierek, limitek, feature-flagek (tiszta
   additív, nincs séma). *(S1.2)*
2. **`services/planAccess.ts`** — capability-service; a `planLimits`
   átvezetése rá (viselkedés-megőrző refaktor).
3. **Migráció:** `Company.hidden` + `manualPlan` (+`planUpdatedAt`).
4. **Founder/internal hiding:** founder cég `hidden=true`; a `hidden`
   kizárása az `/admin/companies` + billing-metrikákból; gating short-
   circuit.
5. **Enterprise (manual):** DEVELOPER-endpoint `plan=enterprise` +
   `manualPlan=true`; **webhook/sync guard**, hogy kézi plant ne írjon
   felül.
6. **Capabilities kitettség + frontend UI-gating** (a hardkódolt upgrade-
   promptok kiváltása).
7. **Multi-price / több Pro-tier Stripe** — később, ha a termékpaletta bővül
   (a mostani single `STRIPE_PRICE_ID` marad, amíg egy fizetős tier van).

---

## 8. Kockázatok / megjegyzések a designhoz
- **Webhook-clobber a kézi planre** — ez a legfontosabb tervezési csapda;
  a `manualPlan` guard nélkül az Enterprise elveszne egy renewal-eseménynél.
- **Downgrade nem retroaktív** (mai viselkedés megőrzendő): limit fölötti
  meglévő projekt/employee marad; csak új létrehozás blokkolt.
- **Founder dogfooding:** ha a founder valódi céget üzemeltet a platformon,
  a `hidden` flag adja a kizárást — nem a DEVELOPER-szerepre kell építeni
  (az cég nélküli).
- **Enterprise láthatóság:** kézi Enterprise-t az admin-felületen jelölni
  kell (`manualPlan`), hogy elkülönüljön a Stripe-fizetős Pro-tól.
