import { createContext, useContext } from "react";

import type { CalendarRange, CalendarView } from "./calendarRange";
import type { CalendarOccurrence, CalendarSummary } from "../services/calendar.service";

// CAL1.6 — the calendar context's shape and its hook.
//
// Separate from CalendarContext.tsx because a file that exports a component
// may export nothing else (react-refresh/only-export-components). The provider
// lives there; the contract lives here, which also means a component can
// import the hook without pulling the provider's imports along with it.

export type CalendarContextValue = {
  calendars: CalendarSummary[];
  calendarById: Map<number, CalendarSummary>;
  calendarsLoading: boolean;

  // Which calendars the source filter has switched on. An empty list means
  // "none" — deliberately NOT the same as "all".
  selectedCalendarIds: number[];
  toggleCalendar: (id: number) => void;

  view: CalendarView;
  setView: (view: CalendarView) => void;
  date: Date;
  setDate: (date: Date) => void;
  goToday: () => void;
  goPrevious: () => void;
  goNext: () => void;
  range: CalendarRange;

  occurrences: CalendarOccurrence[];
  // The server bounds how much one window may expand; when it had to, the UI
  // has to say so. A silently truncated calendar is a calendar that lies.
  truncated: boolean;
  isLoading: boolean;
  error: string | null;

  // Called after every mutation: drops the window cache and refetches.
  refresh: () => void;
};

export const CalendarContext = createContext<CalendarContextValue | undefined>(undefined);

export function useCalendar(): CalendarContextValue {
  const context = useContext(CalendarContext);
  if (!context) {
    throw new Error("useCalendar must be used within a CalendarProvider");
  }
  return context;
}
