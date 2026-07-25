# Axeriva — Subscription System Design

**Status: DESIGN ONLY.** No code, schema, migration, route, or Stripe object is modified by this document. It is the master specification for the Axeriva subscription system and is detailed enough to be implemented step by step without re-designing anything.

Supersedes and expands [subscription-architecture.md](subscription-architecture.md) (the S1.1 audit). Grounded in the codebase at the current `master` head.

**Plan vocabulary is final and canonical:** `starter`, `professional`, `business`, `enterprise` (public) and `founder` (hidden). The product model contains **no** other plans — no `free`, no `pro`, no `legacy_*`, no permanent compatibility tier.

---

## 1. Executive Summary

Axeriva is a **per-company** SaaS for field-service businesses. **One subscription belongs to one company; every employee inherits it. There is no per-seat billing — ever.** This is the central commercial advantage the whole product is built around (§2).

The current codebase already places all billing state on the `Company` model and already has a complete, idempotent Stripe Checkout / Billing Portal / webhook / post-checkout-sync lifecycle. What it lacks is **commercial structure**: a tiered plan model, a declarative capability system, and value-based differentiation. This is the correct foundation to *extend*, not replace.

This design delivers:

1. **Four public plans** — Starter, Professional, Business, Enterprise — plus one hidden internal plan, **Founder**.
2. **Value-based differentiation** (§6): plans differ primarily by *business capability*, not by employee count.
3. A **declarative Feature Registry + Limit Registry** (§8–9) with a central capability service — no `if (plan === "...")` anywhere.
4. **Manual, Stripe-immune plans** (Founder, Enterprise) that webhooks can never overwrite.
5. **Language-driven, market-specific pricing** (HUF/EUR) and a **14-day, no-credit-card trial** that degrades to **read-only** on expiry (§13) rather than locking the account.
6. A **billing state machine** (§14), an **upgrade/downgrade matrix** (§15), a **pricing-page spec** (§20), and a **future add-ons** model (§21).

Everything is additive and backward compatible. Migration from the pre-commercial state is a **one-time, one-shot normalization** (§17.4) with no lasting legacy plans.

---

## 2. Commercial Positioning & Marketing

### 2.1 The core message

> **One subscription. Your whole company. Every employee included.**

Axeriva is priced **per company, not per user**. One predictable monthly price per plan; add the entire crew — 3 people or 30 — without the bill changing. Field-service teams are seasonal and fluctuate; Axeriva's pricing rewards growth instead of taxing it.

### 2.2 Why this is a competitive advantage

| | Typical per-seat competitor | **Axeriva (per-company)** |
|---|---|---|
| Add a seasonal worker | +€X/user/month, forever | **€0 — included** |
| Onboard the whole crew | Cost scales with headcount | **Flat plan price** |
| Budget predictability | Varies monthly with headcount | **Fixed monthly price** |
| Incentive | Discourages adding users | **Encourages company-wide adoption** |
| Admin overhead | Seat management, license reconciliation | **None** |

### 2.3 Positioning pillars

1. **One subscription per company** — not per user.
2. **No per-seat pricing** — add employees freely.
3. **Grow your team without paying for every employee.**
4. **Value you can grow into** — upgrades map to business maturity, not headcount.
5. **Field-service-native** — scheduling, projects, customers, time tracking, mobile are core on every plan.

### 2.4 Message per plan

- **Starter** — "Run your business. Everything core, one price, whole team."
- **Professional** — "See more and connect: analytics, exports, advanced reporting, and the Developer API."
- **Business** — "Automate and scale: automation, webhooks, multi-location, AI, and advanced branding."
- **Enterprise** — "Enterprise-grade control: SSO, SCIM, white-label, custom domain, SLA, and a dedicated account manager."

---

## 3. Business Philosophy

| Principle | Consequence for the design |
|---|---|
| **Subscription = Company. Never per-user.** | All billing on `Company`. Ceilings like "employees" are fair-use guardrails, **never** a price multiplier. |
| **Employees inherit the company plan.** | Capability checks resolve the plan from the acting user's `companyId`, never from the user. |
| **Plans differ by business value, not headcount.** | Differentiation ladder: Analytics → Developer API/Exports/Reporting → Automation/Webhooks/Integrations/Multi-location/AI/Branding → SSO/SCIM/White-label/SLA. |
| **Internal API always free; Developer API premium.** | The API behind Axeriva Web/Mobile is never gated. The public Developer API is Professional+ (§10). |
| **Founder is internal-only.** | Never displayed, never purchasable, DEVELOPER-assignable only, never touched by Stripe. |
| **Enterprise is sales-led.** | No self-serve checkout; DEVELOPER provisions with custom limits. |
| **International from day one.** | Currency and copy follow website language; ≥2 currencies/languages assumed, open to more. |

**Two orthogonal access axes (keep separate in code):** RBAC (`DEVELOPER`/`BUSINESS_OWNER`/`EMPLOYEE`) → *who may act*; Plan capability (`hasFeature`/`limitFor`) → *what the plan includes*. A request must pass **both**.

---

## 4. Subscription Model

