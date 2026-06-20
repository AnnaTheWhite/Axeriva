import { Router } from "express";
import prisma from "../database/prisma";
import { requireRole } from "../middleware/role.middleware";
import { ROLES } from "../constants/roles";
import { stripe } from "../services/stripe/stripeClient";

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

// Starts a Stripe Checkout session for the CrewFlow Pro plan (30 EUR/month).
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
    success_url: `${appUrl()}/subscription?checkout=success`,
    cancel_url: `${appUrl()}/subscription?checkout=cancelled`,
    subscription_data: {
      metadata: { companyId: String(company.id) },
    },
    metadata: { companyId: String(company.id) },
  });

  return res.json({ url: session.url });
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
