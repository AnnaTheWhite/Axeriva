// Lifetimes of the one-time tokens that travel by email. Centralised at N1.3
// because two things now need the same number: the route that stamps
// `expiresAt` on the row, and the email that tells the recipient how long the
// link is good for.
//
// Previously the duration existed twice — once as a constant in the route,
// once as English prose inside the template ("This link expires in 24
// hours."). Changing the constant would have quietly made the email lie.
// Same reasoning as constants/rateLimits.ts: no magic numbers in route files.

export const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const VERIFICATION_TTL_HOURS = VERIFICATION_TTL_MS / (60 * 60 * 1000);
export const INVITE_TTL_DAYS = INVITE_TTL_MS / (24 * 60 * 60 * 1000);
