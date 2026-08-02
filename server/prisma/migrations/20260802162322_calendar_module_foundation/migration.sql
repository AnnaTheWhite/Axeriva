-- CreateTable
CREATE TABLE "public"."Calendar" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "timezone" TEXT,
    "ownerUserId" INTEGER,
    "projectId" INTEGER,
    "employeeId" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Calendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CalendarMember" (
    "id" SERIAL NOT NULL,
    "calendarId" INTEGER NOT NULL,
    "companyId" INTEGER NOT NULL,
    "principalType" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "preset" TEXT NOT NULL,
    "permissions" TEXT,
    "grantedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CalendarEvent" (
    "id" SERIAL NOT NULL,
    "calendarId" INTEGER NOT NULL,
    "companyId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT,
    "recurrenceRule" TEXT,
    "recurrenceEndsAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "visibility" TEXT NOT NULL DEFAULT 'default',
    "createdByUserId" INTEGER NOT NULL,
    "projectId" INTEGER,
    "customerId" INTEGER,
    "employeeId" INTEGER,
    "shiftId" INTEGER,
    "location" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CalendarEventOccurrence" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "originalStartsAt" TIMESTAMP(3) NOT NULL,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "title" TEXT,
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEventOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CalendarParticipant" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "userId" INTEGER,
    "employeeId" INTEGER,
    "email" TEXT,
    "response" TEXT NOT NULL DEFAULT 'needs_action',
    "isOrganizer" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CalendarEventAttachment" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Other',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarEventAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CalendarEventComment" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarEventComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CalendarEventReminder" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "userId" INTEGER,
    "minutesBefore" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEventReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CalendarAudit" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "calendarId" INTEGER NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "actorUserId" INTEGER,
    "source" TEXT NOT NULL,
    "requestId" TEXT,
    "changes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Calendar_companyId_type_idx" ON "public"."Calendar"("companyId", "type");

-- CreateIndex
CREATE INDEX "Calendar_ownerUserId_idx" ON "public"."Calendar"("ownerUserId");

-- CreateIndex
CREATE INDEX "Calendar_projectId_idx" ON "public"."Calendar"("projectId");

-- CreateIndex
CREATE INDEX "Calendar_employeeId_idx" ON "public"."Calendar"("employeeId");

-- CreateIndex
CREATE INDEX "CalendarMember_companyId_principalType_principalId_idx" ON "public"."CalendarMember"("companyId", "principalType", "principalId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarMember_calendarId_principalType_principalId_key" ON "public"."CalendarMember"("calendarId", "principalType", "principalId");

-- CreateIndex
CREATE INDEX "CalendarEvent_calendarId_startsAt_idx" ON "public"."CalendarEvent"("calendarId", "startsAt");

-- CreateIndex
CREATE INDEX "CalendarEvent_companyId_startsAt_idx" ON "public"."CalendarEvent"("companyId", "startsAt");

-- CreateIndex
CREATE INDEX "CalendarEvent_projectId_idx" ON "public"."CalendarEvent"("projectId");

-- CreateIndex
CREATE INDEX "CalendarEvent_customerId_idx" ON "public"."CalendarEvent"("customerId");

-- CreateIndex
CREATE INDEX "CalendarEvent_employeeId_idx" ON "public"."CalendarEvent"("employeeId");

-- CreateIndex
CREATE INDEX "CalendarEvent_shiftId_idx" ON "public"."CalendarEvent"("shiftId");

-- CreateIndex
CREATE INDEX "CalendarEvent_recurrenceEndsAt_idx" ON "public"."CalendarEvent"("recurrenceEndsAt");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEventOccurrence_eventId_originalStartsAt_key" ON "public"."CalendarEventOccurrence"("eventId", "originalStartsAt");

-- CreateIndex
CREATE INDEX "CalendarParticipant_employeeId_idx" ON "public"."CalendarParticipant"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarParticipant_eventId_userId_key" ON "public"."CalendarParticipant"("eventId", "userId");

-- CreateIndex
CREATE INDEX "CalendarEventAttachment_eventId_idx" ON "public"."CalendarEventAttachment"("eventId");

-- CreateIndex
CREATE INDEX "CalendarEventComment_eventId_idx" ON "public"."CalendarEventComment"("eventId");

-- CreateIndex
CREATE INDEX "CalendarEventReminder_eventId_idx" ON "public"."CalendarEventReminder"("eventId");

-- CreateIndex
CREATE INDEX "CalendarAudit_calendarId_createdAt_idx" ON "public"."CalendarAudit"("calendarId", "createdAt");

-- CreateIndex
CREATE INDEX "CalendarAudit_companyId_createdAt_idx" ON "public"."CalendarAudit"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "CalendarAudit_targetType_targetId_idx" ON "public"."CalendarAudit"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "CalendarAudit_actorUserId_idx" ON "public"."CalendarAudit"("actorUserId");

-- AddForeignKey
ALTER TABLE "public"."Calendar" ADD CONSTRAINT "Calendar_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Calendar" ADD CONSTRAINT "Calendar_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Calendar" ADD CONSTRAINT "Calendar_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "public"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CalendarMember" ADD CONSTRAINT "CalendarMember_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "public"."Calendar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CalendarMember" ADD CONSTRAINT "CalendarMember_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CalendarEvent" ADD CONSTRAINT "CalendarEvent_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "public"."Calendar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CalendarEvent" ADD CONSTRAINT "CalendarEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CalendarEvent" ADD CONSTRAINT "CalendarEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CalendarEvent" ADD CONSTRAINT "CalendarEvent_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CalendarEvent" ADD CONSTRAINT "CalendarEvent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "public"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CalendarEvent" ADD CONSTRAINT "CalendarEvent_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "public"."Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CalendarEventOccurrence" ADD CONSTRAINT "CalendarEventOccurrence_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "public"."CalendarEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CalendarParticipant" ADD CONSTRAINT "CalendarParticipant_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "public"."CalendarEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CalendarParticipant" ADD CONSTRAINT "CalendarParticipant_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "public"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CalendarEventAttachment" ADD CONSTRAINT "CalendarEventAttachment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "public"."CalendarEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CalendarEventComment" ADD CONSTRAINT "CalendarEventComment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "public"."CalendarEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CalendarEventReminder" ADD CONSTRAINT "CalendarEventReminder_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "public"."CalendarEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CalendarAudit" ADD CONSTRAINT "CalendarAudit_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CalendarAudit" ADD CONSTRAINT "CalendarAudit_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "public"."Calendar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
