/**
 * `6.1.2` — unit tests for the pure pieces of `services/checkin.ts`
 * (`normalizeCheckinFields`, `toFeedInsertRow`, `feedValidationDomainError`,
 * `checkVersion`) and, through `feedValidationDomainError`, the D36 feed
 * rules already implemented in `domain/feed.ts`'s `validateFeedRows`. Pure —
 * no database, no Fastify. Covered end to end by the API integration tests
 * in `test/days.put.test.ts`, which this file never re-tests.
 */
import { describe, expect, it } from 'vitest'
import { validateFeedRows, type FeedRowInput, type FeedRowValue } from '@attention-lab/shared'

import {
  checkVersion,
  feedValidationDomainError,
  normalizeCheckinFields,
  toFeedInsertRow,
} from '../../src/services/checkin.js'
import type { CheckinRowInput } from '../../src/services/checkinView.js'

const LOCAL_DATE = '2026-09-10'

function feedRowInput(overrides: Partial<FeedRowInput> = {}): FeedRowInput {
  return {
    device: 'phone',
    platform: 'all',
    minutes: 20,
    shortVideoMinutes: null,
    measurementScope: 'feed',
    source: 'estimate',
    plannedWindow: null,
    ...overrides,
  }
}

function feedRowValue(overrides: Partial<FeedRowValue> = {}): FeedRowValue {
  return {
    device: 'phone',
    platform: 'all',
    minutes: 20,
    measurementScope: 'feed',
    source: 'estimate',
    ...overrides,
  }
}

describe('checkin.ts pure functions (unit)', () => {
  it('(1) absent sleepMinutes/stress/mindfulnessMinutes/note map to null, never 0', () => {
    expect(normalizeCheckinFields({})).toEqual({
      sleepMinutes: null,
      stress: null,
      mindfulnessMinutes: null,
      note: null,
    })

    // An explicit 0 (a genuine measurement) is never confused with "absent".
    expect(
      normalizeCheckinFields({ sleepMinutes: 0, stress: 0, mindfulnessMinutes: 0, note: '' }),
    ).toEqual({ sleepMinutes: 0, stress: 0, mindfulnessMinutes: 0, note: '' })
  })

  it('(2) explicit minutes 0 feed row is kept as 0', () => {
    const row = toFeedInsertRow('checkin-1', feedRowValue({ minutes: 0 }))
    expect(row.minutes).toBe(0)
    expect(row.shortVideoMinutes).toBeNull()
    expect(row.plannedWindow).toBeNull()
  })

  it("(3) shortVideoMinutes 45 over minutes 30 -> code feed_subset_violation with fieldErrors['feed[0].shortVideoMinutes']", () => {
    const result = validateFeedRows([feedRowInput({ minutes: 30, shortVideoMinutes: 45 })])
    const error = feedValidationDomainError(result)

    expect(error).not.toBeNull()
    expect(error?.code).toBe('feed_subset_violation')
    expect(error?.fieldErrors).toEqual({ 'feed[0].shortVideoMinutes': 'must not exceed minutes' })
  })

  it('(4) two rows sharing device+platform+scope -> duplicate_feed_row', () => {
    const row = feedRowInput({ device: 'phone', platform: 'instagram', measurementScope: 'feed' })
    const error = feedValidationDomainError(validateFeedRows([row, row]))

    expect(error?.code).toBe('duplicate_feed_row')
    expect(error?.fieldErrors).toEqual({ 'feed[1]': 'duplicate device, platform and scope' })
  })

  it(
    "(5) phone 'all' + phone instagram feed -> feed_platform_conflict; phone 'all' + desktop instagram -> valid " +
      "(per device); phone 'all' feed + phone instagram app_total -> valid (app_total is not a feed row)",
    () => {
      const allPhone = feedRowInput({ device: 'phone', platform: 'all', measurementScope: 'feed', source: 'estimate' })
      const instaPhoneFeed = feedRowInput({ device: 'phone', platform: 'instagram', measurementScope: 'feed' })
      const instaDesktopFeed = feedRowInput({ device: 'desktop', platform: 'instagram', measurementScope: 'feed' })
      const instaPhoneAppTotal = feedRowInput({
        device: 'phone',
        platform: 'instagram',
        measurementScope: 'app_total',
        source: 'device_report',
      })

      const conflict = feedValidationDomainError(validateFeedRows([allPhone, instaPhoneFeed]))
      expect(conflict?.code).toBe('feed_platform_conflict')

      expect(feedValidationDomainError(validateFeedRows([allPhone, instaDesktopFeed]))).toBeNull()
      expect(feedValidationDomainError(validateFeedRows([allPhone, instaPhoneAppTotal]))).toBeNull()
    },
  )

  it('(6) validation error object contains no note text', () => {
    const noteText = 'private note that must never leak into a validation error'
    const row = feedRowInput({ minutes: 30, shortVideoMinutes: 45 })

    // feedValidationDomainError never even receives `note` — it is built
    // from the feed rows alone, which is exactly what this test documents:
    // the resulting error object cannot carry text it was never given.
    const error = feedValidationDomainError(validateFeedRows([row]))

    expect(error).not.toBeNull()
    const serialized = JSON.stringify({ code: error?.code, message: error?.message, fieldErrors: error?.fieldErrors })
    expect(serialized).not.toContain(noteText)
  })

  it(
    '(7) version check: no row and expectedVersion 0 passes, no row and expectedVersion 1 -> stale_version with ' +
      'details.current.version 0; stored version 2 and expectedVersion 1 -> stale_version carrying the stored view',
    () => {
      const ok = checkVersion(null, [], LOCAL_DATE, 0)
      expect(ok.ok).toBe(true)

      const staleNoRow = checkVersion(null, [], LOCAL_DATE, 1)
      expect(staleNoRow.ok).toBe(false)
      if (!staleNoRow.ok) {
        expect(staleNoRow.current.version).toBe(0)
      }

      const storedRow: CheckinRowInput = {
        sleepMinutes: 400,
        stress: 3,
        mindfulnessMinutes: 10,
        note: null,
        version: 2,
      }
      const staleWithRow = checkVersion(storedRow, [], LOCAL_DATE, 1)
      expect(staleWithRow.ok).toBe(false)
      if (!staleWithRow.ok) {
        expect(staleWithRow.current.version).toBe(2)
        expect(staleWithRow.current.checkin.sleepMinutes).toBe(400)
      }
    },
  )
})
