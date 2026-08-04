import { describe, expect, it, vi } from "vitest";
import {
  computeRecurrenceEndsAt,
  expandOccurrences,
  parseRecurrenceRule,
  type OccurrenceException,
} from "../services/calendar/recurrence";
import { allDayBoundsUtc, utcToWallClock } from "../services/calendar/timezone";

// CAL1.2 — recurrence core.
//
// Pure functions, no database. Cases 10 and 11 are the reason this milestone
// exists at all: they are the ones that fail if expansion is done in UTC
// instead of local wall-clock time. Cases 18-21 pin the recurrenceEndsAt
// contract that schema.prisma already committed to in CAL1.1.

const ZONE = "Europe/Budapest";

// "2026-06-01 09:00 Europe/Budapest" as the instant it actually is (+02:00).
const JUNE_1_0900 = new Date("2026-06-01T07:00:00.000Z");
const JUNE_1_1000 = new Date("2026-06-01T08:00:00.000Z");

function localTimes(occurrences: { startsAt: Date }[]): string[] {
  return occurrences.map((occurrence) => {
    const wall = utcToWallClock(occurrence.startsAt, ZONE);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${wall.year}-${pad(wall.month)}-${pad(wall.day)} ${pad(wall.hour)}:${pad(wall.minute)}`;
  });
}

function expand(rule: string | null, overrides: Partial<Parameters<typeof expandOccurrences>[0]> = {}) {
  return expandOccurrences({
    rule,
    startsAt: JUNE_1_0900,
    endsAt: JUNE_1_1000,
    zone: ZONE,
    windowStart: new Date("2026-06-01T00:00:00.000Z"),
    windowEnd: new Date("2026-06-30T00:00:00.000Z"),
    ...overrides,
  });
}

describe("expandOccurrences — the basic frequencies", () => {
  it("expands a daily rule across the window", () => {
    const occurrences = expand("FREQ=DAILY", { windowEnd: new Date("2026-06-05T00:00:00.000Z") });

    expect(localTimes(occurrences)).toEqual([
      "2026-06-01 09:00",
      "2026-06-02 09:00",
      "2026-06-03 09:00",
      "2026-06-04 09:00",
    ]);
  });

  it("honours INTERVAL", () => {
    const occurrences = expand("FREQ=DAILY;INTERVAL=2", {
      windowEnd: new Date("2026-06-08T00:00:00.000Z"),
    });

    expect(localTimes(occurrences)).toEqual([
      "2026-06-01 09:00",
      "2026-06-03 09:00",
      "2026-06-05 09:00",
      "2026-06-07 09:00",
    ]);
  });

  it("emits every listed weekday for FREQ=WEEKLY;BYDAY=MO,WE", () => {
    // 2026-06-01 is a Monday.
    const occurrences = expand("FREQ=WEEKLY;BYDAY=MO,WE", {
      windowEnd: new Date("2026-06-15T00:00:00.000Z"),
    });

    expect(localTimes(occurrences)).toEqual([
      "2026-06-01 09:00",
      "2026-06-03 09:00",
      "2026-06-08 09:00",
      "2026-06-10 09:00",
    ]);
  });

  it("SKIPS months that have no 31st rather than clamping to the 30th", () => {
    // RFC 5545 semantics: a monthly rule on the 31st simply has no occurrence
    // in a short month. Clamping would invent an occurrence on a date the user
    // never chose — February would silently become "the 28th".
    const occurrences = expandOccurrences({
      rule: "FREQ=MONTHLY",
      startsAt: new Date("2026-01-31T08:00:00.000Z"), // 09:00 local, CET
      endsAt: new Date("2026-01-31T09:00:00.000Z"),
      zone: ZONE,
      windowStart: new Date("2026-01-01T00:00:00.000Z"),
      windowEnd: new Date("2026-07-01T00:00:00.000Z"),
    });

    expect(localTimes(occurrences).map((s) => s.slice(0, 10))).toEqual([
      "2026-01-31",
      "2026-03-31",
      "2026-05-31",
    ]);
  });

  it("SKIPS non-leap years for a 29 February yearly rule", () => {
    const occurrences = expandOccurrences({
      rule: "FREQ=YEARLY",
      startsAt: new Date("2024-02-29T08:00:00.000Z"),
      endsAt: new Date("2024-02-29T09:00:00.000Z"),
      zone: ZONE,
      windowStart: new Date("2024-01-01T00:00:00.000Z"),
      windowEnd: new Date("2033-01-01T00:00:00.000Z"),
    });

    expect(localTimes(occurrences).map((s) => s.slice(0, 10))).toEqual([
      "2024-02-29",
      "2028-02-29",
      "2032-02-29",
    ]);
  });
});

describe("expandOccurrences — where the series stops", () => {
  it("emits exactly COUNT occurrences, not one more or fewer", () => {
    const occurrences = expand("FREQ=DAILY;COUNT=3");
    expect(occurrences).toHaveLength(3);
    expect(localTimes(occurrences)).toEqual([
      "2026-06-01 09:00",
      "2026-06-02 09:00",
      "2026-06-03 09:00",
    ]);
  });

  it("treats UNTIL as an inclusive absolute instant", () => {
    // UNTIL bounds the SERIES and is compared against each occurrence's start.
    const occurrences = expand("FREQ=DAILY;UNTIL=20260605T235959Z");
    expect(localTimes(occurrences).map((s) => s.slice(0, 10))).toEqual([
      "2026-06-01",
      "2026-06-02",
      "2026-06-03",
      "2026-06-04",
      "2026-06-05",
    ]);

    // One second earlier than the 5th's start would exclude it.
    const tighter = expand("FREQ=DAILY;UNTIL=20260604T235959Z");
    expect(tighter).toHaveLength(4);
  });

  it("stops at whichever of COUNT and UNTIL comes first", () => {
    // COUNT would allow ten; UNTIL cuts it at three.
    expect(expand("FREQ=DAILY;COUNT=10;UNTIL=20260603T235959Z")).toHaveLength(3);
    // And the other way round.
    expect(expand("FREQ=DAILY;COUNT=2;UNTIL=20260620T235959Z")).toHaveLength(2);
  });

  it("returns null from computeRecurrenceEndsAt for an infinite rule", () => {
    // NULL is what makes the CAL1.5 candidate query treat the series as always
    // reachable; a wrong value here would silently hide the event.
    expect(
      computeRecurrenceEndsAt({
        rule: "FREQ=WEEKLY;BYDAY=MO",
        startsAt: JUNE_1_0900,
        endsAt: JUNE_1_1000,
        zone: ZONE,
      })
    ).toBeNull();
  });
});

describe("expandOccurrences — DST, the reason this module exists", () => {
  it("keeps a weekly 09:00 at 09:00 LOCAL across the spring transition", () => {
    // THE test. 2026-03-23 09:00 local is 08:00Z (CET); 2026-03-30 09:00 local
    // is 07:00Z (CEST). If expansion ran in UTC and simply added seven days,
    // the second occurrence would read 10:00 local — and stay wrong forever.
    const occurrences = expandOccurrences({
      rule: "FREQ=WEEKLY;COUNT=3",
      startsAt: new Date("2026-03-23T08:00:00.000Z"),
      endsAt: new Date("2026-03-23T09:00:00.000Z"),
      zone: ZONE,
      windowStart: new Date("2026-03-01T00:00:00.000Z"),
      windowEnd: new Date("2026-04-30T00:00:00.000Z"),
    });

    expect(localTimes(occurrences)).toEqual([
      "2026-03-23 09:00",
      "2026-03-30 09:00",
      "2026-04-06 09:00",
    ]);
    // The proof that the UTC instant genuinely moved to keep the local time.
    expect(occurrences[0]!.startsAt.toISOString()).toBe("2026-03-23T08:00:00.000Z");
    expect(occurrences[1]!.startsAt.toISOString()).toBe("2026-03-30T07:00:00.000Z");
  });

  it("keeps a weekly 09:00 at 09:00 LOCAL across the autumn transition", () => {
    const occurrences = expandOccurrences({
      rule: "FREQ=WEEKLY;COUNT=3",
      startsAt: new Date("2026-10-19T07:00:00.000Z"), // 09:00 local, CEST
      endsAt: new Date("2026-10-19T08:00:00.000Z"),
      zone: ZONE,
      windowStart: new Date("2026-10-01T00:00:00.000Z"),
      windowEnd: new Date("2026-11-30T00:00:00.000Z"),
    });

    expect(localTimes(occurrences)).toEqual([
      "2026-10-19 09:00",
      "2026-10-26 09:00",
      "2026-11-02 09:00",
    ]);
    expect(occurrences[1]!.startsAt.toISOString()).toBe("2026-10-26T08:00:00.000Z");
  });

  it("D-5: a timed occurrence keeps its EXACT ELAPSED duration across a transition", () => {
    // 00:30 local + 3h. On 2026-03-29 the clocks jump during the event, so the
    // local end reads 04:30 — four wall-clock hours later — while the elapsed
    // duration is still exactly three. A booked three-hour job must not become
    // a four-hour one because the clocks moved.
    const occurrences = expandOccurrences({
      rule: "FREQ=DAILY;COUNT=2",
      startsAt: new Date("2026-03-27T23:30:00.000Z"), // 2026-03-28 00:30 local
      endsAt: new Date("2026-03-28T02:30:00.000Z"), // +3h
      zone: ZONE,
      windowStart: new Date("2026-03-01T00:00:00.000Z"),
      windowEnd: new Date("2026-04-30T00:00:00.000Z"),
    });

    expect(occurrences).toHaveLength(2);

    const spanHours = (o: { startsAt: Date; endsAt: Date }) =>
      (o.endsAt.getTime() - o.startsAt.getTime()) / 3_600_000;

    expect(spanHours(occurrences[0]!)).toBe(3);
    expect(spanHours(occurrences[1]!)).toBe(3);

    // The DST occurrence: same three elapsed hours, but the local clock shows
    // a four-hour span.
    const start = utcToWallClock(occurrences[1]!.startsAt, ZONE);
    const end = utcToWallClock(occurrences[1]!.endsAt, ZONE);
    expect([start.day, start.hour, start.minute]).toEqual([29, 0, 30]);
    expect([end.day, end.hour, end.minute]).toEqual([29, 4, 30]);
  });

  it("D-5: an all-day occurrence on the spring transition day spans 23 hours", () => {
    // All-day series take their bounds from the LOCAL DATE, never from a stored
    // duration — 2026-03-29 is a 23-hour day in Budapest.
    const first = allDayBoundsUtc({ year: 2026, month: 3, day: 28 }, ZONE);

    const occurrences = expandOccurrences({
      rule: "FREQ=DAILY;COUNT=3",
      startsAt: first.startsAt,
      endsAt: first.endsAt,
      allDay: true,
      zone: ZONE,
      windowStart: new Date("2026-03-01T00:00:00.000Z"),
      windowEnd: new Date("2026-04-30T00:00:00.000Z"),
    });

    const spanHours = occurrences.map(
      (o) => (o.endsAt.getTime() - o.startsAt.getTime()) / 3_600_000
    );
    expect(spanHours).toEqual([24, 23, 24]);
    expect(occurrences[1]!.startsAt.toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(occurrences[1]!.endsAt.toISOString()).toBe("2026-03-29T22:00:00.000Z");
  });
});

describe("expandOccurrences — the window", () => {
  it("returns nothing when the window is entirely before the series", () => {
    expect(
      expand("FREQ=DAILY", {
        windowStart: new Date("2026-05-01T00:00:00.000Z"),
        windowEnd: new Date("2026-05-31T00:00:00.000Z"),
      })
    ).toEqual([]);
  });

  it("returns nothing when the window is entirely after a finite series", () => {
    expect(
      expand("FREQ=DAILY;COUNT=3", {
        windowStart: new Date("2026-07-01T00:00:00.000Z"),
        windowEnd: new Date("2026-07-31T00:00:00.000Z"),
      })
    ).toEqual([]);
  });

  it("returns only the occurrences that fall inside a partially overlapping window", () => {
    const occurrences = expand("FREQ=DAILY;COUNT=10", {
      windowStart: new Date("2026-06-04T00:00:00.000Z"),
      windowEnd: new Date("2026-06-07T00:00:00.000Z"),
    });

    expect(localTimes(occurrences)).toEqual([
      "2026-06-04 09:00",
      "2026-06-05 09:00",
      "2026-06-06 09:00",
    ]);
  });

  it("selects by OVERLAP, so an occurrence in progress at the window's opening is included", () => {
    // An overnight 23:00-01:00 weekly. The window opens at 22:00Z on 22 June —
    // one hour INTO the last occurrence, which started at 21:00Z. Filtering on
    // startsAt alone would drop an event that is happening right now.
    const occurrences = expandOccurrences({
      rule: "FREQ=WEEKLY;COUNT=4",
      startsAt: new Date("2026-06-01T21:00:00.000Z"), // 23:00 local
      endsAt: new Date("2026-06-01T23:00:00.000Z"), // 01:00 local next day
      zone: ZONE,
      windowStart: new Date("2026-06-22T22:00:00.000Z"),
      windowEnd: new Date("2026-06-30T00:00:00.000Z"),
    });

    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.startsAt.toISOString()).toBe("2026-06-22T21:00:00.000Z");
    expect(occurrences[0]!.startsAt.getTime()).toBeLessThan(
      new Date("2026-06-22T22:00:00.000Z").getTime()
    );
  });
});

describe("expandOccurrences — exceptions", () => {
  it("removes exactly the cancelled occurrence and leaves its siblings alone", () => {
    const exceptions: OccurrenceException[] = [
      { originalStartsAt: new Date("2026-06-02T07:00:00.000Z"), cancelled: true },
    ];
    const occurrences = expand("FREQ=DAILY;COUNT=4", { exceptions });

    expect(localTimes(occurrences)).toEqual([
      "2026-06-01 09:00",
      "2026-06-03 09:00",
      "2026-06-04 09:00",
    ]);
  });

  it("applies a moved occurrence's overrides while keeping its original key", () => {
    // originalStartsAt stays the series instant — that is what a "?scope=this"
    // edit addresses, and losing it would orphan the exception row.
    const exceptions: OccurrenceException[] = [
      {
        originalStartsAt: new Date("2026-06-02T07:00:00.000Z"),
        startsAt: new Date("2026-06-02T12:00:00.000Z"),
        endsAt: new Date("2026-06-02T13:00:00.000Z"),
        title: "Moved to the afternoon",
      },
    ];
    const occurrences = expand("FREQ=DAILY;COUNT=3", { exceptions });

    expect(occurrences).toHaveLength(3);
    const moved = occurrences.find((o) => o.overridden);
    expect(moved).toBeDefined();
    expect(moved!.originalStartsAt.toISOString()).toBe("2026-06-02T07:00:00.000Z");
    expect(moved!.startsAt.toISOString()).toBe("2026-06-02T12:00:00.000Z");
    expect(moved!.title).toBe("Moved to the afternoon");
    // Siblings are untouched.
    expect(occurrences.filter((o) => o.overridden)).toHaveLength(1);
  });
});

describe("parseRecurrenceRule — unsupported input is rejected, never degraded", () => {
  it("rejects malformed and out-of-grammar rules instead of treating them as one-off", () => {
    // Silently dropping BYSETPOS from "last Friday of the month" would turn it
    // into "every Friday" — a wrong schedule presented as a correct one.
    expect(parseRecurrenceRule("FREQ=WEEKLY;BYDAY=MO").ok).toBe(true);

    for (const bad of [
      "",
      "   ",
      "BYDAY=MO",
      "FREQ=HOURLY",
      "FREQ=WEEKLY;BYSETPOS=-1",
      "FREQ=MONTHLY;BYDAY=-1FR",
      "FREQ=WEEKLY;INTERVAL=0",
      "FREQ=WEEKLY;COUNT=abc",
      "FREQ=WEEKLY;UNTIL=not-a-date",
      "FREQ=WEEKLY;BYDAY=XX",
      "FREQ=DAILY;FREQ=WEEKLY",
      "FREQ",
    ]) {
      expect(parseRecurrenceRule(bad).ok, `expected ${JSON.stringify(bad)} to be rejected`).toBe(false);
    }

    // A stored rule that cannot be read must not silently become a recurring
    // series either — it degrades to the single base event, loudly.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const occurrences = expand("FREQ=HOURLY");
      expect(occurrences).toHaveLength(1);
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});

describe("regression — the six defects the CAL1.2 review found", () => {
  it("rejects an absurd INTERVAL instead of overflowing into a thrown RangeError", () => {
    // Review finding, reproduced before the fix: INTERVAL=999999999999 walked
    // the civil-date arithmetic off the end of the representable range, and the
    // resulting Invalid Date made Intl throw a RangeError straight out of a
    // pure function — a 500 from the CAL1.5 endpoint, caused by a stored string.
    expect(parseRecurrenceRule("FREQ=DAILY;INTERVAL=999999999999").ok).toBe(false);
    expect(parseRecurrenceRule("FREQ=DAILY;INTERVAL=1001").ok).toBe(false);
    expect(parseRecurrenceRule("FREQ=DAILY;INTERVAL=1000").ok).toBe(true);
    // COUNT is bounded for the same reason: computeRecurrenceEndsAt walks the
    // whole series and has no window to stop it.
    expect(parseRecurrenceRule("FREQ=DAILY;COUNT=10000001").ok).toBe(false);

    // And the expander no longer throws when handed one.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => expand("FREQ=DAILY;INTERVAL=999999999999")).not.toThrow();
    } finally {
      error.mockRestore();
    }
  });

  it("never reports a FINITE series as infinite, whatever the input", () => {
    // Review finding. null means "infinite" to the CAL1.5 candidate query, so
    // returning it for a finite series inverts the meaning and makes the row
    // permanently reachable. Two ways this used to happen:
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // (a) a finite rule that yields no occurrence at all — UNTIL earlier than
      //     the first one.
      const empty = computeRecurrenceEndsAt({
        rule: "FREQ=DAILY;UNTIL=20260101T000000Z",
        startsAt: JUNE_1_0900,
        endsAt: JUNE_1_1000,
        zone: ZONE,
      });
      expect(empty).not.toBeNull();
      expect(empty!.toISOString()).toBe(JUNE_1_1000.toISOString());

      // (b) unusable input — degrade to the event's own end, never to "infinite".
      const broken = computeRecurrenceEndsAt({
        rule: "FREQ=DAILY;COUNT=3",
        startsAt: new Date("nonsense"),
        endsAt: JUNE_1_1000,
        zone: ZONE,
      });
      expect(broken!.toISOString()).toBe(JUNE_1_1000.toISOString());

      // The expander degrades to nothing rather than throwing on the same input.
      expect(
        expandOccurrences({
          rule: "FREQ=DAILY",
          startsAt: new Date("nonsense"),
          endsAt: JUNE_1_1000,
          zone: ZONE,
          windowStart: new Date("2026-06-01T00:00:00.000Z"),
          windowEnd: new Date("2026-06-30T00:00:00.000Z"),
        })
      ).toEqual([]);
    } finally {
      error.mockRestore();
    }

    // An infinite rule still reports null — the fix must not have broken that.
    expect(
      computeRecurrenceEndsAt({ rule: "FREQ=DAILY", startsAt: JUNE_1_0900, endsAt: JUNE_1_1000, zone: ZONE })
    ).toBeNull();
  });

  it("returns nothing for limit 0, rather than one occurrence", () => {
    // Review finding: the ceiling was tested AFTER the push, so it was always
    // off by one and limit:0 leaked a single occurrence.
    expect(expand("FREQ=DAILY", { limit: 0 })).toEqual([]);
    expect(expand("FREQ=DAILY", { limit: 1 })).toHaveLength(1);
    expect(expand("FREQ=DAILY", { limit: 3 })).toHaveLength(3);
  });

  it("rejects an UNTIL whose calendar fields silently roll over", () => {
    // Review finding: Date.UTC rolls over rather than failing, so month 13 /
    // day 45 was accepted and became 2027-02-14 — a series ending eight months
    // after the rule appears to say. Number.isNaN never fires on a rollover.
    expect(parseRecurrenceRule("FREQ=DAILY;UNTIL=20261345T000000Z").ok).toBe(false);
    expect(parseRecurrenceRule("FREQ=DAILY;UNTIL=20260231").ok).toBe(false); // 31 February
    expect(parseRecurrenceRule("FREQ=DAILY;UNTIL=20260431").ok).toBe(false); // 31 April
    expect(parseRecurrenceRule("FREQ=DAILY;UNTIL=20261231T256100Z").ok).toBe(false); // hour 25
    // Real dates still parse, including a leap day.
    expect(parseRecurrenceRule("FREQ=DAILY;UNTIL=20261231T230000Z").ok).toBe(true);
    expect(parseRecurrenceRule("FREQ=YEARLY;UNTIL=20280229").ok).toBe(true);
  });

  it("finds an occurrence that an exception moved BACK into the window", () => {
    // Review finding: expansion stopped as soon as the series instant passed
    // windowEnd, so an occurrence rescheduled from beyond the window into it
    // was never materialised — it simply vanished from a view the user had
    // just dragged it into.
    const occurrences = expandOccurrences({
      rule: "FREQ=DAILY;COUNT=30",
      startsAt: JUNE_1_0900,
      endsAt: JUNE_1_1000,
      zone: ZONE,
      windowStart: new Date("2026-06-01T00:00:00.000Z"),
      windowEnd: new Date("2026-06-05T00:00:00.000Z"),
      exceptions: [
        {
          // The 20 June instance, dragged back to 2 June.
          originalStartsAt: new Date("2026-06-20T07:00:00.000Z"),
          startsAt: new Date("2026-06-02T12:00:00.000Z"),
          endsAt: new Date("2026-06-02T13:00:00.000Z"),
          title: "Pulled forward",
        },
      ],
    });

    const moved = occurrences.find((o) => o.overridden);
    expect(moved).toBeDefined();
    expect(moved!.originalStartsAt.toISOString()).toBe("2026-06-20T07:00:00.000Z");
    expect(moved!.startsAt.toISOString()).toBe("2026-06-02T12:00:00.000Z");
    expect(moved!.title).toBe("Pulled forward");
    // The ordinary in-window occurrences are still there and still sorted.
    expect(occurrences.length).toBeGreaterThan(1);
    const times = occurrences.map((o) => o.startsAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});

describe("computeRecurrenceEndsAt — the pruning contract", () => {
  it("returns the last occurrence's END, not its START", () => {
    // schema.prisma defines this column as "the last occurrence's end, computed
    // at WRITE time", and the CAL1.5 candidate query prunes with
    // `recurrenceEndsAt >= :windowStart`. An overnight 23:00-01:00 weekly whose
    // final instance straddles the window opening would be pruned away — the
    // event would vanish from the view while it was actually in progress.
    const endsAt = computeRecurrenceEndsAt({
      rule: "FREQ=WEEKLY;COUNT=4",
      startsAt: new Date("2026-06-01T21:00:00.000Z"), // 23:00 local
      endsAt: new Date("2026-06-01T23:00:00.000Z"), // 01:00 local, +2h
      zone: ZONE,
    });

    // Last occurrence starts 2026-06-22T21:00Z and ends two hours later.
    expect(endsAt!.toISOString()).toBe("2026-06-22T23:00:00.000Z");
    expect(endsAt!.getTime()).toBeGreaterThan(new Date("2026-06-22T21:00:00.000Z").getTime());

    // The same contract on the all-day branch, which takes its end from the
    // local day rather than a stored duration: a series ending on 2026-03-29
    // ends when that 23-hour day does, not 24 hours after it began.
    const firstDay = allDayBoundsUtc({ year: 2026, month: 3, day: 27 }, ZONE);
    const allDayEnd = computeRecurrenceEndsAt({
      rule: "FREQ=DAILY;COUNT=3", // 27th, 28th, 29th
      startsAt: firstDay.startsAt,
      endsAt: firstDay.endsAt,
      allDay: true,
      zone: ZONE,
    });
    expect(allDayEnd!.toISOString()).toBe("2026-03-29T22:00:00.000Z");
  });
});
