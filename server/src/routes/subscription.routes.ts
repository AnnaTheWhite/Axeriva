import { Router } from "express";
import prisma from "../database/prisma";
import { requireRole } from "../middleware/role.middleware";
import { ROLES } from "../constants/roles";
import { stripe } from "../services/stripe/stripeClient";
import { applySubscriptionUpdate } from "../services/stripe/syncSubscription";

const router = Router();

router.use(requireRole(ROLES.BUSINESS_OWNER, ROLES.DEVELOPER));

function appUrl() {
  return process.env.APP_URL || "http://localhost:5173";
}

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

// Starts a Stripe Checkout session for the Axeriva Pro plan (30 EUR/month).
// Only the BUSINESS_OWNER who owns the company can subscribe — not
// DEVELOPER (platform operator) and not EMPLOYEE.
router.post("/checkout", requireRole(ROLES.BUSINESS_OWNER), async (req, res) => {
  if (!process.env.STRIPE_PRICE_ID) {
    return res.status(500).json({
      error: "Stripe is not configured yet (missing STRIPE_PRICE_ID).",
    });
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
    line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${appUrl()}/subscription?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl()}/subscription?checkout=cancelled`,
    subscription_data: {
      metadata: { companyId: String(company.id) },
    },
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
    return_url: `${appUrl()}/subscription`,
  });

  return res.json({ url: session.url });
});

export default router;
