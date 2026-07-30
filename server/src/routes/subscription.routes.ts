import { Router } from "express";
import Stripe from "stripe";
import prisma from "../database/prisma";
import { requireRole } from "../middleware/role.middleware";
import { ROLES } from "../constants/roles";
import { stripe } from "../services/stripe/stripeClient";
import {
  applySubscriptionUpdate,
  reconcileCheckoutCompletion,
} from "../services/stripe/syncSubscription";
import {
  changePlan,
  setCancelAtPeriodEnd,
  hasBlockingSubscription,
  normalizePortalLocale,
} from "../services/stripe/subscriptionChange";
import {
  resolveCheckoutPrice,
  isStripeCurrency,
  priceIdFor,
  type StripeCurrency,
} from "../config/stripePricing";
import { getLimit, getEffectivePlan } from "../services/planAccess";
import { isReadOnly, hasActiveSubscription } from "../services/readOnly";
import { config } from "../config";

const router = Router();

router.use(requireRole(ROLES.BUSINESS_OWNER, ROLES.DEVELOPER));

// Current plan / billing status for the logged-in company, plus the usage
// counts and S2.2 Limit Registry ceilings the Billing Settings page needs
// (S2.4). No new endpoint — this is the existing status endpoint, extended.
// Limits resolve through getLimit() (never hardcoded here); Infinity
// (unlimited) serializes to `null` via JSON.stringify, which the frontend
// already treats as "unlimited".
router.get("/", async (req, res) => {
  const companyId = req.user!.companyId!;

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      plan: true,
      subscriptionStatus: true,
      subscriptionEndsAt: true,
      stripeSubscriptionId: true,
      stripeCustomerId: true,
      cancelAtPeriodEnd: true,
      pendingPlan: true,
    },
  });

  if (!company) {
    return res.status(404).json({ error: "Company not found" });
  }

  const [projects, employees, customers, storage] = await Promise.all([
    prisma.project.count({ where: { companyId } }),
    prisma.employee.count({ where: { companyId } }),
    prisma.customer.count({ where: { companyId } }),
    prisma.projectAttachment.aggregate({
      _sum: { fileSize: true },
      where: { project: { companyId } },
    }),
  ]);

  return res.json({
    plan: company.plan,
    // Canonical plan for display/comparison (legacy "free"/"pro" resolved to
    // starter/professional, "founder" passed through) — the SAME S2.2
    // normalization used for feature/limit gating (getEffectivePlan), so the
    // frontend never re-implements the legacy-plan mapping itself.
    effectivePlan: getEffectivePlan(company.plan),
    subscriptionStatus: company.subscriptionStatus,
    subscriptionEndsAt: company.subscriptionEndsAt,
    stripeSubscriptionId: company.stripeSubscriptionId,
    // S2.6 — mirrors Stripe's cancel_at_period_end; pendingPlan is the
    // canonical plan a scheduled period-end downgrade will land on (null
    // when nothing is pending). Both maintained by the sync layer.
    cancelAtPeriodEnd: company.cancelAtPeriodEnd,
    pendingPlan: company.pendingPlan,
    // S2.7 — read-only state, computed by the single services/readOnly.ts
    // rule (same one the write-guard enforces), so the billing page never
    // re-derives it.
    readOnly: isReadOnly(company),
    // Hotfix — whether the company currently has a LIVE subscription/trial,
    // distinct from its assigned `plan`. The billing UI uses this to tell
    // "on this plan, active" (disabled "Current plan") apart from "assigned
    // this plan but expired" (an active "Subscribe" button).
    hasActiveSubscription: hasActiveSubscription(company),
    // Placeholder-friendly boolean only — never expose the raw Stripe
    // customer ID to the billing UI.
    hasStripeCustomer: Boolean(company.stripeCustomerId),
    usage: {
      projects,
      employees,
      customers,
      storageBytes: storage._sum.fileSize ?? 0,
    },
    limits: {
      projects: getLimit(company.plan, "projects"),
      employees: getLimit(company.plan, "employees"),
      customers: getLimit(company.plan, "customers"),
      storageBytes: getLimit(company.plan, "storage"),
    },
  });
});

