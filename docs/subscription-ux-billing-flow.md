# Axeriva — Subscription UX & Billing Flow Specification

**Status: DESIGN ONLY.** No code, schema, route, or Stripe object is modified by this document. It is the visual and functional specification for the frontend, and the companion to [subscription-system-design.md](subscription-system-design.md) (the commercial/technical design). Where that document defines *what* the plans, features, limits, and states are, this one defines *how the customer experiences them*.

Grounded in the existing frontend at the current `master` head.

---

## 0. Reuse Inventory (what already exists)

Every screen below is specified in terms of components that already exist, so implementation is assembly, not invention.

| Existing asset | Location | Reused for |
|---|---|---|
| `Button` (primary/danger/secondary · md/lg) | `components/ui/Button.tsx` | All CTAs |
| `Modal` (open/title/children/onClose, dark, max-w-2xl) | `components/ui/Modal.tsx` | Upgrade/downgrade/cancel dialogs |
| `ConfirmModal` (title/message/confirm/cancel) | `components/ui/ConfirmModal.tsx` | Destructive confirms (cancel, downgrade) |
| `Toast` + `useToast` | `components/ui/Toast.tsx`, `hooks/useToast.ts` | Transient success/info |
| `EmptyState` (icon/title/desc/bare) | `components/ui/EmptyState.tsx` | Empty billing history, no invoices, locked feature |
| `Tooltip` / `InfoTooltip` | `components/ui/Tooltip.tsx` | Metric explanations, limit hints |
| `Skeleton*` | `components/ui/Skeleton.tsx` | Loading states for billing/pricing |
| `StatCard` (+ tooltip) | `components/StatCard.tsx` | Storage/API usage tiles |
| `PageHeader` | `components/PageHeader.tsx` | Section headers |
| `EmailVerificationBanner` (orange `border-b`, inline action) | `components/EmailVerificationBanner.tsx` | **Banner pattern** for trial/read-only banners |
| `subscription.service` (`getSubscriptionStatus`/`startCheckout`/`startPortal`/`syncCheckoutSession`) | `services/subscription.service.ts` | Extended, not replaced |
| Landing `PricingSection` | `components/landing/PricingSection.tsx` | Rebuilt for 4 plans |
| Design system | `index.css` (dark: `#0f172a`, cards `rounded-3xl border-white/10 bg-white/5`, accent orange) | Everything |

**Gaps to add (design below):** a persistent **in-app notification center** (only transient `Toast` exists today), a **BillingBanner** host in the app shell, an **UpgradePrompt** / **FeatureLocked** surface, and billing sub-pages under Settings.

---

## 1. Pricing Page

Public page (`/pricing`), reachable pre-auth via `LandingNavbar`. Rebuilds `PricingSection` around the four public plans; the **§7 comparison table in the system-design doc is the source of truth**.

### 1.1 Desktop layout (≥1024px)

```
┌───────────────────────────────────────────────────────────────────────────┐
│  LandingNavbar                                          [ HUF | EUR ]  ↹    │
├───────────────────────────────────────────────────────────────────────────┤
│                    One subscription. Your whole company.                    │
│              Every employee included — never pay per user.                  │
│                                                                             │
│  ┌──────────┐   ┌──────────────┐   ┌──────────┐   ┌──────────────┐         │
│  │ STARTER  │   │ PROFESSIONAL │   │ BUSINESS │   │  ENTERPRISE  │         │
│  │          │   │ ★ MOST POPULAR│   │          │   │              │         │
│  │ 7 990 Ft │   │  16 990 Ft   │   │34 990 Ft │   │ Contact Sales│         │
│  │ /month   │   │   /month     │   │ /month   │   │              │         │
│  │14-day trial│ │ 14-day trial │   │14-day trial│ │  (no price)  │         │
│  │          │   │              │   │          │   │              │         │
│  │ ✓ Core   │   │ everything + │   │ everything+│ │ everything + │         │
│  │ ✓ 5 GB   │   │ Analytics    │   │ Automation │ │ SSO / SCIM   │         │
│  │ ✓ CSV    │   │ Dev API      │   │ AI, Webhooks│ │ White-label  │         │
│  │ ✓ Email  │   │ Exports      │   │ Multi-loc  │ │ SLA, Manager │         │
│  │          │   │ 25 GB        │   │ 100 GB     │ │ Custom       │         │
│  │[Start    │   │ [Start free  │   │[Start free │ │[Contact      │         │
│  │  trial]  │   │   trial]     │   │  trial]    │ │  Sales]      │         │
│  └──────────┘   └──────────────┘   └──────────┘   └──────────────┘         │
│                                                                             │
│              ▸ Compare all features   (expands full §7 table)               │
│                                                                             │
│                              FAQ (accordion)                                │
├───────────────────────────────────────────────────────────────────────────┤
│  LandingFooter                                                              │
└───────────────────────────────────────────────────────────────────────────┘
```

