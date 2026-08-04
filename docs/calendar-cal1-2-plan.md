# Axeriva — CAL1.2 implementation plan (timezone + recurrence core)

*Written 2026-08-02, after CAL1.1 shipped (`25d9a2b` docs, `d71d281`
implementation). Status: **PLAN ONLY — no code written.** Resolves **Q8**;
carries **Q2** and three newly-found decisions to approval.*

> Written in English to match the code comments in this module. Its two sibling
> documents ([calendar-system-plan.md](calendar-system-plan.md),
> [calendar-cal1-scope.md](calendar-cal1-scope.md)) are in Hungarian — say the
> word and this one gets converted to match.

---

## 0. Everything below was measured, not assumed

Run on the actual runtime, against the actual repository:

| Question | Measured answer |
|---|---|
| Node runtime | **v24.16.0** (`package.json` floor is `>=22.12`) |
| Full ICU / `Intl` IANA zones | **available** |
| `@date-fns/tz` installed | **no** |
| `date-fns@4.4.0` core timezone helpers | **none** — `TZDate` absent, zero zone-related exports |
| Hungarian spring transition | `2026-03-29T01:00Z`, offset **+60 → +120**; local `01:59 → 03:00` |
| Hungarian autumn transition | `2026-10-25T01:00Z`, offset **+120 → +60**; local `02:59 → 02:00` |
| `Company.timezone` write validation | `TIMEZONE_RE = /^[A-Za-z_]+(\/[A-Za-z_]+)*$/` — **shape only** |
| Does that regex admit a non-existent zone? | **Yes** — `"Mars/Olympus_Mons"` passes the write check; `Intl` rejects it |

Two consequences follow immediately, and they drive the whole plan:

1. **`date-fns` cannot do zone conversion here.** Version 4 moved that into the
   separate `@date-fns/tz` package, which is not installed. So CAL1.2 either
   adds a dependency or uses `Intl`. It will use `Intl` — already proven on this
   runtime by N1.8's `billingFormat.ts`.
2. **`Company.timezone` cannot be trusted at read time.** The column is
   tenant-writable and its validator only checks *shape*. A stored
   `"Mars/Olympus_Mons"` makes `Intl` **throw**. Unhandled inside a recurrence
   expansion, that turns one bad settings value into a dead calendar for the
   whole tenant.

---

## 1. Q8 — RESOLVED: the two defaults stay different

### The conflict as stated

`utils/billingFormat.ts:115` declares `DEFAULT_BILLING_TIME_ZONE = "UTC"`, with
a written rationale. The calendar plan (§5.1) names `Europe/Budapest` as the
single fallback. Same tenant column, two defaults.

### Why unifying is the wrong fix

The two subsystems are not answering the same question.

- **Billing renders an instant Stripe already fixed.** The only question is
  *which calendar day to name*. UTC is a neutral, explainable choice.
- **The calendar stores a human intention.** "Every Monday at 09:00" is a
  wall-clock rule, not an instant. The zone is *semantics*, not presentation.

Measured proof that a UTC fallback breaks the calendar — "every Monday 09:00
Budapest" pinned to a fixed UTC instant across the spring transition:

```
23 Mar 08:00Z  ->  2026-03-23 09:00 local   (intended)
30 Mar 08:00Z  ->  2026-03-30 10:00 local   (same UTC — one hour wrong, forever after)
```

And the mirror image is already pinned in the repo: `billingFormat.test.ts:189`
("can name a DIFFERENT DAY than UTC") proves a European fallback would make
billing name the wrong day for a `23:30Z` period boundary.

**So no single value is correct for both.** A forced unification does not
resolve the conflict — it relocates it onto whichever subsystem loses.

### The decision

**Keep `DEFAULT_BILLING_TIME_ZONE = "UTC"`. Introduce
`DEFAULT_CALENDAR_TIME_ZONE = "Europe/Budapest"`. Change no Billing file.**

The real hazard was never that the values differ — it is that they could differ
*silently*, and that a future reader would find two bare constants with no
indication either knew about the other. Four mechanisms close that:

**M1 — one constant, one home.** `services/calendar/timezone.ts` declares
`DEFAULT_CALENDAR_TIME_ZONE`, with a comment naming `DEFAULT_BILLING_TIME_ZONE`,
quoting its rationale, and stating why the calendar's answer differs. No other
file in the module may hardcode a zone.

