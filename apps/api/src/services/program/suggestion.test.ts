/**
 * 4.5.1 — unit tests for `toPracticeBlockRecords` / `deriveSuggestion`: the
 * progression-suggestion adapter over stored `focus_sessions` rows. Pure —
 * no database. Covered by API integration in 4.5.3 (this task has no
 * integration suite of its own).
 */
import { describe, expect, it } from 'vitest'
import { RealmMixingError } from '@attention-lab/shared'
import type { LocalDate } from '@attention-lab/shared'

import { deriveSuggestion, toPracticeBlockRecords, type SuggestionRow } from './suggestion.js'

const D1: LocalDate = '2026-01-01'
const D2: LocalDate = '2026-01-02'
const D3: LocalDate = '2026-01-03'
const D4: LocalDate = '2026-01-04'
const D5: LocalDate = '2026-01-05'
const D6: LocalDate = '2026-01-06'

function startedAt(localDate: LocalDate, hour: number): Date {
  return new Date(`${localDate}T${String(hour).padStart(2, '0')}:00:00.000Z`)
}

/** A qualifying-by-default practice row: target 900s, complete, output yes, 0 episodes, finalized. */
function row(
  id: string,
  localDate: LocalDate,
  hour: number,
  overrides: Partial<SuggestionRow> = {},
): SuggestionRow {
  return {
    id,
    realm: 'demo',
    kind: 'practice',
    lifecycle: 'finalized',
    localDate,
    startedAt: startedAt(localDate, hour),
    targetSeconds: 900,
    completeInterval: true,
    outputQuality: 'yes',
    episodeCount: 0,
    ...overrides,
  }
}

/** Two qualifying blocks for one local date, at the given target. */
function qualifyingDay(localDate: LocalDate, prefix: string, targetSeconds = 900): SuggestionRow[] {
  return [
    row(`${prefix}-1`, localDate, 9, { targetSeconds }),
    row(`${prefix}-2`, localDate, 10, { targetSeconds }),
  ]
}

