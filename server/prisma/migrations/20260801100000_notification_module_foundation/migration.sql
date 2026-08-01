-- N1.1 — Notification & Email module foundation
-- (docs/notification-system-plan.md, docs/notification-milestones.md)
--
-- Fully additive: one nullable column on an existing table plus six new
-- tables. No existing row is rewritten, no existing column changes type, and
-- nothing in the running application reads or writes any of it yet — the
-- pipeline is wired at N1.5. A deploy of this migration is therefore a no-op
-- from the user's point of view, and rolling the code back leaves the schema
-- harmlessly ahead.

-- 1) Per-user notification language (Q6). NULL = inherit from
--    Company.language, then fall back to "en".
ALTER TABLE "User" ADD COLUMN "language" TEXT;

-- 2) The outbox / event log.
CREATE TABLE "NotificationEvent" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "companyId" INTEGER NOT NULL,
    "dedupeKey" TEXT,
    "context" TEXT,
    "actorUserId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id")
);

-- 3) In-app notifications (the bell feed).
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "companyId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "ctaLabel" TEXT,
    "ctaPath" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- 4) Per-channel delivery ledger.
CREATE TABLE "NotificationDelivery" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "companyId" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "recipientUserId" INTEGER,
    "recipientAddress" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "suppressionReason" TEXT,
    "providerMessageId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- 5) Raw provider delivery events. The provider's own event id is the primary
--    key, so a webhook re-delivery collides instead of duplicating (the same
--    replay protection ProcessedStripeEvent uses).
CREATE TABLE "EmailEvent" (
    "id" TEXT NOT NULL,
    "deliveryId" INTEGER,
    "type" TEXT NOT NULL,
    "payload" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailEvent_pkey" PRIMARY KEY ("id")
);

-- 6) Preference rows (userId NULL = company-wide default).
CREATE TABLE "NotificationPreference" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "userId" INTEGER,
    "category" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- 7) Global do-not-email list (hard bounces, spam complaints).
CREATE TABLE "EmailSuppression" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "companyId" INTEGER,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationEvent_dedupeKey_key" ON "NotificationEvent"("dedupeKey");
CREATE INDEX "NotificationEvent_status_createdAt_idx" ON "NotificationEvent"("status", "createdAt");
CREATE INDEX "NotificationEvent_companyId_createdAt_idx" ON "NotificationEvent"("companyId", "createdAt");

CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");
CREATE INDEX "Notification_companyId_createdAt_idx" ON "Notification"("companyId", "createdAt");

CREATE INDEX "NotificationDelivery_providerMessageId_idx" ON "NotificationDelivery"("providerMessageId");
CREATE INDEX "NotificationDelivery_companyId_status_createdAt_idx" ON "NotificationDelivery"("companyId", "status", "createdAt");
CREATE INDEX "NotificationDelivery_status_idx" ON "NotificationDelivery"("status");

CREATE INDEX "EmailEvent_deliveryId_idx" ON "EmailEvent"("deliveryId");
CREATE INDEX "EmailEvent_type_occurredAt_idx" ON "EmailEvent"("type", "occurredAt");

CREATE UNIQUE INDEX "NotificationPreference_companyId_userId_category_channel_key" ON "NotificationPreference"("companyId", "userId", "category", "channel");
CREATE INDEX "NotificationPreference_companyId_idx" ON "NotificationPreference"("companyId");

CREATE UNIQUE INDEX "EmailSuppression_email_key" ON "EmailSuppression"("email");
CREATE INDEX "EmailSuppression_companyId_idx" ON "EmailSuppression"("companyId");

-- AddForeignKey
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "NotificationEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "NotificationEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmailEvent" ADD CONSTRAINT "EmailEvent_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "NotificationDelivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmailSuppression" ADD CONSTRAINT "EmailSuppression_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