| Plan key | Visibility | Purchasable | Provisioning | Stripe-managed |
|---|---|---|---|---|
| `starter` | Public | Self-serve | Checkout (trial) | Yes |
| `professional` | Public | Self-serve | Checkout (trial) | Yes |
| `business` | Public | Self-serve | Checkout (trial) | Yes |
| `enterprise` | Public ("Contact Sales") | **No self-serve** | DEVELOPER manual | No (manual) |
| `founder` | **Hidden** | **Never** | DEVELOPER manual only | **Never** |

`plan` stays a `String` (not a Prisma enum) — a future plan is a data/registry change, never a migration. These five keys are the only valid values, validated in `constants/plans.ts`.

---

## 5. Pricing Strategy

Market-specific price points (**not** FX conversions):

| Plan | Hungarian (HUF) | English (EUR) | Billing |
|---|---|---|---|
| Starter | **7 990 Ft / hó** | **€29.99 / month** | Monthly, recurring |
| Professional | **16 990 Ft / hó** | **€59.99 / month** | Monthly, recurring |
| Business | **34 990 Ft / hó** | **€119.99 / month** | Monthly, recurring |
| Enterprise | **Kapcsolatfelvétel** | **Contact Sales** | Custom contract |

Each plan needs **one Stripe Price per currency** under a **single Stripe Product** (§16). Currency follows website language: `hu → HUF`, `en → EUR`, default `EUR`.

---

## 6. Plan Differentiation (business value, not seats)

Each tier is **cumulative** — includes everything below plus a capability layer.

| Tier | Headline value | Adds on top of the tier below |
|---|---|---|
| **Starter** | **Core business management** | Projects, employees, customers, scheduling, time tracking, mobile, basic analytics, CSV export, **Standard Email** support, **5 GB** storage. |
| **Professional** | **Insight & integration** | **Advanced analytics**, **Developer API** + API keys, **Excel/PDF exports**, **advanced reporting**, basic integrations, **Priority Email** support, **25 GB** storage. |
| **Business** | **Automation & scale** | **Automation/Workflow Builder**, **webhooks**, **advanced integrations**, **multi-location**, **AI features**, **advanced branding**, audit logs, **Priority Support**, **100 GB** storage. |
| **Enterprise** | **Enterprise control & assurance** | **SSO**, **SCIM**, **white-label**, **custom domain**, **dedicated account manager**, **SLA**, **custom development**, **custom storage & limits**. |
| **Founder** *(hidden)* | Internal / unlimited | Everything, always, invisible. |

Employee count is deliberately **not** the differentiator; ceilings are generous fair-use guardrails (§9), never billed per unit.

---

## 7. Complete Plan Comparison Table

**This table is the single source of truth for the public pricing page.** Every feature is compared across the four public plans. `●` = included, `—` = not included, text = value/tier. Founder is internal and intentionally omitted from the customer-facing table.

| | Starter | Professional | Business | Enterprise |
|---|:--:|:--:|:--:|:--:|
| **Price (HUF / month)** | 7 990 Ft | 16 990 Ft | 34 990 Ft | Contact Sales |
| **Price (EUR / month)** | €29.99 | €59.99 | €119.99 | Contact Sales |
| **Free trial** | 14 days | 14 days | 14 days | — |
| **Billing model** | Per company | Per company | Per company | Per company |
| **— Core operations —** | | | | |
| Projects | ● | ● | ● | ● |
| Employees (all included) | ● | ● | ● | ● |
| Customers | ● | ● | ● | ● |
| Scheduling | ● | ● | ● | ● |
| Time tracking | ● | ● | ● | ● |
| Mobile app | ● | ● | ● | ● |
| Internal API (app) | ● | ● | ● | ● |
| **— Analytics & reporting —** | | | | |
| Basic analytics | ● | ● | ● | ● |
| Advanced analytics | — | ● | ● | ● |
| Advanced reporting | — | ● | ● | ● |
| CSV export | ● | ● | ● | ● |
| Excel export | — | ● | ● | ● |
| PDF export | — | ● | ● | ● |
| **— Developer & integrations —** | | | | |
| Developer API (public) | — | ● | ● | ● |
| API keys | — | ● | ● | ● |
| Basic integrations | — | ● | ● | ● |
| Advanced integrations | — | — | ● | ● |
| Webhooks | — | — | ● | ● |
| **— Automation & AI —** | | | | |
| Automation / Workflow Builder | — | — | ● | ● |
| AI features | — | — | ● | ● |
| **— Operations at scale —** | | | | |
| Multi-location | — | — | ● | ● |
| Audit logs | — | — | ● | ● |
| **— Branding & identity —** | | | | |
| Advanced branding | — | — | ● | ● |
| White-label | — | — | — | ● |
| Custom domain | — | — | — | ● |
| **— Enterprise controls —** | | | | |
| SSO (SAML/OIDC) | — | — | — | ● |
| SCIM provisioning | — | — | — | ● |
| SLA | — | — | — | ● |
| Custom development | — | — | — | ● |
| **— Limits —** | | | | |
| Storage | 5 GB | 25 GB | 100 GB | Custom |
| Employees (fair-use) | 10 | 50 | 200 | Unlimited |
| Projects (fair-use) | 25 | 250 | 2 500 | Unlimited |
| Customers (fair-use) | 100 | 1 000 | 10 000 | Unlimited |
| Locations | 1 | 1 | 10 | Unlimited |
| Automation rules | — | — | 50 | Unlimited |
| Webhooks | — | — | 10 | Unlimited |
| API requests / month | — | 50 000 | 200 000 | Custom |
| **— Support —** | Standard Email | Priority Email | Priority Support | Dedicated Account Manager |

