/**
 * 5.2.1 — unit tests for `deriveTallies` (design.md D11/D20). Pure — no
 * database. Covered by API integration in 5.1.1, 5.2.2 and 5.4.2 (this task
 * has no integration suite of its own).
 */
import { describe, expect, it } from 'vitest'
import type { EventLike } from '@attention-lab/shared'

import { deriveTallies } from '../../src/services/sessionTallies.js'

function event(overrides: Partial<EventLike> & Pick<EventLike, 'type'>): EventLike {
  return {
    clientEventId: `evt-${Math.random().toString(36).slice(2)}`,
    elapsedMs: null,
    voidedAt: null,
    ...overrides,
  }
}

describe('services/sessionTallies deriveTallies', () => {
  it('off_task + agent_check(alsoOffTask true) + agent_check(alsoOffTask false) + external -> { offTask 2, external 1, agentChecks 2 } and Object.keys length is 3', () => {
    const events = [
      event({ type: 'off_task', elapsedMs: 1000 }),
      event({ type: 'agent_check', elapsedMs: 2000, details: { alsoOffTask: true } }),
      event({ type: 'agent_check', elapsedMs: 3000, details: { alsoOffTask: false } }),
      event({ type: 'external', elapsedMs: 4000 }),
    ]
    const tallies = deriveTallies(events)
    expect(tallies).toEqual({ offTask: 2, external: 1, agentChecks: 2 })
    expect(Object.keys(tallies).length).toBe(3)
  })

  it('voided off_task is excluded', () => {
    const events = [
      event({ type: 'off_task', elapsedMs: 1000, voidedAt: '2026-09-06T00:00:01.000Z' }),
    ]
    expect(deriveTallies(events)).toEqual({ offTask: 0, external: 0, agentChecks: 0 })
  })

  it('five visibility events -> all zero', () => {
    const events = [1, 2, 3, 4, 5].map((n) => event({ type: 'visibility', elapsedMs: n * 100 }))
    expect(deriveTallies(events)).toEqual({ offTask: 0, external: 0, agentChecks: 0 })
  })

  it('clock_gap, pause and resume -> all zero', () => {
    const events = [
      event({ type: 'clock_gap', elapsedMs: 1000 }),
      event({ type: 'pause', elapsedMs: 2000 }),
      event({ type: 'resume', elapsedMs: 2500 }),
    ]
    expect(deriveTallies(events)).toEqual({ offTask: 0, external: 0, agentChecks: 0 })
  })

  it('one off_task -> offTask 1 (one departure = one episode; server infers nothing)', () => {
    const events = [event({ type: 'off_task', elapsedMs: 60000 })]
    expect(deriveTallies(events)).toEqual({ offTask: 1, external: 0, agentChecks: 0 })
  })

  it('agent_check with alsoOffTask true adds one to each tally, never two to offTask', () => {
    const events = [
      event({ type: 'agent_check', elapsedMs: 5000, details: { alsoOffTask: true } }),
    ]
    const tallies = deriveTallies(events)
    expect(tallies).toEqual({ offTask: 1, external: 0, agentChecks: 1 })
  })

  it("empty events -> zeros (an event count, distinct from the review's ReportedCount which stays null — asserted in 5.2.2)", () => {
    expect(deriveTallies([])).toEqual({ offTask: 0, external: 0, agentChecks: 0 })
  })
})
