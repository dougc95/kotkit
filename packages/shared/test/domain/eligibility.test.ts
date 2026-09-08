import { describe, expect, it } from 'vitest'
import {
  applyAmendmentExclusion,
  evaluateEligibility,
  type EligibilityInput,
} from '../../src/domain/eligibility.js'

/** Every condition satisfied: the attempt this base describes is eligible. */
function baseInput(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    completeInterval: true,
    recallLockedAt: '2026-09-06T12:20:00.000Z',
    recallScores: [1, 1, 1, 1, 1],
    episodeCount: 2,
    materiallyDisrupted: false,
    timerQuality: 'ok',
    sessionLocalDate: '2026-09-06',
    slotAssignedLocalDate: '2026-09-06',
    excludedByAmendment: false,
    realm: 'demo',
    timeSource: 'measured',
    ...overrides,
  }
}

describe('domain/eligibility: evaluateEligibility', () => {
  it('all conditions met → eligible with []', () => {
    expect(evaluateEligibility(baseInput())).toEqual({ eligible: true, exclusionReasons: [] })
  })

  it('interval_incomplete alone: completeInterval false', () => {
    expect(evaluateEligibility(baseInput({ completeInterval: false }))).toEqual({
      eligible: false,
      exclusionReasons: ['interval_incomplete'],
    })
  })

  it('recall_missing alone: recallLockedAt null', () => {
    expect(evaluateEligibility(baseInput({ recallLockedAt: null }))).toEqual({
      eligible: false,
      exclusionReasons: ['recall_missing'],
    })
  })

  it('scoring_incomplete alone: recallScores null', () => {
    expect(evaluateEligibility(baseInput({ recallScores: null }))).toEqual({
      eligible: false,
      exclusionReasons: ['scoring_incomplete'],
    })
  })

  it('count_unknown alone: episodeCount null', () => {
    expect(evaluateEligibility(baseInput({ episodeCount: null }))).toEqual({
      eligible: false,
      exclusionReasons: ['count_unknown'],
    })
  })

  it('materially_disrupted alone: materiallyDisrupted true', () => {
    expect(evaluateEligibility(baseInput({ materiallyDisrupted: true }))).toEqual({
      eligible: false,
      exclusionReasons: ['materially_disrupted'],
    })
  })

  it('timer_uncertain alone: timerQuality uncertain', () => {
    expect(evaluateEligibility(baseInput({ timerQuality: 'uncertain' }))).toEqual({
      eligible: false,
      exclusionReasons: ['timer_uncertain'],
    })
  })

  it('timing_deviation alone: sessionLocalDate ≠ slotAssignedLocalDate', () => {
    expect(evaluateEligibility(baseInput({ sessionLocalDate: '2026-09-07' }))).toEqual({
      eligible: false,
      exclusionReasons: ['timing_deviation'],
    })
  })

  it('excluded_by_amendment alone: excludedByAmendment true', () => {
    expect(evaluateEligibility(baseInput({ excludedByAmendment: true }))).toEqual({
      eligible: false,
      exclusionReasons: ['excluded_by_amendment'],
    })
  })

  it('simulated_time alone: pilot realm with demo_clock time source', () => {
    expect(
      evaluateEligibility(baseInput({ realm: 'pilot', timeSource: 'demo_clock' })),
    ).toEqual({
      eligible: false,
      exclusionReasons: ['simulated_time'],
    })
  })

  it('completeInterval null (timer expired, never confirmed by an end transition) → interval_incomplete — expiry never proves completion', () => {
    expect(evaluateEligibility(baseInput({ completeInterval: null }))).toEqual({
      eligible: false,
      exclusionReasons: ['interval_incomplete'],
    })
  })

  it('early stop plus blank S → [interval_incomplete, count_unknown] in that order', () => {
    expect(
      evaluateEligibility(baseInput({ completeInterval: false, episodeCount: null })),
    ).toEqual({
      eligible: false,
      exclusionReasons: ['interval_incomplete', 'count_unknown'],
    })
  })

  it('incomplete attempt finalized without recall (completeInterval false, recallLockedAt null, recallScores null, S 2) → [interval_incomplete, recall_missing, scoring_incomplete] (D25)', () => {
    expect(
      evaluateEligibility(
        baseInput({
          completeInterval: false,
          recallLockedAt: null,
          recallScores: null,
          episodeCount: 2,
        }),
      ),
    ).toEqual({
      eligible: false,
      exclusionReasons: ['interval_incomplete', 'recall_missing', 'scoring_incomplete'],
    })
  })

  it('explicit 0 for S is not count_unknown and can be eligible', () => {
    expect(evaluateEligibility(baseInput({ episodeCount: 0 }))).toEqual({
      eligible: true,
      exclusionReasons: [],
    })
  })

  it('E=2 with materiallyDisrupted=false adds no reason (E is not an input)', () => {
    // External interruption count has no field on EligibilityInput at all —
    // it can never disqualify an attempt on its own.
    expect(evaluateEligibility(baseInput({ materiallyDisrupted: false }))).toEqual({
      eligible: true,
      exclusionReasons: [],
    })
  })

  it('demo realm with demo_clock never yields simulated_time', () => {
    expect(evaluateEligibility(baseInput({ realm: 'demo', timeSource: 'demo_clock' }))).toEqual({
      eligible: true,
      exclusionReasons: [],
    })
  })

  it('pilot with attested → simulated_time', () => {
    expect(evaluateEligibility(baseInput({ realm: 'pilot', timeSource: 'attested' }))).toEqual({
      eligible: false,
      exclusionReasons: ['simulated_time'],
    })
  })

  it('baseline B completed on Day 1 (date ≠ slot date) → timing_deviation only', () => {
    expect(
      evaluateEligibility(
        baseInput({ sessionLocalDate: '2026-09-07', slotAssignedLocalDate: '2026-09-06' }),
      ),
    ).toEqual({
      eligible: false,
      exclusionReasons: ['timing_deviation'],
    })
  })

  it('final A on Day 15 → timing_deviation only', () => {
    expect(
      evaluateEligibility(
        baseInput({ sessionLocalDate: '2026-09-21', slotAssignedLocalDate: '2026-09-20' }),
      ),
    ).toEqual({
      eligible: false,
      exclusionReasons: ['timing_deviation'],
    })
  })

  it('amendment exclusion keeps every other input untouched (original values not needed to exclude)', () => {
    expect(evaluateEligibility(baseInput({ excludedByAmendment: true }))).toEqual({
      eligible: false,
      exclusionReasons: ['excluded_by_amendment'],
    })
  })
})

