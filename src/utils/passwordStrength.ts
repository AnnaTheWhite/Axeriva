import { meetsPasswordPolicy, PASSWORD_MIN_LENGTH } from "./passwordPolicy";

export type PasswordStrengthLevel = "weak" | "medium" | "strong";

// Scoring stays on the 0-5 scale so PasswordStrengthMeter's "(score/5)"
// display and its 3-bar rendering keep working untouched. Four points mirror
// the actual backend policy (length + lowercase + uppercase + digit — with
// the same Unicode classes, so "Árvíztűrő12x" is no longer told it has no
// uppercase); the fifth is a BONUS for strength beyond the minimum. A
// special character is part of that bonus only — the backend never requires
// one. Works on the trimmed value, matching what the server validates and
// hashes. Pure function, no React/i18n dependency.
function scorePassword(value: string): number {
  let score = 0;

  if (value.length >= PASSWORD_MIN_LENGTH) score += 1;
  if (/\p{Ll}/u.test(value)) score += 1;
  if (/\p{Lu}/u.test(value)) score += 1;
  if (/\p{Nd}/u.test(value)) score += 1;
  // Bonus: comfortably past the minimum length, OR any non-letter/non-digit
  // character. Either path earns it — "strong" is reachable with length
  // alone, so the meter never implies a rule the backend doesn't enforce.
  if (
    value.length >= PASSWORD_MIN_LENGTH + 4 ||
    /[^\p{L}\p{Nd}]/u.test(value)
  ) {
    score += 1;
  }

  return score;
}

export function getPasswordStrength(password: string): {
  score: number;
  level: PasswordStrengthLevel;
} {
  const value = password.trim();
  const score = scorePassword(value);

  // The level comes from POLICY COMPLIANCE, not from the raw score: "weak"
  // means exactly "the server would reject this", so the meter can never
  // show a passing colour on a password the backend refuses — or vice versa.
  if (!meetsPasswordPolicy(value)) {
    return { score, level: "weak" };
  }

  return { score, level: score >= 5 ? "strong" : "medium" };
}
