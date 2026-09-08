import { describe, expect, it } from 'vitest'
import { countedEvents, prefillCounts, tallyEvents, type EventLike } from '../../src/domain/firstSwitch.js'

function event(overrides: Partial<EventLike> & Pick<EventLike, 'type'>): EventLike {
  return {
    clientEventId: `evt-${Math.random().toString(36).slice(2)}`,
    elapsedMs: null,
    voidedAt: null,
    ...overrides,
  }
}

describe('domain/firstSwitch tallies', () => {
  it('visibility events contribute to no tally and no prefill (hidden tab creates no episode)', () => {
    const events = [event({ type: 'visibility', elapsedMs: 1000 })]
    expect(tallyEvents(events)).toEqual({ offTask: 0, external: 0, agentChecks: 0 })
    expect(prefillCounts(events)).toEqual({
      episodeCount: null,
      externalCount: null,
      unplannedAgentChecks: null,
      countMethod: null,
    })
  })

  it('agent_check with alsoOffTask increments offTask by 1 and agentChecks by 1; the result has exactly the keys offTask/external/agentChecks (nothing summed across tallies)', () => {
    const events = [
      event({ type: 'agent_check', elapsedMs: 2000, details: { alsoOffTask: true } }),
    ]
    const tallies = tallyEvents(events)
    expect(tallies).toEqual({ offTask: 1, external: 0, agentChecks: 1 })
    expect(Object.keys(tallies).sort()).toEqual(['agentChecks', 'external', 'offTask'])
  })

  it('agent_check without alsoOffTask increments agentChecks only', () => {
    const events = [event({ type: 'agent_check', elapsedMs: 2000 })]
    expect(tallyEvents(events)).toEqual({ offTask: 0, external: 0, agentChecks: 1 })
  })

  it('voided duplicate is excluded: two off_task presses then one void → offTask 1', () => {
    const events = [
      event({ type: 'off_task', elapsedMs: 1000 }),
      event({ type: 'off_task', elapsedMs: 1005, voidedAt: '2026-09-06T00:00:01.005Z' }),
    ]
    expect(tallyEvents(events)).toEqual({ offTask: 1, external: 0, agentChecks: 0 })
  })

  it('one Record press after visiting five apps is one episode (tally counts recorded events only)', () => {
    const events = [event({ type: 'off_task', elapsedMs: 60000 })]
    expect(tallyEvents(events)).toEqual({ offTask: 1, external: 0, agentChecks: 0 })
  })

  it('pause/resume/clock_gap contribute nothing', () => {
    const events = [
      event({ type: 'pause', elapsedMs: 1000 }),
      event({ type: 'resume', elapsedMs: 2000 }),
      event({ type: 'clock_gap', elapsedMs: 3000 }),
    ]
    expect(tallyEvents(events)).toEqual({ offTask: 0, external: 0, agentChecks: 0 })
    expect(countedEvents(events)).toEqual([])
  })

  it('no events → prefillCounts all null with countMethod null, never 0', () => {
    expect(prefillCounts([])).toEqual({
      episodeCount: null,
      externalCount: null,
      unplannedAgentChecks: null,
      countMethod: null,
    })
  })

  it('only external events → episodeCount 0, externalCount 1, unplannedAgentChecks 0 with countMethod event (D31: any counted event prefills every count)', () => {
    const events = [event({ type: 'external', elapsedMs: 500 })]
    expect(prefillCounts(events)).toEqual({
      episodeCount: 0,
      externalCount: 1,
      unplannedAgentChecks: 0,
      countMethod: 'event',
    })
  })

  it('benchmark events and practice events use the same function; kind is not an input (benchmark ≠ practice is enforced by callers)', () => {
    const events = [event({ type: 'off_task', elapsedMs: 1000 })]
    // tallyEvents takes only events — no `kind` parameter exists to pass.
    expect(tallyEvents.length).toBe(1)
    expect(tallyEvents(events)).toEqual({ offTask: 1, external: 0, agentChecks: 0 })
  })
})
