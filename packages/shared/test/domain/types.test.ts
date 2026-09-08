import { describe, expect, it } from 'vitest'
import * as domain from '../../src/domain/types.js'
import {
  CHECKIN_STATUSES,
  DEMO_SCENARIO_NAMES,
  EXCLUSION_REASON_COPY,
  EXCLUSION_REASONS,
  RESULT_STATES,
  RealmMixingError,
  assertSameRealm,
  type AttemptSummary,
} from '../../src/domain/types.js'

function baseAttempt(overrides: Partial<AttemptSummary> = {}): AttemptSummary {
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

describe('domain/types const arrays', () => {
  it('EXCLUSION_REASONS is exactly the key set of EXCLUSION_REASON_COPY (same length, same members)', () => {
    const copyKeys = Object.keys(EXCLUSION_REASON_COPY).sort()
    const reasons = [...EXCLUSION_REASONS].sort()
    expect(reasons.length).toBe(copyKeys.length)
    expect(reasons).toEqual(copyKeys)
  })

  it('RESULT_STATES is in the D7.4 precedence order', () => {
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

  it('DEMO_SCENARIO_NAMES has the eight PRD §6 names in that order', () => {
    expect(DEMO_SCENARIO_NAMES).toEqual([
      'new-user',
      'working-day',
      'comparable-change',
      'mixed-result',
      'missing-final',
      'zero-baseline',
      'recovery',
      'timing-deviation',
    ])
  })

  it('every const array has no duplicates and CHECKIN_STATUSES is exactly complete/incomplete/not_reported', () => {
    const constArrays = Object.entries(domain).filter(([, value]) => Array.isArray(value)) as [
      string,
      readonly unknown[],
    ][]
    expect(constArrays.length).toBeGreaterThan(0)
    for (const [name, arr] of constArrays) {
      const unique = new Set(arr)
      expect(unique.size, `${name} has a duplicate entry`).toBe(arr.length)
    }
    expect(CHECKIN_STATUSES).toEqual(['complete', 'incomplete', 'not_reported'])
  })

  it('the module exports no function whose name matches /orZero|zeroIf|defaultZero|toZero/i (no coalescing helper)', () => {
    const bannedNamePattern = /orZero|zeroIf|defaultZero|toZero/i
    const offendingExports = Object.entries(domain)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name)
      .filter((name) => bannedNamePattern.test(name))
    expect(offendingExports).toEqual([])
  })

  it('assertSameRealm returns null for [], returns the realm for a same-realm list, and throws RealmMixingError (name and message mention simulated and real) for demo + pilot', () => {
    expect(assertSameRealm([])).toBeNull()
    expect(assertSameRealm([baseAttempt(), baseAttempt()])).toBe('demo')

    const demo = baseAttempt({ realm: 'demo' })
    const pilot = baseAttempt({ realm: 'pilot' })
    expect(() => assertSameRealm([demo, pilot])).toThrow(RealmMixingError)
    try {
      assertSameRealm([demo, pilot])
      expect.fail('expected assertSameRealm to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(RealmMixingError)
      expect((err as Error).name).toBe('RealmMixingError')
      expect((err as Error).message.toLowerCase()).toContain('simulated')
      expect((err as Error).message.toLowerCase()).toContain('real')
    }
  })

  it('assertSameRealm accepts mixed row shapes (an AttemptSummary and a bare {realm} program row) with the same realm', () => {
    const attempt = baseAttempt({ realm: 'pilot' })
    const programRow = { realm: 'pilot' as const }
    expect(assertSameRealm([attempt, programRow])).toBe('pilot')
  })
})