- 4 cards in a single row (`grid grid-cols-4 gap-6`). Professional is visually elevated (orange border `border-orange-500/30`, subtle scale, `★ Most popular` badge).

### 1.2 Mobile layout (<768px)

- Cards stack vertically (`grid-cols-1`), **Professional first** (recommended-first ordering), then Starter, Business, Enterprise; each full-width.
- HUF/EUR toggle sits under the headline, full-width segmented control.
- "Compare all features" opens the comparison table in a horizontally-scrollable container (`overflow-x-auto`, sticky first column) — no page-level horizontal scroll.
- FAQ is a stacked accordion.

### 1.3 Card design (per public plan)

| Zone | Content |
|---|---|
| Header | Plan name; **Recommended badge** (Professional only, `★ Most popular`); **Trial badge** (`14-day free trial · no card`). |
| Price | Localized monthly price (`7 990 Ft` / `€29.99`), `/month` in muted text. Enterprise: "Contact Sales", no price. |
| Value line | Headline from system-design §6. |
| Highlights | 4–6 bullets: "Everything in <lower tier>, plus …". |
| CTA | See §1.4. |

Reuses the card shell (`rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl`) already used by `SubscriptionPage`.

### 1.4 CTA buttons

| Plan | Visitor (logged-out) | Logged-in owner (no sub) | Logged-in owner (has sub) |
|---|---|---|---|
| Starter/Pro/Business | **Start free trial** → register → Checkout(trial) | **Start free trial** → Checkout(trial) | **Upgrade/Downgrade** (contextual) or **Current plan** (disabled, ✓) |
| Enterprise | **Contact Sales** → contact form | **Contact Sales** | **Contact Sales** |

`Button variant="primary"` for the recommended plan; `secondary` for the others; Enterprise `secondary`. Current plan renders a disabled `✓ Current plan` state.

### 1.5 Recommended & Trial badges
- **Recommended:** small pill top-center of the Professional card, orange (`bg-orange-500/15 text-orange-300`), text from i18n (`pricing.badge.recommended`).
- **Trial:** slate pill under price on the three trial plans (`bg-white/10 text-slate-300`), `pricing.badge.trial`.

### 1.6 Enterprise card
No price, no trial badge. Lists enterprise-only capabilities (SSO, SCIM, white-label, custom domain, dedicated account manager, SLA, custom development, custom limits). CTA = **Contact Sales** (opens contact/sales flow or `mailto:`). Never shows Checkout.

### 1.7 FAQ section
Accordion (reuse simple disclosure). Minimum entries (i18n `pricing.faq.*`): per-user pricing, credit card for trial, what happens at trial end (read-only), changing plans (upgrade immediate / downgrade at period end), currency charged, what's in Enterprise. (Full copy in system-design §20.5.)

### 1.8 HUF/EUR switching
- Currency follows website language by default (`hu→HUF`, `en→EUR`); the segmented toggle lets a visitor preview the other currency.
- Toggle updates **display only**; the **charged** currency is the Stripe Price matching the resolved currency at checkout.
- Values come from a single pricing constant (source of truth shared with the comparison table) — never FX-computed client-side.

### 1.9 Feature comparison table
The full system-design §7 table, behind "Compare all features". Sticky header + sticky first column, `overflow-x-auto`, `●/—` marks, grouped section rows. This is the canonical marketing surface.

---

## 2. Trial Experience

### 2.1 Registration → trial start
1. Owner registers (existing auth flow) and picks a plan (or defaults to Professional).
2. **Start free trial** → Stripe Checkout in trial mode (no card). On return (`?checkout=success`), reuse the existing `syncCheckoutSession` reconcile.
3. `trialEndsAt` set; company enters **Trial** state (system-design §14). Toast: "Your 14-day trial has started."

### 2.2 Trial banner (persistent, app-shell)
Reuses the `EmailVerificationBanner` pattern (a new `BillingBanner` in the same slot). Shown on every authenticated page while `trialing`.