> Employee/project/customer numbers are **generous fair-use guardrails**, tunable in the registry, and **never billed per unit**.

---

## 8. Feature Registry (expanded)

**Goal:** one declarative source of truth. Every premium capability is defined once with full metadata; plans reference feature keys; code asks the capability service — never the plan string. Every feature carries: **internal key · display name · description · minimum tier · future-module flag**.

### 8.1 Feature catalog

| Internal key | Display name | Description | Min. tier | Future module |
|---|---|---|---|:--:|
| `analytics_basic` | Basic analytics | Overview counts and simple charts | Starter | — |
| `analytics_advanced` | Advanced analytics | Trends, segments, cohort/growth | Professional | — |
| `advanced_reporting` | Advanced reporting | Saved/scheduled advanced reports | Professional | — |
| `export_csv` | CSV export | Export data as CSV | Starter | — |
| `export_excel` | Excel export | Export data as .xlsx | Professional | — |
| `export_pdf` | PDF export | Export documents/reports as PDF | Professional | — |
| `developer_api` | Developer API | Public REST API for customer integrations | Professional | — |
| `api_keys` | API keys | Create/manage company-scoped API keys | Professional | — |
| `integrations_basic` | Basic integrations | Prebuilt third-party integrations | Professional | — |
| `integrations_advanced` | Advanced integrations | Advanced/custom integrations | Business | — |
| `webhooks` | Webhooks | Outbound event webhooks | Business | — |
| `automation` | Automation | Automation / Workflow Builder engine | Business | ✓ (`module_workflow_builder`) |
| `multi_location` | Multi-location | Multiple sites/locations | Business | — |
| `ai_features` | AI features | AI assistant / scheduling / reports umbrella | Business | ✓ |
| `advanced_branding` | Advanced branding | Logo/colors on app and documents | Business | — |
| `audit_logs` | Audit logs | Company audit-trail view | Business | — |
| `white_label` | White-label | Remove Axeriva branding | Enterprise | — |
| `custom_domain` | Custom domain | Serve on the customer's domain | Enterprise | — |
| `sso` | SSO | SAML/OIDC single sign-on | Enterprise | — |
| `scim` | SCIM provisioning | Automated user provisioning (SCIM 2.0) | Enterprise | — |
| `sla` | SLA | Contractual service-level agreement | Enterprise | — |
| `custom_development` | Custom development | Bespoke development work | Enterprise | — |

### 8.2 Future commercial modules

Each is a `module_*` feature key with the same metadata shape, activated by one registry edit when it ships.

| Internal key | Display name | Description | Recommended tier |
|---|---|---|---|
| `module_time_tracking` | Time Tracking | Advanced time tracking & approvals | Starter |
| `module_quotations` | Quotations | Create and send quotes | Professional |
| `module_invoices` | Invoices | Generate and manage invoices | Professional |
| `module_customer_portal` | Customer Portal | Self-service portal for customers | Professional |
| `module_inventory` | Inventory | Stock/inventory management | Business |
| `module_vehicles` | Vehicle Management | Fleet/vehicle tracking | Business |
| `module_equipment` | Equipment Management | Equipment/asset tracking | Business |
| `module_expenses` | Expenses | Expense capture & approval | Business |
| `module_maintenance` | Maintenance | Preventive/scheduled maintenance | Business |
| `module_workflow_builder` | Workflow Builder | Visual automation builder | Business |
| `module_ai_assistant` | AI Assistant | Conversational operations assistant | Business |
| `module_ai_reports` | AI Reports | AI-generated reporting | Business |
| `module_ai_scheduling` | AI Scheduling | AI-optimized crew scheduling | Business |

### 8.3 Registry shape (design pseudocode — `server/src/constants/features.ts` + `plans.ts`)

```
export const FEATURES = {
  developer_api: { key:"developer_api", name:"Developer API",
                   description:"Public REST API for customer integrations",
                   minTier:"professional", module:null },
  // …one entry per row in §8.1–8.2
} as const;
export type FeatureKey = keyof typeof FEATURES;

export const PLANS = {
  starter:      { tier:1, public:true,  supportTier:"standard_email",         features:[…] },
  professional: { tier:2, public:true,  supportTier:"priority_email",         features:[…] },
  business:     { tier:3, public:true,  supportTier:"priority",               features:[…] },
  enterprise:   { tier:4, public:true,  manual:true, supportTier:"dedicated_account_manager", features:"ALL" },
  founder:      { tier:99,public:false, hidden:true, manual:true, supportTier:"none", features:"ALL" },
} as const;
```

`"ALL"` = every feature key (future features auto-include in Enterprise/Founder). Adding a feature to a plan = append a key. **Never a migration.**

---

## 9. Limit Registry (expanded)

