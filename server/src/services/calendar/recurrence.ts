// CAL1.2 — recurrence core. See docs/calendar-cal1-2-plan.md.
//
// PURE FUNCTIONS. No database access, no Prisma import, no API. CAL1.5 calls
// this; nothing does today.
//
// WHY A NARROWED EXPANDER RATHER THAN THE `rrule` PACKAGE (Q2): R7 keeps every
// form of external calendar sync out of CAL1-CAL3, and full RFC 5545 exists
// mainly to interoperate with other implementations. `rrule` would be a new
// runtime dependency that still needs its own timezone story (luxon, in
// practice), while the grammar below covers the scheduling this product
// actually does. The cost is that WE own the DST edges — which is exactly why
// this module is pure, and why the DST cases are pinned by name in the tests.
//
// THE ONE RULE THAT MATTERS: expansion happens in LOCAL WALL-CLOCK TIME and
// converts to UTC last. Done the other way round, "every Monday 09:00" drifts
// an hour at each transition, forever after.

import {
  type CivilDate,
  type WallClock,
  addCivilDays,
  allDayBoundsUtc,
  civilDateInZone,
  isRealCivilDate,
  isValidInstant,
  utcToWallClock,
  wallClockToUtc,
} from "./timezone";

// --- Grammar ---------------------------------------------------------------

export const RECURRENCE_FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

// RFC 5545 order, Monday first — matches WKST=MO, which is the default and the
// only week start this grammar supports.
export const RECURRENCE_WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type RecurrenceWeekday = (typeof RECURRENCE_WEEKDAYS)[number];

// Guards rather than bare `includes` checks: `includes` returns boolean and
// does not narrow, so without these the parser would need an unchecked cast at
// exactly the point where it is validating untrusted stored input.
export function isRecurrenceFrequency(value: string): value is RecurrenceFrequency {
  return (RECURRENCE_FREQUENCIES as readonly string[]).includes(value);
}

export function isRecurrenceWeekday(value: string): value is RecurrenceWeekday {
  return (RECURRENCE_WEEKDAYS as readonly string[]).includes(value);
}

// The keys this expander understands. Anything else is REJECTED rather than
// ignored: silently dropping BYSETPOS from "last Friday of the month" would
// turn it into "every Friday", which is a wrong schedule presented as a
// correct one — far worse than a rejected rule.
const SUPPORTED_KEYS = new Set(["FREQ", "INTERVAL", "BYDAY", "COUNT", "UNTIL"]);

export type ParsedRecurrenceRule = {
  freq: RecurrenceFrequency;
  interval: number;
  byDay: RecurrenceWeekday[];
  count: number | null;
  until: Date | null;
};

export type ParseResult =
  | { ok: true; rule: ParsedRecurrenceRule }
  | { ok: false; error: string };

// "YYYYMMDD" or "YYYYMMDDTHHMMSSZ" — the two UNTIL forms RFC 5545 allows that
// this grammar accepts. A floating (non-Z) date-time is rejected: it would need
// a zone to be meaningful, and accepting it would invent one.
const UNTIL_RE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?$/;

function parseUntil(raw: string): Date | null {
  const match = UNTIL_RE.exec(raw.trim());
  if (!match) return null;

  const [, y, mo, d, h, mi, s] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h ?? 23);
  const minute = Number(mi ?? 59);
  const second = Number(s ?? 59);

  // Date.UTC ROLLS OVER rather than failing: month 13 becomes January of the
  // next year, day 45 becomes the middle of the following month. Checking
  // Number.isNaN afterwards therefore never fires, and "UNTIL=20261345" would
  // be silently accepted as 2027-02-14 — a series ending months after the one
  // the rule appears to name. Every field is range-checked before construction.
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (Number.isNaN(date.getTime())) return null;
  // Catches 31 April and 29 February in a common year, which pass the ranges
  // above but still roll over.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;

  return date;
}

// An INTERVAL ceiling, because there is no such thing as a legitimate
// "every 999999999999 days". Without it the civil-date arithmetic overflows
// into an Invalid Date and the conversion throws a RangeError out of what is
// supposed to be a pure function — a 500 from the CAL1.5 endpoint, triggered by
// a stored string. 1000 is far past any real schedule (every ~3 years daily,
// every ~19 years weekly).
export const MAX_RECURRENCE_INTERVAL = 1000;

// A COUNT ceiling. computeRecurrenceEndsAt walks the WHOLE series to find its
// last end and has no window to bound it, so an unbounded COUNT is a stall.
// 10000 daily occurrences is ~27 years.
export const MAX_RECURRENCE_COUNT = 10_000;