**M2 — a divergence tripwire.** `calendarTimezone.test.ts` imports **both**
constants and asserts both values, with the explanation in the test body. Any
future change to *either* breaks a test whose message explains the trade-off, so
the divergence can only ever be changed deliberately. This is the single most
valuable line in the plan, and it costs one import.

> ⚠️ This makes the calendar test file import a Billing-owned module. It is
> read-only and test-only — no Billing file is modified — but it does mean that
> renaming `DEFAULT_BILLING_TIME_ZONE` breaks a Calendar test. That is the
> intended behaviour of a tripwire, but it is a cross-stream coupling and is
> listed as **D-3** below for explicit approval.

**M3 — one resolution order, stated once.** Four levels, in exactly one
function, used by every caller:

```
CalendarEvent.timezone          most specific
  → Calendar.timezone
  → Company.timezone            validated, never trusted
  → DEFAULT_CALENDAR_TIME_ZONE
```

`Calendar.timezone` stays **nullable and un-materialised**. Writing the resolved
zone onto the row at creation was considered and rejected: it would freeze the
value, so a company later correcting its timezone would silently fail to
propagate to calendars that never set one of their own.

**M4 — validate, never trust.** Because the write-side regex admits
`"Mars/Olympus_Mons"`, the calendar re-validates through `Intl` on read and
falls back with a warning, exactly as `resolveTimeZone()` does for billing.

### On sharing the validator instead of duplicating it

`billingFormat.resolveTimeZone()` already contains the right ~10 lines. The
calendar will **not** import it, for two reasons: it hardcodes the *billing*
fallback, and importing it would couple the calendar's runtime to a Billing
module. Extracting the validator into a shared `utils/timezone.ts` would be the
cleaner end state, but it edits `billingFormat.ts` — a Billing file, out of
bounds without approval. Listed as **D-4**; the recommendation is to defer it.
Ten duplicated lines are cheaper than a cross-stream edit while N1.8 is open.

---

## 2. Q2 — recommendation: own narrowed expander, no new dependency

| | `rrule` npm package | Own narrowed expander ✅ |
|---|---|---|
| New runtime dependency | yes | **no** |
| Timezone support | needs `luxon` in practice → a *second* dependency | `Intl`, already proven here |
| Coverage | full RFC 5545 | `FREQ=DAILY\|WEEKLY\|MONTHLY\|YEARLY`, `INTERVAL`, `BYDAY`, `COUNT`, `UNTIL` |
| Is full RFC needed? | only for external sync — **R7 excludes that from CAL1–CAL3** | — |
| DST correctness | theirs | **ours** — the real cost |

The deciding measurement is that `date-fns` brings no zone support, so `Intl` is
the engine either way; `rrule` would add a dependency and still need its own
zone story. Owning the expander is bounded by the grammar above and by CAL1.2
being **pure functions with no database access**, which makes it exhaustively
testable — the reason the scope doc made it a milestone of its own.

The cost is stated plainly: we own the DST edge cases. §4 is where they get
decided rather than discovered later.

---

## 3. Two decisions the approved plan never made

The DST probe surfaced two cases that `calendar-system-plan.md` §5.1–5.2 does
not address. They are not implementation details — they are user-visible
policy, and the expander cannot be written without them.

### D-1: local times that do not exist (spring gap)

On 2026-03-29 Budapest jumps `01:59 → 03:00`. A recurring event at **02:30**
has no valid instant that day.

| Option | Result on 2026-03-29 |
|---|---|
| **Shift forward by the gap ✅ recommended** | fires at 03:30 |
| Clamp to the transition instant | fires at 03:00 |
| Skip the occurrence entirely | does not fire at all |

**Recommended: shift forward.** It preserves "the event still happens that day",
which is what a user means by a daily rule, and it matches the behaviour of the
mainstream calendars users will compare against. Skipping is the worst option —
a silently missing occurrence looks like data loss.

### D-2: local times that happen twice (autumn overlap)

On 2026-10-25, local **02:30** occurs at both `00:30Z` (+120) and `01:30Z`
(+60) — measured, both render as `02:30`.

