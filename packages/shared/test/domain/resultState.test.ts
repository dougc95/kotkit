import { describe, expect, it } from 'vitest'
import {
  CAUSE_NOTE,
  RESULT_STATE_COPY,
  computeComparison,
  resolveResultState,
  type ComparisonResult,
} from '../../src/domain/comparison.js'
import { RESULT_STATES } from '../../src/domain/types.js'
import type { AttemptSummary } from '../../src/domain/types.js'

/** A fully eligible baseline:A attempt by default; override phase/label/fields per case. */
function attempt(overrides: Partial<AttemptSummary> = {}): AttemptSummary {
  return {
    attemptId: 'a1',
    phase: 'baseline',
    label: 'A',
    realm: 'demo',
    timeSource: 'demo_clock',
    eligible: true,
    exclusionReasons: [],
    episodeCount: 0,
    recallScore: 5,
    firstSwitch: { kind: 'none_capped' },
    externalCount: 0,
    unplannedAgentChecks: 0,
    countMethod: 'event',
    conditions: { deviceFormat: null, language: null, materialLevel: null, accommodations: [] },
    localDate: '2026-09-06',
    ...overrides,
  }
}

/** A hand-built ComparisonResult for cases that don't need computeComparison's full derivation. */
function comparison(overrides: Partial<ComparisonResult> = {}): ComparisonResult {
  return {
    s0: 5,
    s14: 3,
    absoluteChange: 2,
    percentageReduction: 40,
    lowBaseline: false,
    recallBaselineMean: 4,
    recallFinalMean: 4,
    firstSwitches: {
      'baseline:A': { kind: 'none_capped' },
      'baseline:B': { kind: 'none_capped' },
      'final:A': { kind: 'none_capped' },
      'final:B': { kind: 'none_capped' },
    },
    firstSwitchMeanSeconds: null,
    ...overrides,
  }
}

