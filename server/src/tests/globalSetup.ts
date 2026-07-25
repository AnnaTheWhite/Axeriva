import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Runs ONCE per `vitest` invocation, before any test file is loaded.
//
// Provisions the throwaway test database by replaying the committed
// migrations onto an empty file. `migrate deploy` (not `db push`) on
// purpose: it means the suite validates the migration history itself — if a
// migration is broken or missing, the tests fail here rather than passing
// against a schema that was conjured straight from schema.prisma.
const SERVER_ROOT = path.join(__dirname, "..", "..");
const TEST_DB = path.join(SERVER_ROOT, "prisma", "test.db");

export async function setup() {
  // Start from a genuinely empty database every run — a leftover file from
  // an aborted run would silently carry rows into the next one. SQLite also
  // writes -journal/-wal siblings; remove those too.
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${TEST_DB}${suffix}`, { force: true });
  }

  // stdio piped, not inherited: `migrate deploy` prints every applied
  // migration, which would bury the test reporter's output on every run. A
  // failure still surfaces — execFileSync throws with the captured output.
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: SERVER_ROOT,
    stdio: "pipe",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      DATABASE_URL: `file:${TEST_DB}`,
    },
  });
}

export async function teardown() {
  // Leave nothing behind: the file is disposable and must never be mistaken
  // for a real database (or committed).
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${TEST_DB}${suffix}`, { force: true });
  }
}
