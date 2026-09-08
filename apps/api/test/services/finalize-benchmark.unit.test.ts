/**
 * 5.8.3 — unit tests for the pure benchmark-finalize pieces of
 * `finalizeSession` (`services/review.ts`): the recall gate
 * (`assertRecallLockedForFinalize`), the disruption attestation requirement
 * (`assertMateriallyDisruptedProvided`), the recall scoring and conditions
 * mapping (`benchmarkReviewPatch`, through the shared `scoreRecall` — named
 * `deriveRecallScore` in the task brief), the `reviewNote` mapping
 * (`reviewNotePatch`), and the D33 auto-activation SQL shape
 * (`autoActivateBaselineReadySql`). No database import — covered end to end
 * by API integration in `test/sessions/finalize-benchmark.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import { StringChunk, type SQL } from 'drizzle-orm'

import type { ObservedConditionsValue, RecallPoints, ReviewInputValue } from '@attention-lab/shared'
import {
  assertMateriallyDisruptedProvided,
  assertRecallLockedForFinalize,
  autoActivateBaselineReadySql,
  benchmarkReviewPatch,
  reviewNotePatch,
  type BenchmarkRecallGateInput,
  type BenchmarkStoredReviewInput,
} from '../../src/services/review.js'
import { DomainError, MalformedError } from '../../src/errors.js'

const RECALL_POINTS: RecallPoints = ['a', 'b', 'c', 'd', 'e']

const EMPTY_CONDITIONS: ObservedConditionsValue = {
  deviceFormat: null,
  language: null,
  materialLevel: null,
  accommodations: [],
}

function baseReview(overrides: Partial<ReviewInputValue> = {}): ReviewInputValue {
  return { materiallyDisrupted: false, ...overrides }
}

function lockedSession(overrides: Partial<BenchmarkRecallGateInput> = {}): BenchmarkRecallGateInput {
  return { completeInterval: true, recallLockedAt: new Date('2026-09-06T09:20:30Z'), ...overrides }
}

function lockedStoredReview(
  overrides: Partial<BenchmarkStoredReviewInput> = {},
): BenchmarkStoredReviewInput {
  return {
    recallPoints: RECALL_POINTS,
    recallLockedAt: new Date('2026-09-06T09:20:30Z'),
    observedConditions: EMPTY_CONDITIONS,
    ...overrides,
  }
}

/** Flattens a tagged `sql\`...\`` template's literal text back to plain text, ignoring interpolated params (mirrors test/db/*.schema.test.ts's own `whereText`). */
function sqlText(query: SQL): string {
  return query.queryChunks
    .map((chunk) => (chunk instanceof StringChunk ? chunk.value.join(' ') : ''))
    .join(' ')
}

