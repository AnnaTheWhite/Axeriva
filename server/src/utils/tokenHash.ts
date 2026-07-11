import crypto from "crypto";

// One-time security tokens (password reset, email verification, invitation)
// are stored ONLY as SHA-256 hashes (K2.1.4) — a database leak must not hand
// out working reset/invite links. The raw token exists solely in the emailed
// URL; on lookup the received token is hashed and matched against the stored
// hash, so no plaintext comparison happens anywhere.
//
// Plain SHA-256 (no salt, no bcrypt) is deliberate and sufficient here:
// unlike passwords, these tokens are 192–256 bits of crypto.randomBytes
// entropy, so brute-forcing the preimage is infeasible and rainbow tables
// don't apply. A fast hash also lets us keep the indexed unique-column
// lookup.
export function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}
