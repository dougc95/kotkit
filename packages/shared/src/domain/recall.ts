/**
 * Recall: a separate, timed, then-locked step of a benchmark attempt.
 *
 * Three independent rules live here, and nowhere else (D16 — recall rules are
 * owned by this module, not by `eligibility.ts`):
 *
 *  - `recallDelaySeconds` / `deriveRecallFlags` turn the gap between the
 *    interval ending and recall starting, and recall's own duration, into
 *    silently-recorded deviation FLAGS. A flag is never an `ExclusionReason`
 *    (D7.3) — a late or slow recall does not disqualify an attempt, it is
 *    just visible in review and export. See
 *    specs/benchmark-assessment/spec.md ("Recall is a separate, timed, then
 *    locked step").
 *  - `isBlankPoint` / `scoreRecall` implement "blank means unknown, not
 *    inaccurate": a blank recall point is FORCED to score 0 (it was not
 *    recalled), while a non-blank point left unscored makes the whole
 *    attempt's recall score unreported (`null`), never a partial array and
 *    never a zero-filled guess. See specs/benchmark-assessment/spec.md
 *    ("Self-scoring is unavailable until recall is locked" / "Score with two
 *    blank points") and HANDOFF.md ("Unknown does not equal zero").
 *
 * This module absorbs what was originally scoped as unit 5.7.1.
 */

import type { RecallFlag, ReportedCount } from './types.js'

/** Delay beyond which a late recall start is flagged (strictly greater than). */
export const RECALL_DELAY_FLAG_SECONDS = 600

/** Recall duration beyond which an overrun is flagged (3 min + 30 s, strictly greater than). */
export const RECALL_OVERRUN_FLAG_SECONDS = 210

/** Recall always asks for exactly five points. */
export const RECALL_POINT_COUNT = 5

/** The recall countdown shown to the user, in seconds (3:00). */
export const RECALL_WINDOW_SECONDS = 180

/** A single recall point's self-score: accurate (1), not accurate (0). */
export type RecallScoreValue = 0 | 1

/** Five recall point texts, in order. */
export type RecallPoints = readonly [string, string, string, string, string]

/** Five recall self-scores, in order; an entry is `null` when that point has not been scored. */
export type RecallPointScores = readonly [
  RecallScoreValue | null,
  RecallScoreValue | null,
  RecallScoreValue | null,
  RecallScoreValue | null,
  RecallScoreValue | null,
]

/**
 * Seconds between the interval ending and recall starting, floored, never
 * negative. Recall cannot logically start before the interval it recalls
 * ended; the API maps that impossible ordering to 422
 * `recall_before_interval_end` (D27).
 */
export function recallDelaySeconds(intervalEndedAt: Date, recallStartedAt: Date): number {
  const diffMs = recallStartedAt.getTime() - intervalEndedAt.getTime()
  if (diffMs < 0) {
    throw new RangeError(
      'recallDelaySeconds: recallStartedAt must not precede intervalEndedAt',
    )
  }
  return Math.floor(diffMs / 1000)
}

/**
 * Silent deviation flags for one recall attempt. Both comparisons are STRICT
 * (`>`, never `>=`) so the stated boundary values (600 s delay, 210 s
 * duration) themselves carry no flag. These are flags only — never an
 * `ExclusionReason` (D7.3) — so an attempt with a late or slow recall stays
 * eligible on that basis alone.
 */
export function deriveRecallFlags({
  delaySeconds,
  durationSeconds,
}: {
  readonly delaySeconds: number
  readonly durationSeconds: number
}): RecallFlag[] {
  const flags: RecallFlag[] = []
  if (delaySeconds > RECALL_DELAY_FLAG_SECONDS) flags.push('recall_delayed')
  if (durationSeconds > RECALL_OVERRUN_FLAG_SECONDS) flags.push('recall_overrun')
  return flags
}

/** Is `text` blank (empty, or whitespace only) once trimmed? */
export function isBlankPoint(text: string): boolean {
  return text.trim() === ''
}

/**
 * Scores one recall attempt's five points.
 *
 * Rules, in order of precedence per point:
 *  - A blank point (per `isBlankPoint`) is FORCED to 0, whatever score was
 *    submitted for it — it was not recalled, so "accurate" cannot apply.
 *  - A non-blank point with no score (its `scores` entry is `null`, or
 *    `scores` itself is `null`) leaves the whole result unreported:
 *    `recallScores: null`, `recallScore: null`, `complete: false`. This is
 *    never a partial array — the stored `recall_scores` jsonb shape is
 *    exactly five `0|1` values or nothing at all.
 *  - Otherwise `recallScore` is the count of 1s (0–5), a number even when 0
 *    (a measurement, not an absence — no `?? 0` / `|| 0` is used here or
 *    needed, since every branch above already handles the unreported case
 *    explicitly, per 2.9.1).
 */
export function scoreRecall(
  points: RecallPoints,
  scores: RecallPointScores | null,
): { recallScores: readonly RecallScoreValue[] | null; recallScore: ReportedCount; complete: boolean } {
  const result: RecallScoreValue[] = []
  for (let i = 0; i < RECALL_POINT_COUNT; i++) {
    // The tuple types guarantee exactly RECALL_POINT_COUNT entries; the `!`
    // reflects that guarantee against noUncheckedIndexedAccess's generic
    // (non-literal `i`) indexing, the same convention `calendar.ts` uses.
    const point = points[i]!
    if (isBlankPoint(point)) {
      result.push(0)
      continue
    }
    const score = scores === null ? null : (scores[i] ?? null)
    if (score === null) {
      return { recallScores: null, recallScore: null, complete: false }
    }
    result.push(score)
  }
  const recallScore: number = result.reduce((sum: number, value) => sum + value, 0)
  return { recallScores: result, recallScore, complete: true }
}
