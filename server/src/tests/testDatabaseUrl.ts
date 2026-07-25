// Single source of the integration suite's database URL.
//
// Two different processes need it and they do NOT share environment:
//   - vitest.config.ts, which puts it in `test.env` for the test WORKERS
//   - globalSetup.ts, which runs in Vitest's MAIN process (where `test.env`
//     has not been applied yet) and shells out to `prisma migrate deploy`
//
// Reading TEST_DATABASE_URL in both places, from here, keeps the fallback
// from drifting between them.
//
// TEST_DATABASE_URL is set by:
//   - CI: the `postgres` service container (see .github/workflows/ci.yml)
//   - locally: the developer, pointing at a disposable database
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/axeriva_test?schema=public";
