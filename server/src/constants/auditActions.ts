// Persistent audit-log action names (written via services/audit/auditLog.ts
// into the AuditLog table, surfaced by /admin/logs and the admin analytics
// activity timeline). Kept as a single source so writers and the timeline
// reader can't drift. Entity-creation events (project/employee/customer/
// company/schedule created) are NOT listed here — the timeline derives those
// straight from each row's createdAt, so they need no extra writes.
export const AUDIT_ACTIONS = {
  USER_LOGIN: "USER_LOGIN",
  USER_LOGOUT: "USER_LOGOUT",
  EMAIL_VERIFIED: "EMAIL_VERIFIED",
  SETTINGS_CHANGED: "SETTINGS_CHANGED",
  SUBSCRIPTION_CHANGED: "SUBSCRIPTION_CHANGED",
  INVITATION_SENT: "INVITATION_SENT",
  INVITATION_ACCEPTED: "INVITATION_ACCEPTED",
  // Already written by account.routes.ts before this constant existed.
  ACCOUNT_DELETED: "ACCOUNT_DELETED",
  // C1.7 — company archived by its owner. Never paired with deleting any
  // User row (unlike ACCOUNT_DELETED); see companyArchive.routes.ts.
  COMPANY_ARCHIVED: "COMPANY_ARCHIVED",
  // B2 — archive attempt refused because the company still has a live,
  // billed Stripe subscription; metadata carries the subscriptionStatus.
  COMPANY_ARCHIVE_BLOCKED_SUBSCRIPTION: "COMPANY_ARCHIVE_BLOCKED_SUBSCRIPTION",
  // B1 — an owner (or DEVELOPER) revoked an employee's login; metadata
  // carries the employeeId and the revoked userId. The Employee row itself
  // is untouched — see employeeAccess.routes.ts.
  EMPLOYEE_ACCESS_REVOKED: "EMPLOYEE_ACCESS_REVOKED",
  // CAL1.4 (D13) — someone changed who can see or do what on a calendar:
  // a member grant added, altered or revoked, or a personal calendar's
  // share level changed. Mirrored here IN ADDITION to the module's own
  // CalendarAudit table, because a permission change is a security event and
  // belongs where the operator already looks for security events
  // (/admin/logs). Calendar EVENT mutations are deliberately not mirrored —
  // their volume would bury a log that sees a handful of rows a day.
  CALENDAR_PERMISSION_CHANGED: "CALENDAR_PERMISSION_CHANGED",
} as const;
