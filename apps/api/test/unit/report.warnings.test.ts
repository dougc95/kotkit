/**
 * Task 6.2.3 — pure-function unit tests for `services/report/warnings.ts`'s
 * `reportWarnings`. No database; every case below is composed entirely from
 * plain `AttemptValue` fixture objects.
 */
import { describe, expect, it } from 'vitest'
import type { AttemptValue } from '@attention-lab/shared'

import { reportWarnings } from '../../src/services/report/warnings.js'

function baseAttempt(overrides: Partial<AttemptValue> = {}): AttemptValue {
  return {
    attemptId: 'attempt-1',
    phase: 'baseline',
    label: 'A',
    realm: 'demo',
    timeSource: 'measured',
    eligible: true,
    exclusionReasons: [],
    episodeCount: 4,
    recallScore: 4,
    firstSwitch: { kind: 'known', seconds: 300 },
    externalCount: 1,
    unplannedAgentChecks: 0,
    countMethod: 'event',
    conditions: { deviceFormat: 'laptop', language: 'en', materialLevel: 'intermediate', accommodations: [] },
    localDate: '2026-01-01',
    lifecycle: 'finalized',
    replacementReason: null,
    recallFlags: [],
    revisionId: 'revision-1',
    mindWanderingCount: 1,
    materiallyDisrupted: false,
    timerQuality: 'ok',
    excludedByAmendment: false,
    ...overrides,
  }
}

describe('services/report/warnings: reportWarnings (unit)', () => {
  it("language en vs es on label B → exactly one warning { label: 'B', field: 'language', baseline: 'en', final: 'es' } with a message naming both", () => {
    const baselineB = baseAttempt({ attemptId: 'baseline-b', phase: 'baseline', label: 'B' })
    const finalB = baseAttempt({
      attemptId: 'final-b',
      phase: 'final',
      label: 'B',
      conditions: { deviceFormat: 'laptop', language: 'es', materialLevel: 'intermediate', accommodations: [] },
    })

    const warnings = reportWarnings([baselineB, finalB])

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ label: 'B', field: 'language', baseline: 'en', final: 'es' })
    expect(warnings[0]?.message).toContain('en')
    expect(warnings[0]?.message).toContain('es')
  })

  it('final A adds increased_font_size → warning field accommodations naming increased_font_size', () => {
    const baselineA = baseAttempt({ attemptId: 'baseline-a', phase: 'baseline', label: 'A' })
    const finalA = baseAttempt({
      attemptId: 'final-a',
      phase: 'final',
      label: 'A',
      conditions: {
        deviceFormat: 'laptop',
        language: 'en',
        materialLevel: 'intermediate',
        accommodations: ['increased_font_size'],
      },
    })

    const warnings = reportWarnings([baselineA, finalA])

    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.field).toBe('accommodations')
    expect(warnings[0]?.message).toContain('increased_font_size')
  })

  it('an amendment-excluded final B (eligible false) is not compared and the eligible replacement is', () => {
    const baselineB = baseAttempt({ attemptId: 'baseline-b', phase: 'baseline', label: 'B' })
    const excludedFinalB = baseAttempt({
      attemptId: 'excluded-final-b',
      phase: 'final',
      label: 'B',
      eligible: false,
      exclusionReasons: ['excluded_by_amendment'],
      excludedByAmendment: true,
      conditions: { deviceFormat: 'laptop', language: 'de', materialLevel: 'intermediate', accommodations: [] },
    })
    const replacementFinalB = baseAttempt({
      attemptId: 'replacement-final-b',
      phase: 'final',
      label: 'B',
      conditions: { deviceFormat: 'laptop', language: 'en', materialLevel: 'intermediate', accommodations: [] },
    })

    const warnings = reportWarnings([baselineB, excludedFinalB, replacementFinalB])

    expect(warnings.some((warning) => warning.label === 'B')).toBe(false)
  })

  it("baseline materialLevel null vs final 'B2' → warning with baseline null and a 'not recorded' message, not suppressed", () => {
    const baselineA = baseAttempt({
      attemptId: 'baseline-a',
      phase: 'baseline',
      label: 'A',
      conditions: { deviceFormat: 'laptop', language: 'en', materialLevel: null, accommodations: [] },
    })
    const finalA = baseAttempt({
      attemptId: 'final-a',
      phase: 'final',
      label: 'A',
      conditions: { deviceFormat: 'laptop', language: 'en', materialLevel: 'B2', accommodations: [] },
    })

    const warnings = reportWarnings([baselineA, finalA])

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ label: 'A', field: 'materialLevel', baseline: null, final: 'B2' })
    expect(warnings[0]?.message).toContain('not recorded')
  })

  it('input attempt objects are deep-equal before and after the call (eligible/exclusionReasons untouched) and a label with no eligible attempt on one side yields no warning', () => {
    const baselineA = baseAttempt({ attemptId: 'baseline-a', phase: 'baseline', label: 'A' })
    const attempts = [baselineA]
    const before = structuredClone(attempts)

    const warnings = reportWarnings(attempts)

    expect(warnings).toEqual([])
    expect(attempts).toEqual(before)
    expect(attempts[0]?.eligible).toBe(before[0]?.eligible)
    expect(attempts[0]?.exclusionReasons).toEqual(before[0]?.exclusionReasons)
  })
})
