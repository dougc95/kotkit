/**
 * 5.8.2 — unit tests for the pure practice-finalize pieces of
 * `finalizeSession` (`services/review.ts`): `assertPracticeReviewInput`
 * (required `outputQuality`, `countMethod`-with-`episodeCount`, and the
 * benchmark-only-field rejection) and `practiceReviewPatch` (the D7.1 count
 * mapping and the D20 guarantee that a practice attempt never carries an
 * eligibility-shaped field). No database import — covered end to end by API
 * integration in `test/sessions/finalize-practice.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import type { ReviewInputValue } from '@attention-lab/shared'
import {
  assertPracticeReviewInput,
  practiceReviewPatch,
} from '../../src/services/review.js'
import { DomainError, MalformedError } from '../../src/errors.js'

function baseReview(overrides: Partial<ReviewInputValue> = {}): ReviewInputValue {
  return { outputQuality: 'yes', ...overrides }
}

describe('practiceReviewPatch — count mapping (D7.1)', () => {
  it('absent counts map to null', () => {
    const patch = practiceReviewPatch(baseReview())

    expect(patch.episodeCount).toBeNull()
    expect(patch.countMethod).toBeNull()
    expect(patch.externalCount).toBeNull()
    expect(patch.unplannedAgentChecks).toBeNull()
    expect(patch.mindWanderingCount).toBeNull()
    expect(patch.outputNote).toBeNull()
    expect(patch.outputQuality).toBe('yes')
  })

  it('explicit 0 maps to 0', () => {
    const patch = practiceReviewPatch(
      baseReview({
        episodeCount: 0,
        countMethod: 'event',
        externalCount: 0,
        unplannedAgentChecks: 0,
        mindWanderingCount: 0,
      }),
    )

    expect(patch.episodeCount).toBe(0)
    expect(patch.countMethod).toBe('event')
    expect(patch.externalCount).toBe(0)
    expect(patch.unplannedAgentChecks).toBe(0)
    expect(patch.mindWanderingCount).toBe(0)
  })
})

describe('assertPracticeReviewInput (D19)', () => {
  it('outputQuality missing → field error naming outputQuality', () => {
    try {
      assertPracticeReviewInput({})
      throw new Error('expected assertPracticeReviewInput to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(MalformedError)
      const malformed = err as MalformedError
      expect(malformed.code).toBe('malformed_request')
      expect(malformed.fieldErrors).toEqual({ outputQuality: 'is required' })
    }
  })

  it('recallScores on practice → benchmark_only_field', () => {
    try {
      assertPracticeReviewInput(baseReview({ recallScores: [1, 1, 1, 1, 1] }))
      throw new Error('expected assertPracticeReviewInput to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError)
      const domain = err as DomainError
      expect(domain.code).toBe('benchmark_only_field')
      expect(domain.fieldErrors).toEqual({ recallScores: 'is not accepted for a practice session' })
    }

    // Every other benchmark-only field is rejected the same way.
    for (const [field, value] of [
      ['materiallyDisrupted', true],
      ['disruptionNote', 'noisy room'],
      ['conditions', { deviceFormat: null, language: null, materialLevel: null, accommodations: [] }],
      ['firstSwitchEstimateSeconds', 300],
    ] as const) {
      expect(() => assertPracticeReviewInput(baseReview({ [field]: value } as Partial<ReviewInputValue>))).toThrow(
        DomainError,
      )
    }
  })

  it('countMethod required with episodeCount', () => {
    try {
      assertPracticeReviewInput(baseReview({ episodeCount: 3 }))
      throw new Error('expected assertPracticeReviewInput to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(MalformedError)
      expect((err as MalformedError).fieldErrors).toEqual({ countMethod: 'is required' })
    }

    // Explicit 0 is a real report too — still requires a method.
    expect(() => assertPracticeReviewInput(baseReview({ episodeCount: 0 }))).toThrow(MalformedError)

    // countMethod supplied → passes.
    expect(() => assertPracticeReviewInput(baseReview({ episodeCount: 3, countMethod: 'retrospective' }))).not.toThrow()

    // A blank (null) episodeCount is not "present" — no countMethod required.
    expect(() => assertPracticeReviewInput(baseReview({ episodeCount: null }))).not.toThrow()

    // And a review with no benchmark-only fields and outputQuality set never throws.
    expect(() => assertPracticeReviewInput(baseReview())).not.toThrow()
  })
})

describe('practiceReviewPatch — no eligibility-shaped field (D20)', () => {
  it('practice never yields an eligibility value', () => {
    const patch = practiceReviewPatch(baseReview({ episodeCount: 2, countMethod: 'event' }))

    expect(patch).not.toHaveProperty('eligible')
    expect(patch).not.toHaveProperty('exclusionReasons')
    expect(patch).not.toHaveProperty('firstSwitchKind')
    expect(patch).not.toHaveProperty('firstSwitchSeconds')
    expect(patch).not.toHaveProperty('recallScore')
    expect(patch).not.toHaveProperty('recallScores')
    expect(Object.keys(patch).sort()).toEqual(
      [
        'countMethod',
        'episodeCount',
        'externalCount',
        'mindWanderingCount',
        'outputNote',
        'outputQuality',
        'unplannedAgentChecks',
      ].sort(),
    )
  })
})
