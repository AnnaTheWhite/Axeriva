import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CALENDAR_TIME_ZONE,
  allDayBoundsUtc,
  isValidTimeZone,
  localDayLengthHours,
  resolveCalendarTimeZone,
  utcToWallClock,
  wallClockToUtcDetailed,
  zoneOffsetMinutes,
} from "../services/calendar/timezone";
// D-3 — deliberate cross-module import. See the tripwire test below.
import { DEFAULT_BILLING_TIME_ZONE } from "../utils/billingFormat";

// CAL1.2 — timezone core.
//
// Pure functions, no database. What is worth proving here is the behaviour that
// only shows up twice a year: every one of these cases is silently correct for
// ten months and wrong for the other two, which is exactly the kind of bug that
// reaches production.

const ZONE = "Europe/Budapest";

describe("resolveCalendarTimeZone — the four-level order", () => {
  it("prefers the event's zone over the calendar, the company and the default", () => {
    expect(
      resolveCalendarTimeZone({
        eventTimeZone: "Asia/Tokyo",
        calendarTimeZone: "America/New_York",
        companyTimeZone: "Europe/Vienna",
      })
    ).toBe("Asia/Tokyo");
  });

  it("prefers the calendar's zone over the company and the default", () => {
    expect(
      resolveCalendarTimeZone({
        eventTimeZone: null,
        calendarTimeZone: "America/New_York",
        companyTimeZone: "Europe/Vienna",
      })
    ).toBe("America/New_York");
  });

  it("prefers the company's zone over the default", () => {
    expect(resolveCalendarTimeZone({ companyTimeZone: "Europe/Vienna" })).toBe("Europe/Vienna");
  });

  it("falls back to the calendar default when nothing is set", () => {
    expect(resolveCalendarTimeZone({})).toBe(DEFAULT_CALENDAR_TIME_ZONE);
    expect(
      resolveCalendarTimeZone({ eventTimeZone: null, calendarTimeZone: null, companyTimeZone: null })
    ).toBe(DEFAULT_CALENDAR_TIME_ZONE);
  });

  it("falls THROUGH a stored zone that passes the write-side regex but is not real", () => {
    // Company.timezone is tenant-writable and services/companyValidation.ts only
    // checks its SHAPE (/^[A-Za-z_]+(\/[A-Za-z_]+)*$/), so this exact string is
    // accepted and stored. Intl throws on it. If that throw escaped, a single
    // bad settings value would take down the tenant's whole calendar rather
    // than degrade one field.
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(resolveCalendarTimeZone({ companyTimeZone: "Mars/Olympus_Mons" })).toBe(
        DEFAULT_CALENDAR_TIME_ZONE
      );
      // An invalid EVENT zone must not skip the levels below it.
      expect(
        resolveCalendarTimeZone({
          eventTimeZone: "Mars/Olympus_Mons",
          calendarTimeZone: "Europe/Vienna",
        })
      ).toBe("Europe/Vienna");
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("treats blank and whitespace-only zones as unset rather than invalid", () => {
    expect(resolveCalendarTimeZone({ companyTimeZone: "" })).toBe(DEFAULT_CALENDAR_TIME_ZONE);
    expect(resolveCalendarTimeZone({ companyTimeZone: "   " })).toBe(DEFAULT_CALENDAR_TIME_ZONE);
    expect(resolveCalendarTimeZone({ calendarTimeZone: "  ", companyTimeZone: "Europe/Vienna" })).toBe(
      "Europe/Vienna"
    );
  });
});

describe("Q8 — the billing/calendar divergence is deliberate", () => {
  it("pins BOTH defaults, so neither can drift without this test failing", () => {
    // THE ANTI-DRIFT TRIPWIRE (plan §1, M2). These two constants describe the
    // same tenant column and deliberately disagree, because the two subsystems
    // ask different questions:
    //
    //   Billing renders an instant Stripe already fixed — the question is which
    //   calendar DAY to name, and UTC is a neutral, explainable answer.
    //   billingFormat.test.ts pins that a European default would name the WRONG
    //   DAY for a 23:30Z invoice period boundary.
    //
    //   The calendar stores a human intention. "Every Monday 09:00" is a
    //   wall-clock rule; under a UTC fallback it drifts an hour at the spring
    //   transition and stays wrong (see the recurrence suite).
    //
    // No single value is correct for both. If you are here because this test
    // failed, you are changing that trade-off — do it on purpose.
    expect(DEFAULT_BILLING_TIME_ZONE).toBe("UTC");
    expect(DEFAULT_CALENDAR_TIME_ZONE).toBe("Europe/Budapest");
    expect(DEFAULT_CALENDAR_TIME_ZONE).not.toBe(DEFAULT_BILLING_TIME_ZONE);
  });
});

describe("zoneOffsetMinutes — the transitions themselves", () => {
  it("jumps +60 → +120 across the spring transition", () => {
    // Hungary springs forward at 01:00 UTC on 2026-03-29: 01:59 → 03:00 local.
    expect(zoneOffsetMinutes(ZONE, new Date("2026-03-29T00:59:00Z"))).toBe(60);
    expect(zoneOffsetMinutes(ZONE, new Date("2026-03-29T01:00:00Z"))).toBe(120);
  });

  it("drops +120 → +60 across the autumn transition", () => {
    // And back at 01:00 UTC on 2026-10-25: 02:59 → 02:00 local.
    expect(zoneOffsetMinutes(ZONE, new Date("2026-10-25T00:59:00Z"))).toBe(120);
    expect(zoneOffsetMinutes(ZONE, new Date("2026-10-25T01:00:00Z"))).toBe(60);
  });
});

describe("wallClockToUtc — local times that are not a single instant", () => {
  it("D-1: shifts a NON-EXISTENT local time forward past the gap", () => {
    // 02:30 on 2026-03-29 never happens in Budapest — the clocks go straight
    // from 01:59 to 03:00. Policy is to shift forward by the gap so the
    // occurrence still lands on the day the user asked for; skipping it would
    // read as data loss.
    // Control first: an ordinary local time resolves exactly, no policy — so a
    // "gap" verdict below means the classifier fired, not that it labels
    // everything.
    const ordinary = wallClockToUtcDetailed(
      { year: 2026, month: 6, day: 15, hour: 9, minute: 0, second: 0 },
      ZONE
    );
    expect(ordinary.resolution).toBe("exact");
    expect(ordinary.instant.toISOString()).toBe("2026-06-15T07:00:00.000Z");

    const resolved = wallClockToUtcDetailed(
      { year: 2026, month: 3, day: 29, hour: 2, minute: 30, second: 0 },
      ZONE
    );

    expect(resolved.resolution).toBe("gap");
    expect(resolved.instant.toISOString()).toBe("2026-03-29T01:30:00.000Z");

    const wall = utcToWallClock(resolved.instant, ZONE);
    expect([wall.hour, wall.minute]).toEqual([3, 30]);
    expect(wall.day).toBe(29);
  });

  it("D-2: resolves an AMBIGUOUS local time to the first of its two instants", () => {
    // 02:30 on 2026-10-25 happens twice — once at +02:00 and again at +01:00.
    // Both render as "02:30". Policy is the earlier one: deterministic, and it
    // stops CAL2.3 from firing every reminder on the event twice.
    const resolved = wallClockToUtcDetailed(
      { year: 2026, month: 10, day: 25, hour: 2, minute: 30, second: 0 },
      ZONE
    );

    expect(resolved.resolution).toBe("overlap");
    expect(resolved.instant.toISOString()).toBe("2026-10-25T00:30:00.000Z");
    // The later candidate renders identically, which is the whole problem.
    expect(utcToWallClock(new Date("2026-10-25T01:30:00.000Z"), ZONE).hour).toBe(2);
    // Pre-transition offset, i.e. the FIRST occurrence.
    expect(zoneOffsetMinutes(ZONE, resolved.instant)).toBe(120);
  });

});

describe("regression — unusable input degrades instead of exploding", () => {
  it("falls back on an unusable zone, and rejects an unusable instant BY NAME", () => {
    // Review finding. Two different contracts, deliberately:
    //
    //   A bad ZONE is recoverable — the fallback chain exists precisely because
    //   Company.timezone is tenant-writable — so conversion degrades and warns.
    //
    //   A bad INSTANT is not recoverable: there is no correct wall clock for
    //   "Invalid Date". It still throws, but Intl's bare
    //   RangeError("Invalid time value") named nothing an operator could act
    //   on, so the guard now says which module rejected what. The public
    //   recurrence entry points catch this class before it reaches a request.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const wall = utcToWallClock(new Date("2026-06-15T07:00:00.000Z"), "Mars/Olympus_Mons");
      // Fell back to Europe/Budapest rather than throwing: 07:00Z is 09:00 there.
      expect(wall.hour).toBe(9);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }

    expect(() => utcToWallClock(new Date("nonsense"), ZONE)).toThrow(/calendar\/timezone/);
    expect(() => zoneOffsetMinutes(ZONE, new Date(Number.NaN))).toThrow(/calendar\/timezone/);
    // Non-finite wall-clock fields are caught before they become an Invalid
    // Date two calls deeper.
    expect(() =>
      wallClockToUtcDetailed(
        { year: Number.NaN, month: 3, day: 29, hour: 2, minute: 30, second: 0 },
        ZONE
      )
    ).toThrow(/calendar\/timezone/);
  });
});

describe("allDayBoundsUtc — a day is a local day", () => {
  it("spans local midnight to local midnight without bleeding into the next day", () => {
    // Not 00:00–23:59Z. Stored that way, a Hungarian all-day event shows up on
    // two days for anyone reading in UTC.
    const { startsAt, endsAt } = allDayBoundsUtc({ year: 2026, month: 6, day: 15 }, ZONE);

    expect(startsAt.toISOString()).toBe("2026-06-14T22:00:00.000Z");
    expect(endsAt.toISOString()).toBe("2026-06-15T22:00:00.000Z");

    const openingWall = utcToWallClock(startsAt, ZONE);
    expect([openingWall.day, openingWall.hour, openingWall.minute]).toEqual([15, 0, 0]);

    // The last instant still inside the day is still the 15th locally.
    expect(utcToWallClock(new Date(endsAt.getTime() - 1), ZONE).day).toBe(15);
    expect(localDayLengthHours({ year: 2026, month: 6, day: 15 }, ZONE)).toBe(24);
  });

  it("is 23 hours on the spring transition day and 25 on the autumn one", () => {
    // The case a fixed 24-hour span gets wrong, and the reason D-5 exempts
    // all-day series from the stored duration.
    expect(localDayLengthHours({ year: 2026, month: 3, day: 29 }, ZONE)).toBe(23);
    expect(localDayLengthHours({ year: 2026, month: 10, day: 25 }, ZONE)).toBe(25);

    const spring = allDayBoundsUtc({ year: 2026, month: 3, day: 29 }, ZONE);
    expect(spring.startsAt.toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(spring.endsAt.toISOString()).toBe("2026-03-29T22:00:00.000Z");

    const autumn = allDayBoundsUtc({ year: 2026, month: 10, day: 25 }, ZONE);
    expect(autumn.startsAt.toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(autumn.endsAt.toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });
});