describe('deriveSuggestion', () => {
  it('(1) Days 4-5 both qualifying at 900s, request day 6 -> null (ceiling 900)', () => {
    const rows = [...qualifyingDay(D4, 'd4'), ...qualifyingDay(D5, 'd5')]
    expect(
      deriveSuggestion({ day: 6, currentTargetSeconds: 900, rows, realm: 'demo' }),
    ).toBeNull()
  })

  it('(2) same rows, day 8 -> suggestedTargetSeconds 1200, qualifiedOn [Day 4 date, Day 5 date]', () => {
    const rows = [...qualifyingDay(D4, 'd4'), ...qualifyingDay(D5, 'd5')]
    expect(deriveSuggestion({ day: 8, currentTargetSeconds: 900, rows, realm: 'demo' })).toEqual({
      suggestedTargetSeconds: 1200,
      qualifiedOn: [D4, D5],
    })
  })

  it('(3) Days 6-7 missing between -> still 1200 on day 8 (missed days hold)', () => {
    const rows = [
      ...qualifyingDay(D4, 'd4'),
      ...qualifyingDay(D5, 'd5'),
      // Day 6 exists but does not qualify (only one block); Day 7 has no rows at all.
      row('d6-1', D6, 9),
    ]
    expect(deriveSuggestion({ day: 8, currentTargetSeconds: 900, rows, realm: 'demo' })).toEqual({
      suggestedTargetSeconds: 1200,
      qualifiedOn: [D4, D5],
    })
  })

  it("(4) Day 5 has one block 'partly' -> null", () => {
    const rows = [
      ...qualifyingDay(D4, 'd4'),
      row('d5-1', D5, 9),
      row('d5-2', D5, 10, { outputQuality: 'partly' }),
    ]
    expect(deriveSuggestion({ day: 8, currentTargetSeconds: 900, rows, realm: 'demo' })).toBeNull()
  })

  it('(5) episodeCount null on one block -> null (unknown != zero)', () => {
    const rows = [
      ...qualifyingDay(D4, 'd4'),
      row('d5-1', D5, 9),
      row('d5-2', D5, 10, { episodeCount: null }),
    ]
    expect(deriveSuggestion({ day: 8, currentTargetSeconds: 900, rows, realm: 'demo' })).toBeNull()
  })

  it('(6) episodeCount 0 and 1 qualify, 2 does not', () => {
    const qualifying = [
      row('d4-1', D4, 9, { episodeCount: 0 }),
      row('d4-2', D4, 10, { episodeCount: 1 }),
      row('d5-1', D5, 9, { episodeCount: 1 }),
      row('d5-2', D5, 10, { episodeCount: 0 }),
    ]
    expect(
      deriveSuggestion({ day: 8, currentTargetSeconds: 900, rows: qualifying, realm: 'demo' }),
    ).toEqual({ suggestedTargetSeconds: 1200, qualifiedOn: [D4, D5] })

    const notQualifying = [
      row('d4-1', D4, 9, { episodeCount: 0 }),
      row('d4-2', D4, 10, { episodeCount: 2 }),
      row('d5-1', D5, 9, { episodeCount: 1 }),
      row('d5-2', D5, 10, { episodeCount: 0 }),
    ]
    expect(
      deriveSuggestion({ day: 8, currentTargetSeconds: 900, rows: notQualifying, realm: 'demo' }),
    ).toBeNull()
  })

  it('(7) block finalized with targetSeconds 600 when the current target is 900 -> not at target -> null', () => {
    const rows = [
      ...qualifyingDay(D4, 'd4'),
      row('d5-1', D5, 9, { targetSeconds: 600 }),
      row('d5-2', D5, 10, { targetSeconds: 900 }),
    ]
    expect(deriveSuggestion({ day: 8, currentTargetSeconds: 900, rows, realm: 'demo' })).toBeNull()
  })

  it('(8) completeInterval null -> not completed -> null', () => {
    const rows = [
      ...qualifyingDay(D4, 'd4'),
      row('d5-1', D5, 9),
      row('d5-2', D5, 10, { completeInterval: null }),
    ]
    expect(deriveSuggestion({ day: 8, currentTargetSeconds: 900, rows, realm: 'demo' })).toBeNull()
  })

  it('(9) benchmark rows ignored even with output yes', () => {
    const rows = [
      ...qualifyingDay(D4, 'd4'),
      row('d5-1', D5, 9),
      row('d5-2', D5, 10, { kind: 'benchmark', targetSeconds: 1200 }),
    ]
    expect(deriveSuggestion({ day: 8, currentTargetSeconds: 900, rows, realm: 'demo' })).toBeNull()
  })

  it('(10) abandoned rows ignored', () => {
    const rows = [
      ...qualifyingDay(D4, 'd4'),
      row('d5-1', D5, 9),
      row('d5-2', D5, 10, { lifecycle: 'abandoned' }),
    ]
    expect(deriveSuggestion({ day: 8, currentTargetSeconds: 900, rows, realm: 'demo' })).toBeNull()
  })

  it("(11) a row with realm 'pilot' among demo rows -> throws RealmMixingError", () => {
    const rows = [
      ...qualifyingDay(D4, 'd4'),
      row('d5-1', D5, 9, { realm: 'pilot' }),
      row('d5-2', D5, 10),
    ]
    expect(() =>
      deriveSuggestion({ day: 8, currentTargetSeconds: 900, rows, realm: 'demo' }),
    ).toThrow(RealmMixingError)
  })

  it('(12) after acceptance (current target 1200 on day 8, prior days at 900) -> null', () => {
    const rows = [...qualifyingDay(D4, 'd4', 900), ...qualifyingDay(D5, 'd5', 900)]
    expect(
      deriveSuggestion({ day: 8, currentTargetSeconds: 1200, rows, realm: 'demo' }),
    ).toBeNull()
  })

  it('(13) Days 1-2 qualifying at 300s on day 3 -> 600 (ceiling 600 permits)', () => {
    const rows = [...qualifyingDay(D1, 'd1', 300), ...qualifyingDay(D2, 'd2', 300)]
    expect(deriveSuggestion({ day: 3, currentTargetSeconds: 300, rows, realm: 'demo' })).toEqual({
      suggestedTargetSeconds: 600,
      qualifiedOn: [D1, D2],
    })
  })

  it('(14) Days 1-2 qualifying at 600s on day 3 -> null (ceiling 600 reached)', () => {
    const rows = [...qualifyingDay(D1, 'd1', 600), ...qualifyingDay(D2, 'd2', 600)]
    expect(
      deriveSuggestion({ day: 3, currentTargetSeconds: 600, rows, realm: 'demo' }),
    ).toBeNull()
  })

  it('(15) day 15 -> null regardless of rows', () => {
    const rows = [...qualifyingDay(D4, 'd4'), ...qualifyingDay(D5, 'd5')]
    expect(
      deriveSuggestion({ day: 15, currentTargetSeconds: 900, rows, realm: 'demo' }),
    ).toBeNull()
  })

  it('(16) a third practice session on a qualifying day is not passed to suggestProgression', () => {
    // Day 4: earliest row does NOT qualify; the next two by startedAt would.
    // "First two by startedAt" keeps [early(fails), mid(qualifies)] and drops
    // late(qualifies) entirely -- so Day 4 ends up with only one qualifying
    // block, not two, even though two of its three rows independently qualify.
    const rows = [
      row('d4-early', D4, 8, { outputQuality: 'no' }),
      row('d4-mid', D4, 9),
      row('d4-late', D4, 10),
      ...qualifyingDay(D5, 'd5'),
    ]

    const records = toPracticeBlockRecords(rows, 'demo')
    const day4Records = records.filter((record) => record.localDate === D4)
    expect(day4Records).toHaveLength(2)
    expect(day4Records.map((record) => record.sessionId).sort()).toEqual(['d4-early', 'd4-mid'])

    expect(deriveSuggestion({ day: 8, currentTargetSeconds: 900, rows, realm: 'demo' })).toBeNull()
  })
})
