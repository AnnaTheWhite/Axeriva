// Frontend mirror of server/src/utils/passwordPolicy.ts — the backend stays
// the authority; this exists ONLY for instant, localized UX feedback before
// a request is sent. No decision may depend on it.
//
// No shared module exists between server/ and src/ (separate package.json,
// separate tsconfig), so the value is deliberately duplicated in exactly
// this one file. No page, component or i18n string may hard-code the
// number — i18n texts receive it via {{min}} interpolation. The backend
// tripwire (server/src/tests/passwordPolicy.test.ts) fails loudly if the
// server-side value changes, naming this file.

export const PASSWORD_MIN_LENGTH = 12;

// Unicode-aware classes, same as the server's (\p{Ll} / \p{Lu} / \p{Nd}),
// so "Árvíztűrő12x" gets the same verdict on both sides.
const HAS_LOWERCASE = /\p{Ll}/u;
const HAS_UPPERCASE = /\p{Lu}/u;
const HAS_DIGIT = /\p{Nd}/u;

// Mirrors the server's rule INCLUDING the trim: the server validates and
// hashes the trimmed form, so the client's verdict only matches this way.
export function meetsPasswordPolicy(password: string): boolean {
  const value = password.trim();

  return (
    value.length >= PASSWORD_MIN_LENGTH &&
    HAS_LOWERCASE.test(value) &&
    HAS_UPPERCASE.test(value) &&
    HAS_DIGIT.test(value)
  );
}
