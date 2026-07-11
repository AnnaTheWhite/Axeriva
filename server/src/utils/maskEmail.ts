// Masks an email for logging: "anna.kovacs@example.com" -> "an***@example.com".
// The single source of this helper — both the rate limiter (for its keys)
// and the auth audit log import it, so masking behaves identically
// everywhere and neither module has to depend on the other.
export function maskEmail(email: string): string {
  const atIndex = email.indexOf("@");
  if (atIndex <= 0) {
    return "***";
  }
  return `${email.slice(0, Math.min(2, atIndex))}***${email.slice(atIndex)}`;
}
