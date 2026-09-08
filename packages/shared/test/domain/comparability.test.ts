import { describe, expect, it } from 'vitest'
import { comparabilityWarnings, type SlotKey } from '../../src/domain/comparison.js'
import type { AttemptSummary, BenchmarkPhase, ObservedConditions, SlotLabel } from '../../src/domain/types.js'

function conditions(overrides: Partial<ObservedConditions> = {}): ObservedConditions {
  return {
    deviceFormat: 'laptop',
    language: 'en',
    materialLevel: 'B1',
    accommodations: [],
    ...overrides,
  }
}

function attemptOf(
  phase: BenchmarkPhase,
  label: SlotLabel,
  conditionsOverrides: Partial<ObservedConditions> = {},
): AttemptSummary {
  return {
    attemptId: `${phase}-${label}`,
    phase,
    label,
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
    conditions: conditions(conditionsOverrides),
    localDate: '2026-09-06',
  }
}

function candidatesOf(
  overrides: {
    baselineA?: Partial<ObservedConditions>
    baselineB?: Partial<ObservedConditions>
    finalA?: Partial<ObservedConditions>
    finalB?: Partial<ObservedConditions>
  } = {},
): Record<SlotKey, AttemptSummary | null> {
  return {
    'baseline:A': attemptOf('baseline', 'A', overrides.baselineA),
    'baseline:B': attemptOf('baseline', 'B', overrides.baselineB),
    'final:A': attemptOf('final', 'A', overrides.finalA),
    'final:B': attemptOf('final', 'B', overrides.finalB),
  }
}

describe('domain/comparison: comparabilityWarnings', () => {
  it('final A has increased_font_size, baseline A has none → one warning for A naming accommodations', () => {
    const candidates = candidatesOf({ finalA: { accommodations: ['increased_font_size'] } })
    const warnings = comparabilityWarnings(candidates)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ label: 'A', field: 'accommodations' })
    expect(warnings[0]!.message).toContain('increased_font_size')
  })

  it('final B language differs → one warning naming language with both values', () => {
    const candidates = candidatesOf({ finalB: { language: 'es' } })
    const warnings = comparabilityWarnings(candidates)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ label: 'B', field: 'language', baseline: 'en', final: 'es' })
    expect(warnings[0]!.message).toContain('en')
    expect(warnings[0]!.message).toContain('es')
  })

  it('identical conditions → []', () => {
    expect(comparabilityWarnings(candidatesOf())).toEqual([])
  })

  it('materialLevel null at baseline, "B2" at final → warning mentioning not recorded', () => {
    const candidates = candidatesOf({
      baselineA: { materialLevel: null },
      finalA: { materialLevel: 'B2' },
    })
    const warnings = comparabilityWarnings(candidates)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ label: 'A', field: 'materialLevel' })
    expect(warnings[0]!.message).toContain('not recorded')
  })

  it('same accommodations in different order → no warning', () => {
    const candidates = candidatesOf({
      baselineA: { accommodations: ['screen_reader', 'high_contrast'] },
      finalA: { accommodations: ['high_contrast', 'screen_reader'] },
    })
    expect(comparabilityWarnings(candidates)).toEqual([])
  })

  it('missing final candidate → no warnings for that label', () => {
    const candidates = candidatesOf({ finalA: { language: 'es' } })
    candidates['final:A'] = null
    const warnings = comparabilityWarnings(candidates)
    expect(warnings.find((w) => w.label === 'A')).toBeUndefined()
  })

  it('warnings computed for inputs leave every eligible/exclusionReasons value untouched (deep-equal before and after; pure)', () => {
    const candidates = candidatesOf({ finalB: { language: 'es' } })
    const before = structuredClone(candidates)
    comparabilityWarnings(candidates)
    expect(candidates).toEqual(before)
  })
})
