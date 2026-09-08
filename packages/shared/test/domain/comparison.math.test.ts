import { describe, expect, it } from 'vitest'
import { computeComparison, sampleCounts, selectSlotCandidates } from '../../src/domain/comparison.js'
import { RealmMixingError } from '../../src/domain/types.js'
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

describe('domain/comparison: computeComparison math', () => {
  it('comparable change 6,4 → 3,3 with recall 4: s0 5, s14 3, absolute 2, percentage 40, recall 4 → 4', () => {
    const result = computeComparison([
      attempt({ attemptId: 'bA', phase: 'baseline', label: 'A', episodeCount: 6, recallScore: 4 }),
      attempt({ attemptId: 'bB', phase: 'baseline', label: 'B', episodeCount: 4, recallScore: 4 }),
      attempt({ attemptId: 'fA', phase: 'final', label: 'A', episodeCount: 3, recallScore: 4 }),
      attempt({ attemptId: 'fB', phase: 'final', label: 'B', episodeCount: 3, recallScore: 4 }),
    ])!
    expect(result.s0).toBe(5)
    expect(result.s14).toBe(3)
    expect(result.absoluteChange).toBe(2)
    expect(result.percentageReduction).toBe(40)
    expect(result.recallBaselineMean).toBe(4)
    expect(result.recallFinalMean).toBe(4)
  })

  it('zero baseline 0,0 → 0,0: percentageReduction null, absoluteChange 0, every numeric field passes Number.isFinite (no NaN/Infinity/100)', () => {
    const result = computeComparison([
      attempt({ attemptId: 'bA', phase: 'baseline', label: 'A', episodeCount: 0, recallScore: 5 }),
      attempt({ attemptId: 'bB', phase: 'baseline', label: 'B', episodeCount: 0, recallScore: 5 }),
      attempt({ attemptId: 'fA', phase: 'final', label: 'A', episodeCount: 0, recallScore: 5 }),
      attempt({ attemptId: 'fB', phase: 'final', label: 'B', episodeCount: 0, recallScore: 5 }),
    ])!
    expect(result.percentageReduction).toBeNull()
    expect(result.absoluteChange).toBe(0)
    expect(Number.isFinite(result.s0)).toBe(true)
    expect(Number.isFinite(result.s14)).toBe(true)
    expect(Number.isFinite(result.absoluteChange)).toBe(true)
    expect(Number.isFinite(result.recallBaselineMean)).toBe(true)
    expect(Number.isFinite(result.recallFinalMean)).toBe(true)
    expect(result.percentageReduction).not.toBe(100)
  })

  it('low baseline s0 2, s14 1: absoluteChange 1, lowBaseline true', () => {
    const result = computeComparison([
      attempt({ attemptId: 'bA', phase: 'baseline', label: 'A', episodeCount: 2, recallScore: 5 }),
      attempt({ attemptId: 'bB', phase: 'baseline', label: 'B', episodeCount: 2, recallScore: 5 }),
      attempt({ attemptId: 'fA', phase: 'final', label: 'A', episodeCount: 1, recallScore: 5 }),
      attempt({ attemptId: 'fB', phase: 'final', label: 'B', episodeCount: 1, recallScore: 5 }),
    ])!
    expect(result.absoluteChange).toBe(1)
    expect(result.lowBaseline).toBe(true)
  })

  it('two 20+ and two known T → firstSwitchMeanSeconds null', () => {
    const result = computeComparison([
      attempt({ attemptId: 'bA', phase: 'baseline', label: 'A', firstSwitch: { kind: 'none_capped' } }),
      attempt({ attemptId: 'bB', phase: 'baseline', label: 'B', firstSwitch: { kind: 'none_capped' } }),
      attempt({
        attemptId: 'fA',
        phase: 'final',
        label: 'A',
        firstSwitch: { kind: 'known', seconds: 100 },
      }),
      attempt({
        attemptId: 'fB',
        phase: 'final',
        label: 'B',
        firstSwitch: { kind: 'known', seconds: 200 },
      }),
    ])!
    expect(result.firstSwitchMeanSeconds).toBeNull()
  })

  it('four known T → mean', () => {
    const result = computeComparison([
      attempt({
        attemptId: 'bA',
        phase: 'baseline',
        label: 'A',
        firstSwitch: { kind: 'known', seconds: 100 },
      }),
      attempt({
        attemptId: 'bB',
        phase: 'baseline',
        label: 'B',
        firstSwitch: { kind: 'known', seconds: 200 },
      }),
      attempt({
        attemptId: 'fA',
        phase: 'final',
        label: 'A',
        firstSwitch: { kind: 'known', seconds: 300 },
      }),
      attempt({
        attemptId: 'fB',
        phase: 'final',
        label: 'B',
        firstSwitch: { kind: 'known', seconds: 400 },
      }),
    ])!
    expect(result.firstSwitchMeanSeconds).toBe(250)
  })

  it('one eligible final → null and sampleCounts {2,1}', () => {
    const attempts = [
      attempt({ attemptId: 'bA', phase: 'baseline', label: 'A' }),
      attempt({ attemptId: 'bB', phase: 'baseline', label: 'B' }),
      attempt({ attemptId: 'fA', phase: 'final', label: 'A' }),
    ]
    expect(computeComparison(attempts)).toBeNull()
    expect(sampleCounts(selectSlotCandidates(attempts))).toEqual({
      baselineEligible: 2,
      finalEligible: 1,
    })
  })

  it('baseline A eligible, B ineligible → sampleCounts baselineEligible 1', () => {
    const attempts = [
      attempt({ attemptId: 'bA', phase: 'baseline', label: 'A' }),
      attempt({
        attemptId: 'bB',
        phase: 'baseline',
        label: 'B',
        eligible: false,
        exclusionReasons: ['materially_disrupted'],
      }),
    ]
    expect(sampleCounts(selectSlotCandidates(attempts))).toEqual({
      baselineEligible: 1,
      finalEligible: 0,
    })
  })

  it('demo + pilot attempts → RealmMixingError, no partial result', () => {
    const attempts = [
      attempt({ attemptId: 'bA', phase: 'baseline', label: 'A', realm: 'demo' }),
      attempt({
        attemptId: 'bB',
        phase: 'baseline',
        label: 'B',
        realm: 'pilot',
        timeSource: 'measured',
      }),
    ]
    expect(() => computeComparison(attempts)).toThrow(RealmMixingError)
  })

  it('candidate with null episodeCount or null recallScore → throws, never treated as 0', () => {
    const nullEpisode = [
      attempt({ attemptId: 'bA', phase: 'baseline', label: 'A', episodeCount: null }),
      attempt({ attemptId: 'bB', phase: 'baseline', label: 'B' }),
      attempt({ attemptId: 'fA', phase: 'final', label: 'A' }),
      attempt({ attemptId: 'fB', phase: 'final', label: 'B' }),
    ]
    expect(() => computeComparison(nullEpisode)).toThrow()

    const nullRecall = [
      attempt({ attemptId: 'bA', phase: 'baseline', label: 'A', recallScore: null }),
      attempt({ attemptId: 'bB', phase: 'baseline', label: 'B' }),
      attempt({ attemptId: 'fA', phase: 'final', label: 'A' }),
      attempt({ attemptId: 'fB', phase: 'final', label: 'B' }),
    ]
    expect(() => computeComparison(nullRecall)).toThrow()
  })

  it('replacement after disruption: first attempt ineligible, second eligible → second is the slot candidate', () => {
    const disrupted = attempt({
      attemptId: 'bA-1',
      phase: 'baseline',
      label: 'A',
      eligible: false,
      exclusionReasons: ['materially_disrupted'],
    })
    const replacement = attempt({ attemptId: 'bA-2', phase: 'baseline', label: 'A' })
    const candidates = selectSlotCandidates([disrupted, replacement])
    expect(candidates['baseline:A']).toBe(replacement)
  })

  it('amendment-excluded attempt (eligible false, excluded_by_amendment) is never a candidate', () => {
    const excluded = attempt({
      attemptId: 'bA',
      phase: 'baseline',
      label: 'A',
      eligible: false,
      exclusionReasons: ['excluded_by_amendment'],
    })
    const candidates = selectSlotCandidates([excluded])
    expect(candidates['baseline:A']).toBeNull()
  })

  it('two eligible attempts in one slot → throws', () => {
    const a1 = attempt({ attemptId: 'bA-1', phase: 'baseline', label: 'A' })
    const a2 = attempt({ attemptId: 'bA-2', phase: 'baseline', label: 'A' })
    expect(() => selectSlotCandidates([a1, a2])).toThrow()
  })
})

// Type-level only (checked by `tsc`, not one of the 12 runtime tests above):
// a practice row can never masquerade as a benchmark attempt in a comparison.
function _typeOnlyPracticeCannotBeAnAttempt(): void {
  const invalid: AttemptSummary = {
    attemptId: 'x',
    // @ts-expect-error - 'practice' is not a BenchmarkPhase; practice rows cannot enter the comparison
    phase: 'practice',
    label: 'A',
    realm: 'demo',
    timeSource: 'measured',
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
  }
  void invalid
}
void _typeOnlyPracticeCannotBeAnAttempt