describe('domain/comparison: resolveResultState precedence', () => {
  it('one eligible baseline before Day 15 → baseline_pending', () => {
    expect(
      resolveResultState({
        baselineEligible: 1,
        finalEligible: 0,
        finalAttemptsExist: false,
        day14Finished: false,
        comparison: null,
      }),
    ).toBe('baseline_pending')
  })

  it('two baseline, no finals, Day 14 → final_pending', () => {
    expect(
      resolveResultState({
        baselineEligible: 2,
        finalEligible: 0,
        finalAttemptsExist: false,
        day14Finished: false,
        comparison: null,
      }),
    ).toBe('final_pending')
  })

  it('two baseline, no finals, Day 15 → insufficient_samples (precedence 1/2 over 3)', () => {
    expect(
      resolveResultState({
        baselineEligible: 2,
        finalEligible: 0,
        finalAttemptsExist: false,
        day14Finished: true,
        comparison: null,
      }),
    ).toBe('insufficient_samples')
  })

  it('two baseline, one ineligible final attempt exists, Day 14 → insufficient_samples', () => {
    expect(
      resolveResultState({
        baselineEligible: 2,
        finalEligible: 0,
        finalAttemptsExist: true,
        day14Finished: false,
        comparison: null,
      }),
    ).toBe('insufficient_samples')
  })

  it('one baseline eligible after Day 14 → insufficient_samples, not baseline_pending', () => {
    expect(
      resolveResultState({
        baselineEligible: 1,
        finalEligible: 0,
        finalAttemptsExist: false,
        day14Finished: true,
        comparison: null,
      }),
    ).toBe('insufficient_samples')
  })

  it('PRD missing final (2 baseline, 1 final eligible) → insufficient_samples', () => {
    expect(
      resolveResultState({
        baselineEligible: 2,
        finalEligible: 1,
        finalAttemptsExist: true,
        day14Finished: true,
        comparison: null,
      }),
    ).toBe('insufficient_samples')
  })

  it('0,0 → 0,0 → zero_baseline', () => {
    expect(
      resolveResultState({
        baselineEligible: 2,
        finalEligible: 2,
        finalAttemptsExist: true,
        day14Finished: true,
        comparison: comparison({ s0: 0, s14: 0, percentageReduction: null, absoluteChange: 0 }),
      }),
    ).toBe('zero_baseline')
  })

  it('0 → 1 → zero_baseline, not more_switches', () => {
    expect(
      resolveResultState({
        baselineEligible: 2,
        finalEligible: 2,
        finalAttemptsExist: true,
        day14Finished: true,
        comparison: comparison({ s0: 0, s14: 1, percentageReduction: null, absoluteChange: -1 }),
      }),
    ).toBe('zero_baseline')
  })

  it('3 → 5 → more_switches with message "More switches were reported in the final sessions."', () => {
    const state = resolveResultState({
      baselineEligible: 2,
      finalEligible: 2,
      finalAttemptsExist: true,
      day14Finished: true,
      comparison: comparison({ s0: 3, s14: 5, absoluteChange: -2 }),
    })
    expect(state).toBe('more_switches')
    expect(RESULT_STATE_COPY[state].message).toBe('More switches were reported in the final sessions.')
  })

  it('4 → 4 → unchanged with message "The reported switch count did not change."', () => {
    const state = resolveResultState({
      baselineEligible: 2,
      finalEligible: 2,
      finalAttemptsExist: true,
      day14Finished: true,
      comparison: comparison({ s0: 4, s14: 4, absoluteChange: 0 }),
    })
    expect(state).toBe('unchanged')
    expect(RESULT_STATE_COPY[state].message).toBe('The reported switch count did not change.')
  })

  it('PRD mixed 6,4 → 3,3, recall 4,4 → 2,2 → fewer_switches_lower_recall with message "Switches decreased, but recall was lower. These results are mixed." and headline null', () => {
    const computed = computeComparison([
      attempt({ attemptId: 'bA', phase: 'baseline', label: 'A', episodeCount: 6, recallScore: 4 }),
      attempt({ attemptId: 'bB', phase: 'baseline', label: 'B', episodeCount: 4, recallScore: 4 }),
      attempt({ attemptId: 'fA', phase: 'final', label: 'A', episodeCount: 3, recallScore: 2 }),
      attempt({ attemptId: 'fB', phase: 'final', label: 'B', episodeCount: 3, recallScore: 2 }),
    ])!
    const state = resolveResultState({
      baselineEligible: 2,
      finalEligible: 2,
      finalAttemptsExist: true,
      day14Finished: true,
      comparison: computed,
    })
    expect(state).toBe('fewer_switches_lower_recall')
    expect(RESULT_STATE_COPY[state].message).toBe(
      'Switches decreased, but recall was lower. These results are mixed.',
    )
    expect(RESULT_STATE_COPY[state].headline).toBeNull()
  })

  it('PRD comparable → improvement_maintained_recall with headline "Fewer reported switches", message "You reported fewer switches; recall was maintained." and CAUSE_NOTE non-empty (D38)', () => {
    const computed = computeComparison([
      attempt({ attemptId: 'bA', phase: 'baseline', label: 'A', episodeCount: 6, recallScore: 4 }),
      attempt({ attemptId: 'bB', phase: 'baseline', label: 'B', episodeCount: 4, recallScore: 4 }),
      attempt({ attemptId: 'fA', phase: 'final', label: 'A', episodeCount: 3, recallScore: 4 }),
      attempt({ attemptId: 'fB', phase: 'final', label: 'B', episodeCount: 3, recallScore: 4 }),
    ])!
    const state = resolveResultState({
      baselineEligible: 2,
      finalEligible: 2,
      finalAttemptsExist: true,
      day14Finished: true,
      comparison: computed,
    })
    expect(state).toBe('improvement_maintained_recall')
    expect(RESULT_STATE_COPY[state].headline).toBe('Fewer reported switches')
    expect(RESULT_STATE_COPY[state].message).toBe('You reported fewer switches; recall was maintained.')
    expect(CAUSE_NOTE.length).toBeGreaterThan(0)
  })

  it('no headline, message, action or CAUSE_NOTE contains "attention +", "improved by", "%", "significan" or "confidence"', () => {
    const forbidden = ['attention +', 'improved by', '%', 'significan', 'confidence']
    const allText = [
      CAUSE_NOTE,
      ...Object.values(RESULT_STATE_COPY).flatMap((copy) => [copy.headline ?? '', copy.message, copy.action]),
    ]
    for (const text of allText) {
      for (const bad of forbidden) {
        expect(text.toLowerCase()).not.toContain(bad.toLowerCase())
      }
    }
  })

  it('every ResultState has copy, headline is null for all states except improvement_maintained_recall, and RESULT_STATES order equals the evaluation order (exhaustive satisfies + array equality)', () => {
    for (const state of RESULT_STATES) {
      expect(RESULT_STATE_COPY[state]).toBeDefined()
      if (state === 'improvement_maintained_recall') {
        expect(RESULT_STATE_COPY[state].headline).toBe('Fewer reported switches')
      } else {
        expect(RESULT_STATE_COPY[state].headline).toBeNull()
      }
    }
    expect(RESULT_STATES).toEqual([
      'baseline_pending',
      'final_pending',
      'insufficient_samples',
      'zero_baseline',
      'more_switches',
      'unchanged',
      'fewer_switches_lower_recall',
      'improvement_maintained_recall',
    ])
  })
})
