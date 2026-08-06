import {
  addDays,
  addMonths,
  addWeeks,
  endOfDay,
  endOfMonth,
  endOfWeek,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";

// CAL1.6 — which instants a view actually covers.
//
// Decision (c): the week starts on MONDAY, fixed. Company.firstDayOfWeek stays
// dead until CAL3.4 ("defaultWorkStart/End, firstDayOfWeek élővé tétele") —
// reading it here would pull a company setting the roadmap has not scheduled
// into a page with no way to refresh it.
const WEEK_OPTIONS = { weekStartsOn: 1 } as const;

export type CalendarView = "month" | "week" | "day";
export type CalendarRange = { from: Date; to: Date };

// The window actually fetched. For the month view that is the whole GRID
// react-big-calendar draws — including the leading and trailing days of the
// neighbouring months — or those cells render empty while plainly showing
// dates that do have events.
export function rangeFor(view: CalendarView, date: Date): CalendarRange {
  if (view === "day") return { from: startOfDay(date), to: endOfDay(date) };
  if (view === "week") {
    return { from: startOfWeek(date, WEEK_OPTIONS), to: endOfWeek(date, WEEK_OPTIONS) };
  }
  return {
    from: startOfWeek(startOfMonth(date), WEEK_OPTIONS),
    to: endOfWeek(endOfMonth(date), WEEK_OPTIONS),
  };
}

// One step of the arrow buttons, in the unit the current view is measured in.
export function stepDate(view: CalendarView, date: Date, direction: 1 | -1): Date {
  if (view === "day") return addDays(date, direction);
  if (view === "week") return addWeeks(date, direction);
  return addMonths(date, direction);
}

// The server refuses a window wider than 366 days (Q7). Nothing this page can
// produce comes close — a month grid is at most 42 days — but the constant is
// named here so a future view cannot quietly cross it.
export const MAX_WINDOW_DAYS = 366;