function parsePositiveInt(raw: string, max: number): number | null {
  const text = raw.trim();
  // Bound the digit count before Number(): a multi-megabyte digit string is a
  // denial-of-service shape, not a schedule.
  if (!/^\d{1,9}$/.test(text)) return null;
  const value = Number(text);
  return value >= 1 && value <= max ? value : null;
}

// Narrowed RRULE string → structure, or a stated reason. Never throws, and
// never returns a "best effort" partial rule.
export function parseRecurrenceRule(raw: string | null | undefined): ParseResult {
  const text = raw?.trim();
  if (!text) return { ok: false, error: "empty recurrence rule" };

  // Tolerate the "RRULE:" property prefix; the column stores the value alone,
  // but a rule pasted from an .ics file carries it.
  const body = text.replace(/^RRULE:/i, "");

  const parts: Record<string, string> = {};
  for (const segment of body.split(";")) {
    if (!segment.trim()) continue;

    const index = segment.indexOf("=");
    if (index === -1) return { ok: false, error: `malformed segment ${JSON.stringify(segment)}` };

    const key = segment.slice(0, index).trim().toUpperCase();
    const value = segment.slice(index + 1).trim();

    if (!SUPPORTED_KEYS.has(key)) {
      return { ok: false, error: `unsupported recurrence part ${JSON.stringify(key)}` };
    }
    if (key in parts) return { ok: false, error: `duplicate recurrence part ${JSON.stringify(key)}` };

    parts[key] = value;
  }

  const freq = parts.FREQ?.toUpperCase();
  if (!freq) return { ok: false, error: "FREQ is required" };
  if (!isRecurrenceFrequency(freq)) {
    return { ok: false, error: `unsupported FREQ ${JSON.stringify(freq)}` };
  }

  let interval = 1;
  if (parts.INTERVAL !== undefined) {
    const parsed = parsePositiveInt(parts.INTERVAL, MAX_RECURRENCE_INTERVAL);
    if (parsed === null) return { ok: false, error: `invalid INTERVAL ${JSON.stringify(parts.INTERVAL)}` };
    interval = parsed;
  }

  let byDay: RecurrenceWeekday[] = [];
  if (parts.BYDAY !== undefined) {
    const tokens = parts.BYDAY.split(",").map((token) => token.trim().toUpperCase());
    for (const token of tokens) {
      // Numeric prefixes ("-1FR" = last Friday) are BYSETPOS-like positioning
      // and are outside this grammar. Rejected, not silently truncated.
      if (!isRecurrenceWeekday(token)) {
        return { ok: false, error: `unsupported BYDAY value ${JSON.stringify(token)}` };
      }
      if (!byDay.includes(token)) byDay.push(token);
    }
    if (byDay.length === 0) return { ok: false, error: "BYDAY was empty" };
    if (freq !== "WEEKLY") {
      return { ok: false, error: `BYDAY is only supported with FREQ=WEEKLY in this grammar` };
    }
    // Keep calendar order so emitted occurrences are chronological within a week.
    byDay = RECURRENCE_WEEKDAYS.filter((day) => byDay.includes(day));
  }

  let count: number | null = null;
  if (parts.COUNT !== undefined) {
    // Bounded by the same reasoning as INTERVAL: COUNT drives the loop in
    // computeRecurrenceEndsAt, which has no window to stop it.
    count = parsePositiveInt(parts.COUNT, MAX_RECURRENCE_COUNT);
    if (count === null) return { ok: false, error: `invalid COUNT ${JSON.stringify(parts.COUNT)}` };
  }

  let until: Date | null = null;
  if (parts.UNTIL !== undefined) {
    until = parseUntil(parts.UNTIL);
    if (until === null) return { ok: false, error: `invalid UNTIL ${JSON.stringify(parts.UNTIL)}` };
  }

  return { ok: true, rule: { freq, interval, byDay, count, until } };
}

// --- Expansion -------------------------------------------------------------

// One stored deviation from the series (CalendarEventOccurrence). Keyed by the
// occurrence's ORIGINAL computed start, which is why expansion must surface
// that instant even when the occurrence has been moved.
export type OccurrenceException = {
  originalStartsAt: Date;
  cancelled?: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
  title?: string | null;
  location?: string | null;
};

export type Occurrence = {
  // The series-computed instant. The join key for exceptions, and what a
  // "?scope=this" edit addresses.
  originalStartsAt: Date;
  startsAt: Date;
  endsAt: Date;
  // True when a CalendarEventOccurrence row changed this instance.
  overridden: boolean;
  title?: string | null;
  location?: string | null;
};

