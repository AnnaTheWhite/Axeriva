import { execFileSync } from "node:child_process";
import path from "node:path";
import { TEST_DATABASE_URL } from "./testDatabaseUrl";
import { assertDisposableDatabase } from "./helpers/disposableDatabase";

// Runs ONCE per `vitest` invocation, before any test file is loaded.
//
// Brings the test database up to the committed migrations. `migrate deploy`
// (not `db push`) on purpose: it means the suite validates the migration
// HISTORY — if a migration is broken or missing, the tests fail here rather
// than passing against a schema conjured straight from schema.prisma. On an
// empty database (CI's service container, or a freshly created local one)
// this applies every migration from scratch, which is exactly the check we
// want.
//
// Deliberately NOT `migrate reset`. Reset drops the schema and everything in
// it, which is irreversible if the connection string ever points somewhere it
// shouldn't — and a test harness should not carry a loaded gun for a job that
// does not need one. The clean slate each test needs comes from the per-test
// truncation in helpers/db.ts, which empties all 18 tables in FK order.
//
// Before the PostgreSQL migration this deleted a SQLite file; Postgres has no
// file to delete.
const SERVER_ROOT = path.join(__dirname, "..", "..");

// The suite TRUNCATES every table between tests (see helpers/db.ts). Pointed
// at the wrong database that is unrecoverable data loss, and the only thing
// standing between the two is an environment variable. So: refuse to run
// unless the target database marks itself as disposable — by NAME and, since
// the 2026-07 incident (production ran on a remote instance named
// "axeriva_test" and a suite run wiped it), by HOST: remote targets need the
// explicit ALLOW_REMOTE_TEST_DB=true opt-in. The rules themselves live in
// helpers/disposableDatabase.ts as a pure, unit-tested function.

export async function setup() {
  // NOT process.env.DATABASE_URL: globalSetup runs in Vitest's main process,
  // where the `test.env` block from vitest.config.ts has not been applied.
  // Both read the same resolved value from testDatabaseUrl.ts.
  const databaseUrl = TEST_DATABASE_URL;

  assertDisposableDatabase(databaseUrl, process.env.ALLOW_REMOTE_TEST_DB === "true");

  // stdio piped, not inherited: `migrate deploy` prints every applied
  // migration, which would bury the test reporter's output on every run. A
  // failure still surfaces — execFileSync throws with the captured output.
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: SERVER_ROOT,
    stdio: "pipe",
    shell: process.platform === "win32",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

export async function teardown() {
  // Nothing to clean up: the database is a dedicated throwaway one, its tables
  // are left empty by the last test's truncation, and the next run re-applies
  // any pending migration. Dropping anything here would only make a failed run
  // harder to inspect afterwards.
}