| Option | Result |
|---|---|
| **First occurrence, pre-transition offset ✅ recommended** | fires once, at 00:30Z |
| Second occurrence | fires once, at 01:30Z |
| Both | fires twice — rejected outright |

**Recommended: first occurrence.** RFC 5545 does not actually mandate a
resolution for ambiguous local times — this is implementation policy, and
"first" is what the mainstream calendars settled on. It is deterministic, and
firing twice would double-send every reminder built on it in CAL2.3.

Both policies live in **one exported enum-like constant** in `timezone.ts` so
the choice is visible in one place rather than implied by arithmetic.

### D-5: how long is an occurrence?

D-1 and D-2 decide where an occurrence *starts*. They say nothing about where it
*ends* — and across a transition the two possible answers differ by an hour.
For a weekly 23:00–01:00 event crossing the spring gap:

| Option | Result |
|---|---|
| **Exact elapsed duration ✅ recommended** | still 2 hours; the local end shifts 01:00 → 02:00 |
| Wall-clock duration preserved | local end stays 01:00; the event silently becomes 1 hour |

**Recommended: exact elapsed duration for timed events.** This is what RFC 5545
prescribes when an event carries an explicit end rather than a `DURATION`, and
`CalendarEvent.endsAt` is exactly that — a stored instant, not a length. A
booked two-hour job must not become a one-hour job because the clocks moved.

**All-day series are the exception** and must not use a stored duration at all:
their bounds come from `allDayBoundsUtc()` applied to each occurrence's *local
date*, because 2026-03-29 is a 23-hour day in Budapest and 2026-10-25 a 25-hour
one (measured, §0). Applying a fixed 24-hour span to either produces a
recurring all-day event that drifts an hour off the day boundary twice a year.

> This decision was missed in the first draft of this plan and found by review.
> It is recorded here rather than left to the implementer precisely because §2
> promised the DST edges would be decided, not discovered.

---

## 4. What CAL1.2 builds

Two files, both **pure functions — zero database access, zero API, zero
imports from `routes/` or `services/` outside the calendar module.**

### `server/src/services/calendar/timezone.ts`

| Export | Responsibility |
|---|---|
| `DEFAULT_CALENDAR_TIME_ZONE` | the single fallback (M1) |
| `isValidTimeZone(zone)` | `Intl` probe; the only validity authority |
| `resolveCalendarTimeZone({ event, calendar, company })` | the four-level order (M3), validating as it goes |
| `zoneOffsetMinutes(zone, instant)` | offset at an instant, derived from `Intl.formatToParts` |
| `wallClockToUtc(parts, zone, policy)` | local → UTC, applying **D-1** and **D-2** |
| `utcToWallClock(instant, zone)` | UTC → local calendar fields |
| `allDayBoundsUtc(dateOnly, zone)` | all-day start/end **in the calendar's zone** |

`allDayBoundsUtc` is not cosmetic: a Hungarian all-day event stored as
`00:00–23:59Z` bleeds into the neighbouring day for anyone reading in UTC. Note
that 2026-03-29 is a **23-hour day** in Budapest and 2026-10-25 a **25-hour**
one, so the function must not assume 24.

### `server/src/services/calendar/recurrence.ts`

| Export | Responsibility |
|---|---|
| `parseRecurrenceRule(rule)` | narrowed RRULE → structure, or a typed rejection |
| `expandOccurrences({ rule, startsAt, endsAt, allDay, zone, windowStart, windowEnd, exceptions, limit })` | the window expansion, in local time, exceptions applied |
| `computeRecurrenceEndsAt({ rule, startsAt, endsAt, allDay, zone })` | the pruning value written at save time; **`null` = infinite** |

Expansion happens in the **local** zone and converts to UTC last. Doing it the
other way round is precisely the bug the measurement in §1 demonstrates.

**Both functions take `endsAt`, and this is not optional.** The shipped CAL1.1
schema defines the column they feed as *"the last **occurrence's end**, computed
at WRITE time"* ([schema.prisma:1089-1093](../server/prisma/schema.prisma), commit
`d71d281`), and the candidate query in
[calendar-system-plan.md](calendar-system-plan.md) §5.2 prunes with
`recurrenceEndsAt >= :windowStart`. A signature carrying only `startsAt` can
physically return only the last occurrence's *start* — so a series whose final
occurrence straddles the window start (an overnight 22:00–01:00 weekly, or any
all-day series) would be pruned out and vanish from the view while it is
actually in progress. The first draft of this plan had exactly that defect.

