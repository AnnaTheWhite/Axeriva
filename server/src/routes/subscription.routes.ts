import { Router } from "express";
import prisma from "../database/prisma";
import { requireRole } from "../middleware/role.middleware";
import { ROLES } from "../constants/roles";
import { stripe } from "../services/stripe/stripeClient";
import { applySubscriptionUpdate } from "../services/stripe/syncSubscription";
import { resolveCheckoutPrice } from "../config/stripePricing";
import { config } from "../config";

const router = Router();

router.use(requireRole(ROLES.BUSINESS_OWNER, ROLES.DEVELOPER));

// Current plan / billing status for the logged-in company.
router.get("/", async (req, res) => {
  const company = await prisma.company.findUnique({
    where: { id: req.user!.companyId! },
    select: {
      plan: true,
      subscriptionStatus: true,
      subscriptionEndsAt: true,
      stripeSubscriptionId: true,
    },
  });

  if (!company) {
    return res.status(404).json({ error: "Company not found" });
  }

  return res.json(company);
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
// Trial scope (S2.3 vs S2.5): `trial_period_days` / `payment_method_collection`
// below are Stripe Checkout Session PARAMETERS ONLY — they tell Stripe how to
// run the session. This route does not implement any trial business logic:
// no "has this company already had a trial" check, no app-side trial-state
// tracking, no read-only/expiry enforcement. All of that is S2.5.
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

  let stripeCustomerId = company.stripeCustomerId;

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
    line_items: [{ price: resolution.priceId, quantity: 1 }],
    success_url: `${config.frontendUrl}/subscription?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.frontendUrl}/subscription?checkout=cancelled`,
    subscription_data: {
      metadata: { companyId: String(company.id) },
      // Starter carries a 14-day trial (Stripe-side prep only; trial business
      // logic is a later story).
      ...(resolution.trialDays > 0 ? { trial_period_days: resolution.trialDays } : {}),
    },
    // With a trial, don't force a card up front.
    ...(resolution.trialDays > 0 ? { payment_method_collection: "if_required" as const } : {}),
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

  await applySubscriptionUpdate(
    req.user!.companyId!,
    subscription,
    typeof session.customer === "string" ? session.customer : undefined
  );

  return res.json({ synced: true });
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