describe('finalize-benchmark (5.8.3) — pure unit pieces', () => {
  it('complete_interval true, no recall lock → RecallNotLockedError even with recallScores', () => {
    for (const recallScoresProvided of [false, true]) {
      try {
        assertRecallLockedForFinalize({ completeInterval: true, recallLockedAt: null }, recallScoresProvided)
        throw new Error('expected assertRecallLockedForFinalize to throw')
      } catch (err) {
        expect(err).toBeInstanceOf(DomainError)
        expect((err as DomainError).code).toBe('recall_not_locked')
      }
    }
  })

  it('complete_interval false, no recall lock, recallScores omitted → proceeds (no error)', () => {
    expect(() =>
      assertRecallLockedForFinalize({ completeInterval: false, recallLockedAt: null }, false),
    ).not.toThrow()
  })

  it('complete_interval false, no recall lock, recallScores present → RecallNotLockedError', () => {
    try {
      assertRecallLockedForFinalize({ completeInterval: false, recallLockedAt: null }, true)
      throw new Error('expected assertRecallLockedForFinalize to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError)
      expect((err as DomainError).code).toBe('recall_not_locked')
    }
  })

  it('materiallyDisrupted undefined → field error', () => {
    try {
      assertMateriallyDisruptedProvided({})
      throw new Error('expected assertMateriallyDisruptedProvided to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(MalformedError)
      expect((err as MalformedError).fieldErrors).toEqual({ materiallyDisrupted: 'required' })
    }
    // Either explicit boolean passes.
    expect(() => assertMateriallyDisruptedProvided({ materiallyDisrupted: true })).not.toThrow()
    expect(() => assertMateriallyDisruptedProvided({ materiallyDisrupted: false })).not.toThrow()
  })

  it('recallScores mapped through the shared deriveRecallScore, ok:true stores its recallScores/recallScore', () => {
    const patch = benchmarkReviewPatch(
      lockedSession(),
      baseReview({ recallScores: [1, 1, 0, 1, 0] }),
      lockedStoredReview(),
    )
    expect(patch.recallScores).toEqual([1, 1, 0, 1, 0])
    expect(patch.recallScore).toBe(3)
  })

  it('deriveRecallScore ok:false → recall_score and recall_scores both null', () => {
    // Point index 2 ('c') is non-blank but left unscored (null) — the whole
    // result is unreported, never a partial array (D7.3).
    const patch = benchmarkReviewPatch(
      lockedSession(),
      baseReview({ recallScores: [1, 1, null, 1, 0] }),
      lockedStoredReview(),
    )
    expect(patch.recallScores).toBeNull()
    expect(patch.recallScore).toBeNull()
  })

  it('recallScores absent while locked → recall_score null', () => {
    const patch = benchmarkReviewPatch(lockedSession(), baseReview(), lockedStoredReview())
    expect(patch.recallScore).toBeNull()
    expect(patch.recallScores).toBeNull()
  })

  it('conditions replace the defaulted value', () => {
    const seeded: ObservedConditionsValue = {
      deviceFormat: 'desktop',
      language: 'en',
      materialLevel: 'B1',
      accommodations: [],
    }
    const replacement: ObservedConditionsValue = {
      deviceFormat: 'tablet',
      language: 'es',
      materialLevel: 'B2',
      accommodations: ['increased_font_size'],
    }

    const replaced = benchmarkReviewPatch(
      lockedSession(),
      baseReview({ conditions: replacement }),
      lockedStoredReview({ observedConditions: seeded }),
    )
    expect(replaced.observedConditions).toEqual(replacement)

    // Absent keeps whatever was already stored (the slot's own defaults, D7.5/D31).
    const kept = benchmarkReviewPatch(lockedSession(), baseReview(), lockedStoredReview({ observedConditions: seeded }))
    expect(kept.observedConditions).toEqual(seeded)
  })

  it('outputQuality on benchmark rejected', () => {
    expect(() =>
      benchmarkReviewPatch(lockedSession(), baseReview({ outputQuality: 'yes' }), lockedStoredReview()),
    ).toThrow(DomainError)
    try {
      benchmarkReviewPatch(lockedSession(), baseReview({ outputQuality: 'yes' }), lockedStoredReview())
    } catch (err) {
      expect((err as DomainError).code).toBe('practice_only_field')
    }
    // outputNote is rejected the same way (the mirror image of practice's own benchmark-only-field check).
    expect(() =>
      benchmarkReviewPatch(lockedSession(), baseReview({ outputNote: 'done' }), lockedStoredReview()),
    ).toThrow(DomainError)
  })

  it('reviewNote absent → null, present → stored verbatim', () => {
    expect(reviewNotePatch(baseReview())).toBeNull()
    expect(reviewNotePatch(baseReview({ reviewNote: 'felt distracted by noise' }))).toBe(
      'felt distracted by noise',
    )
  })

  it('auto-activation SQL only targets baseline-phase slots and is a no-op for a final-phase finalize', () => {
    const text = sqlText(autoActivateBaselineReadySql('11111111-1111-1111-1111-111111111111'))

    expect(text).toContain("status = 'active'")
    expect(text).toContain("status = 'baseline_ready'")
    expect(text).toContain("phase = 'baseline'")
    expect(text).toContain("lifecycle = 'finalized'")
    expect(text).toContain('COUNT(DISTINCT bs.label)')
    expect(text).toContain('= 2')
    // Never mentions the final phase at all — a final-phase attempt is never
    // counted toward the 2-label threshold, so finalizing one can never
    // satisfy this WHERE clause on its own.
    expect(text).not.toContain("'final'")
  })
})
