import { Router } from "express";
import prisma from "../database/prisma";
import { requireRole } from "../middleware/role.middleware";
import { ROLES } from "../constants/roles";

const router = Router();

router.use(requireRole(ROLES.BUSINESS_OWNER, ROLES.DEVELOPER));

// Current plan / billing status for the logged-in company.
router.get("/", async (req, res) => {
  const company = await prisma.company.findUnique({
    where: { id: req.user!.companyId! },
    select: {
      plan: true,
      subscriptionStatus: true,
    },
  });

  if (!company) {
    return res.status(404).json({ error: "Company not found" });
  }

  return res.json(company);
});

// Starts a checkout flow for the CrewFlow Pro plan.
//
// This is a placeholder: no real payment provider is wired up yet. Once
// Stripe is integrated, this handler should create a Stripe Checkout
// Session for `req.user!.companyId` (creating/reusing a Stripe customer via
// company.stripeCustomerId) and return the session URL for redirect. A
// Stripe webhook would then update company.subscriptionStatus/plan on
// checkout.session.completed.
router.post("/checkout", async (req, res) => {
  return res.status(501).json({
    error: "Payments are not enabled yet. Stripe integration coming soon.",
  });
});

export default router;