```
┌───────────────────────────────────────────────────────────────────────┐
│ 🎉 You're on a Professional trial — 9 days left.   [ Choose a plan → ] │
└───────────────────────────────────────────────────────────────────────┘
```
- Neutral/info tone (slate/orange) while >3 days remain.
- CTA → Billing Settings (§3) / Checkout.

### 2.3 Remaining days & warning escalation
Severity escalates as `trialEndsAt` approaches (drives banner color + notifications §13):

| Days left | Banner tone | Copy | CTA |
|---|---|---|---|
| 14–4 | Info (slate) | "{n} days left in your trial." | Choose a plan |
| 3 | Warning (amber) | "Only 3 days left — add a plan to keep full access." | Choose a plan |
| 1 | Critical (red) | "Your trial ends tomorrow. Subscribe to avoid read-only mode." | Subscribe now |
| 0 (expired) | Critical (red), persistent | "Your trial has ended — your account is read-only." | Subscribe now |

### 2.4 Expired state
On trial end without payment → **Expired → Read-Only** (§11). The banner becomes persistent red and cannot be dismissed until the company subscribes.

### 2.5 Read-only trial experience
See §11 — identical mechanics to any read-only state: browse + export allowed, all writes blocked, banner + subscribe CTA everywhere.

---

## 3. Billing Settings

New **Billing** area. Recommended placement: a dedicated `/subscription` page (existing route) expanded into sections, with a link from `SettingsPage` ("Billing & plan → "). BUSINESS_OWNER only (DEVELOPER has no company; EMPLOYEE has no billing access — §14 RBAC).

### 3.1 Layout

```
Billing & Plan
├─ [ Current Plan ]        plan name, status pill, next billing date, price
│    └─ actions: Upgrade · Downgrade · Cancel / Resume · Manage payment
├─ [ Trial Status ]        (only while trialing) days left, progress bar, Subscribe
├─ [ Usage ]              StatCards: Storage (used/limit + bar), API (used/quota + bar)
├─ [ Payment Method ]     card brand/last4 (from Stripe), "Manage" → Portal
└─ [ Billing History ]    invoice list (date, amount, status, PDF) or EmptyState
```

### 3.2 Current Plan card
- Reuses the existing "Current plan" card, extended: plan display name, **status pill** (color per state §14), next billing/renewal date, monthly price in the company's currency.
- Action row (contextual per state, §5–10): **Upgrade**, **Downgrade**, **Cancel** (if active) / **Resume** (if cancel-scheduled), **Manage payment** (→ Portal).

### 3.3 Upgrade / Downgrade / Cancel / Resume
Entry points here open the dialogs in §6/§7/§10. All plan changes are driven by the resolved capabilities payload — no hardcoded plan strings.

### 3.4 Payment Method
- Displays card brand + last4 + expiry (read from Stripe via a small backend passthrough; never stored by Axeriva).
- **Manage** → Stripe Billing Portal (existing `startPortal`). If no method on file (trial), show "No card on file — added when you subscribe."

### 3.5 Billing History
- Table: date · description · amount · status pill · **Invoice PDF** (Stripe hosted URL).
- Empty (trial / no invoices yet) → `EmptyState` icon `🧾`, "No invoices yet", "Your invoices will appear here after your first payment."

### 3.6 Storage Usage
- `StatCard` "Storage" showing `used / limit` + a usage bar colored green/amber/red (reuse the analytics StorageBar coloring): ≥80% amber, 100% red.
- Tooltip explains storage is company-wide (reuse `InfoTooltip`). At 100%, inline "Storage full — upgrade or free space" with upgrade CTA.

### 3.7 API Usage
- Shown only when `developer_api` is available (Professional+). `StatCard` "API requests" `used / quota` + bar. At quota, link to add-on (future §21 of system-design) / upgrade.

### 3.8 Trial Status
- Only while `trialing`: days-left number, a 14-day progress bar, `trialEndsAt` date, and **Subscribe** CTA. Hidden once active/paid.

---

## 4. Stripe Checkout UX

