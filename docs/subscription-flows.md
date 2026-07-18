# Subscription Flows (S2.6) — Upgrade / Downgrade / Cancel / Resume

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

## Upgrade flow (immediate)

`POST /subscription/change-plan { plan, currency }` →
`changePlan()`:

1. Target must be purchasable (`starter`/`professional`/`business`);
   `enterprise` is rejected (sales-led), `founder` never purchasable.
2. Founder/Enterprise companies are operator-managed → rejected (same guard
   the webhook uses).
3. Direction decided by the S2.2 `canUpgrade()` (legacy `"pro"`/`"free"`
   aware).
4. **With a live Stripe subscription** (active/trialing +
   `stripeSubscriptionId`): the subscription's single item is updated to the
   target price with `proration_behavior: "create_prorations"`;
   `cancel_at_period_end` is cleared (upgrading recommits); any pending
   downgrade schedule is released first. The returned subscription goes
   through `applySubscriptionUpdate` → plan/limits change **immediately**.
5. **Without one** (registration trial, canceled sub): the endpoint answers
   `requires_checkout` and the frontend falls back to the existing
   `/subscription/checkout` flow — a duplicate subscription is never created.

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
  downgrade); non-active status → `free`.
- `subscriptionStatus`, `subscriptionEndsAt` (item `current_period_end`),
- `cancelAtPeriodEnd` (mirror of Stripe's flag),
- `pendingPlan` (kept only while a schedule is attached and the price hasn't
  flipped; cleared otherwise).

Manual plans (`founder`, `enterprise`) are never overwritten by any Stripe
event. Legacy `"pro"` maps through `LEGACY_PLAN_MAP` for tier comparisons and
keeps its unlimited limits until the real migration.

## Frontend

`SubscriptionPage` orchestrates; `BillingPlansSection` renders
upgrade/downgrade actions (destination named on the button, downgrades behind
a confirm dialog), `CurrentSubscriptionCard` shows next plan / billing period
/ renewal-or-cancellation date and hosts Cancel/Resume. All billing actions
are mutually disabled while one is in flight. No pricing, tier, or limit
values exist in the frontend beyond the S2.1 config + the server-resolved
`/subscription` payload.
