// CAL1.2 — timezone core. See docs/calendar-cal1-2-plan.md.
//
// PURE FUNCTIONS. No database access, no Prisma import, no API. Nothing calls
// this yet: CAL1.5 does, when the event endpoints land.
//
// WHY Intl AND NOT date-fns: date-fns v4 moved zone support into the separate
// @date-fns/tz package, which this repo does not install — measured, and
// `date-fns` exports no zone helpers at all. Intl with full ICU is present on
// the runtime (Node >= 22.12) and N1.8's billingFormat.ts already relies on it.
// So the calendar adds ZERO dependencies and uses the same engine.

// ---------------------------------------------------------------------------
// The fallback (Q8)
// ---------------------------------------------------------------------------

// The zone a calendar falls back to when neither the event, the calendar, nor
// the company names one.
//
// ⚠️ This DELIBERATELY DIFFERS from DEFAULT_BILLING_TIME_ZONE ("UTC",
// utils/billingFormat.ts). That is not an oversight, and the divergence is
// pinned by a test in calendarTimezone.test.ts so it can only ever be changed
// on purpose. The two subsystems ask different questions:
//
//   Billing renders an instant Stripe already fixed, and the only question is
//   which calendar DAY to name. UTC is a neutral, explainable answer, and its
//   own tests pin that a European default would name the wrong day for a
//   23:30Z period boundary.
//
//   The calendar stores a human INTENTION. "Every Monday at 09:00" is a
//   wall-clock rule, not an instant, so the zone is semantics rather than
//   presentation. Under a UTC fallback, an event pinned at 08:00Z reads 09:00
//   local on 23 March and 10:00 local on 30 March — an hour wrong from the
//   spring transition onward, permanently.
//
// No single value is right for both. Resolution recorded as Q8 in
// docs/calendar-cal1-2-plan.md §1.
export const DEFAULT_CALENDAR_TIME_ZONE = "Europe/Budapest";

// D-1 — what to do with a local time that does not exist (the spring gap).
// "shift_forward" moves it past the gap (02:30 → 03:30) so the occurrence still
// happens that day; "clamp" would pin it to the transition instant. Skipping
// was rejected outright: a silently missing occurrence reads as data loss.
export const GAP_POLICY: "shift_forward" | "clamp" = "shift_forward";

// D-2 — what to do with a local time that happens twice (the autumn overlap).
// "first" takes the pre-transition instant. Emitting both was rejected: it
// would double-send every reminder CAL2.3 builds on this.
export const OVERLAP_POLICY: "first" | "last" = "first";

