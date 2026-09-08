/**
 * 5.6.1 — unit tests for the pure decision core of `putAgentPlan`
 * (`decideAgentPlanWrite` and `assertPracticeKind` — `services/session.ts`).
 * Pure — no database. Covered end to end by API integration in
 * `test/sessions/agent-plan.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { assertPracticeKind, decideAgentPlanWrite, type AgentPlanRowLike } from '../../src/services/session.js'
import { DomainError } from '../../src/errors.js'

function existingRow(overrides: Partial<AgentPlanRowLike> = {}): AgentPlanRowLike {
  return {
    sessionId: 'session-1',
    workstream: 'Write the report',
    waitingTask: 'Read a paper',
    resumeNote: null,
    reviewCheckpoint: 'end_of_block',
    reviewAt: null,
    version: 1,
    ...overrides,
  }
}

describe('decideAgentPlanWrite', () => {
  it('insert path requires expectedVersion 0', () => {
    // No row yet + expectedVersion 0 -> a fresh insert.
    const inserted = decideAgentPlanWrite(null, { expectedVersion: 0, workstream: 'Write the report' })
    expect(inserted.kind).toBe('insert')

    // No row yet + any other expectedVersion -> stale, with no stored plan
    // to report (the same `null` GET itself returns for `agentPlan` when no
    // row exists) rather than a silent insert.
    const rejected = decideAgentPlanWrite(null, { expectedVersion: 1 })
    expect(rejected.kind).toBe('stale')
    expect(rejected.kind === 'stale' ? rejected.current : undefined).toBeNull()
  })

  it('default review_checkpoint end_of_block', () => {
    const decision = decideAgentPlanWrite(null, { expectedVersion: 0, waitingTask: 'Read a paper' })
    expect(decision.kind).toBe('insert')
    expect(decision.kind === 'insert' ? decision.values.reviewCheckpoint : undefined).toBe('end_of_block')
  })

  it('partial update keeps unspecified fields', () => {
    const existing = existingRow({
      workstream: 'Write the report',
      waitingTask: 'Read a paper',
      resumeNote: 'Pick up where recall left off',
      version: 1,
    })
    const decision = decideAgentPlanWrite(existing, { expectedVersion: 1, waitingTask: 'Read a different paper' })
    expect(decision.kind).toBe('update')
    if (decision.kind !== 'update') throw new Error('expected update')
    expect(decision.patch.waitingTask).toBe('Read a different paper')
    expect(decision.patch.workstream).toBe('Write the report')
    expect(decision.patch.resumeNote).toBe('Pick up where recall left off')
    expect(decision.patch.reviewCheckpoint).toBe('end_of_block')
    expect(decision.patch.version).toBe(2)
  })

  it('benchmark kind rejected', () => {
    expect(() => assertPracticeKind('practice')).not.toThrow()
    try {
      assertPracticeKind('benchmark')
      throw new Error('expected assertPracticeKind to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError)
      expect((err as DomainError).code).toBe('practice_only')
    }
  })

  it('stale version returns details.current with the stored plan', () => {
    const existing = existingRow({ version: 2, workstream: 'Write the report' })
    const decision = decideAgentPlanWrite(existing, { expectedVersion: 1, workstream: 'A racing write' })
    expect(decision.kind).toBe('stale')
    if (decision.kind !== 'stale') throw new Error('expected stale')
    expect(decision.current).toEqual(existing)
  })
})