- **Entry:** any "Start free trial" / "Subscribe" / "Upgrade" CTA → backend creates a Checkout Session for the `{plan, currency}` Price → `window.location.href = url` (existing pattern).
- **Trial:** `trial_period_days=14`, `payment_method_collection="if_required"` → no card fields for trial starts.
- **Loading:** button shows spinner text ("Starting checkout…") — existing behavior.
- **Return success** (`?checkout=success&session_id=…`): reuse `syncCheckoutSession` to reconcile immediately (don't wait for webhook), then refresh status; Toast "Subscription activated" / "Trial started".
- **Return cancelled** (`?checkout=cancelled`): info Toast "Checkout cancelled — you have not been charged." No state change.
- **Failure to create session** (Stripe unconfigured/offline): inline error in the card (existing `message` slot) + retry; see error states §15.

### 4.1 Checkout sequence
```
UI CTA ─▶ POST /subscription/checkout {plan,currency}
        ◀─ { url }
      ─▶ redirect to Stripe Checkout (hosted)
      ◀─ redirect back ?checkout=success&session_id=…
      ─▶ POST /subscription/sync {sessionId}   (reconcile)
      ─▶ GET /subscription/capabilities         (refresh UI)
```

---

## 5. Stripe Customer Portal UX

- **Entry:** "Manage payment" / "Manage subscription" → backend creates a Billing Portal session (existing `startPortal`) → redirect.
- **In-portal actions** (Stripe-hosted): update card, view/download invoices, cancel/resume (if enabled). Axeriva does not reimplement these.
- **Return:** back to Billing Settings; on load, `GET /subscription/capabilities` refreshes. Webhooks (`customer.subscription.updated/deleted`) keep state authoritative.
- **Guardrail:** the Portal is configured to **not** allow arbitrary plan switching that would bypass Axeriva's proration/mapping (plan changes go through Axeriva's own upgrade/downgrade UI so the Price→plan mapping and messaging stay controlled). Portal focuses on payment method + invoices + cancel.

---

## 6. Upgrade Flow

Immediate, prorated. Owner-initiated from Billing Settings or a `FeatureLocked` prompt.

### 6.1 Upgrade dialog (`Modal`)
```
┌─ Upgrade to Business ─────────────────────────────┐
│ You'll get: Automation, Webhooks, AI, Multi-       │
│ location, Advanced branding, 100 GB storage.       │
│                                                     │
│ New price: 34 990 Ft / month                        │
│ You'll be charged a prorated amount today for the   │
│ rest of this billing period. Full access is         │
│ immediate.                                          │
│                                                     │
│              [ Cancel ]   [ Upgrade now ]           │
└─────────────────────────────────────────────────────┘
```
- Confirm → backend updates the subscription (or Checkout for the target Price) → webhook maps Price→plan → capabilities refresh → Toast "You're now on Business." New features unlock immediately.
- From a locked feature, the dialog is pre-scoped to the plan that unlocks it (`upgradeTo` hint from the 402 response).

---

## 7. Downgrade Flow

Scheduled at period end, non-retroactive.

### 7.1 Downgrade dialog (`ConfirmModal`, amber not red)
```
┌─ Downgrade to Starter? ───────────────────────────┐
│ Your Business features stay active until <date>.   │
│ After that:                                         │
│  • You'll lose: Automation, AI, Webhooks, Multi-    │
│    location, advanced analytics.                    │
│  • Data is kept — nothing is deleted.               │
│  • You have 12 projects; Starter allows 25 — OK.    │
│  • ⚠ You have 60 employees; Starter allows 10.      │
│    Existing employees stay, but you can't add new   │
│    ones until you're under the limit.               │
│                                                     │
│         [ Keep Business ]   [ Schedule downgrade ]  │
└─────────────────────────────────────────────────────┘
```
- Shows **over-limit conflicts** (§15 "Plan Downgrade Conflict") computed from current counts vs. target-plan limits, with the non-retroactive rule spelled out.
- Confirm → schedule at period end (`cancel_at_period_end`/scheduled update). Banner + notification "Downgrade scheduled for <date>." Owner can **Resume/Keep** before the date.

---

## 8. Trial Expiration Flow

```
trialing ──(T-3d)──▶ amber banner + email/in-app "3 days left"
         ──(T-1d)──▶ red banner + "1 day left"
         ──(T-0)───▶ trial ends, no card ─▶ Expired ─▶ Read-Only
                         │
                         ├─ persistent red banner "Account is read-only"
                         ├─ email "Trial expired"
                         └─ every write blocked (§11)
         ──subscribe──▶ Active (full access restored, data intact)
```
- The transition is enforced server-side (write-guard); the UI reflects it via the capabilities payload (`state: read_only`).

---

## 9. Payment Failure Flow