// A calendar date and time as a HUMAN would write it — no zone, no instant.
// "2026-03-29 02:30" is a perfectly well-formed WallClock that happens not to
// exist in Budapest; that is the entire reason this type is separate from Date.
export type WallClock = {
  year: number;
  month: number; // 1-12, NOT the 0-11 that Date uses
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export type CivilDate = Pick<WallClock, "year" | "month" | "day">;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Validity
// ---------------------------------------------------------------------------

// The ONLY authority on whether a zone name is real.
//
// This matters more than it looks. Company.timezone is tenant-writable and its
// write-side validator (services/companyValidation.ts) is a SHAPE check —
// /^[A-Za-z_]+(\/[A-Za-z_]+)*$/ — so "Mars/Olympus_Mons" is accepted and
// stored. Intl throws on it. Unhandled inside a recurrence expansion, one bad
// settings value would take down the whole tenant's calendar, so every entry
// point into this module screens through here.
// Canonical name → validity. Memoised because requireZone() runs on EVERY
// conversion and the recurrence expander performs thousands per call; without
// this, each one constructed and discarded an Intl.DateTimeFormat, which is the
// expensive half of the operation. Keyed on the raw string, valued with the
// CANONICAL name Intl reports, so "europe/budapest" and "Europe/Budapest" —
// both accepted by Intl, and both writable into Company.timezone — converge on
// one cache entry instead of growing the formatter cache without bound.
const ZONE_CACHE = new Map<string, string | null>();

function canonicalZone(zone: unknown): string | null {
  if (typeof zone !== "string") return null;
  const candidate = zone.trim();
  if (!candidate) return null;

  const cached = ZONE_CACHE.get(candidate);
  if (cached !== undefined) return cached;

  let canonical: string | null = null;
  try {
    // Asking Intl to use it is the only reliable check — there is no exposed
    // list of valid zone names. resolvedOptions() then reports the canonical
    // spelling, which is what everything downstream keys on.
    canonical = new Intl.DateTimeFormat("en-GB", { timeZone: candidate }).resolvedOptions().timeZone;
  } catch {
    canonical = null;
  }

  ZONE_CACHE.set(candidate, canonical);
  return canonical;
}

export function isValidTimeZone(zone: unknown): zone is string {
  return canonicalZone(zone) !== null;
}

export type TimeZoneSources = {
  // CalendarEvent.timezone
  eventTimeZone?: string | null;
  // Calendar.timezone
  calendarTimeZone?: string | null;
  // Company.timezone — untrusted, see isValidTimeZone
  companyTimeZone?: string | null;
};

// The four-level resolution order, in one place, used by every caller:
//
//   event → calendar → company → DEFAULT_CALENDAR_TIME_ZONE
//
// An INVALID value falls through to the next level rather than short-circuiting
// to the default: a company with a broken timezone string but a calendar that
// set its own should still get the calendar's, not Budapest.
//
// Calendar.timezone is deliberately NOT materialised at creation time. Writing
// the resolved zone onto the row would freeze it, so a company later correcting
// its timezone would silently fail to reach calendars that never set one.
export function resolveCalendarTimeZone(sources: TimeZoneSources): string {
  const levels: Array<[string, string | null | undefined]> = [
    ["event", sources.eventTimeZone],
    ["calendar", sources.calendarTimeZone],
    ["company", sources.companyTimeZone],
  ];

  for (const [level, value] of levels) {
    const candidate = value?.trim();
    if (!candidate) continue;

    if (isValidTimeZone(candidate)) return candidate;

    console.warn(
      `[calendar/timezone] invalid ${level} timezone ${JSON.stringify(candidate)} — falling through`
    );
  }

  return DEFAULT_CALENDAR_TIME_ZONE;
}

// Screens a zone for the arithmetic below, which cannot proceed on a bad one.
// Returns the CANONICAL spelling so the formatter cache holds one entry per
// real zone rather than one per spelling a tenant happened to type.
function requireZone(zone: string): string {
  const canonical = canonicalZone(zone);
  if (canonical) return canonical;

  console.warn(
    `[calendar/timezone] invalid timezone ${JSON.stringify(zone)} — using ${DEFAULT_CALENDAR_TIME_ZONE}`
  );
  return DEFAULT_CALENDAR_TIME_ZONE;
}

// Every entry point that accepts a Date screens it here.
//
// Intl.DateTimeFormat#formatToParts throws a bare RangeError("Invalid time
// value") on an invalid Date, and that throw would surface from deep inside a
// pure function — a 500 from the CAL1.5 event endpoint, with a message naming
// nothing the operator could act on. An invalid instant genuinely cannot be
// converted, so this still throws, but with a message that says which module
// rejected what.
export function isValidInstant(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function requireInstant(value: Date, label: string): Date {
  if (isValidInstant(value)) return value;
  throw new RangeError(`[calendar/timezone] ${label} is not a valid instant`);
}

// ---------------------------------------------------------------------------
// Instant  ↔  wall clock
// ---------------------------------------------------------------------------

// Constructing an Intl.DateTimeFormat is expensive relative to using one, and
// the recurrence expander converts every candidate occurrence — thousands of
// them for a long-running daily series. Formatters are immutable and
// thread-free, so one per zone is safe to keep. The map is bounded in practice
// by the number of distinct zones a deployment's tenants use.
const FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

// hourCycle "h23" rather than hour12:false: with hour12:false some locales
// render midnight as hour "24", which would silently corrupt every date whose
// local time is 00:00 — including every all-day boundary this module computes.
function partsFormatter(zone: string): Intl.DateTimeFormat {
  const cached = FORMATTER_CACHE.get(zone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  FORMATTER_CACHE.set(zone, formatter);
  return formatter;
}

// What clock a person standing in `zone` reads at this instant.
export function utcToWallClock(instant: Date, zone: string): WallClock {
  const parts = partsFormatter(requireZone(zone))
    .formatToParts(requireInstant(instant, "instant"))
    .reduce<Record<string, string>>((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

// The zone's UTC offset in MINUTES at a given instant (+120 for Budapest in
// summer). Derived from Intl rather than a table: the tz database ships inside
// ICU, so this stays correct when the rules change.
export function zoneOffsetMinutes(zone: string, instant: Date): number {
  const wall = utcToWallClock(instant, zone);
  const asIfUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);

  // Truncate the instant to whole seconds — formatToParts has no sub-second
  // resolution, so a millisecond component would leak into the offset.
  const truncated = Math.floor(instant.getTime() / 1000) * 1000;
  return (asIfUtc - truncated) / MINUTE_MS;
}

function sameWallClock(a: WallClock, b: WallClock): boolean {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute &&
    a.second === b.second
  );
}

// How a local time that is not a single instant was resolved. Returned
// alongside the instant so callers (and tests) can assert the POLICY fired,
// not merely that some plausible instant came back.
export type WallClockResolution = "exact" | "gap" | "overlap";

export type ResolvedInstant = {
  instant: Date;
  resolution: WallClockResolution;
};

// Local wall clock → UTC instant. The hard direction, because the mapping is
// not one-to-one twice a year:
//
//   GAP     (spring)  2026-03-29 02:30 Budapest does not exist — the clocks
//                     jump 01:59 → 03:00. ZERO instants match.
//   OVERLAP (autumn)  2026-10-25 02:30 Budapest happens TWICE — once at +02:00
//                     and again at +01:00. TWO instants match.
//
// Rather than special-casing transition dates, this generates every candidate
// the surrounding offsets allow and keeps the ones that actually render back to
// the requested wall clock. The count of survivors IS the classification.
export function wallClockToUtcDetailed(wall: WallClock, zone: string): ResolvedInstant {
  const safeZone = requireZone(zone);
  const guess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);

  // Date.UTC returns NaN for non-finite fields, and every probe below would
  // then convert an Invalid Date. Rejected here so the message names the wall
  // clock rather than surfacing as an opaque failure two calls deeper.
  if (!Number.isFinite(guess)) {
    throw new RangeError(
      `[calendar/timezone] wall clock is out of range: ${JSON.stringify(wall)}`
    );
  }

  // Probe a full day either side: far enough to sit outside any transition,
  // close enough that no second transition intervenes.
  const offsetBefore = zoneOffsetMinutes(safeZone, new Date(guess - DAY_MS));
  const offsetAfter = zoneOffsetMinutes(safeZone, new Date(guess + DAY_MS));

  const candidates = [...new Set([guess - offsetBefore * MINUTE_MS, guess - offsetAfter * MINUTE_MS])];
  const valid = candidates
    .filter((candidate) => sameWallClock(utcToWallClock(new Date(candidate), safeZone), wall))
    .sort((a, b) => a - b);

  if (valid.length === 1) {
    return { instant: new Date(valid[0]!), resolution: "exact" };
  }

  if (valid.length >= 2) {
    // D-2 — OVERLAP_POLICY "first": the earlier instant, i.e. the one still on
    // the pre-transition offset. Deterministic, and it is the choice that stops
    // CAL2.3 from firing every reminder on this event twice.
    const chosen = OVERLAP_POLICY === "first" ? valid[0]! : valid[valid.length - 1]!;
    return { instant: new Date(chosen), resolution: "overlap" };
  }

  // D-1 — GAP_POLICY "shift_forward": nothing matched, so the requested time is
  // inside the skipped hour. Applying the PRE-transition offset lands exactly
  // one gap-width later in local terms (02:30 → 03:30), which keeps the
  // occurrence on the day the user asked for. Skipping it instead would look
  // like data loss.
  const shifted = guess - offsetBefore * MINUTE_MS;
  const clamped = guess - offsetAfter * MINUTE_MS;
  return {
    instant: new Date(GAP_POLICY === "shift_forward" ? shifted : clamped),
    resolution: "gap",
  };
}

// The common case, when the caller does not care how the mapping was resolved.
export function wallClockToUtc(wall: WallClock, zone: string): Date {
  return wallClockToUtcDetailed(wall, zone).instant;
}

// ---------------------------------------------------------------------------
// All-day boundaries
// ---------------------------------------------------------------------------

// Civil (zone-free) date arithmetic. Date.UTC is used purely as a calendar
// calculator here — UTC has no transitions, so adding days can never drift.
export function addCivilDays(date: CivilDate, days: number): CivilDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day) + days * DAY_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

// Whether a (year, month, day) triple is a real date. Date.UTC silently ROLLS
// OVER — Date.UTC(2026, 1, 29) is 1 March — so the only way to detect 31 April
// or a non-leap 29 February is to build it and check it came back unchanged.
// The recurrence expander depends on this to skip impossible occurrences.
export function isRealCivilDate({ year, month, day }: CivilDate): boolean {
  const built = new Date(Date.UTC(year, month - 1, day));
  return (
    built.getUTCFullYear() === year && built.getUTCMonth() === month - 1 && built.getUTCDate() === day
  );
}

export type DayBounds = { startsAt: Date; endsAt: Date };

// An all-day event's real UTC boundaries: local midnight to the NEXT local
// midnight.
//
// Not 00:00-23:59Z, and not "start + 24h". A Hungarian all-day event stored in
// UTC bleeds into the neighbouring day for anyone reading elsewhere, and — the
// case a fixed 24-hour span gets wrong — 2026-03-29 is a 23-HOUR day in
// Budapest while 2026-10-25 is a 25-hour one. Both are measured in
// docs/calendar-cal1-2-plan.md §0.
export function allDayBoundsUtc(date: CivilDate, zone: string): DayBounds {
  const safeZone = requireZone(zone);
  const midnight = (d: CivilDate): WallClock => ({ ...d, hour: 0, minute: 0, second: 0 });

  return {
    startsAt: wallClockToUtc(midnight(date), safeZone),
    endsAt: wallClockToUtc(midnight(addCivilDays(date, 1)), safeZone),
  };
}

// How many hours the local day actually lasted — 23, 24 or 25. Exposed because
// it is the clearest way for a caller (and for the tests) to state the DST
// property without re-deriving the arithmetic.
export function localDayLengthHours(date: CivilDate, zone: string): number {
  const { startsAt, endsAt } = allDayBoundsUtc(date, zone);
  return (endsAt.getTime() - startsAt.getTime()) / HOUR_MS;
}

// The civil date a given instant falls on, in the given zone.
export function civilDateInZone(instant: Date, zone: string): CivilDate {
  const { year, month, day } = utcToWallClock(instant, zone);
  return { year, month, day };
}
