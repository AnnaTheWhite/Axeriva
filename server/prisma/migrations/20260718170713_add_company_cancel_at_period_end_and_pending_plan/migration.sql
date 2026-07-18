-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Company" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "billingEmail" TEXT,
    "contactEmail" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "address" TEXT,
    "taxNumber" TEXT,
    "vatNumber" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "subscriptionStatus" TEXT NOT NULL DEFAULT 'inactive',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "subscriptionEndsAt" DATETIME,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "pendingPlan" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Company" ("active", "address", "billingEmail", "contactEmail", "createdAt", "deletedAt", "id", "logoUrl", "name", "phone", "plan", "stripeCustomerId", "stripeSubscriptionId", "subscriptionEndsAt", "subscriptionStatus", "taxNumber", "updatedAt", "vatNumber", "website") SELECT "active", "address", "billingEmail", "contactEmail", "createdAt", "deletedAt", "id", "logoUrl", "name", "phone", "plan", "stripeCustomerId", "stripeSubscriptionId", "subscriptionEndsAt", "subscriptionStatus", "taxNumber", "updatedAt", "vatNumber", "website" FROM "Company";
DROP TABLE "Company";
ALTER TABLE "new_Company" RENAME TO "Company";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
