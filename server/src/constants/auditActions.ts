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
} as const;
