// Stripe statuses that mean "this company is still being billed" — including
// past_due, where a renewal has failed but the subscription is very much
// alive. Deliberately NOT the same list as readOnly.ts's WRITABLE_STATUSES,
// which answers a different question ("may this company write?") and leaves
// past_due out on purpose. Do not merge the two.
//
// Typed as a mutable string[]: `as const` would break .includes(string)
// (company.subscriptionStatus is a plain string), and `readonly string[]`
// would break the Prisma `in` filters in adminAnalytics.routes.ts (Prisma's
// StringFilter.in wants string[]).
export const ACTIVE_SUBSCRIPTION_STATUSES: string[] = [
  "active",
  "trialing",
  "past_due",
];
