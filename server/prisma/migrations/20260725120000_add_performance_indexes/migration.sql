-- CreateIndex
CREATE INDEX "Company_stripeCustomerId_idx" ON "public"."Company"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "User_companyId_idx" ON "public"."User"("companyId");

-- CreateIndex
CREATE INDEX "Employee_companyId_status_idx" ON "public"."Employee"("companyId", "status");

-- CreateIndex
CREATE INDEX "Project_companyId_status_idx" ON "public"."Project"("companyId", "status");

-- CreateIndex
CREATE INDEX "Project_customerId_idx" ON "public"."Project"("customerId");

-- CreateIndex
CREATE INDEX "ProjectNote_projectId_idx" ON "public"."ProjectNote"("projectId");

-- CreateIndex
CREATE INDEX "ProjectNote_userId_idx" ON "public"."ProjectNote"("userId");

-- CreateIndex
CREATE INDEX "ProjectAttachment_projectId_idx" ON "public"."ProjectAttachment"("projectId");

-- CreateIndex
CREATE INDEX "ProjectAttachment_userId_idx" ON "public"."ProjectAttachment"("userId");

-- CreateIndex
CREATE INDEX "ProjectActivity_projectId_idx" ON "public"."ProjectActivity"("projectId");

-- CreateIndex
CREATE INDEX "ProjectActivity_userId_idx" ON "public"."ProjectActivity"("userId");

-- CreateIndex
CREATE INDEX "ProjectAssignment_projectId_idx" ON "public"."ProjectAssignment"("projectId");

-- CreateIndex
CREATE INDEX "Customer_companyId_idx" ON "public"."Customer"("companyId");

-- CreateIndex
CREATE INDEX "Shift_employeeId_start_idx" ON "public"."Shift"("employeeId", "start");

-- CreateIndex
CREATE INDEX "Shift_projectId_idx" ON "public"."Shift"("projectId");

-- CreateIndex
CREATE INDEX "OwnerNote_companyId_status_idx" ON "public"."OwnerNote"("companyId", "status");

-- CreateIndex
CREATE INDEX "OwnerNote_userId_idx" ON "public"."OwnerNote"("userId");

-- CreateIndex
CREATE INDEX "OwnerNote_projectId_idx" ON "public"."OwnerNote"("projectId");

-- CreateIndex
CREATE INDEX "OwnerNote_customerId_idx" ON "public"."OwnerNote"("customerId");

-- CreateIndex
CREATE INDEX "OwnerNote_employeeId_idx" ON "public"."OwnerNote"("employeeId");

-- CreateIndex
CREATE INDEX "Task_companyId_idx" ON "public"."Task"("companyId");

-- CreateIndex
CREATE INDEX "Task_projectId_idx" ON "public"."Task"("projectId");

-- CreateIndex
CREATE INDEX "Task_employeeId_idx" ON "public"."Task"("employeeId");

-- CreateIndex
CREATE INDEX "Reminder_companyId_idx" ON "public"."Reminder"("companyId");

-- CreateIndex
CREATE INDEX "Reminder_projectId_idx" ON "public"."Reminder"("projectId");

-- CreateIndex
CREATE INDEX "Reminder_customerId_idx" ON "public"."Reminder"("customerId");

-- CreateIndex
CREATE INDEX "CommunicationLog_companyId_idx" ON "public"."CommunicationLog"("companyId");

-- CreateIndex
CREATE INDEX "CommunicationLog_customerId_idx" ON "public"."CommunicationLog"("customerId");

-- CreateIndex
CREATE INDEX "CommunicationLog_projectId_idx" ON "public"."CommunicationLog"("projectId");

-- CreateIndex
CREATE INDEX "ProjectInternalNote_companyId_idx" ON "public"."ProjectInternalNote"("companyId");

-- CreateIndex
CREATE INDEX "ProjectInternalNote_projectId_idx" ON "public"."ProjectInternalNote"("projectId");

-- CreateIndex
CREATE INDEX "ProjectInternalNote_userId_idx" ON "public"."ProjectInternalNote"("userId");

-- CreateIndex
CREATE INDEX "OwnerNoteConversion_ownerNoteId_companyId_idx" ON "public"."OwnerNoteConversion"("ownerNoteId", "companyId");

-- CreateIndex
CREATE INDEX "OwnerNoteConversion_companyId_idx" ON "public"."OwnerNoteConversion"("companyId");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_idx" ON "public"."AuditLog"("companyId");

-- CreateIndex
CREATE INDEX "Invitation_companyId_idx" ON "public"."Invitation"("companyId");

