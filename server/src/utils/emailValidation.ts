// Centralized email validation (K2.1.7) — the only place email format rules
// live. Every endpoint that accepts an email address in its body must call
// validateEmail(); no endpoint may hand-roll its own regex.

const EMAIL_MAX_LENGTH = 254; // RFC 5321 path limit
const LOCAL_MAX_LENGTH = 64; // RFC 5321 local-part limit

// Rejects whitespace and ASCII control characters anywhere in the address.
// Implemented with explicit code-point checks instead of a character-class
// range so no invisible control characters live in this source file.
function hasForbiddenChar(email: string): boolean {
  if (/\s/.test(email)) {
    return true;
  }

  for (const ch of email) {
    const code = ch.codePointAt(0)!;
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }

  return false;
}

// Domain: dot-separated labels (letters/digits/hyphen, not hyphen-edged),
// ending in a TLD of at least 2 letters. Non-ASCII (IDN) label characters
// (¡-￿) are allowed so internationalized domains aren't rejected
// unnecessarily — stricter punycode handling is out of scope (documented
// limitation).
const DOMAIN_PATTERN =
  /^(?:[a-z0-9¡-￿](?:[a-z0-9¡-￿-]{0,61}[a-z0-9¡-￿])?\.)+[a-z¡-￿]{2,}$/;

export const INVALID_EMAIL_MESSAGE = "Invalid email address.";

type EmailValidationResult =
  | { ok: true; email: string }
  | { ok: false; error: string };

// Normalization: trim outer whitespace, lowercase the DOMAIN part only. The
// local part is case-sensitive per RFC and stays untouched — and no
// provider-specific rewriting happens (dots and +aliases in the local part
// are preserved exactly as typed).
export function normalizeEmail(rawEmail: string): string {
  const trimmed = rawEmail.trim();
  const atIndex = trimmed.lastIndexOf("@");

  if (atIndex === -1) {
    return trimmed;
  }

  return trimmed.slice(0, atIndex) + "@" + trimmed.slice(atIndex + 1).toLowerCase();
}

// Validates (and normalizes) an email address from a request body. On
// success the caller must use the returned `email` (the normalized form)
// for lookups and storage.
export function validateEmail(rawEmail: unknown): EmailValidationResult {
  if (typeof rawEmail !== "string") {
    return { ok: false, error: INVALID_EMAIL_MESSAGE };
  }

  const email = normalizeEmail(rawEmail);

  if (email.length === 0 || email.length > EMAIL_MAX_LENGTH) {
    return { ok: false, error: INVALID_EMAIL_MESSAGE };
  }

  if (hasForbiddenChar(email)) {
    return { ok: false, error: INVALID_EMAIL_MESSAGE };
  }

  const parts = email.split("@");

  // Exactly one "@": one local part, one domain. (A quoted local part may
  // legally contain "@" per RFC 5321, but quoted locals are practically
  // unused and rejecting them keeps parsing unambiguous — documented
  // limitation.)
  if (parts.length !== 2) {
    return { ok: false, error: INVALID_EMAIL_MESSAGE };
  }

  const [local, domain] = parts;

  if (local.length === 0 || local.length > LOCAL_MAX_LENGTH) {
    return { ok: false, error: INVALID_EMAIL_MESSAGE };
  }

  // Unicode local parts stay accepted (compatibility must not decrease) —
  // only structural rules are enforced on the local part: no leading/
  // trailing dot, no consecutive dots.
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    return { ok: false, error: INVALID_EMAIL_MESSAGE };
  }

  if (!DOMAIN_PATTERN.test(domain)) {
    return { ok: false, error: INVALID_EMAIL_MESSAGE };
  }

  return { ok: true, email };
}