export type ExpandInput = {
  // Null / empty means a one-off event, which is a series of exactly one.
  rule: string | ParsedRecurrenceRule | null | undefined;
  startsAt: Date;
  endsAt: Date;
  allDay?: boolean;
  zone: string;
  windowStart: Date;
  windowEnd: Date;
  exceptions?: OccurrenceException[];
  limit?: number;
};

// Hard ceiling on EMITTED occurrences. A 366-day window (Q7) cannot legitimately
// contain more than a few hundred, so anything approaching this is a bomb — a
// pathological rule, or a window the caller failed to bound.
export const DEFAULT_OCCURRENCE_LIMIT = 1000;

// Hard ceiling on candidate steps, independent of how many are emitted. A daily
// series that started years before the window burns iterations without emitting
// anything, and an unbounded loop here would hang a request rather than fail it.
const MAX_ITERATIONS = 20_000;

// MO=0 … SU=6, matching RECURRENCE_WEEKDAYS. Date#getUTCDay is Sunday-based, so
// the rotation is not cosmetic.
function weekdayIndex(date: CivilDate): number {
  const day = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return (day + 6) % 7;
}

function civilDaysBetween(from: CivilDate, to: CivilDate): number {
  const a = Date.UTC(from.year, from.month - 1, from.day);
  const b = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((b - a) / 86_400_000);
}

function addCivilMonths(date: CivilDate, months: number): CivilDate {
  const totalMonths = date.year * 12 + (date.month - 1) + months;
  return {
    year: Math.floor(totalMonths / 12),
    month: (totalMonths % 12) + 1,
    day: date.day,
  };
}

// Every candidate LOCAL date the rule produces, in order, starting at the
// series start. Yields civil dates only — no zone arithmetic, so this stays
// cheap enough to step over years of history before reaching the window.
//
// Impossible dates are SKIPPED, not clamped: RFC 5545 says a 31st-of-the-month
// rule simply has no occurrence in a 30-day month, and a 29 February rule none
// in a common year. Clamping to the 30th or the 28th would invent occurrences
// the user never asked for.
function* candidateDates(rule: ParsedRecurrenceRule, start: CivilDate): Generator<CivilDate> {
  if (rule.freq === "WEEKLY") {
    const startWeekday = weekdayIndex(start);
    const days = rule.byDay.length > 0 ? rule.byDay.map((d) => RECURRENCE_WEEKDAYS.indexOf(d)) : [startWeekday];
    // The Monday of the series start's week — the anchor every INTERVAL counts from.
    const weekAnchor = addCivilDays(start, -startWeekday);

    for (let block = 0; ; block += 1) {
      const weekStart = addCivilDays(weekAnchor, block * rule.interval * 7);
      for (const day of days) {
        const candidate = addCivilDays(weekStart, day);
        // The first week may contain listed weekdays that fall BEFORE the
        // series start; those are not occurrences.
        if (civilDaysBetween(start, candidate) < 0) continue;
        yield candidate;
      }
    }
  }

  if (rule.freq === "DAILY") {
    for (let step = 0; ; step += 1) {
      yield addCivilDays(start, step * rule.interval);
    }
  }

  if (rule.freq === "MONTHLY") {
    for (let step = 0; ; step += 1) {
      const candidate = addCivilMonths(start, step * rule.interval);
      if (isRealCivilDate(candidate)) yield candidate;
      else yield { ...candidate, day: 0 }; // sentinel: consumed and skipped below
    }
  }

  if (rule.freq === "YEARLY") {
    for (let step = 0; ; step += 1) {
      const candidate = { ...start, year: start.year + step * rule.interval };
      if (isRealCivilDate(candidate)) yield candidate;
      else yield { ...candidate, day: 0 }; // sentinel
    }
  }
}

type Materialised = { originalStartsAt: Date; startsAt: Date; endsAt: Date };

// A candidate local date becomes a real pair of instants here — and this is
// where D-5 lives.
function materialise(
  date: CivilDate,
  timeOfDay: Pick<WallClock, "hour" | "minute" | "second">,
  zone: string,
  allDay: boolean,
  durationMs: number
): Materialised {
  if (allDay) {
    // D-5, all-day branch: bounds come from the LOCAL DATE, never from a stored
    // duration. 2026-03-29 is a 23-hour day in Budapest and 2026-10-25 a
    // 25-hour one, so a fixed 24-hour span would drift off the day boundary
    // twice a year.
    const bounds = allDayBoundsUtc(date, zone);
    return { originalStartsAt: bounds.startsAt, startsAt: bounds.startsAt, endsAt: bounds.endsAt };
  }

  // D-5, timed branch: EXACT ELAPSED duration. CalendarEvent.endsAt is a stored
  // instant rather than a length, which is the case RFC 5545 treats as a fixed
  // duration — a booked two-hour job must not become a one-hour job because the
  // clocks moved.
  const startsAt = wallClockToUtc({ ...date, ...timeOfDay }, zone);
  return { originalStartsAt: startsAt, startsAt, endsAt: new Date(startsAt.getTime() + durationMs) };
}