```
active ─renewal charge fails─▶ Past Due (grace)
   ├─ email "Payment failed — update your card" (CTA: Update payment)
   ├─ in-app critical notification + amber banner
   ├─ Stripe dunning retries automatically
   ├─ recovered ─▶ Active (Toast "Payment successful")
   └─ grace elapses, still failing ─▶ Read-Only (§11)
```
- Banner during Past Due: "We couldn't process your payment. Update your card to avoid losing access. [ Update payment → Portal ]".
- Never blocks writes *during* grace (soft-fail) — only after grace elapses.

---

## 10. Subscription Cancel Flow

### 10.1 Cancel dialog (`ConfirmModal`, red)
```
┌─ Cancel subscription? ────────────────────────────┐
│ Your plan stays active until <period end>. After   │
│ that your account becomes read-only — your data is  │
│ kept and you can reactivate anytime.                │
│                                                     │
│ Tell us why (optional): [ ▾ reason ]                │
│                                                     │
│         [ Keep subscription ]   [ Cancel plan ]     │
└─────────────────────────────────────────────────────┘
```
- Confirm → `cancel_at_period_end` → state **Cancelled** (still active until period end). Banner "Your plan is cancelled and ends <date>. [ Resume ]".
- **Resume** before period end → back to Active (Toast "Subscription resumed"). At period end → Read-Only.
- Optional cancel-reason feeds retention analytics (not billing).

---

## 11. Read-only Mode UX

Applies to Expired / Cancelled-elapsed / Past-Due-after-grace.

- **Persistent, non-dismissible banner** (red, app-shell): "Your account is read-only. Subscribe to restore full access. [ Choose a plan → ]".
- **Allowed:** navigation, viewing all data, analytics, **export** (CSV/Excel/PDF where the plan allowed it), opening Billing.
- **Blocked:** every create/edit/delete/upload. Implementation of the *feel*:
  - Primary "New / Create / Save / Upload / Delete" buttons render **disabled** with a `Tooltip`: "Read-only — subscribe to make changes."
  - Any blocked action attempted via deep link / stale UI → backend write-guard returns `403 read_only`; the frontend catches it and opens the **Subscribe** dialog rather than a raw error.
- **One-click recovery:** Subscribe → Checkout → Active → full write access, data unchanged.

Rationale (from system-design §13): read-only preserves trust and keeps value on screen, converting better than a hard lockout.

---

## 12. Feature Locked UX

For features the current plan doesn't include (e.g. Starter user opens Automation).

### 12.1 `FeatureLocked` surface (new component, built from `EmptyState`)
```
        🔒
   Automation is a Business feature
   Automate repetitive work with rules and
   workflows. Upgrade to Business to unlock it.
        [ See plans ]   [ Upgrade to Business ]
```
- Rendered in place of the gated feature's content (reuse `EmptyState` with `icon="🔒"` + action buttons).
- Buttons: **Upgrade to <plan>** (opens §6 dialog pre-scoped) and **See plans** (→ pricing/billing).
- Nav entries for unavailable features either hide or show a small `🔒` with an `InfoTooltip` ("Business feature") — configurable; recommend **show + lock** for discoverability (drives upgrades).

### 12.2 Inline lock (small controls)
For a single locked button (e.g. "Export to Excel" on Starter): render enabled-looking but on click open a compact **UpgradePrompt** popover instead of performing the action.

### 12.3 `UpgradePrompt` (new, reusable)
Small card/popover: title, one-line benefit, `Upgrade` + `See plans`. Used by inline locks, usage-limit hits, and API/storage ceilings. Driven by the `upgradeTo` hint from the backend 402/limit responses.

---

## 13. Notifications — Complete Communication Matrix

**Channels:** **Email** (via existing `emailService`), **In-app** (new persistent notification center — see §13.2), **Banner** (app-shell `BillingBanner`). **Severity:** Info / Success / Warning / Critical. Each has a single primary **CTA**.

