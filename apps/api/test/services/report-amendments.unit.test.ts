/**
 * Task 5.9.3 — pure-function unit tests, no database, over the two shared
 * pieces that already carry the D32 amendment-exclusion overlay into their
 * respective call sites: `mapAttemptRow` (`services/report/attempts.ts`,
 * task 6.2.1 — the report's row-to-`AttemptSummary` mapper) and
 * `checkSlotStart` (`services/slotAttempts.ts`, task 5.1.2 — the benchmark
 * replacement rule). Both already call the shared `applyAmendmentExclusion`
 * (5.9.2) or read its caller-supplied `excludedByAmendment` flag; this file
 * is the task-5.9.3 confirmation that the two call sites agree with each
 * other and with 5.9.2's own contract, per row fixtures rather than a live
 * database (the database-backed confirmation is
 * `test/sessions/amendment-exclusion.test.ts`).
 */
import { describe, expect, it } from 'vitest'

import { mapAttemptRow, type AttemptQueryRow } from '../../src/services/report/attempts.js'
import { checkSlotStart, type SlotStartAttempt } from '../../src/services/slotAttempts.js'

function baseRow(overrides: Partial<AttemptQueryRow> = {}): AttemptQueryRow {
  return {
    attemptId: 'attempt-1',
    phase: 'baseline',
    label: 'B',
    realm: 'demo',
    timeSource: 'measured',
    lifecycle: 'finalized',
    localDate: '2026-01-01',
    timerQuality: 'ok',
    revisionId: 'revision-1',
    replacementReason: null,
    storedEligible: true,
    storedExclusionReasons: [],
    episodeCount: 6,
    recallScore: 4,
    countMethod: 'event',
    firstSwitchKind: 'known',
    firstSwitchSeconds: 300,
    firstSwitchMethod: 'event',
    externalCount: 1,
    unplannedAgentChecks: 0,
    mindWanderingCount: 1,
    materiallyDisrupted: false,
    recallFlags: [],
    conditions: { deviceFormat: 'laptop', language: 'en', materialLevel: 'intermediate', accommodations: [] },
    excludedByAmendment: false,
    ...overrides,
  }
}

describe('services/report/attempts + services/slotAttempts: the D32 amendment overlay agrees at both call sites (unit)', () => {
  it('mapper overlays eligible and exclusionReasons only and leaves the other AttemptSummary fields identical', () => {
    const notExcluded = mapAttemptRow(baseRow({ excludedByAmendment: false }))
    const excluded = mapAttemptRow(baseRow({ excludedByAmendment: true }))

    // The two fields the overlay is allowed to change.
    expect(notExcluded.eligible).toBe(true)
    expect(notExcluded.exclusionReasons).toEqual([])
    expect(excluded.eligible).toBe(false)
    expect(excluded.exclusionReasons).toEqual(['excluded_by_amendment'])

    // Every other AttemptSummary field is byte-identical between the two —
    // an excluding amendment never rewrites a stored measurement.
    const { eligible: _e1, exclusionReasons: _r1, excludedByAmendment: _x1, ...restNotExcluded } = notExcluded
    const { eligible: _e2, exclusionReasons: _r2, excludedByAmendment: _x2, ...restExcluded } = excluded
    expect(restExcluded).toEqual(restNotExcluded)
  })

  it('replacement check treats an excluded eligible attempt as replaceable', () => {
    const attempts: readonly SlotStartAttempt[] = [
      { eligible: true, lifecycle: 'finalized', excludedByAmendment: true },
    ]
    const result = checkSlotStart({
      todayLocalDate: '2026-01-15',
      slotAssignedLocalDate: '2026-01-01',
      attempts,
      replacementReason: 'Retaking after exclusion',
    })
    expect(result).toEqual({ ok: true, isReplacement: true })
  })

  it('replacement check still refuses an eligible unamended attempt', () => {
    const attempts: readonly SlotStartAttempt[] = [
      { eligible: true, lifecycle: 'finalized', excludedByAmendment: false },
    ]
    const result = checkSlotStart({
      todayLocalDate: '2026-01-15',
      slotAssignedLocalDate: '2026-01-01',
      attempts,
      replacementReason: 'Trying again',
    })
    expect(result).toEqual({ ok: false, reason: 'eligible_attempt_not_retaken' })
  })
})