// Starts a Stripe Checkout session for a subscription. The target price is
// resolved through the centralized Stripe pricing config from an optional
// { plan, currency } body:
//   - no plan            → legacy single-price flow (backward compatible with
//                          the existing subscription page)
//   - starter/pro/business → that plan's price for the chosen currency, with
//                          Starter's 14-day trial applied
//   - enterprise/founder → rejected (not self-serve purchasable)
// Only the BUSINESS_OWNER who owns the company can subscribe — not DEVELOPER
// (platform operator) and not EMPLOYEE.
//
// Design C trial rule (AC1): the registration trial is the company's only
// trial. `trialConsumedAt` suppresses trial_period_days forever after, which
// also forces card collection (payment_method_collection stays default).
router.post("/checkout", requireRole(ROLES.BUSINESS_OWNER), async (req, res) => {
  const { plan, currency } = (req.body ?? {}) as { plan?: string; currency?: string };

  const resolution = resolveCheckoutPrice(plan, currency);
  if (!resolution.ok) {
    return res.status(resolution.status).json({ error: resolution.error });
  }

  const company = await prisma.company.findUnique({
    where: { id: req.user!.companyId! },
  });

  if (!company) {
    return res.status(404).json({ error: "Company not found" });
  }

  // Design C duplicate guard (AC3): a company holding a not-closed Stripe
  // subscription (live, or broken-but-open like past_due) must never create a
  // second one. Closed subscriptions (canceled/incomplete_expired) pass — the
  // re-subscribe path depends on that, since the stored subscription id is
  // deliberately kept for history.
  if (hasBlockingSubscription(company)) {
    return res.status(409).json({
      error: "An open subscription already exists — manage it from the billing page.",
    });
  }

  // AC1 — trial suppression: once consumed, never again.
  const trialDays = company.trialConsumedAt ? 0 : resolution.trialDays;

  // The stored Stripe customer is verified before use. A customer deleted in
  // the Dashboard (cleanup, GDPR) or missing in this account/mode would make
  // every checkout fail forever — instead, a dead reference is dropped so the
  // lazy-create branch below builds a fresh customer (self-healing).
  let stripeCustomerId = company.stripeCustomerId;
  let pinnedCurrency: string | null = null;
  if (stripeCustomerId) {
    try {
      const customer = await stripe.customers.retrieve(stripeCustomerId);
      if (customer.deleted) {
        stripeCustomerId = null;
      } else if (isStripeCurrency(customer.currency)) {
        pinnedCurrency = customer.currency;
      }
    } catch (error) {
      if ((error as Stripe.errors.StripeError)?.code === "resource_missing") {
        stripeCustomerId = null;
      } else {
        throw error;
      }
    }
  }

  // AC4 — currency pinning for returning customers: Stripe fixes a Customer's
  // currency at their first invoice, so a canceled HUF customer re-subscribing
  // from an English UI must NOT be sent to an EUR Checkout (it would fail).
  // The customer's pinned currency wins over the UI-language one.
  let priceId = resolution.priceId;
  if (resolution.plan && resolution.currency && pinnedCurrency && pinnedCurrency !== resolution.currency) {
    const pinnedPriceId = priceIdFor(resolution.plan, pinnedCurrency as StripeCurrency);
    if (!pinnedPriceId) {
      return res.status(500).json({
        error: `No Stripe price configured for ${resolution.plan} (${pinnedCurrency.toUpperCase()}).`,
      });
    }
    priceId = pinnedPriceId;
  }

  // AC3, first layer at session granularity: expire any still-open Checkout
  // sessions of this customer before creating a new one. Sessions stay
  // completable for ~24h — without this, an abandoned or second-tab session
  // could later complete NEXT TO the one being created now. (The second
  // layer, completion-time reconciliation, lives in syncSubscription.ts.)
  if (stripeCustomerId) {
    const openSessions = await stripe.checkout.sessions.list({
      customer: stripeCustomerId,
      status: "open",
      limit: 100,
    });
    for (const openSession of openSessions.data) {
      // Racing an in-flight completion is fine — expire() then errors and the
      // reconciliation layer handles the completed one.
      await stripe.checkout.sessions.expire(openSession.id).catch(() => {});
    }
  }

  if (!stripeCustomerId) {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
    });

    const customer = await stripe.customers.create({
      name: company.name,
      email: user?.email,
      metadata: { companyId: String(company.id) },
    });

    stripeCustomerId = customer.id;

    await prisma.company.update({
      where: { id: company.id },
      data: { stripeCustomerId },
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: stripeCustomerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${config.frontendUrl}/subscription?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.frontendUrl}/subscription?checkout=cancelled`,
    subscription_data: {
      metadata: { companyId: String(company.id) },
      // Only a company that has never consumed its trial gets one (AC1) —
      // in practice that is nobody after the Design C migration, since the
      // registration trial sets trialConsumedAt. Kept parameterized so the
      // rule lives in data, not in a hardcoded zero.
      ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
    },
    // Without a trial the card is always collected (Stripe default); the
    // trial-only "if_required" relaxation follows the same suppressed value.
    ...(trialDays > 0 ? { payment_method_collection: "if_required" as const } : {}),
    metadata: { companyId: String(company.id) },
  });

  return res.json({ url: session.url });
});

// Reconciles the company's subscription state right after returning from
// Checkout, using the session ID from the success_url.
//
// This is a deliberate second path to the same data the webhook writes
// (see services/stripe/syncSubscription.ts) — not a replacement for it. The
// webhook is the source of truth for ongoing changes (renewals,
// cancellations, payment failures), but it requires Stripe to be able to
// reach this server (a registered Dashboard endpoint, or `stripe listen`
// locally). Without that, a successful payment leaves the UI showing
// "Free/Inactive" indefinitely even though Stripe already charged the
// customer — exactly what this route fixes for the immediate post-checkout
// case.
router.post("/sync", requireRole(ROLES.BUSINESS_OWNER), async (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: "sessionId is required" });
  }

  // B4 — sessionId comes straight from the request body; a cheap format
  // check keeps user-controlled junk from ever reaching the Stripe API
  // (every Checkout session id starts with "cs_").
  if (typeof sessionId !== "string" || !sessionId.startsWith("cs_")) {
    return res.status(400).json({ error: "Invalid sessionId" });
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId);

  if (session.metadata?.companyId !== String(req.user!.companyId)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (!session.subscription) {
    return res.status(400).json({ error: "Checkout session has no subscription" });
  }

  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription.id;

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  // AC3 second layer: if this session completed NEXT TO an already-open
  // subscription, the incoming duplicate is canceled instead of applied.
  const outcome = await reconcileCheckoutCompletion(
    req.user!.companyId!,
    subscription,
    typeof session.customer === "string" ? session.customer : undefined
  );

  return res.json({ synced: true, duplicate: outcome === "duplicate_canceled" });
});

// Design C return-sync (AC8) — reconciles the company's subscription right
// after returning from the Stripe-hosted upgrade-confirmation page
// (?upgrade=confirmed). The confirmation itself already happened on Stripe's
// side; this pulls the fresh subscription state so the UI doesn't have to
// wait for the customer.subscription.updated webhook. Same
// second-path-not-replacement contract as POST /sync above.
router.post("/sync-subscription", requireRole(ROLES.BUSINESS_OWNER), async (req, res) => {
  const company = await prisma.company.findUnique({
    where: { id: req.user!.companyId! },
    select: { stripeSubscriptionId: true },
  });

  if (!company?.stripeSubscriptionId) {
    return res.status(400).json({ error: "No subscription to sync" });
  }

  const subscription = await stripe.subscriptions.retrieve(company.stripeSubscriptionId);
  await applySubscriptionUpdate(req.user!.companyId!, subscription);

  return res.json({ synced: true });
});

// S2.6 + Design C — change the company's plan. Paid→paid upgrades answer
// `requires_upgrade_confirmation` with a Stripe-hosted confirmation URL (the
// customer approves the prorated charge THERE — no silent
// subscriptions.update); downgrades are scheduled for the end of the current
// billing period; selecting the current plan while a downgrade is pending
// cancels that downgrade. Returns `requires_checkout` when there is no Stripe
// subscription to modify (the frontend then falls back to the existing
// /checkout flow). All business rules live in
// services/stripe/subscriptionChange.ts.
router.post("/change-plan", requireRole(ROLES.BUSINESS_OWNER), async (req, res) => {
  const { plan, currency, locale } = (req.body ?? {}) as {
    plan?: string;
    currency?: string;
    locale?: string;
  };

  const result = await changePlan(
    req.user!.companyId!,
    plan,
    currency,
    normalizePortalLocale(locale)
  );
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }

  return res.json(result);
});

// S2.6 — cancel at period end. Access continues until the paid period ends;
// the Stripe subscription is never deleted here.
router.post("/cancel", requireRole(ROLES.BUSINESS_OWNER), async (req, res) => {
  const result = await setCancelAtPeriodEnd(req.user!.companyId!, true);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }
  return res.json(result);
});

// S2.6 — resume a subscription whose cancellation is pending (reuses the
// same, still-live Stripe subscription).
router.post("/resume", requireRole(ROLES.BUSINESS_OWNER), async (req, res) => {
  const result = await setCancelAtPeriodEnd(req.user!.companyId!, false);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }
  return res.json(result);
});

// Opens the Stripe Billing Portal so the owner can manage/cancel the
// existing subscription. BUSINESS_OWNER only.
router.post("/portal", requireRole(ROLES.BUSINESS_OWNER), async (req, res) => {
  const company = await prisma.company.findUnique({
    where: { id: req.user!.companyId! },
  });

  if (!company?.stripeCustomerId) {
    return res.status(400).json({ error: "No billing account yet" });
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: company.stripeCustomerId,
    return_url: `${config.frontendUrl}/subscription`,
  });

  return res.json({ url: session.url });
});

export default router;
