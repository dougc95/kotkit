/**
 * 5.7.2 — unit tests for the pure decision core of `lockRecall`
 * (`decideRecallLock` — `services/review.ts`). Pure — no database, fake
 * `ctx.now`. Covered end to end by API integration in
 * `test/sessions/recall.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import type { RecallBodyValue } from '@attention-lab/shared'
import {
  decideRecallLock,
  type RecallReviewLike,
  type RecallSessionLike,
} from '../../src/services/review.js'
import { ConflictError, DomainError } from '../../src/errors.js'

const ENDED_AT = new Date('2026-09-06T10:20:00.000Z')
const NOW = new Date('2026-09-06T10:25:00.000Z')

const POINTS: RecallBodyValue['points'] = ['p1', 'p2', 'p3', 'p4', 'p5']

function baseSession(overrides: Partial<RecallSessionLike> = {}): RecallSessionLike {
  return {
    kind: 'benchmark',
    lifecycle: 'awaiting_review',
    endedAt: ENDED_AT,
    ...overrides,
  }
}

function baseReview(overrides: Partial<RecallReviewLike> = {}): RecallReviewLike {
  return {
    recallPoints: null,
    recallLockedAt: null,
    ...overrides,
  }
}

function baseBody(overrides: Partial<RecallBodyValue> = {}): RecallBodyValue {
  return {
    points: POINTS,
    startedAt: new Date(ENDED_AT.getTime() + 40_000).toISOString(),
    durationSeconds: 60,
    ...overrides,
  }
}

describe('decideRecallLock — delay in whole seconds (2.3.2)', () => {
  it('delay computed via the shared recallDelaySeconds in whole seconds', () => {
    // 40.7s after ended_at must floor to 40, never round or truncate toward
    // the wrong boundary.
    const body = baseBody({ startedAt: new Date(ENDED_AT.getTime() + 40_700).toISOString() })
    const decision = decideRecallLock(baseSession(), baseReview(), body, NOW)
    expect(decision.kind).toBe('lock')
    if (decision.kind !== 'lock') throw new Error('expected lock')
    expect(decision.recallDelaySeconds).toBe(40)
  })
})

describe('decideRecallLock — flags (2.3.2)', () => {
  it('flags come from the shared deriveRecallFlags', () => {
    const startedAt = new Date(ENDED_AT.getTime() + 700_000) // > 600s delay flag
    const body = baseBody({ startedAt: startedAt.toISOString(), durationSeconds: 300 }) // > 210s overrun
    const now = new Date(startedAt.getTime() + 1_000)
    const decision = decideRecallLock(baseSession(), baseReview(), body, now)
    expect(decision.kind).toBe('lock')
    if (decision.kind !== 'lock') throw new Error('expected lock')
    expect(decision.recallFlags).toEqual(['recall_delayed', 'recall_overrun'])
  })
})

describe('decideRecallLock — state-based lock, independent of the idempotency key', () => {
  it('same points after lock → replay without touching recall_locked_at', () => {
    const lockedAt = new Date(ENDED_AT.getTime() + 50_000)
    const review = baseReview({ recallPoints: POINTS, recallLockedAt: lockedAt })
    const decision = decideRecallLock(baseSession(), review, baseBody(), NOW)
    expect(decision).toEqual({ kind: 'replay' })
  })

  it('different points after lock → RecallLockedError', () => {
    const lockedAt = new Date(ENDED_AT.getTime() + 50_000)
    const review = baseReview({ recallPoints: POINTS, recallLockedAt: lockedAt })
    const body = baseBody({ points: ['p1', 'DIFFERENT', 'p3', 'p4', 'p5'] })
    try {
      decideRecallLock(baseSession(), review, body, NOW)
      throw new Error('expected decideRecallLock to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError)
      expect((err as ConflictError).code).toBe('recall_locked')
    }
  })
})

describe('decideRecallLock — benchmark only', () => {
  it('practice kind → BenchmarkOnlyError', () => {
    try {
      decideRecallLock(baseSession({ kind: 'practice' }), baseReview(), baseBody(), NOW)
      throw new Error('expected decideRecallLock to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError)
      expect((err as DomainError).code).toBe('benchmark_only')
    }
  })
})

describe('decideRecallLock — startedAt range (D27)', () => {
  it("startedAt before ended_at → recall_before_interval_end (delegates to recallDelaySeconds' throw)", () => {
    const body = baseBody({ startedAt: new Date(ENDED_AT.getTime() - 5_000).toISOString() })
    try {
      decideRecallLock(baseSession(), baseReview(), body, NOW)
      throw new Error('expected decideRecallLock to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError)
      expect((err as DomainError).code).toBe('recall_before_interval_end')
    }
  })

  it('startedAt after ctx.now → recall_before_interval_end', () => {
    const body = baseBody({ startedAt: new Date(NOW.getTime() + 5_000).toISOString() })
    try {
      decideRecallLock(baseSession(), baseReview(), body, NOW)
      throw new Error('expected decideRecallLock to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError)
      expect((err as DomainError).code).toBe('recall_before_interval_end')
    }
  })
})
