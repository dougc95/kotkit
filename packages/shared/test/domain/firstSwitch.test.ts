import { describe, expect, it } from 'vitest'
import {
  deriveFirstSwitch,
  formatFirstSwitch,
  fromStoredFirstSwitch,
  tallyEvents,
  toStoredFirstSwitch,
  type DerivedFirstSwitch,
  type EventLike,
} from '../../src/domain/firstSwitch.js'
import type { FirstSwitch } from '../../src/domain/types.js'

function event(overrides: Partial<EventLike> & Pick<EventLike, 'type'>): EventLike {
  return {
    clientEventId: `evt-${Math.random().toString(36).slice(2)}`,
    elapsedMs: null,
    voidedAt: null,
    ...overrides,
  }
}

describe('domain/firstSwitch derivation and formatting', () => {
  it('S=0 → none_capped and formats "20+, capped"', () => {
    const result = deriveFirstSwitch({
      events: [],
      episodeCount: 0,
      countMethod: 'event',
      estimateSeconds: null,
    })
    expect(result).toEqual({ firstSwitch: { kind: 'none_capped' }, method: null })
    expect(formatFirstSwitch(result!.firstSwitch)).toBe('20+, capped')
  })

  it('first off_task event at 370000 ms → known 370 s, method event, formats "6:10"', () => {
    const events = [event({ type: 'off_task', elapsedMs: 370000 })]
    const result = deriveFirstSwitch({
      events,
      episodeCount: 1,
      countMethod: 'event',
      estimateSeconds: null,
    })
    expect(result).toEqual({ firstSwitch: { kind: 'known', seconds: 370 }, method: 'event' })
    expect(formatFirstSwitch(result!.firstSwitch)).toBe('6:10')
  })

  it('S=3 retrospective with no estimate → unknown, formats "Unknown" and the string never contains "20+"', () => {
    const result = deriveFirstSwitch({
      events: [],
      episodeCount: 3,
      countMethod: 'retrospective',
      estimateSeconds: null,
    })
    expect(result).toEqual({ firstSwitch: { kind: 'unknown' }, method: null })
    const formatted = formatFirstSwitch(result!.firstSwitch)
    expect(formatted).toBe('Unknown')
    expect(formatted).not.toContain('20+')
  })

  it('S=3 retrospective with estimate 480 → known 480, method estimate', () => {
    const result = deriveFirstSwitch({
      events: [],
      episodeCount: 3,
      countMethod: 'retrospective',
      estimateSeconds: 480,
    })
    expect(result).toEqual({ firstSwitch: { kind: 'known', seconds: 480 }, method: 'estimate' })
  })

  it('S null → null (never none_capped, never unknown)', () => {
    const result = deriveFirstSwitch({
      events: [],
      episodeCount: null,
      countMethod: null,
      estimateSeconds: null,
    })
    expect(result).toBeNull()
  })

  it('voided first event is skipped; the next counted episode times T', () => {
    const events = [
      event({ type: 'off_task', elapsedMs: 1000, voidedAt: '2026-09-06T00:00:01.000Z' }),
      event({ type: 'off_task', elapsedMs: 50000 }),
    ]
    const result = deriveFirstSwitch({
      events,
      episodeCount: 1,
      countMethod: 'event',
      estimateSeconds: null,
    })
    expect(result).toEqual({ firstSwitch: { kind: 'known', seconds: 50 }, method: 'event' })
  })

  it('countMethod event but the only episode event lacks elapsedMs → unknown', () => {
    const events = [event({ type: 'off_task', elapsedMs: null })]
    const result = deriveFirstSwitch({
      events,
      episodeCount: 1,
      countMethod: 'event',
      estimateSeconds: null,
    })
    expect(result).toEqual({ firstSwitch: { kind: 'unknown' }, method: null })
  })

  it('estimate 1200 or 0 throws', () => {
    expect(() =>
      deriveFirstSwitch({
        events: [],
        episodeCount: 2,
        countMethod: 'retrospective',
        estimateSeconds: 1200,
      }),
    ).toThrow()
    expect(() =>
      deriveFirstSwitch({
        events: [],
        episodeCount: 2,
        countMethod: 'retrospective',
        estimateSeconds: 0,
      }),
    ).toThrow()
  })

  it('stored round-trip preserves all three kinds and the null case', () => {
    const cases: (DerivedFirstSwitch | null)[] = [
      { firstSwitch: { kind: 'none_capped' }, method: null },
      { firstSwitch: { kind: 'known', seconds: 125 }, method: 'event' },
      { firstSwitch: { kind: 'known', seconds: 480 }, method: 'estimate' },
      { firstSwitch: { kind: 'unknown' }, method: null },
      null,
    ]
    for (const result of cases) {
      const stored = toStoredFirstSwitch(result)
      expect(fromStoredFirstSwitch(stored)).toEqual(result)
    }
  })

  it('exhaustive formatting: only none_capped renders a cap label', () => {
    const kinds: FirstSwitch[] = [
      { kind: 'none_capped' },
      { kind: 'known', seconds: 5 },
      { kind: 'unknown' },
    ]
    for (const fs of kinds) {
      const formatted = formatFirstSwitch(fs)
      expect(formatted.includes('20+')).toBe(fs.kind === 'none_capped')
    }
  })

  it('retrospective S=4 with two off_task events present → episodeCount stays 4 (never 6) and T is unknown without an estimate (methods are alternatives, never summed)', () => {
    const events = [
      event({ type: 'off_task', elapsedMs: 1000 }),
      event({ type: 'off_task', elapsedMs: 2000 }),
    ]
    const result = deriveFirstSwitch({
      events,
      episodeCount: 4,
      countMethod: 'retrospective',
      estimateSeconds: null,
    })
    expect(result).toEqual({ firstSwitch: { kind: 'unknown' }, method: null })
    // deriveFirstSwitch takes episodeCount as given; it never recomputes it from events.
    expect(tallyEvents(events).offTask).toBe(2)
  })
})
