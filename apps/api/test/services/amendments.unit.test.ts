/**
 * 5.9.1 — unit tests for the amendments route's service layer
 * (`services/review.ts`): the `AmendmentBody` contract itself (mirroring
 * `clock-gap.unit.test.ts`'s own contract-level cases), the pure
 * `assertAmendableLifecycle` lifecycle gate, and `addAmendment`'s own
 * statement shape against a fake db/tx double (no real database). Covered
 * end to end by API integration in `test/sessions/amendments.test.ts`.
 */
import { Value } from '@sinclair/typebox/value'
import { describe, expect, it } from 'vitest'

import { AmendmentBody, SESSION_LIFECYCLES, type SessionLifecycle } from '@attention-lab/shared'
import { addAmendment, assertAmendableLifecycle } from '../../src/services/review.js'
import { ConflictError } from '../../src/errors.js'
import type { AppDatabase } from '../../src/plugins/db.js'
import type { RequestContext } from '../../src/plugins/identity.js'

describe('AmendmentBody contract (2.7)', () => {
  it('empty reason rejected', () => {
    expect(Value.Check(AmendmentBody, { reason: '', excludeFromReport: true })).toBe(false)
  })

  it('excludeFromReport must be boolean', () => {
    expect(Value.Check(AmendmentBody, { reason: 'wrong material', excludeFromReport: 'yes' })).toBe(false)
  })
})

describe('assertAmendableLifecycle (D32)', () => {
  it('unfinalized session rejected', () => {
    const unfinalized = SESSION_LIFECYCLES.filter((lifecycle) => lifecycle !== 'finalized')
    expect(unfinalized.length).toBeGreaterThan(0)

    for (const lifecycle of unfinalized) {
      try {
        assertAmendableLifecycle(lifecycle)
        throw new Error(`expected assertAmendableLifecycle('${lifecycle}') to throw`)
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictError)
        expect((err as ConflictError).code).toBe('not_finalized')
      }
    }

    // The one lifecycle that DOES pass — never throws.
    expect(() => assertAmendableLifecycle('finalized' as SessionLifecycle)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// addAmendment — statement shape, against a fake db/tx double (D9-style
// append-only proof, no real database).
// ---------------------------------------------------------------------------

interface SessionRowDouble {
  readonly userId: string
  readonly realm: 'demo' | 'pilot' | 'real'
  readonly lifecycle: SessionLifecycle
}

/**
 * A minimal fake of the chained `db.select().from().where().limit()` /
 * `db.insert().values().returning()` shape `addAmendment` calls, recording
 * which top-level statement kind was invoked so the test can assert exactly
 * one `insert` and zero `update` calls happened — `addAmendment` never
 * updates any row (D32: stored eligibility is never rewritten by an
 * amendment, and there is no update route for the amendment itself either).
 */
function createDbDouble(sessionRow: SessionRowDouble | undefined, insertedRow: Record<string, unknown>) {
  const statementLog: string[] = []

  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: () => Promise.resolve(sessionRow ? [sessionRow] : []),
  }

  const insertChain = {
    values: () => insertChain,
    returning: () => Promise.resolve([insertedRow]),
  }

  const updateChain = {
    set: () => updateChain,
    where: () => updateChain,
    returning: () => Promise.resolve([]),
  }

  const db = {
    select: () => {
      statementLog.push('select')
      return selectChain
    },
    insert: () => {
      statementLog.push('insert')
      return insertChain
    },
    update: () => {
      statementLog.push('update')
      return updateChain
    },
  } as unknown as AppDatabase

  return { db, statementLog }
}

const CTX: RequestContext = {
  principalId: 'local-demo',
  realm: 'demo',
  identityMode: 'local-demo',
  now: new Date('2026-09-07T10:00:00.000Z'),
  demoClockOffsetSeconds: 0,
  timeSource: 'measured',
}

describe('addAmendment — statement shape', () => {
  it('addAmendment issues a single INSERT and no UPDATE', async () => {
    const insertedRow = {
      id: 'amendment-1',
      sessionId: 'session-1',
      userId: CTX.principalId,
      reason: 'wrong material',
      excludeFromReport: true,
      createdAt: CTX.now,
    }
    const { db, statementLog } = createDbDouble(
      { userId: CTX.principalId, realm: 'demo', lifecycle: 'finalized' },
      insertedRow,
    )

    const result = await addAmendment(db, CTX, 'session-1', {
      reason: 'wrong material',
      excludeFromReport: true,
    })

    expect(statementLog.filter((s) => s === 'insert')).toHaveLength(1)
    expect(statementLog.filter((s) => s === 'update')).toHaveLength(0)
    expect(statementLog).toEqual(['select', 'insert'])
    expect(result).toEqual({
      id: 'amendment-1',
      sessionId: 'session-1',
      reason: 'wrong material',
      excludeFromReport: true,
      createdAt: CTX.now.toISOString(),
    })
  })
})