function exceptionKey(instant: Date): number {
  return instant.getTime();
}

// Expands a series over a window.
//
// Occurrences are selected by OVERLAP, not by start alone:
//     occ.endsAt > windowStart && occ.startsAt < windowEnd
// An overnight 22:00-01:00 event is in progress at the window's opening instant
// and must appear; filtering on startsAt would drop it.
export function expandOccurrences(input: ExpandInput): Occurrence[] {
  const {
    startsAt,
    endsAt,
    zone,
    windowStart,
    windowEnd,
    exceptions = [],
    limit = DEFAULT_OCCURRENCE_LIMIT,
    allDay = false,
  } = input;

  // Stored data reaches here through CAL1.5's request path, so bad input must
  // degrade rather than throw out of a pure function.
  if (!isValidInstant(startsAt) || !isValidInstant(endsAt)) {
    console.error("[calendar/recurrence] expandOccurrences called with an invalid instant");
    return [];
  }
  if (!isValidInstant(windowStart) || !isValidInstant(windowEnd)) {
    console.error("[calendar/recurrence] expandOccurrences called with an invalid window");
    return [];
  }

  const durationMs = Math.max(0, endsAt.getTime() - startsAt.getTime());
  const overrides = new Map<number, OccurrenceException>();
  // The furthest-out series instant that an exception refers to. Expansion must
  // not stop before reaching it: an exception may have MOVED an occurrence from
  // beyond the window back INTO it, and stopping at windowEnd would drop an
  // occurrence the user can plainly see was rescheduled into view.
  let lastExceptionInstant = Number.NEGATIVE_INFINITY;
  for (const exception of exceptions) {
    if (!isValidInstant(exception.originalStartsAt)) continue;
    overrides.set(exceptionKey(exception.originalStartsAt), exception);
    lastExceptionInstant = Math.max(lastExceptionInstant, exception.originalStartsAt.getTime());
  }

  const emit = (materialised: Materialised): Occurrence | null => {
    const override = overrides.get(exceptionKey(materialised.originalStartsAt));
    if (override?.cancelled) return null;

    const occurrence: Occurrence = {
      originalStartsAt: materialised.originalStartsAt,
      startsAt: override?.startsAt ?? materialised.startsAt,
      endsAt: override?.endsAt ?? materialised.endsAt,
      overridden: Boolean(override),
      title: override?.title ?? null,
      location: override?.location ?? null,
    };

    const overlaps =
      occurrence.endsAt.getTime() > windowStart.getTime() &&
      occurrence.startsAt.getTime() < windowEnd.getTime();
    return overlaps ? occurrence : null;
  };

  // A one-off event is a series of exactly one — same overlap rule, no parsing.
  const parsed = resolveRule(input.rule);
  if (!parsed) {
    const single = emit({ originalStartsAt: startsAt, startsAt, endsAt });
    return single ? [single] : [];
  }

  const baseWall = utcToWallClock(startsAt, zone);
  const startDate: CivilDate = { year: baseWall.year, month: baseWall.month, day: baseWall.day };
  const timeOfDay = { hour: baseWall.hour, minute: baseWall.minute, second: baseWall.second };

  const results: Occurrence[] = [];
  let produced = 0; // counts SERIES occurrences, for COUNT — not emitted ones
  let iterations = 0;

  for (const date of candidateDates(parsed, startDate)) {
    iterations += 1;
    if (iterations > MAX_ITERATIONS) break;

    // This step of the rule has no real date — the 31st in a short month, or
    // 29 February in a common year (candidateDates marks those with day 0), or
    // arithmetic that ran off the end of the representable range. It consumes a
    // step but is not an occurrence, and does NOT count towards COUNT.
    if (!isRealCivilDate(date)) continue;

    const materialised = materialise(date, timeOfDay, zone, allDay, durationMs);

    // UNTIL bounds the SERIES, and it is an absolute instant — compared against
    // the occurrence start, per RFC 5545.
    if (parsed.until && materialised.startsAt.getTime() > parsed.until.getTime()) break;

    produced += 1;
    if (parsed.count !== null && produced > parsed.count) break;

    const occurrence = emit(materialised);
    if (occurrence) {
      // Checked BEFORE the push: testing afterwards let limit:0 return one
      // occurrence, i.e. the ceiling was always off by one.
      if (results.length >= limit) break;
      results.push(occurrence);
    }

    // Past the window with no further chance of overlapping it. Checked on the
    // series instant rather than the (possibly moved) occurrence, so a single
    // rescheduled instance cannot end the expansion early — and held open until
    // past the furthest exception, so an occurrence dragged BACK into the
    // window from beyond it is still found.
    if (
      materialised.startsAt.getTime() >= windowEnd.getTime() &&
      materialised.startsAt.getTime() >= lastExceptionInstant
    ) {
      break;
    }
  }

  return results.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

function resolveRule(rule: ExpandInput["rule"]): ParsedRecurrenceRule | null {
  if (!rule) return null;
  if (typeof rule !== "string") return rule;

  const parsed = parseRecurrenceRule(rule);
  if (!parsed.ok) {
    // A rule we cannot read must NOT silently degrade into a one-off event —
    // that would hide a broken schedule behind a plausible-looking single
    // entry. CAL1.5 validates at write time; reaching here means stored data
    // is bad, and the loud log is the only signal available at read time.
    console.error(`[calendar/recurrence] unusable rule: ${parsed.error}`);
    return null;
  }
  return parsed.rule;
}

// --- Pruning ---------------------------------------------------------------

export type RecurrenceEndsAtInput = {
  rule: string | ParsedRecurrenceRule | null | undefined;
  startsAt: Date;
  endsAt: Date;
  allDay?: boolean;
  zone: string;
};

// The value written to CalendarEvent.recurrenceEndsAt at save time.
//
// Returns the LAST OCCURRENCE'S END — not its start. schema.prisma defines the
// column that way ("the last occurrence's end, computed at WRITE time"), and
// the candidate query prunes with `recurrenceEndsAt >= :windowStart`. Storing
// the start instead would prune out any series whose final occurrence straddles
// the window opening — an overnight weekly, or any all-day series — making an
// in-progress event vanish from the view.
//
// NULL means the rule is infinite, which the query treats as "always a
// candidate".
export function computeRecurrenceEndsAt(input: RecurrenceEndsAtInput): Date | null {
  const { startsAt, endsAt, zone, allDay = false } = input;

  if (!isValidInstant(startsAt) || !isValidInstant(endsAt)) {
    console.error("[calendar/recurrence] computeRecurrenceEndsAt called with an invalid instant");
    // Prefer a real end over null: null means INFINITE to the candidate query,
    // and reporting bad input as an endless series is the same inversion this
    // function goes out of its way to avoid below.
    return isValidInstant(endsAt) ? endsAt : null;
  }

  const parsed = resolveRule(input.rule);
  // A one-off (or unreadable) rule ends when the event itself ends.
  if (!parsed) return endsAt;

  // No COUNT and no UNTIL — the series never ends. This is the ONLY case that
  // may return null, because null is what the CAL1.5 candidate query reads as
  // "always reachable".
  if (parsed.count === null && parsed.until === null) return null;

  const durationMs = Math.max(0, endsAt.getTime() - startsAt.getTime());
  const baseWall = utcToWallClock(startsAt, zone);
  const startDate: CivilDate = { year: baseWall.year, month: baseWall.month, day: baseWall.day };
  const timeOfDay = { hour: baseWall.hour, minute: baseWall.minute, second: baseWall.second };

  let last: Date | null = null;
  let produced = 0;
  let iterations = 0;

  for (const date of candidateDates(parsed, startDate)) {
    iterations += 1;
    if (iterations > MAX_ITERATIONS) break;
    if (!isRealCivilDate(date)) continue;

    const materialised = materialise(date, timeOfDay, zone, allDay, durationMs);

    if (parsed.until && materialised.startsAt.getTime() > parsed.until.getTime()) break;

    produced += 1;
    if (parsed.count !== null && produced > parsed.count) break;

    last = materialised.endsAt;
  }

  // A FINITE rule that yielded nothing — an UNTIL earlier than the first
  // occurrence, say. Returning null here would report it as INFINITE, the exact
  // opposite of the truth, and the candidate query would then treat the series
  // as permanently reachable. The event's own end is the honest floor.
  return last ?? endsAt;
}

// The civil date an instant falls on in a zone — re-exported so CAL1.5 can key
// all-day series without importing two modules.
export { civilDateInZone };