**Goal:** every numeric ceiling defined once, resolved through one function, enforced at creation time (non-retroactive). Every limit carries: **key · description · default value (per plan) · unlimited behavior · UI behavior when reached**.

| Key | Description | Defaults (S / Pro / Biz / Ent) | Unlimited behavior | UI when limit reached |
|---|---|---|---|---|
| `employees` | Max employee records | 10 / 50 / 200 / ∞ | `Infinity` ⇒ no check | "Employee limit reached (10/10). Upgrade to add more." Invite button disabled + `UpgradePrompt`. |
| `projects` | Max projects | 25 / 250 / 2 500 / ∞ | `Infinity` ⇒ no check | "Project limit reached." Create button disabled + upgrade CTA. |
| `customers` | Max customers | 100 / 1 000 / 10 000 / ∞ | `Infinity` ⇒ no check | "Customer limit reached." Create disabled + upgrade CTA. |
| `locations` | Max locations/sites | 1 / 1 / 10 / ∞ | `Infinity` ⇒ no check | "Location limit reached." Add-location disabled + upgrade CTA (multi-location is Business+). |
| `storageBytes` | Total uploaded file storage | 5 / 25 / 100 GB / Custom | `Infinity` (Founder) / Custom (Ent via `manualLimits`) | At ~80% show usage warning bar; at 100% block upload with "Storage full — upgrade or free space." |
| `automationRules` | Max automation rules | 0 / 0 / 50 / ∞ | `Infinity` ⇒ no check | Below Business: feature hidden + upgrade CTA. At cap: "Rule limit reached." |
| `webhooks` | Max webhook endpoints | 0 / 0 / 10 / ∞ | `Infinity` ⇒ no check | Below Business: hidden + upgrade CTA. At cap: "Webhook limit reached." |
| `apiRequestsPerMonth` | Developer API request quota | 0 / 50k / 200k / Custom | `Infinity` (Founder) / Custom (Ent) | Approaching: header/usage warning. Over quota: `429` + "Monthly API quota exceeded — upgrade or add API requests" (future add-on §21). |

**Resolution & enforcement (design pseudocode — `services/planAccess.ts`):**
```
limitFor(company, key): number          // hidden/founder → Infinity; enterprise → manualLimits[key] ?? Infinity; else LIMITS[plan][key] ?? Infinity
isWithinLimit(company, key, current): boolean   // current < limitFor(...)
```
- **Unlimited** is represented as `Infinity`; a missing key also ⇒ `Infinity` (safe for higher tiers and new limits).
- **Enforcement at creation time only** (reuse existing `projects`/`invites` pattern; extend to customers, locations, webhooks, automation, API keys; storage at upload). **Downgrade never deletes** over-limit records — they stay viewable; only new creation is blocked.
- **UI parity:** the frontend receives resolved limits in the capabilities payload (§19) and disables the relevant create control + shows the message above; the backend still enforces authoritatively.

---

## 10. Internal API vs Developer API

| | **Internal API** | **Developer API** |
|---|---|---|
| Purpose | Powers Axeriva **Web** and **Mobile** apps | Public API for **customer integrations** |
| Auth | User session JWT (existing middleware) | Company-scoped **API keys** |
| Plan gating | **None — always available** | **Professional+** (`developer_api` + `api_keys`) |
| Rate limiting | Normal app limits | Per-company `apiRequestsPerMonth` quota |
| Contract | Internal, may change with the app | Versioned, documented public contract |

The internal API is never plan-gated (gating the app the customer paid for is nonsensical). Both are company-scoped, never cross-tenant. API keys hashed at rest (reuse `hashToken`), revocable.

---

## 11. Founder Plan

Hidden internal plan. Never visible / never purchasable / DEVELOPER-only assignment / Stripe never overwrites / unlimited access — via `PLANS.founder.public=false` + `hidden=true` + `manualPlan=true`, the `applySubscriptionUpdate` guard (§16.3), and the capability short-circuit (`hidden` ⇒ all features true, all limits `Infinity`). Attaches to **companies** (via `hidden`), independent of the DEVELOPER role, so the founder can dogfood a real tenant without appearing as a customer.

---

## 12. Enterprise Plan

Sales-led, manually provisioned. "Contact Sales" on pricing (no self-serve). DEVELOPER endpoint sets `plan="enterprise"`, `manualPlan=true`, optional `manualLimits` (custom storage/ceilings) and feature overrides. Off-platform contract billing (optional Stripe customer for records; no plan-driving subscription). `manualPlan=true` ⇒ Stripe guard never overwrites. All features (`"ALL"`) incl. SSO/SCIM/white-label/custom-domain/SLA/custom-development; `supportTier="dedicated_account_manager"`. Distinct **Manual/Enterprise** badge in admin.

---

## 13. Trial System

