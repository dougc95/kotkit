import { describe, expect, it } from 'vitest'
import { RealmMixingError } from '../../src/domain/types.js'
import { suggestProgression, type PracticeBlockRecord } from '../../src/domain/progression.js'

function block(overrides: Partial<PracticeBlockRecord> = {}): PracticeBlockRecord {
  return {
    sessionId: 's1',
    realm: 'demo',
    kind: 'practice',
    localDate: '2026-09-04',
    targetSeconds: 900,
    completeInterval: true,
    outputQuality: 'yes',
    episodeCount: 1,
    finalized: true,
    ...overrides,
  }
}

/** Two qualifying blocks for one local date, at the given target. */
function qualifyingDay(localDate: string, targetSeconds = 900): PracticeBlockRecord[] {
  return [
    block({ sessionId: `${localDate}-1`, localDate, targetSeconds }),
    block({ sessionId: `${localDate}-2`, localDate, targetSeconds }),
  ]
}

describe('domain/progression: suggestProgression', () => {
  it('Days 4 and 5 qualify at 900 → Day 6 null (ceiling 900)', () => {
    const blocks = [...qualifyingDay('2026-09-04'), ...qualifyingDay('2026-09-05')]
    const result = suggestProgression({ day: 6, currentTargetSeconds: 900, blocks })
    expect(result).toBeNull()
  })

  it('same blocks evaluated on Day 7 → null', () => {
    const blocks = [...qualifyingDay('2026-09-04'), ...qualifyingDay('2026-09-05')]
    const result = suggestProgression({ day: 7, currentTargetSeconds: 900, blocks })
    expect(result).toBeNull()
  })

  it('same blocks evaluated on Day 8 → suggests 1200 with qualifiedOn [Day 4, Day 5]', () => {
    const blocks = [...qualifyingDay('2026-09-04'), ...qualifyingDay('2026-09-05')]
    const result = suggestProgression({ day: 8, currentTargetSeconds: 900, blocks })
    expect(result).toEqual({
      suggestedTargetSeconds: 1200,
      qualifiedOn: ['2026-09-04', '2026-09-05'],
    })
  })

  it('missed Days 6 and 7 (no sessions) then Day 8 → still suggests (held, nothing reset)', () => {
    // No blocks at all for 09-06 or 09-07; the qualifying pair on 09-04/09-05
    // is unaffected by the gap.
    const blocks = [...qualifyingDay('2026-09-04'), ...qualifyingDay('2026-09-05')]
    const result = suggestProgression({ day: 8, currentTargetSeconds: 900, blocks })
    expect(result).not.toBeNull()
    expect(result?.qualifiedOn).toEqual(['2026-09-04', '2026-09-05'])
  })

  it('qualifying Days 4 and 6 with nothing on Day 5 → null (not adjacent)', () => {
    const blocks = [...qualifyingDay('2026-09-04'), ...qualifyingDay('2026-09-06')]
    const result = suggestProgression({ day: 8, currentTargetSeconds: 900, blocks })
    expect(result).toBeNull()
  })

  it('one of the two days has a Partly block → null', () => {
    const blocks = [
      ...qualifyingDay('2026-09-04'),
      block({ sessionId: '2026-09-05-1', localDate: '2026-09-05', outputQuality: 'partly' }),
      block({ sessionId: '2026-09-05-2', localDate: '2026-09-05' }),
    ]
    const result = suggestProgression({ day: 8, currentTargetSeconds: 900, blocks })
    expect(result).toBeNull()
  })

  it('target 1200 on Day 9 → null (never above ceiling)', () => {
    const blocks = [
      ...qualifyingDay('2026-09-08', 1200),
      ...qualifyingDay('2026-09-09', 1200),
    ]
    const result = suggestProgression({ day: 9, currentTargetSeconds: 1200, blocks })
    expect(result).toBeNull()
  })

  it('target 300 with Days 1–2 qualifying → suggests 600 on Day 3', () => {
    const blocks = [
      ...qualifyingDay('2026-09-01', 300),
      ...qualifyingDay('2026-09-02', 300),
    ]
    const result = suggestProgression({ day: 3, currentTargetSeconds: 300, blocks })
    expect(result).toEqual({
      suggestedTargetSeconds: 600,
      qualifiedOn: ['2026-09-01', '2026-09-02'],
    })
  })

  it('benchmark sessions on the qualifying days are ignored and 1200 (20 min) is never suggested from them', () => {
    const blocks = [
      ...qualifyingDay('2026-09-04'),
      ...qualifyingDay('2026-09-05'),
      block({
        sessionId: 'benchmark-1',
        localDate: '2026-09-04',
        kind: 'benchmark',
        targetSeconds: 1200,
        episodeCount: 0,
      }),
      block({
        sessionId: 'benchmark-2',
        localDate: '2026-09-05',
        kind: 'benchmark',
        targetSeconds: 1200,
        episodeCount: 0,
      }),
    ]
    const result = suggestProgression({ day: 8, currentTargetSeconds: 900, blocks })
    expect(result).toEqual({
      suggestedTargetSeconds: 1200,
      qualifiedOn: ['2026-09-04', '2026-09-05'],
    })
  })

  it('after acceptance (target now 1200) the Day 4–5 blocks at 900 no longer qualify → null until two new days qualify at 1200', () => {
    const blocks = [...qualifyingDay('2026-09-04', 900), ...qualifyingDay('2026-09-05', 900)]
    const result = suggestProgression({ day: 8, currentTargetSeconds: 1200, blocks })
    expect(result).toBeNull()

    const withNewQualifyingDays = [
      ...blocks,
      ...qualifyingDay('2026-09-08', 1200),
      ...qualifyingDay('2026-09-09', 1200),
    ]
    const afterNewDays = suggestProgression({ day: 11, currentTargetSeconds: 1200, blocks: withNewQualifyingDays })
    expect(afterNewDays).toEqual({
      suggestedTargetSeconds: 1500,
      qualifiedOn: ['2026-09-08', '2026-09-09'],
    })
  })

  it('mixed demo/pilot blocks → RealmMixingError', () => {
    const blocks = [
      ...qualifyingDay('2026-09-04'),
      block({ sessionId: 'pilot-1', localDate: '2026-09-05', realm: 'pilot' }),
      block({ sessionId: 'pilot-2', localDate: '2026-09-05', realm: 'pilot' }),
    ]
    expect(() => suggestProgression({ day: 8, currentTargetSeconds: 900, blocks })).toThrow(
      RealmMixingError,
    )
  })
})
