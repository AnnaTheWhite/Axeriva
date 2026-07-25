// Single source of truth for which Company columns a tenant-facing update
// endpoint may write. Used by both PUT /company/settings (company.routes.ts)
// and the legacy admin PUT /companies/:id (companies.routes.ts), so the two
// allow-lists can never drift apart.
//
// Everything NOT listed here — the primary key, tenant links, billing and
// subscription state (plan, subscriptionStatus, subscriptionEndsAt,
// cancelAtPeriodEnd, pendingPlan), Stripe identifiers and soft-delete/system
// columns — stays read-only on these endpoints. Billing state is only ever
// mutated by the Stripe sync layer (services/stripe/*).
//
// `logoUrl` is deliberately ABSENT (R1.5). It is not a user-supplied value at
// all: it is derived by the server from the file multer just wrote, and is set
// in exactly two places — POST /company/logo and DELETE /company/logo in
// company.routes.ts, both of which assign it directly. Leaving it writable
// here let a client store an arbitrary string in it, and since responses now
// carry a SIGNED, expiring URL, a client echoing that value back would persist
// `path?exp=…&sig=…` into the column — after which deleteLogoFile()'s
// path.basename() no longer matches the real filename and a replaced logo is
// orphaned on disk.
export const COMPANY_WRITABLE_FIELDS = [
  "name",
  "billingEmail",
  "contactEmail",
  "phone",
  "website",
  "address",
  "taxNumber",
  "vatNumber",
  "legalName",
  "registrationNumber",
  "postalCode",
  "city",
  "country",
  "primaryColor",
  "accentColor",
  "language",
  "currency",
  "timezone",
  "dateFormat",
  "timeFormat",
  "firstDayOfWeek",
  "defaultWorkStart",
  "defaultWorkEnd",
  "defaultShiftMinutes",
  "notificationsEnabled",
  "emailNotificationsEnabled",
  "desktopNotificationsEnabled",
] as const;

export type CompanyWritableField = (typeof COMPANY_WRITABLE_FIELDS)[number];

// Copies only the allow-listed fields out of an untrusted request body,
// ready to hand to prisma.company.update(). Never spread req.body directly.
export function pickCompanyWritableFields(
  body: unknown
): Record<string, unknown> {
  const source = (body ?? {}) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  for (const field of COMPANY_WRITABLE_FIELDS) {
    if (field in source) {
      data[field] = source[field];
    }
  }
  return data;
}