- Every **public** plan includes a **14-day trial**, **no credit card**, **full access** to the selected plan. Enterprise/Founder have no trial.
- **On expiry → READ-ONLY mode:** existing data remains; users **can** log in, browse/view, and **export**; users **cannot** create, edit, delete, or upload. Persistent banner + one-click subscribe restores full access instantly.
- **Why read-only beats a full lockout:** the customer never feels their data is held hostage, can still demo/evaluate and export, reactivation is one click with context intact, and trial-to-paid friction/churn drops — the value stays on screen and the only missing thing is *writing*, which is exactly the nudge to subscribe.
- **Mechanics:** Checkout `trial_period_days=14`, `payment_method_collection="if_required"`, `trial_settings.end_behavior.missing_payment_method="cancel"`; `trialing` treated like `active`; on expiry a **write-guard middleware** enforces read-only at every mutating endpoint (mirrored by UI-gating). Data retained; any cleanup is a documented manual DEVELOPER action, never silent.

---

## 14. Billing State Machine

### 14.1 States

| State | Definition | Write access | Notes |
|---|---|---|---|
| **Trial** (`trialing`) | Within 14-day trial of a selected plan | **Full** (selected plan) | No card required. |
| **Active** (`active`) | Paid subscription in good standing | **Full** | Renews each period. |
| **Past Due** (`past_due`) | Renewal payment failed | **Full during grace** | Stripe dunning/retries; grace window before restriction. |
| **Cancelled** (`canceled`, period not ended) | Owner cancelled; still within paid period | **Full until period end** | `cancel_at_period_end`; converts to Read-Only at period end. |
| **Expired** | Trial ended, or paid period ended without renewal | **None (→ Read-Only)** | Terminal for the subscription; access mode becomes Read-Only. |
| **Read-Only** | Access mode applied to Expired / Cancelled-elapsed / Past-Due-after-grace | **None** — login + browse + export only | Enforced by write-guard middleware. |
| **Suspended** | DEVELOPER/abuse/compliance hold | **None; login may be blocked** | Stronger than Read-Only; manual, reversible by DEVELOPER. |
| **Founder** | Manual internal plan | **Full, unlimited** | `manualPlan`+`hidden`; Stripe-immune. |
| **Enterprise** | Manual contract plan | **Full, custom limits** | `manualPlan`; Stripe-immune. |

`Trial/Active/Past Due/Cancelled/Expired` map to Stripe-native `subscriptionStatus`; `Read-Only`/`Suspended`/`Founder`/`Enterprise` are derived/manual states resolved by the capability service, not extra Stripe state.

### 14.2 Transitions

| From | To | Trigger |
|---|---|---|
| (none) | Trial | Checkout with trial started |
| Trial | Active | Payment method charged at trial end |
| Trial | Expired → Read-Only | Trial ends with no payment method |
| Active | Active | Successful renewal |
| Active | Past Due | Renewal payment fails |
| Active | Cancelled | Owner cancels (at period end) |
| Past Due | Active | Payment recovered (dunning success) |
| Past Due | Read-Only | Grace elapses without recovery |
| Cancelled | Active | Owner resubscribes before period end |
| Cancelled | Read-Only | Paid period ends |
| Expired / Read-Only | Active | Owner subscribes (Checkout) |
| Any (public) | Suspended | DEVELOPER/abuse action |
| Suspended | Prior state / Active | DEVELOPER lifts hold |
| Any (public) | Founder / Enterprise | DEVELOPER manual assignment (`manualPlan`) |
| Founder / Enterprise | (unchanged by Stripe) | Stripe events **ignored** by guard |

### 14.3 Diagram

```
(none) ─checkout(trial)─▶ Trial ─charged─▶ Active ─renew─▶ Active
   │                        │                 │  ▲            │
   │                  no card @ end     fails │  │ recovered  │ cancel
   │                        ▼                 ▼  │            ▼
   │                     Expired            Past Due       Cancelled
   │                        │                 │               │
   │                        └───────▶ Read-Only ◀──grace──────┘ (at period end)
   │                                     │
   │                                subscribe → Active
   │
   ├─ DEVELOPER ─▶ Founder / Enterprise   (manualPlan; Stripe-immune)
   └─ DEVELOPER ─▶ Suspended              (abuse/compliance; reversible)
```

---

## 15. Upgrade / Downgrade Matrix

**Rules:** upgrades apply **immediately** with Stripe **proration**; downgrades apply **at period end** (keep paid features through the paid period) and are **non-retroactive** (over-limit records kept, new creation blocked). Enterprise/Founder are DEVELOPER-only (never self-serve). All transitions audit `SUBSCRIPTION_CHANGED`.

| Transition | Type | Timing | Behavior |
|---|---|---|---|
| Starter → Professional | Upgrade | Immediate | Proration; analytics/API/exports unlock at once. |
| Starter → Business | Upgrade | Immediate | Proration; automation/AI/multi-location unlock. |
| Professional → Business | Upgrade | Immediate | Proration; automation/webhooks/AI/branding unlock. |
| Business → Enterprise | Upgrade (sales) | On contract | DEVELOPER sets `enterprise`+`manualPlan`; Stripe self-serve ends, contract billing begins. |
| Professional → Starter | Downgrade | Period end | Advanced features disabled; data kept; new creation capped at Starter limits. |
| Business → Professional | Downgrade | Period end | Automation/AI/etc. disabled; data kept; caps tighten. |
| Business → Starter | Downgrade | Period end | Drops to core; over-limit records kept (viewable), creation blocked until under caps. |
| Enterprise → Business/Pro | Downgrade (sales) | Contract end | DEVELOPER clears `manualPlan`, sets target plan; Stripe self-serve resumes if desired. |
| Trial → Paid (same plan) | Conversion | Immediate | Add payment method / charged at trial end → Active. |
| Trial → Paid (different plan) | Conversion + change | Immediate | Checkout for chosen plan's Price; Active on the new plan. |
| Expired / Read-Only → Paid | Reactivation | Immediate | New Checkout → Active; full write access restored, data intact. |
| Cancelled → Active | Reactivation | Immediate | Resubscribe before/after period end → Active. |
| Past Due → Active | Recovery | On payment | Dunning success (Billing Portal) → Active. |
| Any → Founder | Manual | Immediate | DEVELOPER only; `hidden`+`manualPlan`; unlimited. |
| Any → Suspended / lift | Manual | Immediate | DEVELOPER only; reversible. |

