/**
 * Pure "skip to Day 14" clock math for `DemoClockPanel` (task 8.9.3;
 * design.md D35 — `POST /demo/clock` takes an ABSOLUTE offset from real
 * time, never a delta on top of whatever is already stored — and this
 * task's own decided fallback: 00:00 in the program timezone when the final
 * A slot carries no `plannedLocalTime`).
 *
 * `zonedWallClockToUtcMs` is deliberately duplicated from
 * `e2e/support/demo.ts`'s own two-pass fixed-point helper rather than
 * imported (that file is Playwright-only, outside `apps/web`'s dependency
 * graph) or added to `packages/shared/src/domain/calendar.ts` (a
 * shared/domain file outside this task's ownership, task 2.1) — small
 * enough to own here, matching that file's own reasoning for the same
 * duplication.
 */
import { finalDate, type LocalDate } from '@attention-lab/shared'
import type { SlotResponseValue } from '@attention-lab/shared'

/** `timeZone`'s UTC offset in milliseconds AT `instant` (varies across a DST transition). */
function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? Number.NaN)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asUtc - instant.getTime()
}

/**
 * The UTC instant (epoch ms) of local wall-clock `HH:MM` on `localDate` in
 * IANA zone `timeZone`. Two-pass fixed point (a same-day DST transition
 * inside the loop would need a third pass, which no program timezone this
 * app exercises does) — mirrors `e2e/support/demo.ts`'s own
 * `zonedWallClockToUtcMs`.
 */
export function zonedWallClockToUtcMs(localDate: LocalDate, hhmm: string, timeZone: string): number {
  const [year, month, day] = localDate.split('-').map(Number)
  const [hour, minute] = hhmm.split(':').map(Number)
  if (year === undefined || month === undefined || day === undefined || hour === undefined || minute === undefined) {
    throw new Error(`Malformed local date/time: "${localDate}" "${hhmm}"`)
  }
  let guessMs = Date.UTC(year, month - 1, day, hour, minute, 0)
  for (let i = 0; i < 2; i++) {
    const offsetMs = timeZoneOffsetMs(new Date(guessMs), timeZone)
    guessMs = Date.UTC(year, month - 1, day, hour, minute, 0) - offsetMs
  }
  return guessMs
}

/** The final A slot from `slots`, or `undefined` when the four slots have not been readied (or readied without this one) yet. */
export function findFinalSlotA(slots: readonly SlotResponseValue[]): SlotResponseValue | undefined {
  return slots.find((slot) => slot.phase === 'final' && slot.label === 'A')
}

export interface SkipToDay14Program {
  readonly baselineDate: LocalDate
  readonly timezone: string
}

/**
 * `offsetSeconds` so that `now + offset` lands on the program's final date
 * (`finalDate(program.baselineDate)`, calendar.ts) at final slot A's
 * `plannedLocalTime` in the program timezone — or 00:00 in that timezone
 * when the slot is missing or its `plannedLocalTime` is not yet set (this
 * task's decided fallback, tasks-detail.md 8.9.3).
 */
export function skipToDay14OffsetSeconds(
  program: SkipToDay14Program,
  slots: readonly SlotResponseValue[],
  now: Date,
): number {
  const targetDate = finalDate(program.baselineDate)
  const finalSlotA = findFinalSlotA(slots)
  const hhmm = finalSlotA?.plannedLocalTime ?? '00:00'
  const targetMs = zonedWallClockToUtcMs(targetDate, hhmm, program.timezone)
  return Math.round((targetMs - now.getTime()) / 1000)
}
