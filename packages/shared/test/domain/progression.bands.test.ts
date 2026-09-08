import { describe, expect, it } from 'vitest'
import {
  bandCeilingSeconds,
  blockQualifies,
  dayQualifies,
  type BandCeiling,
  type PracticeBlockRecord,
} from '../../src/domain/progression.js'

function block(overrides: Partial<PracticeBlockRecord> = {}): PracticeBlockRecord {
  return {
    sessionId: 's1',
    realm: 'demo',
    kind: 'practice',
    localDate: '2026-09-10',
    targetSeconds: 900,
    completeInterval: true,
    outputQuality: 'yes',
    episodeCount: 1,
    finalized: true,
    ...overrides,
  }
}

describe('domain/progression: bandCeilingSeconds', () => {
  it('default ceilings: Days 1–3 600, 4–7 900, 8–10 1200, 11–14 1500; Day 0 600; Day 15 1500', () => {
    expect(bandCeilingSeconds(0)).toBe(600)
    expect(bandCeilingSeconds(1)).toBe(600)
    expect(bandCeilingSeconds(3)).toBe(600)
    expect(bandCeilingSeconds(4)).toBe(900)
    expect(bandCeilingSeconds(7)).toBe(900)
    expect(bandCeilingSeconds(8)).toBe(1200)
    expect(bandCeilingSeconds(10)).toBe(1200)
    expect(bandCeilingSeconds(11)).toBe(1500)
    expect(bandCeilingSeconds(14)).toBe(1500)
    expect(bandCeilingSeconds(15)).toBe(1500)
  })

  it('initial 5-minute block: Day 1 ceiling remains 600', () => {
    // A 5-minute (300s) initial target does not change the band ceiling itself;
    // the ceiling for Day 1 is still 600s (10 minutes) regardless of the
    // program's starting target.
    expect(bandCeilingSeconds(1)).toBe(600)
  })

  it('custom ceilings passed from a revision override the defaults', () => {
    const custom: readonly BandCeiling[] = [
      { fromDay: 1, toDay: 5, minutes: 12 },
      { fromDay: 6, toDay: 14, minutes: 30 },
    ]
    expect(bandCeilingSeconds(0, custom)).toBe(12 * 60)
    expect(bandCeilingSeconds(5, custom)).toBe(12 * 60)
    expect(bandCeilingSeconds(6, custom)).toBe(30 * 60)
    expect(bandCeilingSeconds(20, custom)).toBe(30 * 60)
    // Defaults are untouched by passing a custom array.
    expect(bandCeilingSeconds(6)).toBe(900)
  })
})

describe('domain/progression: blockQualifies', () => {
  it('Partly output does not qualify', () => {
    expect(blockQualifies(block({ outputQuality: 'partly' }), 900)).toBe(false)
  })

  it('episodeCount null does not qualify (unknown is not ≤ 1)', () => {
    expect(blockQualifies(block({ episodeCount: null }), 900)).toBe(false)
  })

  it('episodeCount 2 does not qualify, 1 does, 0 does', () => {
    expect(blockQualifies(block({ episodeCount: 2 }), 900)).toBe(false)
    expect(blockQualifies(block({ episodeCount: 1 }), 900)).toBe(true)
    expect(blockQualifies(block({ episodeCount: 0 }), 900)).toBe(true)
  })

  it('early finish (completeInterval false) does not qualify', () => {
    expect(blockQualifies(block({ completeInterval: false }), 900)).toBe(false)
  })

  it('block at previous target 600 while current is 900 does not qualify', () => {
    expect(blockQualifies(block({ targetSeconds: 600 }), 900)).toBe(false)
  })

  it('benchmark kind never qualifies', () => {
    expect(blockQualifies(block({ kind: 'benchmark' }), 900)).toBe(false)
  })

  it('unfinalized block that reached its target never qualifies (expiry is not completion)', () => {
    expect(blockQualifies(block({ finalized: false }), 900)).toBe(false)
  })
})

describe('domain/progression: dayQualifies', () => {
  it('one qualifying block → day does not qualify; two → qualifies; two plus a Partly third → still qualifies', () => {
    const one = [block({ sessionId: 's1' })]
    expect(dayQualifies(one, 900)).toBe(false)

    const two = [block({ sessionId: 's1' }), block({ sessionId: 's2' })]
    expect(dayQualifies(two, 900)).toBe(true)

    const twoPlusPartly = [
      block({ sessionId: 's1' }),
      block({ sessionId: 's2' }),
      block({ sessionId: 's3', outputQuality: 'partly' }),
    ]
    expect(dayQualifies(twoPlusPartly, 900)).toBe(true)
  })
})