`expandOccurrences` therefore emits `{ startsAt, endsAt }` **pairs**, selected by
overlap (`occ.endsAt > windowStart && occ.startsAt < windowEnd`) rather than by
start alone — which is also what gives `CalendarEventOccurrence.endsAt` an
override to override. Ends are derived per **D-5**: exact elapsed duration for
timed series, `allDayBoundsUtc()` on the occurrence's local date for all-day
ones. That is why `allDay` is a parameter.

`limit` is a hard upper bound on emitted occurrences — a recurrence bomb
(`FREQ=DAILY` over a 366-day window with a pathological rule) must fail loudly
rather than allocate without end.

---

## 5. Test plan — 40 cases

Two new files. The CAL1.1 gate style applies: **the suite must grow by exactly
40** relative to the commit CAL1.2 branches from. Given that Stream A moves the
total independently, the count is verified by running the two files in
isolation, not by subtracting totals.

> **Raised from 34 to 40 on 2026-08-02**, after an adversarial review of the
> finished implementation found six real defects — two of which threw a
> `RangeError` out of a pure function, and one of which reported a *finite*
> series as infinite. All six were confirmed by running them before being fixed.
> The regression cases are listed in §5.3; without them every one of the six can
> silently come back.

### 5.1 `calendarTimezone.test.ts` — 14

| # | Case |
|---|---|
| 1 | event zone wins over calendar, company and default |
| 2 | calendar zone wins over company and default |
| 3 | company zone wins over default |
| 4 | all three null → `DEFAULT_CALENDAR_TIME_ZONE` |
| 5 | `"Mars/Olympus_Mons"` (passes the write regex) → falls back, warns, does **not** throw |
| 6 | blank / whitespace company zone → falls back |
| 7 | **the divergence tripwire (M2)** — pins both `DEFAULT_CALENDAR_TIME_ZONE` and `DEFAULT_BILLING_TIME_ZONE` |
| 8 | spring: offset +60 → +120 across `2026-03-29T01:00Z` |
| 9 | autumn: offset +120 → +60 across `2026-10-25T01:00Z` |
| 10 | **D-1** — 02:30 on 2026-03-29 resolves to 03:30 |
| 11 | **D-2** — 02:30 on 2026-10-25 resolves to the first (`00:30Z`) instant |
| 12 | all-day on a normal day does not bleed into the adjacent day |
| 13 | all-day on 2026-03-29 spans **23** hours, and on 2026-10-25 **25** |

### 5.2 `calendarRecurrence.test.ts` — 26

| # | Case |
|---|---|
| 1 | `FREQ=DAILY` across a plain window |
| 2 | `INTERVAL=2` skips correctly |
| 3 | `FREQ=WEEKLY;BYDAY=MO,WE` emits both weekdays |
| 4 | `FREQ=MONTHLY` on the 31st — behaviour in a 30-day month is pinned |
| 5 | `FREQ=YEARLY` on 02-29 — behaviour in a non-leap year is pinned |
| 6 | `COUNT` boundary is exact (n, not n±1) |
| 7 | `UNTIL` boundary is exact, inclusivity pinned |
| 8 | `COUNT` and `UNTIL` together → whichever ends first |
| 9 | no `COUNT`/`UNTIL` → `computeRecurrenceEndsAt` returns **null** |
| 10 | **weekly 09:00 across the spring transition stays 09:00 local** |
| 11 | **weekly 09:00 across the autumn transition stays 09:00 local** |
| 12 | window entirely before the series → `[]` |
| 13 | window entirely after a finite series → `[]` |
| 14 | window partially overlapping → only the in-window occurrences |
| 15 | a `cancelled` exception removes exactly that occurrence |
| 16 | a moved exception overrides time/title, leaving siblings untouched |
| 17 | malformed / unsupported rule is rejected, never silently treated as one-off |
| 18 | `computeRecurrenceEndsAt` returns the last occurrence's **end**, not its start — `FREQ=WEEKLY;COUNT=4` on a 23:00–01:00 local event |
| 19 | a finite series whose last occurrence **starts before** `windowStart` and ends after it is still returned (overlap selection, not start-only) |
| 20 | **D-5** — a timed occurrence keeps its exact elapsed duration across the spring transition; the local end moves, the length does not |
| 21 | **D-5** — an all-day recurring occurrence on 2026-03-29 spans **23** hours, derived from the local date rather than a stored duration |

