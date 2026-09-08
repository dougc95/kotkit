/**
 * Task 6.2.1 — pure-function unit tests for `services/report/attempts.ts`:
 * `mapAttemptRow` (the row → widened-attempt mapper) and `finalAttemptsExist`.
 * No database; every case below is composed entirely from plain fixture
 * objects plus the pure shared domain functions `sampleCounts` /
 * `selectSlotCandidates`.
 */
import { describe, expect, it } from 'vitest'
import { sampleCounts, selectSlotCandidates } from '@attention-lab/shared'

import {
  finalAttemptsExist,
  mapAttemptRow,
  type AttemptQueryRow,
} from '../../src/services/report/attempts.js'

function baseRow(overrides: Partial<AttemptQueryRow> = {}): AttemptQueryRow {
  return {
    attemptId: 'attempt-1',
    phase: 'baseline',
    label: 'A',
    realm: 'demo',
    timeSource: 'measured',
    lifecycle: 'finalized',
    localDate: '2026-01-01',
    timerQuality: 'ok',
    revisionId: 'revision-1',
    replacementReason: null,
    storedEligible: true,
    storedExclusionReasons: [],
    episodeCount: 4,
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

describe('services/report/attempts: mapAttemptRow and finalAttemptsExist (unit)', () => {
  it('episode_count NULL → episodeCount null (never 0)', () => {
    const result = mapAttemptRow(baseRow({ episodeCount: null }))
    expect(result.episodeCount).toBeNull()
  })

  it('first_switch_kind none_capped / known(370 s) / unknown map to the three FirstSwitch variants, unknown is not none_capped, NULL kind → null', () => {
    const noneCapped = mapAttemptRow(
      baseRow({ firstSwitchKind: 'none_capped', firstSwitchSeconds: null, firstSwitchMethod: null }),
    )
    expect(noneCapped.firstSwitch).toEqual({ kind: 'none_capped' })

    const known = mapAttemptRow(
      baseRow({ firstSwitchKind: 'known', firstSwitchSeconds: 370, firstSwitchMethod: 'event' }),
    )
    expect(known.firstSwitch).toEqual({ kind: 'known', seconds: 370 })

    const unknown = mapAttemptRow(
      baseRow({ firstSwitchKind: 'unknown', firstSwitchSeconds: null, firstSwitchMethod: null }),
    )
    expect(unknown.firstSwitch).toEqual({ kind: 'unknown' })
    expect(unknown.firstSwitch).not.toEqual({ kind: 'none_capped' })

    const nullKind = mapAttemptRow(
      baseRow({ firstSwitchKind: null, firstSwitchSeconds: null, firstSwitchMethod: null }),
    )
    expect(nullKind.firstSwitch).toBeNull()
  })

  it('exclude_from_report amendment → eligible false with excluded_by_amendment appended, excludedByAmendment true and counts unchanged', () => {
    const result = mapAttemptRow(
      baseRow({
        storedEligible: true,
        storedExclusionReasons: [],
        excludedByAmendment: true,
        episodeCount: 6,
        recallScore: 4,
      }),
    )
    expect(result.eligible).toBe(false)
    expect(result.exclusionReasons).toEqual(['excluded_by_amendment'])
    expect(result.excludedByAmendment).toBe(true)
    expect(result.episodeCount).toBe(6)
    expect(result.recallScore).toBe(4)
  })

  it("unfinalized session (eligible NULL, lifecycle awaiting_review) → eligible false, exclusionReasons [], lifecycle 'awaiting_review', countMethod null", () => {
    const result = mapAttemptRow(
      baseRow({
        storedEligible: null,
        storedExclusionReasons: [],
        lifecycle: 'awaiting_review',
        countMethod: null,
        episodeCount: null,
        firstSwitchKind: null,
        firstSwitchSeconds: null,
        firstSwitchMethod: null,
      }),
    )
    expect(result.eligible).toBe(false)
    expect(result.exclusionReasons).toEqual([])
    expect(result.lifecycle).toBe('awaiting_review')
    expect(result.countMethod).toBeNull()
  })

  it('awaiting_review benchmark whose target elapsed → eligible false and not counted in samples (timer expiry is not completion)', () => {
    const attempt = mapAttemptRow(
      baseRow({ phase: 'baseline', label: 'A', storedEligible: null, lifecycle: 'awaiting_review' }),
    )
    expect(attempt.eligible).toBe(false)
    const samples = sampleCounts(selectSlotCandidates([attempt]))
    expect(samples.baselineEligible).toBe(0)
  })

  it('samples: baseline A eligible + B ineligible → baselineEligible 1', () => {
    const a = mapAttemptRow(baseRow({ label: 'A', storedEligible: true, storedExclusionReasons: [] }))
    const b = mapAttemptRow(
      baseRow({ label: 'B', storedEligible: false, storedExclusionReasons: ['count_unknown'] }),
    )
    const samples = sampleCounts(selectSlotCandidates([a, b]))
    expect(samples.baselineEligible).toBe(1)
  })

  it('phase midpoint attempt is listed in attempts and leaves samples unchanged', () => {
    const baselineA = mapAttemptRow(baseRow({ phase: 'baseline', label: 'A', storedEligible: true }))
    const midpoint = mapAttemptRow(baseRow({ phase: 'midpoint', label: 'A', storedEligible: true }))
    const attempts = [baselineA, midpoint]

    expect(attempts.some((attempt) => attempt.phase === 'midpoint')).toBe(true)

    const samples = sampleCounts(selectSlotCandidates(attempts))
    expect(samples.baselineEligible).toBe(1)
    expect(samples.finalEligible).toBe(0)
  })

  it('finalAttemptsExist is true for a finalized final attempt and false when the only final attempt is abandoned', () => {
    expect(finalAttemptsExist([{ phase: 'final', lifecycle: 'finalized' }])).toBe(true)
    expect(finalAttemptsExist([{ phase: 'final', lifecycle: 'abandoned' }])).toBe(false)
    expect(finalAttemptsExist([{ phase: 'baseline', lifecycle: 'finalized' }])).toBe(false)
  })
})
