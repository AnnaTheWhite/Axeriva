-- Design C (docs/checkout-only-upgrades-ux.md) — schema for Checkout-mandatory
-- upgrades.
--
-- 1) Company.trialConsumedAt: when the company consumed its one-and-only
--    Starter trial. Backfilled to createdAt for every existing row: every
--    existing company registered through the trial-granting path, and
--    business rule 4 ("a Starter trial egyszer használható") means none of
--    them may receive a second trial via Checkout.
ALTER TABLE "Company" ADD COLUMN "trialConsumedAt" TIMESTAMP(3);

UPDATE "Company" SET "trialConsumedAt" = "createdAt";

-- 2) Webhook idempotency ledger — one row per successfully handled Stripe
--    event id.
CREATE TABLE "ProcessedStripeEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedStripeEvent_pkey" PRIMARY KEY ("id")
);