Cases **10 and 11 are the reason this milestone exists.** They are the ones that
would have failed under a UTC fallback. Cases **18–21** exist because the first
draft of this plan got the `recurrenceEndsAt` contract wrong; they are the
regression net for it.

### 5.3 Regression cases — 6

Added after review. Every one of these was **reproduced against the finished
code before the fix**, not predicted.

| # | File | Defect it pins |
|---|---|---|
| R1 | recurrence | An unbounded `INTERVAL` walked civil-date arithmetic past the representable range, so `Intl` threw a `RangeError` **out of a pure function** — a 500 from the CAL1.5 endpoint, caused by a stored string. `INTERVAL` and `COUNT` are now bounded. |
| R2 | timezone | An unusable **zone** must degrade with a warning (it is tenant-writable); an unusable **instant** must still fail, but by name — `Intl`'s bare `RangeError("Invalid time value")` identified nothing actionable. |
| R3 | recurrence | A **finite** series that produced no occurrence returned `null`, which the candidate query reads as **infinite** — the exact opposite. Now returns the event's own end, and the entry points degrade rather than throw. |
| R4 | recurrence | The occurrence ceiling was tested *after* the push, so it was off by one and `limit: 0` still returned one occurrence. |
| R5 | recurrence | `Date.UTC` rolls over instead of failing, so `UNTIL=20261345` was accepted as 2027-02-14 — a series ending eight months after the rule appears to say. Every field is now range-checked. |
| R6 | recurrence | Expansion stopped at `windowEnd`, so an occurrence an exception had **moved back into** the window was never materialised — it vanished from the view the user had just dragged it into. |

---

## 6. Explicitly out of scope

| Item | Belongs to |
|---|---|
| Any route, controller, or database read/write | CAL1.4 / CAL1.5 |
| Permission logic | CAL1.3 |
| Materialising `recurrenceEndsAt` onto rows | CAL1.5 (writes it via this module) |
| Frontend, `react-big-calendar` wiring | CAL1.6 |
| Reminder sweep | CAL2.3 |
| `BYMONTHDAY`, `BYSETPOS`, `WKST`, `EXDATE` in the rule grammar | not needed under R7 |
| Any change to `billingFormat.ts` or `companyValidation.ts` | out of bounds / D-4 |
| `Company.timezone` backfill | not needed — the fallback chain covers it |

---

## 7. Gates

- `prisma validate` unaffected — **CAL1.2 ships no migration and no schema change**
- backend `tsc --noEmit` clean
- both new test files green **in isolation** and in the full suite
- full backend suite green against `axeriva_test_cal1` (inline `TEST_DATABASE_URL`)
- frontend build and lint unchanged (CAL1.2 touches no frontend file)
- `git status` immediately before staging; **Calendar files only**

---

## 8. Open decisions — needed before any code is written

| # | Decision | Recommendation |
|---|---|---|
| **Q8** | billing vs calendar fallback | **Resolved above** — keep both, add the tripwire. Needs your acknowledgement, not a choice. |
| **Q2** | own expander vs `rrule` | **Own narrowed expander**, no new dependency |
| **D-1** | non-existent local time (spring gap) | **Shift forward** by the gap |
| **D-2** | ambiguous local time (autumn overlap) | **First** occurrence |
| **D-5** | occurrence duration across a transition | **Exact elapsed** for timed events; all-day derived from the local date |
| **D-3** | may `calendarTimezone.test.ts` import `DEFAULT_BILLING_TIME_ZONE`? | **Yes** — it is the anti-drift tripwire, test-only, read-only |
| **D-4** | extract the zone validator into a shared `utils/timezone.ts` | **Defer** — it edits a Billing file; revisit once N1.8 is fully closed |

*Nothing in CAL1.2 is implemented. This document is the specification to be
carried over verbatim once the table above is approved.*
