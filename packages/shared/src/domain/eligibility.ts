/**
 * Server-side benchmark eligibility.
 *
 * An attempt is eligible only when every condition below holds; every failing
 * condition is stored as an explicit exclusion reason (never silently
 * dropped, never collapsed into a single "ineligible" flag). See
 * specs/benchmark-assessment/spec.md ("Eligibility is derived server-side
 * with explicit reasons") and HANDOFF.md's invariant that expiry never
 * proves completion and unknown never becomes zero.
 *
 * This module is pure: it takes the stored/derived columns as plain input
 * and returns a decision. The API (5.8.4) is the only writer of the result;
 * the web app may call this same function to preview eligibility before
 * finalize, but the persisted value is always the server's (D4).
 */

import type { LocalDate } from './calendar.js'
import type { ExclusionReason, Realm, ReportedCount, TimeSource, TimerQuality } from './types.js'
import { isReported } from './types.js'

/**
 * Everything `evaluateEligibility` needs to know about one attempt. Callers
 * (5.8.4) pass the stored columns straight into these fields — there is no
 * transformation step between the database row and this shape besides
 * reading it out.
 */
export interface EligibilityInput {
  /**
   * Whether the fixed interval was completed. `null` means the deadline was
   * reached but the attempt was never confirmed by an `end` transition
   * (D24) — expiry never proves completion, so `null` is NOT complete, the
   * same as `false`.
   */
  readonly completeInterval: boolean | null
  readonly recallLockedAt: string | null
  readonly recallScores: readonly (0 | 1)[] | null
  readonly episodeCount: ReportedCount
  readonly materiallyDisrupted: boolean
  readonly timerQuality: TimerQuality
  readonly sessionLocalDate: LocalDate
  readonly slotAssignedLocalDate: LocalDate
  readonly excludedByAmendment: boolean
  readonly realm: Realm
  readonly timeSource: TimeSource
}

export interface EligibilityResult {
  readonly eligible: boolean
  readonly exclusionReasons: ExclusionReason[]
}

/**
 * Derives eligibility and its explicit exclusion reasons from the stored
 * conditions of one attempt. Reasons are emitted in `ExclusionReason`
 * declaration order (see `EXCLUSION_REASONS` in types.ts) regardless of
 * which conditions fail, so the output is deterministic and diffable.
 *
 * Deliberately absent from the inputs: external interruption count (E). E
 * never disqualifies an attempt on its own (only `materiallyDisrupted`
 * does) — see "External interruptions without disruption".
 */
export function evaluateEligibility(input: EligibilityInput): EligibilityResult {
  const exclusionReasons: ExclusionReason[] = []

  // expiry never proves completion: only `=== true` (an explicit `end`
  // transition) counts as complete; `null` and `false` both fail here.
  if (input.completeInterval !== true) {
    exclusionReasons.push('interval_incomplete')
  }

  if (input.recallLockedAt === null) {
    // D25: an incomplete attempt may be finalized without a recall lock and
    // then carries this reason rather than blocking finalize.
    exclusionReasons.push('recall_missing')
  }

  if (input.recallScores === null || input.recallScores.length !== 5) {
    exclusionReasons.push('scoring_incomplete')
  }

  if (!isReported(input.episodeCount)) {
    // explicit 0 is a measurement and passes; only `null` (not reported)
    // triggers this reason.
    exclusionReasons.push('count_unknown')
  }

  if (input.materiallyDisrupted) {
    exclusionReasons.push('materially_disrupted')
  }

  if (input.timerQuality === 'uncertain') {
    // D26: an unresolved clock gap at finalize is forced to 'uncertain'
    // before evaluateEligibility is ever called.
    exclusionReasons.push('timer_uncertain')
  }

  if (input.sessionLocalDate !== input.slotAssignedLocalDate) {
    // D23: a late (or early, for a replacement) start is accepted and
    // labelled here — it is never blocked from starting or finalizing.
    exclusionReasons.push('timing_deviation')
  }

  if (input.excludedByAmendment) {
    exclusionReasons.push('excluded_by_amendment')
  }

  if (input.realm === 'pilot' && input.timeSource !== 'measured') {
    exclusionReasons.push('simulated_time')
  }

  return { eligible: exclusionReasons.length === 0, exclusionReasons }
}

/**
 * The stored eligibility of one attempt, as read back from `focus_sessions`
 * after finalize. `eligible` is nullable because practice sessions never get
 * a value (5.8.2) — only benchmarks are evaluated by `evaluateEligibility`.
 */
export interface StoredEligibility {
  readonly eligible: boolean | null
  readonly exclusionReasons: readonly ExclusionReason[]
}

export interface AmendmentExclusionInput {
  readonly excludeFromReport: boolean
}

export interface AmendmentExclusionResult {
  readonly eligible: boolean | null
  readonly exclusionReasons: ExclusionReason[]
}

/**
 * Overlays finalized-attempt amendments (5.9.1) onto the eligibility that was
 * written at finalize (5.8.4), without ever rewriting the stored columns.
 *
 * `focus_sessions.eligible` / `exclusion_reasons` are frozen the moment a
 * session is finalized (D32) — amendments are append-only and change nothing
 * in the database. This function is the single place (used by the report
 * mapper, 5.9.3, and the replacement rule, 5.1) that folds an excluding
 * amendment into the *displayed* eligibility: any amendment with
 * `excludeFromReport: true` forces `eligible: false` and appends
 * `'excluded_by_amendment'` once, after whatever reasons were already
 * stored. An attempt with no excluding amendment is returned unchanged.
 *
 * `eligible: null` (a practice session, which is never evaluated for
 * eligibility) stays `null` even when excluded — exclusion can only turn a
 * benchmark's `true` into `false`, never invent a benchmark-shaped value for
 * a practice session.
 */
export function applyAmendmentExclusion(
  stored: StoredEligibility,
  amendments: readonly AmendmentExclusionInput[],
): AmendmentExclusionResult {
  const excluded = amendments.some((amendment) => amendment.excludeFromReport)

  if (!excluded) {
    return { eligible: stored.eligible, exclusionReasons: [...stored.exclusionReasons] }
  }

  const exclusionReasons: ExclusionReason[] = stored.exclusionReasons.includes(
    'excluded_by_amendment',
  )
    ? [...stored.exclusionReasons]
    : [...stored.exclusionReasons, 'excluded_by_amendment']

  return {
    eligible: stored.eligible === null ? null : false,
    exclusionReasons,
  }
}
