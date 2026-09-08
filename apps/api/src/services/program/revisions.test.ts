/**
 * 4.4.1 — unit tests for the pure helpers behind `POST
 * /programs/{id}/revisions`: `nextRevisionNumber`, `normalizeReason`,
 * `effectiveDayAllowed`, `composeSettings`. Pure — no database; the route's
 * transactional behavior (`createRevision`) is covered by
 * `test/programs/revisions.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_BAND_CEILINGS } from '@attention-lab/shared'

import { MalformedError } from '../../errors.js'
import { composeSettings, effectiveDayAllowed, nextRevisionNumber, normalizeReason } from './revisions.js'

describe('nextRevisionNumber', () => {
  it('(1) nextRevisionNumber([1,2]) = 3, ([]) = 1', () => {
    expect(nextRevisionNumber([1, 2])).toBe(3)
    expect(nextRevisionNumber([])).toBe(1)
  })
})

describe('normalizeReason', () => {
  it('(2) normalizeReason(\'   \') rejected with fieldErrors.reason, (\' more time \') accepted and trimmed to \'more time\'', () => {
    try {
      normalizeReason('   ')
      expect.unreachable('expected normalizeReason to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(MalformedError)
      expect((err as MalformedError).fieldErrors).toEqual({ reason: 'is required' })
    }

    expect(normalizeReason(' more time ')).toBe('more time')
  })
})

describe('effectiveDayAllowed', () => {
  it('(3) current day 8 accepts 8 and 14, rejects 7 and 15; current day -1 accepts 0', () => {
    expect(effectiveDayAllowed(8, 8)).toBe(true)
    expect(effectiveDayAllowed(14, 8)).toBe(true)
    expect(effectiveDayAllowed(7, 8)).toBe(false)
    expect(effectiveDayAllowed(15, 8)).toBe(false)
    expect(effectiveDayAllowed(0, -1)).toBe(true)
  })
})

describe('composeSettings', () => {
  it('(4) fills bandCeilings from BAND_CEILINGS and leisureAllowanceMin from the program row when omitted, and keeps an explicit body leisureAllowanceMin', () => {
    const omitted = composeSettings({ practiceTargetSeconds: 900 }, { leisureAllowanceMin: 30 })
    expect(omitted).toEqual({
      practiceTargetSeconds: 900,
      bandCeilings: DEFAULT_BAND_CEILINGS,
      leisureAllowanceMin: 30,
    })

    const explicit = composeSettings(
      { practiceTargetSeconds: 900, leisureAllowanceMin: 45 },
      { leisureAllowanceMin: 30 },
    )
    expect(explicit.leisureAllowanceMin).toBe(45)
    expect(explicit.bandCeilings).toEqual(DEFAULT_BAND_CEILINGS)
  })
})