| Event | Email | In-app | Banner | Severity | CTA |
|---|:--:|:--:|:--:|---|---|
| Trial Started | ✓ | ✓ | ✓ (info) | Info | Explore your plan |
| 7 Days Remaining | ✓ | ✓ | ✓ (info) | Info | Choose a plan |
| 3 Days Remaining | ✓ | ✓ | ✓ (amber) | Warning | Choose a plan |
| 1 Day Remaining | ✓ | ✓ | ✓ (red) | Critical | Subscribe now |
| Trial Expired | ✓ | ✓ | ✓ (red, persistent) | Critical | Subscribe now |
| Payment Failed | ✓ | ✓ | ✓ (amber) | Critical | Update payment |
| Payment Successful | ✓ | ✓ | — | Success | View invoice |
| Subscription Renewed | ✓ | ✓ | — | Success | View invoice |
| Subscription Cancelled | ✓ | ✓ | ✓ (amber until period end) | Warning | Resume plan |
| Upgrade Successful | ✓ | ✓ | — | Success | Explore new features |
| Downgrade Scheduled | ✓ | ✓ | ✓ (info until effective) | Info | Review / Keep plan |
| Invoice Paid | ✓ | ✓ | — | Success | Download PDF |
| Invoice Failed | ✓ | ✓ | ✓ (amber) | Critical | Update payment |
| Webhook Error (internal) | — | — | — | Critical (ops) | Alert DEVELOPER/ops only |
| Storage Limit Reached | ✓ | ✓ | ✓ (amber) | Warning | Upgrade / free space |
| API Limit Reached | ✓ | ✓ | ✓ (amber, if API user) | Warning | Upgrade / add-on |

Notes:
- **Webhook Error** is an **internal ops** signal, never customer-facing (log + DEVELOPER alert); listed because it's a billing event class.
- Email templates extend the existing `emailService` (which already sends `sendSubscriptionConfirmedEmail`); each event = one template, i18n by company language.
- Every customer email and in-app item carries exactly one primary CTA (deep link into Billing / Portal / Pricing).

### 13.1 Toast vs. notification center
- **Toast** (existing): transient, for immediate action results (upgrade success, resume). Auto-dismiss.
- **Notification center** (new): persistent list (bell icon in `Topbar`), unread badge, entries with severity icon + CTA. Billing events that need durability (trial reminders, payment failed, downgrade scheduled) land here.

### 13.2 In-app notification center (new)
- `Topbar` bell → dropdown list; unread count badge.
- Item: icon (severity), title, timestamp, CTA. Mark-read on open.
- Backed by a lightweight notifications feed (design; storage TBD — can reuse an additive table later). For v1, billing notifications may be **derived** from subscription state + `trialEndsAt` (no new table needed) and merged with any stored events.

---

## 14. RBAC vs Subscription — Complete Permission Model

Two orthogonal axes decide every gated action. **Both must pass.** Order matters: cheap identity checks first, then capability, then quantity.

### 14.1 Layered model
```
        ┌─────────────────────────────────────────────┐
Request │ 1. RBAC            who are you? (role)        │  DEVELOPER / BUSINESS_OWNER / EMPLOYEE
        │        ↓                                      │
        │ 2. Subscription    is the company billable    │  active / trialing / read_only / suspended
        │                    & in a writable state?     │
        │        ↓                                      │
        │ 3. Feature Registry does the plan include     │  hasFeature(company, key)
        │                     this capability?           │
        │        ↓                                      │
        │ 4. Limit Registry   is there headroom?        │  isWithinLimit(company, key, current)
        │        ↓                                      │
        │ 5. FINAL PERMISSION  allow / deny(+reason)     │
        └─────────────────────────────────────────────┘
```

### 14.2 Responsibilities
| Layer | Question | Denies with |
|---|---|---|
| RBAC | Is this role allowed to perform this action at all? | `403 forbidden` (existing `requireRole`) |
| Subscription state | Is the company in a writable state (not read-only/suspended)? | `403 read_only` / `403 suspended` (write-guard) |
| Feature Registry | Does the plan include this capability? | `402 feature_locked` (+ `upgradeTo`) |
| Limit Registry | Is the company under the relevant ceiling? | `402 limit_reached` (+ `upgradeTo`) |
| Final | Combine | allow, or the first failing layer's reason |

### 14.3 Decision flow (create/write action)
```
             ┌─────────────┐
 request ───▶│ RBAC ok?    │──no──▶ 403 forbidden
             └─────┬───────┘
                   │yes
             ┌─────▼───────────────┐
             │ writable state?     │──no──▶ 403 read_only / suspended  ──▶ UI: Subscribe / contact support
             │ (active|trialing)   │
             └─────┬───────────────┘
                   │yes
             ┌─────▼───────────────┐
             │ hasFeature(key)?    │──no──▶ 402 feature_locked(upgradeTo) ──▶ UI: FeatureLocked / UpgradePrompt
             └─────┬───────────────┘
                   │yes
             ┌─────▼───────────────┐
             │ isWithinLimit(key)? │──no──▶ 402 limit_reached(upgradeTo) ──▶ UI: UpgradePrompt / usage banner
             └─────┬───────────────┘
                   │yes
              ▶ perform action (allow)
```

