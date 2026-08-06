import type { CalendarSummary } from "../../services/calendar.service";

// CAL1.6 — one colour per calendar, shared by the source filter's legend dots
// and the event chips on the grid. In its own module because a component file
// may only export components (react-refresh/only-export-components).
//
// DETERMINISTIC from the id rather than random or assignment-ordered: a
// calendar has to keep its colour across reloads, or the legend a user just
// learned stops meaning anything on the next visit.
const FALLBACK_COLORS = ["#f97316", "#0ea5e9", "#a855f7", "#22c55e", "#eab308", "#ec4899"];

export function colorFor(calendar: CalendarSummary | undefined): string {
  if (!calendar) return FALLBACK_COLORS[0]!;
  return calendar.color ?? FALLBACK_COLORS[calendar.id % FALLBACK_COLORS.length]!;
}

// Free/busy blocks are drawn in ONE neutral colour, never their calendar's.
// R4 gives the company occupancy without content, and a chip tinted per source
// calendar would hand back a little of what the redaction just removed — which
// calendar someone's private appointment sits on.
export const BUSY_COLOR = "#64748b";
