import { describe, expect, it } from 'vitest'
import {
  ACCOMMODATIONS,
  EXCLUSION_REASON_COPY,
  FIRST_SWITCH_CAP_SECONDS,
  RealmMixingError,
  assertSameRealm,
  isReported,
  type AttemptSummary,
  type ExclusionReason,
} from '../src/index.js'

function baseAttempt(overrides: Partial<AttemptSummary>): AttemptSummary {
  return {
    attemptId: 'a1',
    phase: 'baseline',
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
    ...overrides,
  }
}

describe('packages/shared barrel', () => {
  it('exports assertSameRealm, isReported and FIRST_SWITCH_CAP_SECONDS', () => {
    expect(typeof assertSameRealm).toBe('function')
    expect(typeof isReported).toBe('function')
    expect(typeof FIRST_SWITCH_CAP_SECONDS).toBe('number')
  })

  it('mixing demo and pilot attempts throws RealmMixingError with the fixed message', () => {
    const demo = baseAttempt({ realm: 'demo' })
    const pilot = baseAttempt({ realm: 'pilot' })
    expect(() => assertSameRealm([demo, pilot])).toThrow(RealmMixingError)
    expect(() => assertSameRealm([demo, pilot])).toThrow(
      'Simulated and real results are never combined.',
    )
  })

  it('isReported distinguishes null (not reported) from an explicit zero', () => {
    expect(isReported(null)).toBe(false)
    expect(isReported(0)).toBe(true)
  })

  it('FIRST_SWITCH_CAP_SECONDS is exactly 20 minutes', () => {
    expect(FIRST_SWITCH_CAP_SECONDS).toBe(1200)
  })

  it('EXCLUSION_REASON_COPY has an entry for every ExclusionReason', () => {
    const reasons: ExclusionReason[] = [
      'interval_incomplete',
      'recall_missing',
      'scoring_incomplete',
      'count_unknown',
      'materially_disrupted',
      'timer_uncertain',
      'timing_deviation',
      'excluded_by_amendment',
      'simulated_time',
    ]
    for (const reason of reasons) {
      expect(typeof EXCLUSION_REASON_COPY[reason]).toBe('string')
      expect(EXCLUSION_REASON_COPY[reason].length).toBeGreaterThan(0)
    }
  })

  it('ACCOMMODATIONS is a fixed, non-empty list of accommodation kinds', () => {
    expect(ACCOMMODATIONS.length).toBeGreaterThan(0)
    expect(ACCOMMODATIONS).toContain('screen_reader')
  })
})
