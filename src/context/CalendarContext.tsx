import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { useAuth } from "./AuthContext";
import { useReadOnly } from "./ReadOnlyContext";
import { ROLES } from "../types/auth";
import { rangeFor, stepDate, type CalendarRange, type CalendarView } from "./calendarRange";
import { CalendarContext, type CalendarContextValue } from "./useCalendar";
import {
  type CalendarSummary,
  type EventWindow,
  ensurePersonalCalendar,
  getCalendars,
  getEvents,
} from "../services/calendar.service";

// CAL1.6 — the calendar's own state, on the AuthContext/ReadOnlyContext
// pattern. NO new state library: the repo has neither react-query nor zustand,
// and introducing one for a single page would be a decision far larger than
// this milestone.
//
// Provided around the calendar page only, not app-wide — every other page
// would otherwise pay for a calendar fetch it never reads.
//
// WHY LOADING IS DERIVED RATHER THAN STORED: eslint's
// react-hooks/set-state-in-effect forbids a synchronous setState in an effect
// body, and `setIsLoading(true)` at the top of a fetch effect is exactly that.
// Keying the last successful load by its window instead turns "is this window
// loaded?" into a comparison, so nothing has to be set up front.

function windowKey(range: CalendarRange, calendarIds: number[]): string {
  const ids = [...calendarIds].sort((a, b) => a - b).join(",");
  return `${range.from.toISOString()}|${range.to.toISOString()}|${ids}`;
}

export function CalendarProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { readOnly } = useReadOnly();

  const [calendars, setCalendars] = useState<CalendarSummary[]>([]);
  const [calendarsLoaded, setCalendarsLoaded] = useState(false);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<number[]>([]);

  const [view, setView] = useState<CalendarView>("month");
  const [date, setDate] = useState<Date>(() => new Date());

  const [loaded, setLoaded] = useState<{ key: string; window: EventWindow } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [revision, setRevision] = useState(0);

  // Window cache (plan §10.3). Wholesale-invalidated by refresh() rather than
  // surgically patched: a mutation can reshape a series, split it in two, or
  // move an occurrence into a window it was not in, and a cache that tried to
  // reason about which windows those touched would be wrong before it was fast.
  const cacheRef = useRef(new Map<string, EventWindow>());

  // At most ONE lazy-creation attempt per provider instance.
  //
  // Found in browser verification: without it this page created TWO personal
  // calendars, a millisecond apart. The effect below runs more than once by
  // design — StrictMode double-invokes it in development, and `mayBootstrap`
  // legitimately flips false→true as AuthContext resolves — and CAL1.4's
  // find-then-create documents that genuinely concurrent creates can both miss
  // the find, because the "one default calendar per user" rule needs a partial
  // unique index that Prisma cannot declare (CAL1.1's known limit). The server
  // race is CAL1.4's to close; provoking it is this component's to avoid.
  const bootstrapAttempted = useRef(false);

  const range = useMemo(() => rangeFor(view, date), [view, date]);
  const key = useMemo(() => windowKey(range, selectedCalendarIds), [range, selectedCalendarIds]);

  const refresh = useCallback(() => {
    cacheRef.current.clear();
    setRevision((current) => current + 1);
  }, []);

  // --- Calendars ----------------------------------------------------------

  // A tenant user with no calendar yet gets one here (Q5, lazy creation).
  // Guarded twice: a read-only company cannot write at all, and a DEVELOPER
  // belongs to no tenant, so POST /calendars would answer 403 by design.
  const mayBootstrap =
    user != null && user.role !== ROLES.DEVELOPER && user.companyId != null && !readOnly;

  useEffect(() => {
    let cancelled = false;

    getCalendars()
      .then((loadedCalendars) => {
        if (loadedCalendars.length > 0 || !mayBootstrap) return loadedCalendars;
        // Check-and-set in one synchronous block, so a second callback already
        // queued behind this one sees the flag rather than racing it.
        if (bootstrapAttempted.current) return loadedCalendars;
        bootstrapAttempted.current = true;

        // A failure here must not take the page down — an empty calendar is a
        // usable one.
        return ensurePersonalCalendar()
          .then((created) => [created])
          .catch(() => loadedCalendars);
      })
      .then((loadedCalendars) => {
        if (cancelled) return;
        setCalendars(loadedCalendars);
        setSelectedCalendarIds(loadedCalendars.map((calendar) => calendar.id));
        setCalendarsLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setCalendars([]);
        setCalendarsLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [mayBootstrap, revision]);

  // --- Events -------------------------------------------------------------

  useEffect(() => {
    if (!calendarsLoaded) return;

    let cancelled = false;

    // "Nothing selected" cannot mean "everything": an empty calendarIds filter
    // is omitted from the query, and the server would answer with every
    // visible calendar — the opposite of what the user just switched off.
    const emptySelection = selectedCalendarIds.length === 0;
    const pending: Promise<EventWindow> = emptySelection
      ? Promise.resolve({
          from: range.from.toISOString(),
          to: range.to.toISOString(),
          truncated: false,
          occurrences: [],
        })
      : // Resolving a cache hit through a promise keeps every setState below
        // inside a callback rather than in the effect body.
        Promise.resolve(cacheRef.current.get(key)).then(
          (cached) =>
            cached ??
            getEvents({ from: range.from, to: range.to, calendarIds: selectedCalendarIds })
        );

    pending
      .then((eventWindow) => {
        if (cancelled) return;
        cacheRef.current.set(key, eventWindow);
        setLoaded({ key, window: eventWindow });
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setFailure({
          key,
          message: caught instanceof Error ? caught.message : "Failed to load calendar events",
        });
      });

    return () => {
      cancelled = true;
    };
    // `range` and `selectedCalendarIds` are both already encoded in `key`, and
    // rangeFor builds fresh Date objects on every render — listing them would
    // refetch forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, calendarsLoaded, revision]);

  const toggleCalendar = useCallback((id: number) => {
    setSelectedCalendarIds((current) =>
      current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]
    );
  }, []);

  const goToday = useCallback(() => setDate(new Date()), []);
  const goPrevious = useCallback(() => setDate((current) => stepDate(view, current, -1)), [view]);
  const goNext = useCallback(() => setDate((current) => stepDate(view, current, 1)), [view]);

  const calendarById = useMemo(
    () => new Map(calendars.map((calendar) => [calendar.id, calendar])),
    [calendars]
  );

  const value = useMemo<CalendarContextValue>(
    () => ({
      calendars,
      calendarById,
      calendarsLoading: !calendarsLoaded,
      selectedCalendarIds,
      toggleCalendar,
      view,
      setView,
      date,
      setDate,
      goToday,
      goPrevious,
      goNext,
      range,
      // The PREVIOUS window stays on screen while the next one loads. Blanking
      // the grid on every arrow press reads as data loss rather than progress.
      occurrences: loaded?.window.occurrences ?? [],
      truncated: loaded?.window.truncated ?? false,
      isLoading: calendarsLoaded && loaded?.key !== key && failure?.key !== key,
      error: failure?.key === key ? failure.message : null,
      refresh,
    }),
    [
      calendars,
      calendarById,
      calendarsLoaded,
      selectedCalendarIds,
      toggleCalendar,
      view,
      date,
      goToday,
      goPrevious,
      goNext,
      range,
      loaded,
      failure,
      key,
      refresh,
    ]
  );

  return <CalendarContext.Provider value={value}>{children}</CalendarContext.Provider>;
}
