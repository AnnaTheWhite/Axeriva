// The guard that decides whether the integration suite may run against a
// given database URL. PURE logic — no process.env reads, no side effects —
// so it is unit-testable (the same reason config/stripeKeyMode.ts is pure);
// globalSetup.ts owns the env read and the call.
//
// Two independent rules, both required:
//
//  1. NAME rule (original): the database name must contain "test" — the
//     suite truncates every table between tests, so its target must mark
//     itself as disposable.
//
//  2. HOST rule (added after the 2026-07 production incident): the target
//     must be LOCAL. The name rule alone proved insufficient in the worst
//     possible way — production ran on a managed instance whose database
//     was named "axeriva_test", the name check waved it through, and a
//     routine suite run deleted the production data. A remote host is only
//     ever accepted with the explicit ALLOW_REMOTE_TEST_DB=true opt-in
//     (passed in as a boolean by the caller), which exists for deliberate,
//     eyes-open setups (e.g. a CI provider whose database sits on a
//     separate host) — never as a convenience.

const TEST_DB_NAME_MARKER = "test";

// Node's WHATWG URL keeps IPv6 hostnames bracketed ("[::1]"), so both
// spellings are listed.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function assertDisposableDatabase(url: string, allowRemote: boolean): void {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      `Refusing to run the integration suite: DATABASE_URL is not a valid URL.\n` +
        `Set TEST_DATABASE_URL to a throwaway PostgreSQL database.`
    );
  }

  // "postgresql://user:pass@host:5432/axeriva_test?schema=public" → "axeriva_test"
  const databaseName = parsed.pathname.replace(/^\//, "");

  if (!databaseName.toLowerCase().includes(TEST_DB_NAME_MARKER)) {
    throw new Error(
      `Refusing to run the integration suite against database "${databaseName}".\n` +
        `The suite drops and truncates every table, so its target database name must\n` +
        `contain "${TEST_DB_NAME_MARKER}" (e.g. axeriva_test). Set TEST_DATABASE_URL\n` +
        `to a database you are willing to lose.`
    );
  }

  if (!LOCAL_HOSTS.has(parsed.hostname.toLowerCase()) && !allowRemote) {
    throw new Error(
      `Refusing to run the integration suite against REMOTE host "${parsed.hostname}".\n` +
        `The suite truncates every table between tests, and a disposable-looking name\n` +
        `is no proof a remote database is disposable — in July 2026 the production\n` +
        `database was named "axeriva_test" and a suite run wiped it. Use a local\n` +
        `PostgreSQL database, or — only if you are CERTAIN the remote target is\n` +
        `disposable — set ALLOW_REMOTE_TEST_DB=true for this run.`
    );
  }
}
