/**
 * Practice-block progression: band ceilings for the practice target and the
 * two-consecutive-day suggestion rule.
 *
 * The protocol never raises the target on its own — it only ever *offers* a
 * +5 minute step, capped by the current band ceiling, after two consecutive
 * local days each had two qualifying practice blocks at the current target.
 * A missed day never resets a qualification that already happened; it only
 * fails to extend one. See docs/Attention-Recovery-14-Day-Plan.md and
 * specs/practice-sessions/spec.md ("Progression suggestion follows the
 * protocol rule").
 */

import { addDays, type LocalDate } from './calendar.js'
import { assertSameRealm } from './types.js'
import type { OutputQuality, Realm, ReportedCount, SessionKind } from './types.js'

/** One inclusive day range and the practice-target ceiling (in minutes) that governs it. */
export interface BandCeiling {
  readonly fromDay: number
  readonly toDay: number
  readonly minutes: number
}

/**
 * The protocol's band ceilings (practice-sessions spec, "Progression suggestion
 * follows the protocol rule"). This is also the exact value 4.1.1 stores in
 * revision 1's `settings.bandCeilings`, so the two must be kept in sync by hand
 * if either changes.
 */
export const DEFAULT_BAND_CEILINGS: readonly BandCeiling[] = [
  { fromDay: 1, toDay: 3, minutes: 10 },
  { fromDay: 4, toDay: 7, minutes: 15 },
  { fromDay: 8, toDay: 10, minutes: 20 },
  { fromDay: 11, toDay: 14, minutes: 25 },
]

/**
 * The practice-target ceiling, in seconds, that governs `day`. A day at or
 * before the first band's `toDay` (including Day 0 and any negative day) uses
 * the first band; a day past the last band's `toDay` uses the last band — the
 * ceiling never runs out, it just stops rising.
 */
export function bandCeilingSeconds(
  day: number,
  ceilings: readonly BandCeiling[] = DEFAULT_BAND_CEILINGS,
): number {
  const first = ceilings[0]
  if (!first) {
    throw new RangeError('bandCeilingSeconds: ceilings must not be empty')
  }
  if (day <= first.toDay) return first.minutes * 60
  for (const band of ceilings) {
    if (day >= band.fromDay && day <= band.toDay) return band.minutes * 60
  }
  const last = ceilings[ceilings.length - 1]!
  return last.minutes * 60
}

/** One practice or benchmark session, reduced to what progression needs. */
export interface PracticeBlockRecord {
  readonly sessionId: string
  readonly realm: Realm
  readonly kind: SessionKind
  readonly localDate: LocalDate
  readonly targetSeconds: number
  readonly completeInterval: boolean | null
  readonly outputQuality: OutputQuality | null
  readonly episodeCount: ReportedCount
  readonly finalized: boolean
}

/**
 * Does this one block, on its own, count toward a qualifying day? Timer expiry
 * is never completion on its own — an unfinalized block never qualifies, even
 * if it reached its target.
 */
export function blockQualifies(block: PracticeBlockRecord, currentTargetSeconds: number): boolean {
  return (
    block.finalized &&
    block.kind === 'practice' &&
    block.targetSeconds === currentTargetSeconds &&
    block.completeInterval === true &&
    block.outputQuality === 'yes' &&
    block.episodeCount !== null &&
    block.episodeCount <= 1
  )
}

/** Does this local date have at least two qualifying blocks at the current target? */
export function dayQualifies(
  blocksOfOneDate: readonly PracticeBlockRecord[],
  currentTargetSeconds: number,
): boolean {
  let qualifying = 0
  for (const block of blocksOfOneDate) {
    if (blockQualifies(block, currentTargetSeconds)) qualifying += 1
  }
  return qualifying >= 2
}

/** +5 minutes, the only step the protocol ever offers. */
export const PROGRESSION_STEP_SECONDS = 300

/** The revision reason recorded when a user accepts a progression suggestion. */
export const PROGRESSION_ACCEPTED_REASON = 'progression accepted'

export interface SuggestProgressionInput {
  /** The program day the suggestion is being evaluated for (governs the ceiling). */
  readonly day: number
  readonly currentTargetSeconds: number
  readonly blocks: readonly PracticeBlockRecord[]
  readonly bandCeilings?: readonly BandCeiling[]
}

export interface ProgressionSuggestion {
  readonly suggestedTargetSeconds: number
  readonly qualifiedOn: readonly [LocalDate, LocalDate]
}

/**
 * Suggests +5 minutes when two *consecutive* local dates each qualified at the
 * current target — and only when that step stays within the ceiling that
 * governs `day`. Qualification is held: a missed day between two qualifying
 * dates breaks that particular pairing (they are no longer adjacent), but a
 * missed day *after* a qualifying pair does not clear it. Benchmark blocks
 * never contribute (`blockQualifies` rejects `kind !== 'practice'`), so the
 * benchmark duration is never an input to, or an output of, this function.
 *
 * Throws `RealmMixingError` (via `assertSameRealm`) if `blocks` mixes realms.
 */
export function suggestProgression(input: SuggestProgressionInput): ProgressionSuggestion | null {
  const { day, currentTargetSeconds, blocks, bandCeilings = DEFAULT_BAND_CEILINGS } = input

  assertSameRealm(blocks)

  const byDate = new Map<LocalDate, PracticeBlockRecord[]>()
  for (const block of blocks) {
    const existing = byDate.get(block.localDate)
    if (existing) {
      existing.push(block)
    } else {
      byDate.set(block.localDate, [block])
    }
  }

  const qualifyingDates = [...byDate.keys()]
    .filter((date) => dayQualifies(byDate.get(date)!, currentTargetSeconds))
    .sort()
  const qualifyingSet = new Set(qualifyingDates)

  let pair: [LocalDate, LocalDate] | null = null
  for (const date of qualifyingDates) {
    const next = addDays(date, 1)
    if (qualifyingSet.has(next)) {
      pair = [date, next]
      break
    }
  }

  if (!pair) return null

  const suggestedTargetSeconds = currentTargetSeconds + PROGRESSION_STEP_SECONDS
  if (suggestedTargetSeconds > bandCeilingSeconds(day, bandCeilings)) return null

  return { suggestedTargetSeconds, qualifiedOn: pair }
}
