-- N1.5 — the notification tables' companyId becomes optional.
--
-- Why: platform operators (role DEVELOPER) belong to no company, and the auth
-- notifications they receive — password reset above all — are about a USER,
-- not a tenant. With companyId NOT NULL, routing password resets through the
-- notification pipeline would have thrown for exactly those accounts, i.e.
-- broken an auth flow for the operators. N1.1 modelled this too strictly.
--
-- Dropping NOT NULL is additive and cannot fail on existing data: every row
-- that satisfies the constraint today still satisfies the looser one. No row
-- is rewritten (Postgres records this in the catalog, not the heap).

ALTER TABLE "NotificationEvent" ALTER COLUMN "companyId" DROP NOT NULL;
ALTER TABLE "Notification" ALTER COLUMN "companyId" DROP NOT NULL;
ALTER TABLE "NotificationDelivery" ALTER COLUMN "companyId" DROP NOT NULL;

-- Dropping NOT NULL is only half of it: Prisma emits ON DELETE RESTRICT for a
-- REQUIRED relation and ON DELETE SET NULL for an OPTIONAL one, so the foreign
-- keys have to be recreated or the database and the schema disagree — which
-- the drift check catches (and did).
--
-- SET NULL is also the behaviour we want: companies are soft-deleted, never
-- removed, so this only matters in a hard-delete path that does not exist —
-- and if one ever did, orphaning the audit trail beats blocking the delete.

ALTER TABLE "NotificationEvent" DROP CONSTRAINT "NotificationEvent_companyId_fkey";
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Notification" DROP CONSTRAINT "Notification_companyId_fkey";
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NotificationDelivery" DROP CONSTRAINT "NotificationDelivery_companyId_fkey";
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