Self-serve upgrades/downgrades **never** touch `manualPlan` companies.

---

## 16. Stripe Architecture

### 16.1 Object model
One **Product per plan**, one **Price per currency** (6 recurring Prices for v1: Starter/Professional/Business × HUF/EUR). Enterprise/Founder have no Product/Price. Config moves from a single `STRIPE_PRICE_ID` to a **Price registry** mapping `{ plan, currency } → priceId` and reverse `priceId → plan`.

### 16.2 Price → plan
```
planForSubscription(sub) = STRIPE_PRICE_TO_PLAN[sub.items.data[0].price.id] ?? "starter"
```
Plan derived from **which Price** was bought; status gates trialing/active vs. inactive/read-only.

### 16.3 Guards (critical)
Inside `applySubscriptionUpdate` (single write source):
```
if (company.manualPlan || company.hidden) return;  // never overwrite founder/enterprise plan
```

### 16.4 Preserved invariants
Webhook signature + raw-body ordering (`express.raw` before `express.json`); idempotent single-source writes (webhook and `/sync` both call `applySubscriptionUpdate`); `resolveCompanyId(metadata → customer)`; owner-only Checkout/Portal.

### 16.5 Config
Replace single `STRIPE_PRICE_ID` with per-plan/per-currency IDs, fail-fast validated in `config.ts`. `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` unchanged.

---

## 17. Database Impact

Additive, backward compatible, default-safe. `plan` stays a `String`.

### 17.1 New `Company` fields

| Field | Type | Default | Purpose |
|---|---|---|---|
| `hidden` | `Boolean` | `false` | Founder/internal exclusion + unlimited short-circuit |
| `manualPlan` | `Boolean` | `false` | Enterprise/Founder marker; Stripe must not overwrite `plan` |
| `manualLimits` | `String?` (JSON) | `null` | Enterprise per-company limit/feature overrides (incl. custom storage) |
| `trialEndsAt` | `DateTime?` | `null` | Trial end → derived trial/read-only states |
| `planUpdatedAt` | `DateTime?` | `null` | Audit: last plan change |

### 17.2 Not added
No per-user billing fields. No separate `Subscription` table for v1 (a `SubscriptionEvent` history table can be added additively later). No Prisma enum for `plan`.

### 17.3 Reused
`plan`, `subscriptionStatus`, `stripeCustomerId`, `stripeSubscriptionId`, `subscriptionEndsAt`, `active`, `deletedAt`, plus branding/invoice fields.

### 17.4 One-time migration (simple, no legacy plans)

Axeriva is early-stage; there is **no need for permanent legacy plans or a compatibility layer.** A single one-shot normalization runs alongside the additive migration and is then irrelevant:

- `plan = "free"` → **`starter`**
- `plan = "pro"` → **`professional`**
- Founder company → `plan="founder"`, `hidden=true`, `manualPlan=true`
- Enterprise company → `plan="enterprise"`, `manualPlan=true`

After this runs, **only the five canonical keys exist.** No `legacy_free`, no special-case pricing, no compatibility code path. Migrated companies are ordinary Starter/Professional customers on standard pricing going forward. (A short dry-run count before/after confirms every row maps; reversible via the additive columns.)

---

## 18. Backend Impact

| Area | Change |
|---|---|
| `constants/features.ts` / `plans.ts` (new) | Feature + Limit Registries with full metadata. |
| `services/planAccess.ts` (new) | Capability service (short-circuit hidden/founder). |
| `utils/planLimits.ts` (refactor) | Re-express existing checks on `isWithinLimit`. |
| `services/stripe/syncSubscription.ts` | Manual-plan guard; `planForStatus` → `planForSubscription`. |
| `middleware/writeGuard` (new) | Enforce Read-Only/Suspended at create/update/delete/upload. |
| `routes/subscription.routes.ts` | Checkout by `{plan, currency}`; `GET /subscription/capabilities`; reject checkout for enterprise/founder. |
| Admin endpoint (new) | DEVELOPER-only: assign founder/enterprise/suspend, set `hidden`/`manualPlan`/`manualLimits`; exclude `hidden` from lists. |
| Create endpoints | Enforce limits via `isWithinLimit`. |
| Developer API (future) | Gated by `developer_api`/`api_keys`, quota `apiRequestsPerMonth`. |

**Preserved:** webhook route + signature/raw-body, single write source, RBAC, company-active enforcement, audit logging.

