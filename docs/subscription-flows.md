# Subscription Flows (S2.6 + Design C) — Upgrade / Downgrade / Cancel / Resume

> **Design C (2026-07-29):** paid→paid upgrades no longer apply via a silent
> `subscriptions.update` — the customer approves the exact prorated amount on
> Stripe's hosted confirmation page. Screen-level spec and acceptance
> criteria: [checkout-only-upgrades-ux.md](checkout-only-upgrades-ux.md).

Implementation reference for the subscription change engine. All business
rules live in **one place per concern**:

| Concern | Single source |
|---|---|
| Plan tiers, legacy mapping, founder/enterprise guard | `server/src/constants/plans.ts` + `server/src/services/planAccess.ts` (S2.2) |
| Limits shown/enforced after a change | `server/src/constants/limits.ts` via `getLimit()` (S2.2) |
| Stripe prices, currencies, Price-ID → plan mapping | `server/src/config/stripePricing.ts` (S2.3) |
| Change engine (upgrade/downgrade/cancel/resume) | `server/src/services/stripe/subscriptionChange.ts` (S2.6) |
| State writes from Stripe (webhook + sync) | `server/src/services/stripe/syncSubscription.ts` |
| Display pricing / plan names | `src/config/pricing.ts` + i18n (S2.1) |

`Company` billing columns: `plan`, `subscriptionStatus`, `subscriptionEndsAt`
(current period end), `stripeCustomerId`, `stripeSubscriptionId`, and (S2.6)
`cancelAtPeriodEnd` + `pendingPlan`. The last two are written only by the
sync layer and the change engine.

## Upgrade flow (Stripe-hosted confirmation — Design C)

`POST /subscription/change-plan { plan, currency, locale }` →
`changePlan()`:

1. Target must be purchasable (`starter`/`professional`/`business`);
   `enterprise` is rejected (sales-led), `founder` never purchasable.
2. Founder/Enterprise companies are operator-managed → rejected (same guard
   the webhook uses).
3. Direction decided by the S2.2 `canUpgrade()` (legacy `"pro"`/`"free"`
   aware).
4. **With a live Stripe subscription** (active/trialing +
   `stripeSubscriptionId`): the service **never** calls
   `subscriptions.update`. It releases any pending downgrade schedule
   (clears `pendingPlan` — the flow can't run on a schedule-managed
   subscription), then creates a Billing Portal session with
   `flow_data.subscription_update_confirm` (dedicated configuration:
   `always_invoice`, `end_trial`; target price in the subscription's own
   currency) and answers `{ kind: "requires_upgrade_confirmation", url }`.
   The customer approves the prorated charge on Stripe's hosted page; the
   confirmation triggers `customer.subscription.updated` (webhook) and the
   `?upgrade=confirmed` return triggers `POST /subscription/sync-subscription`
   (return-sync), so the app updates without waiting for the webhook.
   Guards: `cancelAtPeriodEnd` → `409` (two-step UX: resume first);
   `past_due`/broken-open subscription → `409` (fix payment in the Portal).
5. **Without one** (registration trial, canceled sub): the endpoint answers
   `requires_checkout` and the frontend falls back to the existing
   `/subscription/checkout` flow — a duplicate subscription is never created.
   `/checkout` itself refuses (409) whenever a not-closed subscription
   exists, suppresses the trial once `trialConsumedAt` is set (AC1), and
   re-resolves the price to the Stripe customer's pinned currency (AC4).

### Re-subscribing to the assigned plan

The billing UI and `changePlan()` distinguish the company's **assigned**
plan (`Company.plan` / `effectivePlan`) from whether it has an **active**
subscription/trial right now (`hasActiveSubscription()`, shared with the
S2.7 read-only rule). Selecting the assigned plan again:

- **With** an active PAID subscription → `400 "This is already the current
  plan."` (nothing to buy) — the Billing card shows a disabled **"Current
  plan"**.
- **On the DB-only registration trial** (live trial, no
  `stripeSubscriptionId`) → `requires_checkout` (Design C/AC2): the Starter
  card shows an active **"Subscribe to Starter"** so the owner can pay
  before the trial expires — card required, no second trial.
