// CAL1.6 — RRULE ↔ editor state, kept in a module of its own.
//
// Two reasons it is not inside RecurrenceEditor.tsx: the repo's lint rule
// (react-refresh/only-export-components) requires a component file to export
// components only, and this conversion is the part worth reading on its own —
// it is where the UI is constrained to the grammar the server accepts.
//
// THE CONSTRAINT: CAL1.2 implements a NARROWED RRULE grammar and REJECTS
// anything outside it rather than silently dropping the unsupported part. A
// dropped BYSETPOS would turn "last Friday of the month" into "every Friday" —
// a wrong schedule presented as a correct one. So this module must not be able
// to compose a rule the server will refuse.
//
// Supported: FREQ · INTERVAL · BYDAY (WEEKLY only) · COUNT · UNTIL.

export const FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

// RFC 5545 order, Monday first — matching the server's own list, so a rule
// round-trips through both sides unchanged.
export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type RecurrenceState = {
  enabled: boolean;
  freq: Frequency;
  interval: number;
  byDay: Weekday[];
  endMode: "never" | "count" | "until";
  count: number;
  // "YYYY-MM-DD", the shape a date input speaks.
  until: string;
};

export const EMPTY_RECURRENCE: RecurrenceState = {
  enabled: false,
  freq: "WEEKLY",
  interval: 1,
  byDay: [],
  endMode: "never",
  count: 10,
  until: "",
};

// The server's own ceilings (MAX_RECURRENCE_INTERVAL / MAX_RECURRENCE_COUNT).
// Enforced here too, so the user meets a bounded input rather than a 400.
export const MAX_INTERVAL = 1000;
export const MAX_COUNT = 10_000;

export function buildRecurrenceRule(state: RecurrenceState): string | null {
  if (!state.enabled) return null;

  const parts = [`FREQ=${state.freq}`];

  if (state.interval > 1) parts.push(`INTERVAL=${Math.min(state.interval, MAX_INTERVAL)}`);

  // BYDAY is WEEKLY-only in this grammar; emitting it under any other
  // frequency is a guaranteed 400, so it is gated here as well as in the UI.
  if (state.freq === "WEEKLY" && state.byDay.length > 0) {
    parts.push(`BYDAY=${WEEKDAYS.filter((day) => state.byDay.includes(day)).join(",")}`);
  }

  if (state.endMode === "count") {
    parts.push(`COUNT=${Math.min(Math.max(state.count, 1), MAX_COUNT)}`);
  }

  // The date-only UNTIL form the server accepts; it reads as end-of-day, which
  // is what "repeat until this date" means to a person.
  if (state.endMode === "until" && state.until) {
    parts.push(`UNTIL=${state.until.replace(/-/g, "")}`);
  }

  return parts.join(";");
}

export function parseRecurrenceRule(rule: string | null): RecurrenceState {
  if (!rule) return { ...EMPTY_RECURRENCE };

  const parts: Record<string, string> = {};
  for (const segment of rule.replace(/^RRULE:/i, "").split(";")) {
    const index = segment.indexOf("=");
    if (index === -1) continue;
    parts[segment.slice(0, index).trim().toUpperCase()] = segment.slice(index + 1).trim();
  }

  const freq = (FREQUENCIES as readonly string[]).includes(parts.FREQ ?? "")
    ? (parts.FREQ as Frequency)
    : "WEEKLY";

  const byDay = (parts.BYDAY ?? "")
    .split(",")
    .map((token) => token.trim().toUpperCase())
    .filter((token): token is Weekday => (WEEKDAYS as readonly string[]).includes(token));

  const interval = Number(parts.INTERVAL);
  const count = Number(parts.COUNT);

  // UNTIL comes back as "YYYYMMDD" or "YYYYMMDDTHHMMSSZ"; the date input wants
  // the first eight digits with dashes either way.
  const until = parts.UNTIL
    ? `${parts.UNTIL.slice(0, 4)}-${parts.UNTIL.slice(4, 6)}-${parts.UNTIL.slice(6, 8)}`
    : "";

  return {
    enabled: true,
    freq,
    interval: Number.isFinite(interval) && interval >= 1 ? Math.min(interval, MAX_INTERVAL) : 1,
    byDay,
    endMode: parts.COUNT ? "count" : parts.UNTIL ? "until" : "never",
    count: Number.isFinite(count) && count >= 1 ? Math.min(count, MAX_COUNT) : 10,
    until,
  };
}