---

## 19. Frontend Impact

| Area | Change |
|---|---|
| `pages/PricingPage.tsx` | Four public plans from §7; price/currency by language; Enterprise "Contact Sales"; Founder never rendered (see §20). |
| `pages/SubscriptionPage.tsx` | Current plan, trial countdown, read-only banner, upgrade/downgrade CTAs, Billing Portal — all from the `capabilities` payload. |
| Capability context | Fetch `GET /subscription/capabilities` once; UI-gate with `capabilities.features.<key>` + `limits`; else `UpgradePrompt`. Reuse `apiFetch`/`authHeaders`/`t()`. |
| `UpgradePrompt` (new) | Reusable upgrade surface in the existing dark design system. |
| Read-only UX | Disable/hide create/edit/delete/upload; show banner + subscribe CTA. |
| i18n | Plan/feature/limit/trial/marketing copy in `en.json` + `hu.json`. |

No redesign of existing components — additive props + one new `UpgradePrompt`.

---

## 20. Pricing Page Specification

### 20.1 Layout
Four cards in a responsive row (Starter · Professional · Business · Enterprise), reusing the dark design system (cards `rounded-3xl border-white/10 bg-white/5`). Above the cards: the per-company headline (§2.1) and a **HUF ⇄ EUR** control. Below: an FAQ. Founder is **never** shown.

### 20.2 Card anatomy (per public plan)

| Element | Detail |
|---|---|
| Plan name | Starter / Professional / Business / Enterprise |
| **Recommended badge** | On **Professional** ("Most popular") — the intended default for growing businesses. |
| **Trial badge** | On Starter/Professional/Business: "14-day free trial · no credit card". |
| Price | Localized monthly price (`7 990 Ft` / `€29.99`); Enterprise shows "Contact Sales". |
| Value line | Headline value from §6. |
| Feature list | Top differentiators from §7 (the comparison table is the source of truth; the card shows the highlights + "everything in <lower tier>"). |
| **CTA button** | Starter/Pro/Business: **"Start free trial"** → Checkout (trial). Enterprise: **"Contact Sales"** → contact form/mailto. Read-only/existing customers see contextual CTAs ("Upgrade", "Manage billing"). |

### 20.3 HUF / EUR switching
Currency follows website language by default (`hu→HUF`, `en→EUR`); the toggle lets a visitor preview the other currency. The **charged** currency is always the Stripe Price matching the resolved currency (§16). Formatting is locale-correct.

### 20.4 Enterprise "Contact Sales" card
No price, no trial badge. Lists enterprise-only capabilities (SSO, SCIM, white-label, custom domain, dedicated account manager, SLA, custom development, custom limits). CTA opens a contact/sales flow; no Checkout.

### 20.5 Full comparison + FAQ
A "Compare all features" expander renders the full §7 table. FAQ (i18n) covers at least:
- **"Is Axeriva priced per user?"** — No. One subscription per company; every employee is included.
- **"Do I need a credit card for the trial?"** — No. 14 days, no card.
- **"What happens when my trial ends?"** — Your account becomes read-only; your data stays and you can browse/export. Subscribe anytime to restore full access.
- **"Can I change plans later?"** — Yes. Upgrades are immediate (prorated); downgrades apply at period end.
- **"What currency am I charged in?"** — HUF for Hungarian, EUR for English; shown before checkout.
- **"What's included in Enterprise?"** — SSO, SCIM, white-label, custom domain, SLA, dedicated account manager, custom limits — contact sales.

---

## 21. Future Add-ons

Add-ons let a company **raise a limit or top up a metered resource without changing plan**. Not implemented now, but the Limit Registry + `manualLimits` already make them a clean additive extension: an add-on either raises a `LimitKey` ceiling or grants metered units.

| Add-on | Raises / grants | Limit key affected | Billing model (future) | Availability |
|---|---|---|---|---|
| Additional Storage | +GB blocks | `storageBytes` | Recurring Stripe Price per block (e.g. +50 GB) | Any paid plan |
| Additional API Requests | +request quota | `apiRequestsPerMonth` | Metered/tiered Stripe Price, or monthly top-up block | Professional+ |
| Additional AI Credits | +AI usage units | new `aiCredits` limit key | Metered Stripe Price (consumable) | Business+ |
| Additional Locations | +location slots | `locations` | Recurring per-slot Stripe Price | Business+ |

**Architecture support (design):**
- Add-ons are modeled as **additional Stripe subscription items** on the company's subscription (or standalone metered prices), never as new plans.
- The resolved ceiling becomes `base plan limit + Σ add-on grants`, computed in `limitFor()` by reading add-on state (stored on `manualLimits`/a future `CompanyAddon` table) — the capability service stays the single resolver.
- No new gating code: enforcement continues through `isWithinLimit`; the number it compares against simply increases.
- Metered add-ons (AI credits, API overage) report usage to Stripe; ceilings/warnings reuse the §9 UI behaviors.

This keeps add-ons **additive and orthogonal**: plans define capability tiers; add-ons flex the ceilings within a tier.

---

## 22. Security Considerations

