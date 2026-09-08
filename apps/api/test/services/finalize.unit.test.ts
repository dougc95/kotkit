/**
 * 5.8.1 — unit tests for the kind-independent pure pieces of `finalizeSession`
 * (`services/review.ts`): the request-hash coverage, the event-count mismatch
 * error shape, the `lastBatch` duplicate-counting, the lifecycle gate, and its
 * fixed ordering ahead of any `lastBatch` processing. No database import —
 * covered end to end by API integration in
 * `test/sessions/finalize-mechanics.test.ts`.
 */
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import type { EventInputValue, FinalizeBodyValue } from '@attention-lab/shared'
import {
  assertEventCountMatches,
  assertFinalizableLifecycle,
  planFinalizeLastBatch,
} from '../../src/services/review.js'
import { ConflictError, DomainError } from '../../src/errors.js'
import { requestHash } from '../../src/idempotency/requestHash.js'

function offTaskEvent(overrides: Partial<EventInputValue> = {}): EventInputValue {
  return {
    clientEventId: randomUUID(),
    type: 'off_task',
    elapsedMs: 1000,
    occurredAt: new Date().toISOString(),
    ...overrides,
  } as EventInputValue
}

function baseFinalizeBody(overrides: Partial<FinalizeBodyValue> = {}): FinalizeBodyValue {
  return {
    expectedEventCount: 3,
    review: { outputQuality: 'yes' },
    ...overrides,
  }
}

describe('finalizeSession request hash (D21)', () => {
  it('request hash covers expectedEventCount, lastBatch and review', () => {
    const params = { id: randomUUID() }
    const base = requestHash('finalize', params, baseFinalizeBody())

    const differentCount = requestHash('finalize', params, baseFinalizeBody({ expectedEventCount: 4 }))
    expect(differentCount).not.toBe(base)

    const differentReview = requestHash(
      'finalize',
      params,
      baseFinalizeBody({ review: { outputQuality: 'no' } }),
    )
    expect(differentReview).not.toBe(base)

    const withLastBatch = requestHash(
      'finalize',
      params,
      baseFinalizeBody({ lastBatch: { events: [offTaskEvent()] } }),
    )
    expect(withLastBatch).not.toBe(base)

    // Identical content, key order shuffled: canonicalization keeps the hash
    // stable (requestHash.ts's own contract), so this is the same hash again.
    const reordered = requestHash('finalize', params, {
      review: baseFinalizeBody().review,
      expectedEventCount: baseFinalizeBody().expectedEventCount,
    } as FinalizeBodyValue)
    expect(reordered).toBe(base)
  })
})

describe('assertEventCountMatches (D18, D19, D21)', () => {
  it('mismatch error carries details.expected/details.stored and triggers no receipt write (D21)', () => {
    try {
      assertEventCountMatches(5, 4)
      throw new Error('expected assertEventCountMatches to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError)
      const conflict = err as ConflictError
      expect(conflict.code).toBe('event_count_mismatch')
      expect(conflict.details).toEqual({ expected: 5, stored: 4 })
      expect(conflict.retryable).toBe(true)
      // Throwing (rather than writing anything) is exactly what lets
      // `withIdempotency`'s transaction roll back with no receipt written —
      // verified end to end in finalize-mechanics.test.ts's own
      // "no mutation_receipts row for this key" assertion.
    }

    // A matching count never throws.
    expect(() => assertEventCountMatches(4, 4)).not.toThrow()
  })
})

describe('planFinalizeLastBatch — duplicates (D9)', () => {
  it('lastBatch duplicates are counted once', () => {
    const duplicateId = randomUUID()
    const events: EventInputValue[] = [
      offTaskEvent({ clientEventId: duplicateId }),
      offTaskEvent({ clientEventId: duplicateId }),
      offTaskEvent(),
    ]

    const plan = planFinalizeLastBatch('awaiting_review', { events }, 1_000_000, new Set())

    expect(plan.toInsert).toHaveLength(2)
    const insertedIds = plan.toInsert.map((event) => event.clientEventId)
    expect(new Set(insertedIds).size).toBe(2)

    // Already-stored ids are excluded too, not just in-batch repeats.
    const alreadyStored = new Set([events[2]!.clientEventId])
    const planAgainstStored = planFinalizeLastBatch('awaiting_review', { events }, 1_000_000, alreadyStored)
    expect(planAgainstStored.toInsert).toHaveLength(1)
  })
})

describe('assertFinalizableLifecycle (D19)', () => {
  it('non-awaiting_review lifecycle rejected', () => {
    expect(() => assertFinalizableLifecycle('awaiting_review')).not.toThrow()

    for (const lifecycle of ['running', 'paused'] as const) {
      try {
        assertFinalizableLifecycle(lifecycle)
        throw new Error(`expected ${lifecycle} to throw`)
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictError)
        expect((err as ConflictError).code).toBe('session_not_ended')
      }
    }

    try {
      assertFinalizableLifecycle('abandoned')
      throw new Error('expected abandoned to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError)
      expect((err as ConflictError).code).toBe('session_not_active')
    }

    try {
      assertFinalizableLifecycle('finalized')
      throw new Error('expected finalized to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError)
      expect((err as ConflictError).code).toBe('already_finalized')
    }
  })
})

describe('planFinalizeLastBatch — check order (D19)', () => {
  it('lifecycle gate runs before any lastBatch insert', () => {
    // An impossible offset (elapsedMs far past any reasonable ceiling) that
    // WOULD throw its own 422 `impossible_offset` if the lastBatch checks
    // ever ran — but the lifecycle gate must win first, before that check is
    // even reached.
    const impossibleEvents = [offTaskEvent({ elapsedMs: 999_999_999 })]

    try {
      planFinalizeLastBatch('running', { events: impossibleEvents }, 1_000, new Set())
      throw new Error('expected planFinalizeLastBatch to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError)
      expect(err).not.toBeInstanceOf(DomainError)
      expect((err as ConflictError).code).toBe('session_not_ended')
    }

    try {
      planFinalizeLastBatch('abandoned', { events: impossibleEvents }, 1_000, new Set())
      throw new Error('expected planFinalizeLastBatch to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError)
      expect((err as ConflictError).code).toBe('session_not_active')
    }

    // Once the lifecycle is valid, the SAME impossible batch is rejected for
    // its own reason instead.
    try {
      planFinalizeLastBatch('awaiting_review', { events: impossibleEvents }, 1_000, new Set())
      throw new Error('expected planFinalizeLastBatch to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError)
      expect((err as DomainError).code).toBe('impossible_offset')
    }
  })
})
