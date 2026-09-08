/**
 * 4.5.3 — unit tests for the pure pieces of `GET /programs/{id}/today`:
 * `toTodayResponse` (the response envelope) and `checkinValuesFrom` (the
 * sleep + phone/desktop feed aggregate adapter). Pure functions only — no
 * database; see `test/programs/today.test.ts` for the Fastify inject
 * integration tests against the real database.
 */
import { describe, expect, it } from 'vitest'
import type { TodayBlockValue } from '@attention-lab/shared'

import { checkinValuesFrom, toTodayResponse, type ToTodayResponseInput } from './today.js'

function block(overrides: Partial<TodayBlockValue> = {}): TodayBlockValue {
  return { index: 1, status: 'not_started', targetSeconds: 600, sessionId: null, ...overrides }
}

function baseInput(overrides: Partial<ToTodayResponseInput> = {}): ToTodayResponseInput {
  return {
    day: 4,
    localDate: '2026-09-10',
    blocks: [block({ index: 1 }), block({ index: 2 })],
    checkin: {
      status: 'not_reported',
      missing: ['sleep', 'feed'],
      values: { sleepMinutes: null, phoneFeedMinutes: null, desktopFeedMinutes: null },
    },
    suggestion: null,
    nextAction: { kind: 'practice', block: 1 },
    ...overrides,
  }
}

describe('toTodayResponse', () => {
  it('(1) omits the suggestion key when the suggestion is null and includes { suggestedTargetSeconds, qualifiedOn } when defined', () => {
    const withoutSuggestion = toTodayResponse(baseInput({ suggestion: null }))
    expect('suggestion' in withoutSuggestion).toBe(false)

    const withSuggestion = toTodayResponse(
      baseInput({ suggestion: { suggestedTargetSeconds: 1200, qualifiedOn: ['2026-09-08', '2026-09-09'] } }),
    )
    expect(withSuggestion.suggestion).toEqual({
      suggestedTargetSeconds: 1200,
      qualifiedOn: ['2026-09-08', '2026-09-09'],
    })
  })

  it('(2) output keys are exactly {day, localDate, blocks, checkin, nextAction} (+ suggestion), and checkin keys exactly {status, missing, values} — no streak or missed-day fields', () => {
    const withoutSuggestion = toTodayResponse(baseInput({ suggestion: null }))
    expect(Object.keys(withoutSuggestion).sort()).toEqual(
      ['blocks', 'checkin', 'day', 'localDate', 'nextAction'].sort(),
    )

    const withSuggestion = toTodayResponse(
      baseInput({ suggestion: { suggestedTargetSeconds: 900, qualifiedOn: ['2026-09-04', '2026-09-05'] } }),
    )
    expect(Object.keys(withSuggestion).sort()).toEqual(
      ['blocks', 'checkin', 'day', 'localDate', 'nextAction', 'suggestion'].sort(),
    )
    expect(Object.keys(withSuggestion.checkin).sort()).toEqual(['missing', 'status', 'values'].sort())
  })
})

describe('checkinValuesFrom', () => {
  it('(3) no row -> all three null; sleepMinutes 0 -> 0; an explicit-zero phone feed row -> phoneFeedMinutes 0; desktop with no feed-scope row -> null; a phone app_total-only row -> phoneFeedMinutes null', () => {
    expect(checkinValuesFrom(null, [])).toEqual({
      sleepMinutes: null,
      phoneFeedMinutes: null,
      desktopFeedMinutes: null,
    })

    expect(checkinValuesFrom({ sleepMinutes: 0 }, []).sleepMinutes).toBe(0)

    const phoneZeroValues = checkinValuesFrom({ sleepMinutes: 420 }, [
      {
        device: 'phone',
        platform: 'all',
        minutes: 0,
        shortVideoMinutes: null,
        measurementScope: 'feed',
        source: 'estimate',
        plannedWindow: null,
      },
    ])
    expect(phoneZeroValues.phoneFeedMinutes).toBe(0)
    expect(phoneZeroValues.desktopFeedMinutes).toBeNull()

    const appTotalOnlyValues = checkinValuesFrom({ sleepMinutes: 420 }, [
      {
        device: 'phone',
        platform: 'browser',
        minutes: 60,
        shortVideoMinutes: null,
        measurementScope: 'app_total',
        source: 'device_report',
        plannedWindow: null,
      },
    ])
    expect(appTotalOnlyValues.phoneFeedMinutes).toBeNull()
  })
})