- **Without** an active subscription/trial (expired trial, or a subscription
  that ended) → `requires_checkout`, same as picking any other plan with no
  live subscription — the Billing card shows an active **"Subscribe to
  {plan}"** button that starts a fresh Checkout session.

## Downgrade flow (period end)

Same endpoint, `canDowngrade()` direction:

1. Requires a live Stripe subscription (nothing to schedule otherwise).
2. A **Stripe Subscription Schedule** is created `from_subscription` with two
   phases: current price until `current_period_end`, target price after;
   `end_behavior: "release"` so the subscription runs normally afterwards.
3. `Company.pendingPlan` is set for the UI ("Downgrading to X at period
   end"). Access/limits do **not** change yet.
4. At period end Stripe flips the phase and emits
   `customer.subscription.updated` with the new price — the normal sync path
   maps price → plan and the sync layer clears `pendingPlan` (it also
   self-heals: if the schedule disappears without flipping, the marker is
   dropped).
5. Re-selecting the **current** plan while a downgrade is pending releases
   the schedule and clears `pendingPlan` (downgrade cancelled).

## Cancellation flow

`POST /subscription/cancel` → `setCancelAtPeriodEnd(companyId, true)`:

- Flips Stripe's `cancel_at_period_end` — the subscription is **never
  deleted** and access continues until the period ends.
- A pending downgrade schedule is released first (a sub ending at period end
  has no next phase).
- At period end Stripe emits `customer.subscription.deleted` → existing
  webhook → `markSubscriptionCanceled` (status `canceled`, S2.6 flags reset).

## Resume flow

`POST /subscription/resume` → `setCancelAtPeriodEnd(companyId, false)` on the
**same** Stripe subscription — allowed any time before the period ends.

## Webhook synchronization

Events (unchanged set): `checkout.session.completed`,
`customer.subscription.updated`, `customer.subscription.deleted` — all funnel
through `applySubscriptionUpdate` / `markSubscriptionCanceled`, which write:

- `plan` — from the purchased Price via `planForPriceId` (never a hardcoded
  status mapping); unknown price → keep current plan (no accidental
  downgrade); plan-carrying statuses are `active`/`trialing`/**`past_due`**
  (dunning grace, AC17 — the plan survives a bounced charge); any other
  status → `free`.
- `subscriptionStatus`, `subscriptionEndsAt` (item `current_period_end`),
- `cancelAtPeriodEnd` (mirror of Stripe's flag),
- `pendingPlan` (kept only while a schedule is attached and the price hasn't
  flipped; cleared otherwise).

Design C protections (AC15/AC16):

- **Idempotency ledger** (`ProcessedStripeEvent`): a redelivered event id is
  acked without re-processing — state writes never re-apply a stale snapshot
  and the subscription-confirmed email is at-most-once.
- **Stale-event guards**: `customer.subscription.updated` about a FOREIGN,
  non-live subscription is ignored (the old subscription's dying events must
  not overwrite a replacement); `markSubscriptionCanceled` only acts when the
  deleted subscription IS the company's current one.

Manual plans (`founder`, `enterprise`) are never overwritten by any Stripe
event. Legacy `"pro"` maps through `LEGACY_PLAN_MAP` for tier comparisons and
keeps its unlimited limits until the real migration.

## Frontend

`SubscriptionPage` orchestrates; `BillingPlansSection` renders
upgrade/downgrade actions (destination named on the button; downgrades AND
paid→paid upgrades behind confirm dialogs — the upgrade dialog announces the
Stripe redirect and, when relevant, the pending-downgrade cancellation),
`CurrentSubscriptionCard` shows next plan / billing period /
renewal-or-cancellation date and hosts Cancel/Resume. Blocks mirrored
client-side: upgrades while `cancelAtPeriodEnd` ("resume first") or
`past_due` ("settle payment first" → Portal). The Stripe Customer Portal
(payment method / invoices / cancel / resume; plan changes disabled in its
configuration) opens from the Billing Information card and the invoice empty
state. Return paths: `?checkout=success` → session sync;
`?upgrade=confirmed` → return-sync. All billing actions are mutually
disabled while one is in flight. No pricing, tier, or limit values exist in
the frontend beyond the S2.1 config + the server-resolved `/subscription`
payload.
