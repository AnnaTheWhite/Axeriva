import { describe, expect, it } from "vitest";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_MESSAGE,
  validatePassword,
} from "../utils/passwordPolicy";

// B3 tripwire — the frontend mirrors this policy in src/utils/passwordPolicy.ts
// and hard-codes the same minimum into the common.passwordRequirements /
// common.passwordPolicyError i18n keys (via {{min}} interpolation from the
// mirrored constant). No shared module exists between server/ and src/, so
// the duplication is deliberate and THIS test is what keeps it honest: if it
// fails, the policy changed — update the frontend mirror and both i18n
// dictionaries in the same commit.
describe("password policy contract (frontend mirror tripwire)", () => {
  it("pins the minimum length the frontend mirrors", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
  });

  it("keeps the user-facing message in sync with the constant", () => {
    expect(PASSWORD_POLICY_MESSAGE).toContain(String(PASSWORD_MIN_LENGTH));
  });

  it("accepts Unicode letters — the mirror must use the same classes", () => {
    // "Á" must count as the uppercase letter and "á" as the lowercase one;
    // the frontend meter used ASCII regexes before B3 and told Hungarian
    // users their uppercase was missing.
    expect(validatePassword("árvíztűrő12X").ok).toBe(true);
    expect(validatePassword("Árvíztűrő12x").ok).toBe(true);
  });

  it("rejects a policy-violating password with the canonical message", () => {
    const result = validatePassword("abcdefghijkl");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(PASSWORD_POLICY_MESSAGE);
    }
  });
});