describe('domain/eligibility: applyAmendmentExclusion', () => {
  it('no amendments → unchanged', () => {
    expect(
      applyAmendmentExclusion({ eligible: true, exclusionReasons: [] }, []),
    ).toEqual({ eligible: true, exclusionReasons: [] })
  })

  it('explaining amendment only → unchanged', () => {
    expect(
      applyAmendmentExclusion(
        { eligible: true, exclusionReasons: [] },
        [{ excludeFromReport: false }],
      ),
    ).toEqual({ eligible: true, exclusionReasons: [] })
  })

  it('excluding amendment → eligible false and excluded_by_amendment appended once', () => {
    expect(
      applyAmendmentExclusion(
        { eligible: true, exclusionReasons: [] },
        [{ excludeFromReport: true }],
      ),
    ).toEqual({ eligible: false, exclusionReasons: ['excluded_by_amendment'] })
  })

  it("already ineligible with count_unknown + excluded → ['count_unknown','excluded_by_amendment']", () => {
    expect(
      applyAmendmentExclusion(
        { eligible: false, exclusionReasons: ['count_unknown'] },
        [{ excludeFromReport: true }],
      ),
    ).toEqual({ eligible: false, exclusionReasons: ['count_unknown', 'excluded_by_amendment'] })
  })

  it('two excluding amendments → reason appears once', () => {
    expect(
      applyAmendmentExclusion(
        { eligible: true, exclusionReasons: [] },
        [{ excludeFromReport: true }, { excludeFromReport: true }],
      ),
    ).toEqual({ eligible: false, exclusionReasons: ['excluded_by_amendment'] })
  })

  it('eligible null (practice) stays null', () => {
    expect(
      applyAmendmentExclusion(
        { eligible: null, exclusionReasons: [] },
        [{ excludeFromReport: true }],
      ),
    ).toEqual({ eligible: null, exclusionReasons: ['excluded_by_amendment'] })
  })
})
