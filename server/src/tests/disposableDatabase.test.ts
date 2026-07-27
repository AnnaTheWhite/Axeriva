import { describe, expect, it } from "vitest";
import { assertDisposableDatabase } from "./helpers/disposableDatabase";

// The guard that keeps the integration suite from truncating anything that
// is not a local, disposable database. The HOST rule exists because the NAME
// rule alone failed in production in July 2026: the live database was named
// "axeriva_test" on a remote Render instance, the name check accepted it,
// and a routine suite run deleted the production data. These tests pin both
// rules and the exact opt-in.

const REMOTE_URL =
  "postgresql://user:pw@dpg-abc123-a.frankfurt-postgres.render.com/axeriva_test";

describe("assertDisposableDatabase", () => {
  it("accepts a test-named database on localhost", () => {
    expect(() =>
      assertDisposableDatabase(
        "postgresql://postgres:postgres@localhost:5432/axeriva_test?schema=public",
        false
      )
    ).not.toThrow();
  });

  it("accepts 127.0.0.1 and bracketed IPv6 loopback", () => {
    expect(() =>
      assertDisposableDatabase("postgresql://u:p@127.0.0.1:5432/axeriva_test", false)
    ).not.toThrow();
    expect(() =>
      assertDisposableDatabase("postgresql://u:p@[::1]:5432/axeriva_test", false)
    ).not.toThrow();
  });

  it("REFUSES a remote host without the opt-in — even with a test-looking name", () => {
    // The exact production-incident shape: remote Render host, "test" name.
    expect(() => assertDisposableDatabase(REMOTE_URL, false)).toThrow(
      /REMOTE host/
    );
    expect(() => assertDisposableDatabase(REMOTE_URL, false)).toThrow(
      /ALLOW_REMOTE_TEST_DB/
    );
  });

  it("accepts a remote host WITH the explicit opt-in", () => {
    expect(() => assertDisposableDatabase(REMOTE_URL, true)).not.toThrow();
  });

  it("keeps the name rule even on localhost", () => {
    expect(() =>
      assertDisposableDatabase("postgresql://u:p@localhost:5432/axeriva", false)
    ).toThrow(/database "axeriva"/);
  });

  it("keeps the name rule even with the remote opt-in", () => {
    // ALLOW_REMOTE_TEST_DB relaxes the host rule ONLY — a non-test name
    // stays fatal no matter what.
    expect(() =>
      assertDisposableDatabase(
        "postgresql://u:p@dpg-abc123-a.frankfurt-postgres.render.com/axeriva_prod",
        true
      )
    ).toThrow(/axeriva_prod/);
  });

  it("rejects an unparseable URL", () => {
    expect(() => assertDisposableDatabase("not a url", false)).toThrow(
      /not a valid URL/
    );
  });
});
