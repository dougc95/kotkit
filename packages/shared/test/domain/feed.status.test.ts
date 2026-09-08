import { describe, expect, it } from 'vitest'
import {
  checkinStatus,
  checkinValues,
  type CheckinSleep,
  type FeedRowInput,
} from '../../src/domain/feed.js'

function row(overrides: Partial<FeedRowInput> = {}): FeedRowInput {
  return {
    device: 'phone',
    platform: 'all',
    minutes: 0,
    shortVideoMinutes: null,
    measurementScope: 'feed',
    source: 'estimate',
    plannedWindow: null,
    ...overrides,
  }
}

describe('domain/feed: checkinStatus', () => {
  it('sleep only → incomplete, missing [feed]', () => {
    const checkin: CheckinSleep = { sleepMinutes: 420 }
    const result = checkinStatus(checkin, [])
    expect(result.status).toBe('incomplete')
    expect(result.missing).toEqual(['feed'])
  })

  it('one feed row only → incomplete, missing [sleep]', () => {
    const checkin: CheckinSleep = { sleepMinutes: null }
    const result = checkinStatus(checkin, [row({ device: 'phone', minutes: 15 })])
    expect(result.status).toBe('incomplete')
    expect(result.missing).toEqual(['sleep'])
  })

  it('sleep + explicit-zero phone all row → complete', () => {
    const checkin: CheckinSleep = { sleepMinutes: 420 }
    const result = checkinStatus(checkin, [row({ device: 'phone', minutes: 0 })])
    expect(result.status).toBe('complete')
    expect(result.missing).toEqual([])
  })

  it('sleep 0 (explicit) is reported, not missing', () => {
    const checkin: CheckinSleep = { sleepMinutes: 0 }
    const result = checkinStatus(checkin, [row({ device: 'phone', minutes: 5 })])
    expect(result.status).toBe('complete')
    expect(result.missing).not.toContain('sleep')
  })

  it('existing check-in with sleep null and no rows → incomplete with missing [sleep, feed], never complete by existence', () => {
    const checkin: CheckinSleep = { sleepMinutes: null }
    const result = checkinStatus(checkin, [])
    expect(result.status).toBe('incomplete')
    expect(result.missing).toEqual(['sleep', 'feed'])
  })

  it('no check-in → not_reported with missing [sleep, feed]', () => {
    const result = checkinStatus(null, [])
    expect(result.status).toBe('not_reported')
    expect(result.missing).toEqual(['sleep', 'feed'])
  })

  it('sleep + app_total-only row → incomplete, missing [feed] (D36)', () => {
    const checkin: CheckinSleep = { sleepMinutes: 420 }
    const result = checkinStatus(checkin, [
      row({ device: 'phone', platform: 'instagram', minutes: 60, measurementScope: 'app_total' }),
    ])
    expect(result.status).toBe('incomplete')
    expect(result.missing).toEqual(['feed'])
  })

  it('sleep + one platform feed row without an all row → complete', () => {
    const checkin: CheckinSleep = { sleepMinutes: 420 }
    const result = checkinStatus(checkin, [
      row({ device: 'phone', platform: 'instagram', minutes: 10, measurementScope: 'feed' }),
    ])
    expect(result.status).toBe('complete')
    expect(result.missing).toEqual([])
  })

  it('checkinValues: no rows → phone and desktop null; phone all 25 + desktop youtube 10 + desktop twitter 5 → {phone 25, desktop 15}; sleep null stays null', () => {
    const noRows = checkinValues({ sleepMinutes: null }, [])
    expect(noRows).toEqual({ sleepMinutes: null, phoneFeedMinutes: null, desktopFeedMinutes: null })

    const withRows = checkinValues({ sleepMinutes: 420 }, [
      row({ device: 'phone', platform: 'all', minutes: 25 }),
      row({ device: 'desktop', platform: 'youtube', minutes: 10 }),
      row({ device: 'desktop', platform: 'twitter', minutes: 5 }),
    ])
    expect(withRows).toEqual({ sleepMinutes: 420, phoneFeedMinutes: 25, desktopFeedMinutes: 15 })
  })
})
