/**
 * 4.2.1 — unit tests for `deriveBlocks`: Today's two practice-block statuses
 * from one local date's `focus_sessions` rows. Pure — no database. Covered
 * by API integration in 4.2.3 and 4.5.3 (this task has no integration
 * suite of its own).
 */
import { describe, expect, it } from 'vitest'
import type { SessionKind, SessionLifecycle } from '@attention-lab/shared'

import { deriveBlocks, type Block, type BlockSessionInput } from './blocks.js'

const T0 = new Date('2026-09-10T09:00:00.000Z')
const T1 = new Date('2026-09-10T10:00:00.000Z')
const T2 = new Date('2026-09-10T11:00:00.000Z')

function session(overrides: Partial<BlockSessionInput> & { id: string }): BlockSessionInput {
  return {
    kind: 'practice' as SessionKind,
    lifecycle: 'finalized' as SessionLifecycle,
    startedAt: T0,
    completeInterval: true,
    outputQuality: null,
    ...overrides,
  }
}

describe('deriveBlocks', () => {
  it('(1) no sessions -> both not_started, sessionId null, targetSeconds from input, index 1 then 2', () => {
    const [block1, block2] = deriveBlocks({ sessions: [], targetSeconds: 600 })
    expect(block1).toEqual({ index: 1, status: 'not_started', targetSeconds: 600, sessionId: null })
    expect(block2).toEqual({ index: 2, status: 'not_started', targetSeconds: 600, sessionId: null })
  })

  it('(2) one finalized complete session -> [completed, not_started]', () => {
    const [block1, block2] = deriveBlocks({
      sessions: [session({ id: 's1', lifecycle: 'finalized', completeInterval: true })],
      targetSeconds: 600,
    })
    expect(block1).toEqual({ index: 1, status: 'completed', targetSeconds: 600, sessionId: 's1' })
    expect(block2.status).toBe('not_started')
    expect(block2.sessionId).toBeNull()
  })

  it('(3) one running session -> [in_progress, not_started] carrying its sessionId', () => {
    const [block1, block2] = deriveBlocks({
      sessions: [session({ id: 's1', lifecycle: 'running', completeInterval: null })],
      targetSeconds: 600,
    })
    expect(block1).toEqual({ index: 1, status: 'in_progress', targetSeconds: 600, sessionId: 's1' })
    expect(block2.status).toBe('not_started')
  })

  it('(4) finalized with completeInterval false (early finish) -> partial', () => {
    const [block1] = deriveBlocks({
      sessions: [session({ id: 's1', lifecycle: 'finalized', completeInterval: false })],
      targetSeconds: 600,
    })
    expect(block1.status).toBe('partial')
  })

  it('(5) finalized with completeInterval null -> partial, never completed', () => {
    const [block1] = deriveBlocks({
      sessions: [session({ id: 's1', lifecycle: 'finalized', completeInterval: null })],
      targetSeconds: 600,
    })
    expect(block1.status).toBe('partial')
    expect(block1.status).not.toBe('completed')
  })

  it("(6) outputQuality 'partly' with completeInterval true -> status completed (partial output != partial block)", () => {
    const [block1] = deriveBlocks({
      sessions: [
        session({ id: 's1', lifecycle: 'finalized', completeInterval: true, outputQuality: 'partly' }),
      ],
      targetSeconds: 600,
    })
    expect(block1.status).toBe('completed')
  })

  it('(7) abandoned session excluded, block stays not_started', () => {
    const [block1] = deriveBlocks({
      sessions: [session({ id: 's1', lifecycle: 'abandoned', completeInterval: null })],
      targetSeconds: 600,
    })
    expect(block1).toEqual({ index: 1, status: 'not_started', targetSeconds: 600, sessionId: null })
  })

  it('(8) a benchmark session on the same date is never a block', () => {
    const [block1, block2] = deriveBlocks({
      sessions: [
        session({ id: 'b1', kind: 'benchmark', lifecycle: 'finalized', completeInterval: true }),
      ],
      targetSeconds: 600,
    })
    expect(block1).toEqual({ index: 1, status: 'not_started', targetSeconds: 600, sessionId: null })
    expect(block2).toEqual({ index: 2, status: 'not_started', targetSeconds: 600, sessionId: null })
  })

  it('(9) three practice sessions -> only the first two by startedAt are used', () => {
    const [block1, block2] = deriveBlocks({
      sessions: [
        session({ id: 's3', startedAt: T2 }),
        session({ id: 's1', startedAt: T0 }),
        session({ id: 's2', startedAt: T1 }),
      ],
      targetSeconds: 600,
    })
    expect(block1.sessionId).toBe('s1')
    expect(block2.sessionId).toBe('s2')
  })

  it('(10) lifecycle awaiting_review after the target elapsed -> in_progress, never completed', () => {
    const [block1] = deriveBlocks({
      sessions: [session({ id: 's1', lifecycle: 'awaiting_review', completeInterval: null })],
      targetSeconds: 600,
    })
    expect(block1.status).toBe('in_progress')
    expect(block1.status).not.toBe('completed')
  })

  it('(11) paused -> in_progress', () => {
    const [block1] = deriveBlocks({
      sessions: [session({ id: 's1', lifecycle: 'paused', completeInterval: null })],
      targetSeconds: 600,
    })
    expect(block1.status).toBe('in_progress')
  })

  it('(12) each Block has exactly the keys index, status, targetSeconds, sessionId and the tuple order is [1, 2]', () => {
    const [block1, block2] = deriveBlocks({
      sessions: [session({ id: 's1', startedAt: T0 }), session({ id: 's2', startedAt: T1 })],
      targetSeconds: 600,
    })
    const expectedKeys = ['index', 'status', 'targetSeconds', 'sessionId'].sort()
    expect(Object.keys(block1).sort()).toEqual(expectedKeys)
    expect(Object.keys(block2).sort()).toEqual(expectedKeys)
    expect(block1.index).toBe(1)
    expect(block2.index).toBe(2)
    const tuple: [Block, Block] = deriveBlocks({
      sessions: [session({ id: 's1', startedAt: T0 }), session({ id: 's2', startedAt: T1 })],
      targetSeconds: 600,
    })
    expect(tuple[0].index).toBe(1)
    expect(tuple[1].index).toBe(2)
  })
})