- **Server is source of truth**: capabilities, limits, and the read-only/suspended write-guard are enforced backend-side; frontend gating is UX only.
- **Manual-plan integrity**: `manualPlan`/`hidden` guard prevents privilege loss and escalation via forged/misrouted Stripe events; only DEVELOPER sets these flags.
- **Webhook trust**: keep signature verification + raw-body ordering; never trust `metadata` without `resolveCompanyId`.
- **RBAC vs capability stay separate**; both must pass.
- **Developer API**: keys hashed at rest (`hashToken`), company-scoped, quota-limited, revocable; never cross-tenant. **Internal API never plan-gated.**
- **SSO/SCIM (Enterprise)**: standards-based (SAML/OIDC, SCIM 2.0); provisioning changes audited.
- **Add-ons**: usage/quota computed server-side; a client can never grant itself extra limits.
- **PCI**: card data never touches Axeriva servers (Stripe-hosted). VAT/tax fields already captured.

---

## 23. Internationalization

- **Currency by language**: `hu→HUF`, `en→EUR`, default `EUR`; central resolver, open to more markets.
- **Locale-correct formatting** (`7 990 Ft`, `€29.99`).
- **All plan/feature/limit/trial/marketing/FAQ copy** in i18n via `t()`; plan **keys** canonical/stable, display names translatable.
- **Stripe Prices per currency** ⇒ charged = displayed local price (no FX approximation).
- **Tax**: Hungarian ÁFA / EU VAT (OSS) via Stripe Tax per market when scaling; `vatNumber`/`taxNumber` present.

---

## 24. Future Modules & Expansion Strategy

- **New feature** → add to `FEATURES` (with metadata), list in including plans; Enterprise/Founder auto-include via `"ALL"`. No migration.
- **New limit** → add to `LIMITS`; missing ⇒ `Infinity`; enforce at its create endpoint. No migration.
- **New module** (§8.2) → ship behind its `module_*` key at its recommended tier.
- **New plan/tier** → add a `PLANS` entry + Stripe Product/Prices + pricing rows; `plan` stays a String.
- **New market/currency** → currency mapping + Stripe Prices + pricing rows.
- **Add-ons** (§21) → Stripe subscription items + ceiling math in `limitFor`.
- **Subscription history** → additive `SubscriptionEvent` table when needed.

Invariant: **commercial changes live in registries and Stripe config, not scattered code.**

---

## 25. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Stripe overwrites a manual plan** | Critical | `manualPlan`/`hidden` guard in `applySubscriptionUpdate`, added in the same change as the flags. |
| **Display price drifts from Stripe Price** | High | §7 table + pricing constant as single source; release check vs. Price IDs; automated test. |
| **One-time migration mis-maps a row** | Medium | Simple deterministic mapping (§17.4); dry-run counts before/after; reversible additive columns. |
| **Read-only/suspended write-guard gap** | High | Single central write-guard middleware; checklist of every mutating endpoint; tests. |
| **Downgrade data-loss expectations** | Medium | Non-retroactive rule + clear over-limit UX (§9); never delete. |
| **Trial abuse (repeat trials)** | Medium | One trial per company by policy; track prior trial. |
| **Add-on ceiling math bugs** | Medium | Single resolver (`limitFor`) computes base+add-ons; unit tests per limit. |
| **Multi-Price config sprawl** | Low | Central Price registry + `config.ts` fail-fast validation. |
| **VAT/tax compliance** | Medium | Stripe Tax; VAT numbers captured; pre-EU-scale task. |
| **Positioning dilution (seat-thinking)** | Medium | "Per-company, never per-seat" documented invariant (§2–3); guardrails explicitly non-billing. |

---

## 26. Recommended Implementation Order

1. **Registries** — `constants/features.ts` + `plans.ts` (features, limits, metadata, `supportTier`, flags). Additive.
2. **Capability service** — `services/planAccess.ts`; refactor `planLimits.ts` onto it.
3. **Additive migration** — `Company.hidden`, `manualPlan`, `manualLimits`, `trialEndsAt`, `planUpdatedAt`.
4. **One-time normalization** — `free→starter`, `pro→professional`, founder/enterprise flags; switch gating to the five canonical keys (no legacy plans afterward).
5. **Stripe manual-plan guard + Price→plan mapping** — with/next to steps 3–4 so a renewal can't clobber a manual plan.
6. **Stripe Products/Prices + multi-currency config** — Price registry; language-driven currency at checkout.
7. **Trials + read-only** — Checkout trial; `trialEndsAt`; write-guard middleware + read-only UX; billing state machine wiring.
8. **Capabilities exposure + pricing page** — `GET /subscription/capabilities`; `UpgradePrompt`; four-plan pricing page per §20 (Recommended/Trial badges, HUF/EUR, FAQ, Contact Sales); i18n.
9. **Enterprise + Founder + Suspend provisioning** — DEVELOPER admin; badges; exclude `hidden`.
10. **Developer API (Professional+)** — public surface gated + quota-limited; separate from internal API.
11. **Future modules** — ship each behind its `module_*` key at its recommended tier.
12. **Add-ons + Enterprise security (SSO/SCIM) + (later) subscription history / Stripe Tax** as the product scales.

---

*End of design. No implementation performed. This document is the authoritative reference for building the Axeriva subscription system step by step.*
