// Deterministic, substring-based entity detection for the Owner Command
// Center "suggestions panel" — no AI/ML, no automatic record creation.
// This only ever *suggests*; linking a detected entity to a note is always
// a separate, explicit owner action (see ownerNotes.routes.ts PUT).

type NamedEntity = { id: number; name: string };
type EmployeeEntity = { id: number; firstName: string; lastName: string };

export type DetectedEntities = {
  customers: NamedEntity[];
  projects: NamedEntity[];
  employees: EmployeeEntity[];
};

// False-positive mitigations:
// 1. Word-boundary match, not raw substring — "Pet" won't match inside
//    "Pets", "Kov" won't match inside "Kovalski".
// 2. Unicode-aware boundaries (\p{L}/\p{N}) so accented names like "Kovács"
//    or "János" are bounded correctly — plain `\b` in JS regex doesn't
//    treat accented letters as word characters and would misfire.
// 3. Minimum 3-character name requirement — skips trivial/short names that
//    would otherwise match almost any text.
// 4. Each category capped at 10 matches — a defensive limit, not a product
//    feature, in case a company has many short, common-word-like names.
const MIN_NAME_LENGTH = 3;
const MAX_MATCHES_PER_CATEGORY = 10;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isMentioned(text: string, name: string): boolean {
  if (name.trim().length < MIN_NAME_LENGTH) return false;

  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegex(name.trim())}(?![\\p{L}\\p{N}])`,
    "iu"
  );

  return pattern.test(text);
}

export function detectEntities(
  text: string,
  customers: NamedEntity[],
  projects: NamedEntity[],
  employees: EmployeeEntity[]
): DetectedEntities {
  return {
    customers: customers
      .filter((c) => isMentioned(text, c.name))
      .slice(0, MAX_MATCHES_PER_CATEGORY),
    projects: projects
      .filter((p) => isMentioned(text, p.name))
      .slice(0, MAX_MATCHES_PER_CATEGORY),
    // Employees match on full name OR first name alone — "Peter should go
    // on Friday" should still surface Peter Kovács even though the note
    // never spells out the last name.
    employees: employees
      .filter(
        (e) =>
          isMentioned(text, `${e.firstName} ${e.lastName}`) ||
          isMentioned(text, e.firstName)
      )
      .slice(0, MAX_MATCHES_PER_CATEGORY),
  };
}