### 14.4 Sequence diagram (frontend ↔ backend)
```
Frontend                         Backend (middleware chain)             Stripe
   │  create project (POST)         │                                     │
   ├───────────────────────────────▶│ requireRole(BUSINESS_OWNER)         │
   │                                │  ok →                               │
   │                                │ writeGuard(state != read_only)      │
   │                                │  ok →                               │
   │                                │ hasFeature("projects"|module) ok →  │
   │                                │ isWithinLimit("projects", count)    │
   │                                │  fail → 402 limit_reached{upgradeTo}│
   │◀───────────────────────────────┤                                     │
   │ open UpgradePrompt(upgradeTo)  │                                     │
   │ user confirms upgrade          │                                     │
   ├───────────────────────────────▶│ POST /subscription/checkout        │
   │                                ├────────────────────────────────────▶│ create session
   │◀──────────── url ──────────────┤◀──────── url ───────────────────────┤
   │ redirect → pay → return        │                                     │
   ├───────────────────────────────▶│ /sync + webhook → plan updated      │
   │ GET /capabilities (refresh)    │                                     │
   │ retry create project → allow   │                                     │
```

### 14.5 Read-model for the UI
`GET /subscription/capabilities` returns `{ plan, state, supportTier, features:{…}, limits:{…}, usage:{…}, trialEndsAt }`. The frontend gates purely off this — it **never** re-derives permission from the plan string, matching the "no `plan === '...'`" rule.

---

## 15. Error States (billing)

Every billing error maps to a specific, friendly UI. Backend returns a typed reason; the frontend renders the matching surface (never a raw stack/JSON).

| Error | Trigger | HTTP/state | UI surface | Primary CTA |
|---|---|---|---|---|
| **Expired Trial** | Trial ended, no card | `read_only` | Persistent red banner + read-only writes (§11) | Subscribe now |
| **Card Declined** | Payment attempt fails | `402` from Checkout/Portal (Stripe-hosted) | Stripe shows inline; on return, amber banner "Payment didn't go through" | Update payment |
| **Missing Payment Method** | Subscribe/renew with no card | `past_due` / blocked | Banner "Add a payment method to continue" | Add card → Portal |
| **Stripe Offline / unconfigured** | Stripe API/network error, missing keys | `503`/`500` | Inline card error (existing `message` slot) + retry; **no state change**; disable CTA with tooltip | Retry / try later |
| **Webhook Failure** | Webhook not delivered/verified | internal | No customer error (state reconciled via `/sync` fallback); **DEVELOPER/ops alert** | Ops-only |
| **Cancelled Subscription** | Owner cancelled | `Cancelled`→`read_only` at period end | Amber banner "Ends <date>" then red read-only | Resume plan |
| **Suspended Company** | DEVELOPER/abuse hold | `suspended` | Full-screen notice "Account suspended — contact support"; login may be limited | Contact support |
| **Plan Downgrade Conflict** | Current counts exceed target-plan limits | pre-check in downgrade dialog | Conflict list in `ConfirmModal` (§7); non-retroactive explanation | Keep plan / proceed |
| **Storage Overflow** | Upload would exceed `storageBytes` | `402 limit_reached` on upload | Upload blocked + "Storage full" banner/usage bar red | Upgrade / free space |
| **API Quota Exceeded** | Over `apiRequestsPerMonth` | `429` on Developer API | API error payload + Billing usage banner | Upgrade / add-on |

Cross-cutting rules:
- **Never lose data** on any billing error; writes are blocked, not destructive.
- **Idempotent recovery**: after fixing payment/plan, `GET /capabilities` restores the correct UI; the blocked action can be retried.
- **Graceful Stripe-offline**: subscription *state* is never mutated by a transient Stripe/network failure; the user sees a retryable inline error, not a downgrade.

---

## 16. Implementation Readiness

