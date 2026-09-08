/**
 * 5.1.1 — unit tests for the pure pieces of `POST /sessions`' practice-start
 * path: `governingRevisionFor` (4.1.1, reused verbatim — not
 * re-implemented, D16), `buildPracticeSessionInsert`,
 * `practiceObservedConditions` and `normalizeIntendedOutput`. Pure — no
 * database. Covered end to end by API integration in
 * `test/sessions/start.practice.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { MalformedError } from '../../src/errors.js'
import { governingRevisionFor, type GoverningRevisionCandidate } from '../../src/services/program/programService.js'
import {
  buildPracticeSessionInsert,
  normalizeIntendedOutput,
  practiceObservedConditions,
} from '../../src/services/session.js'

describe('services/session governingRevisionFor (4.1.1, reused by startSession)', () => {
  const revisions: GoverningRevisionCandidate[] = [
    { revision: 1, effectiveDay: 0 },
    { revision: 2, effectiveDay: 5 },
    { revision: 3, effectiveDay: 10 },
  ]

  it('governing revision picks the greatest effective_day <= day', () => {
    expect(governingRevisionFor(revisions, 7)).toEqual({ revision: 2, effectiveDay: 5 })
    expect(governingRevisionFor(revisions, 10)).toEqual({ revision: 3, effectiveDay: 10 })
    expect(governingRevisionFor(revisions, 14)).toEqual({ revision: 3, effectiveDay: 10 })
  })

  it('ties resolve to the highest revision number', () => {
    const tied: GoverningRevisionCandidate[] = [
      { revision: 1, effectiveDay: 0 },
      { revision: 2, effectiveDay: 5 },
      { revision: 3, effectiveDay: 5 },
    ]
    expect(governingRevisionFor(tied, 5)).toEqual({ revision: 3, effectiveDay: 5 })
  })

  it('day before any later revision falls back to revision 1', () => {
    const withLaterRevision: GoverningRevisionCandidate[] = [
      { revision: 1, effectiveDay: 0 },
      { revision: 2, effectiveDay: 8 },
    ]
    expect(governingRevisionFor(withLaterRevision, 3)).toEqual({ revision: 1, effectiveDay: 0 })
  })
})

describe('services/session buildPracticeSessionInsert', () => {
  const baseParams = {
    id: '11111111-1111-4111-8111-111111111111',
    programId: '22222222-2222-4222-8222-222222222222',
    revisionId: '33333333-3333-4333-8333-333333333333',
    localDate: '2026-09-06',
    targetSeconds: 600,
    intendedOutput: 'Draft the outline',
  }

  it('ctx.timeSource measured is stored verbatim on the session (offset 0)', () => {
    const row = buildPracticeSessionInsert({
      ...baseParams,
      ctx: { principalId: 'local-demo', realm: 'demo', now: new Date('2026-09-06T10:00:00.000Z'), timeSource: 'measured' },
    })
    expect(row.timeSource).toBe('measured')
    expect(row.startedAt).toEqual(new Date('2026-09-06T10:00:00.000Z'))
  })

  it('ctx.timeSource demo_clock is stored verbatim (nonzero or negative offset)', () => {
    const advanced = buildPracticeSessionInsert({
      ...baseParams,
      ctx: { principalId: 'local-demo', realm: 'demo', now: new Date('2026-09-06T10:00:00.000Z'), timeSource: 'demo_clock' },
    })
    expect(advanced.timeSource).toBe('demo_clock')

    const rewound = buildPracticeSessionInsert({
      ...baseParams,
      ctx: { principalId: 'local-demo', realm: 'demo', now: new Date('2026-09-01T00:00:00.000Z'), timeSource: 'demo_clock' },
    })
    expect(rewound.timeSource).toBe('demo_clock')
  })
})

describe('services/session practiceObservedConditions', () => {
  it('practice conditions default to all-null fields with empty accommodations', () => {
    expect(practiceObservedConditions(undefined)).toEqual({
      deviceFormat: null,
      language: null,
      materialLevel: null,
      accommodations: [],
    })
  })

})

describe('services/session normalizeIntendedOutput', () => {
  it('normalizeIntendedOutput: whitespace-only is treated as absent, interior whitespace is preserved', () => {
    expect(() => normalizeIntendedOutput(undefined)).toThrow(MalformedError)
    expect(() => normalizeIntendedOutput('')).toThrow(MalformedError)
    expect(() => normalizeIntendedOutput('   ')).toThrow(MalformedError)

    let caught: unknown
    try {
      normalizeIntendedOutput('   ')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(MalformedError)
    expect((caught as MalformedError).code).toBe('malformed_request')
    expect((caught as MalformedError).fieldErrors).toEqual({ intendedOutput: 'is required' })

    expect(normalizeIntendedOutput('  Draft the outline  ')).toBe('Draft the outline')
    expect(normalizeIntendedOutput('  a   b  ')).toBe('a   b')
  })
})
