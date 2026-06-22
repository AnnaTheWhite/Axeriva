export type PasswordStrengthLevel = "weak" | "medium" | "strong";

// 5 equally-weighted criteria, 1 point each. Pure function, no React/i18n
// dependency, so it stays independently reusable/testable.
function scorePassword(password: string): number {
  let score = 0;

  if (password.length >= 10) score += 1;
  if (/[a-z]/.test(password)) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^a-zA-Z0-9]/.test(password)) score += 1;

  return score;
}

function levelFromScore(score: number): PasswordStrengthLevel {
  if (score >= 5) return "strong";
  if (score >= 3) return "medium";
  return "weak";
}

export function getPasswordStrength(password: string): {
  score: number;
  level: PasswordStrengthLevel;
} {
  const score = scorePassword(password);
  return { score, level: levelFromScore(score) };
}