### 16.1 Recommended implementation order (frontend UX)
1. **Capabilities read-model + context** — consume `GET /subscription/capabilities`; provide `useCapabilities()` context (unblocks all gating).
2. **BillingBanner host** in the app shell (reuse `EmailVerificationBanner` pattern) — trial/read-only/past-due/cancelled banners driven by `state`+`trialEndsAt`.
3. **FeatureLocked + UpgradePrompt** components (from `EmptyState`) — enables §12 everywhere.
4. **Read-only write-guard UX** — disable create/edit/delete/upload controls off `state`; catch `403 read_only`/`402` → open Subscribe/Upgrade dialog.
5. **Pricing Page** rebuild (4 plans, badges, currency toggle, comparison table, FAQ) — §1.
6. **Billing Settings** sections (current plan, trial status, usage, payment method, history) — §3.
7. **Upgrade/Downgrade/Cancel/Resume dialogs** — §6/§7/§10 (reuse `Modal`/`ConfirmModal`).
8. **Notification center** (Topbar bell) + email templates for §13 events.
9. **Error-state surfaces** — §15 typed-reason rendering.

### 16.2 UI components required
- **New:** `useCapabilities` context/hook, `BillingBanner`, `FeatureLocked`, `UpgradePrompt`, `PlanCard`, `PlanComparisonTable`, `CurrencyToggle`, `UsageBar` (or reuse analytics StorageBar), `NotificationCenter` + `NotificationItem`, `PaymentMethodCard`, `BillingHistoryTable`, `TrialStatusCard`, upgrade/downgrade/cancel dialogs.
- **Reused:** `Button`, `Modal`, `ConfirmModal`, `Toast`/`useToast`, `EmptyState`, `Tooltip`/`InfoTooltip`, `Skeleton*`, `StatCard`, `PageHeader`, card shell, `EmailVerificationBanner` pattern.

### 16.3 Backend changes required (per system-design §18)
- `GET /subscription/capabilities` (plan, state, features, limits, usage, trialEndsAt).
- Checkout by `{plan, currency}`; reject enterprise/founder self-serve.
- **Write-guard middleware** (read-only/suspended) returning typed `403`.
- Typed capability/limit denials (`402 feature_locked`/`limit_reached` with `upgradeTo`).
- Payment-method + invoice passthrough (read from Stripe) for Billing Settings.
- Notification triggers (trial reminders via scheduled check; payment/renewal via existing webhooks) + email templates.
- Manual-plan guard + Price→plan mapping (already specified in system-design §16).

### 16.4 Frontend changes required
- New Billing area + expanded `/subscription`; `SettingsPage` link.
- Gate every create/edit/delete/upload control and every premium feature entry off `useCapabilities`.
- Rebuild `PricingSection` for 4 plans; localized currency.
- Global handling of `402`/`403 read_only` responses → dialogs.
- i18n: all plan/feature/limit/trial/error/notification copy in `en.json` + `hu.json`.

### 16.5 Stripe changes required
- One Product per plan; one Price per currency (6 Prices v1).
- Trial config on Checkout (`trial_period_days`, `if_required`, cancel-on-missing-card).
- Billing Portal configured for payment/invoices/cancel (plan changes stay in Axeriva UI).
- Webhooks unchanged in shape; optionally add `invoice.payment_failed` for explicit past-due.

### 16.6 Risk analysis
| Risk | Severity | Mitigation |
|---|---|---|
| UI shows a capability the backend denies (or vice-versa) | High | Single `useCapabilities` read-model mirrors backend registries; backend is authoritative; contract test capabilities payload vs. registry. |
| Read-only guard bypassed via stale UI/deep link | High | Backend write-guard is the real gate; frontend catch of `403 read_only` opens Subscribe dialog. |
| Trial reminders miss/duplicate | Medium | Idempotent scheduled check keyed on `trialEndsAt` + a "last reminder sent" marker; one send per threshold. |
| Currency/price mismatch (display vs. charged) | High | Single pricing constant shared by cards + comparison table; charged currency = Stripe Price; release check. |
| Notification spam / fatigue | Medium | One primary CTA per event; thresholds only (7/3/1/expired); center + banner de-duplicated. |
| Stripe-offline mistaken for downgrade | High | Never mutate state on transient Stripe/network errors; retryable inline error only. |
| Downgrade conflict surprises (data seems lost) | Medium | Explicit conflict list + non-retroactive copy in the downgrade dialog. |
| Portal plan-switch bypasses mapping | Medium | Portal restricted to payment/invoices/cancel; plan changes via Axeriva UI. |
| No notification-center storage yet | Low | v1 derives billing notifications from state+`trialEndsAt`; add a table later if durable history is needed. |

---

*End of UX & billing-flow specification. No implementation performed. Companion to [subscription-system-design.md](subscription-system-design.md); together they are the complete, build-ready spec for the Axeriva subscription system.*
