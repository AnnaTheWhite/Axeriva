// Centralized password policy (K2.1.6) — the single place password strength
// is defined. Every flow that creates or changes a password (register,
// password reset, invitation accept, and any future one) must call
// validatePassword(); no endpoint may hand-roll its own rules.
//
// The policy applies ONLY when a password is being set — existing hashes are
// untouched and login never validates strength (backward compatibility).

export const PASSWORD_MIN_LENGTH = 12;

// One consistent, user-facing message for every flow. Deliberately lists the
// rules (they are not a secret — they're a prompt for the user) without any
// implementation detail.
export const PASSWORD_POLICY_MESSAGE =
  "Password must contain: at least 12 characters, one uppercase letter, one lowercase letter and one number.";

type PasswordValidationResult =
  | { ok: true; password: string }
  | { ok: false; error: string };

// Unicode-aware checks (\p{Ll} / \p{Lu}) so non-ASCII passwords keep
// working — "Árvíztűrő" satisfies the uppercase and lowercase rules the
// same way "Password" does. Digits accept any Unicode decimal digit.
const HAS_LOWERCASE = /\p{Ll}/u;
const HAS_UPPERCASE = /\p{Lu}/u;
const HAS_DIGIT = /\p{Nd}/u;

// Validates (and normalizes) a password being created or changed. Only
// leading/trailing whitespace is trimmed — internal whitespace is a legal
// password character and stays untouched. On success the caller must hash
// the returned `password` (the trimmed form), not the raw input.
export function validatePassword(rawPassword: unknown): PasswordValidationResult {
  if (typeof rawPassword !== "string") {
    return { ok: false, error: PASSWORD_POLICY_MESSAGE };
  }

  const password = rawPassword.trim();

  if (
    password.length < PASSWORD_MIN_LENGTH ||
    !HAS_LOWERCASE.test(password) ||
    !HAS_UPPERCASE.test(password) ||
    !HAS_DIGIT.test(password)
  ) {
    return { ok: false, error: PASSWORD_POLICY_MESSAGE };
  }

  return { ok: true, password };
}
