import { describe, expect, it } from 'vitest'
import { feedAggregates, validateFeedRows, type FeedRowInput } from '../../src/domain/feed.js'

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

describe('domain/feed: feedAggregates', () => {
  it('phone Instagram app_total 60 alongside phone Instagram feed 25 → feedDeviceMinutes 25 and appTotals contains the 60', () => {
    const rows = [
      row({ platform: 'instagram', minutes: 60, measurementScope: 'app_total' }),
      row({ platform: 'instagram', minutes: 25, measurementScope: 'feed' }),
    ]
    const result = feedAggregates(rows)
    expect(result.feedDeviceMinutes).toBe(25)
    expect(result.appTotals).toHaveLength(1)
    expect(result.appTotals[0]?.minutes).toBe(60)
  })

  it('phone all 20 + desktop all 20 → 40 with unitLabel device-minutes, feedByDevice {phone 20, desktop 20}, partial false', () => {
    const rows = [
      row({ device: 'phone', minutes: 20 }),
      row({ device: 'desktop', minutes: 20 }),
    ]
    const result = feedAggregates(rows)
    expect(result.unitLabel).toBe('device-minutes')
    expect(result.feedDeviceMinutes).toBe(40)
    expect(result.feedByDevice.phone).toBe(20)
    expect(result.feedByDevice.desktop).toBe(20)
    expect(result.partial).toBe(false)
  })

  it('desktop all 20 only → feedByDevice.phone null, partial true, total 20', () => {
    const rows = [row({ device: 'desktop', minutes: 20 })]
    const result = feedAggregates(rows)
    expect(result.feedByDevice.phone).toBeNull()
    expect(result.partial).toBe(true)
    expect(result.feedDeviceMinutes).toBe(20)
  })

  it('explicit phone all 0 row → feedByDevice.phone 0, included, partial false with desktop present', () => {
    const rows = [row({ device: 'phone', minutes: 0 }), row({ device: 'desktop', minutes: 20 })]
    const result = feedAggregates(rows)
    expect(result.feedByDevice.phone).toBe(0)
    expect(result.partial).toBe(false)
    expect(result.feedDeviceMinutes).toBe(20)
  })

  it('no rows → feedDeviceMinutes null, never 0', () => {
    const result = feedAggregates([])
    expect(result.feedDeviceMinutes).toBeNull()
    expect(result.feedByDevice.phone).toBeNull()
    expect(result.feedByDevice.desktop).toBeNull()
  })

  it('short-video 45 on a 30-minute row → feed_subset_violation naming the subset rule', () => {
    const result = validateFeedRows([row({ minutes: 30, shortVideoMinutes: 45 })])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected validation failure')
    expect(result.errors[0]?.code).toBe('feed_subset_violation')
    expect(result.errors[0]?.message).toMatch(/subset/)
  })

  it('short-video 20 on a 30-minute row → total 30 (subset not added)', () => {
    const rows = [row({ minutes: 30, shortVideoMinutes: 20 })]
    expect(validateFeedRows(rows).ok).toBe(true)
    const result = feedAggregates(rows)
    expect(result.feedDeviceMinutes).toBe(30)
    expect(result.shortVideoDeviceMinutes).toBe(20)
  })

  it('duplicate device/platform/scope → duplicate_feed_row', () => {
    const rows = [
      row({ device: 'phone', platform: 'instagram', measurementScope: 'feed', minutes: 10 }),
      row({ device: 'phone', platform: 'instagram', measurementScope: 'feed', minutes: 12 }),
    ]
    const result = validateFeedRows(rows)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected validation failure')
    expect(result.errors.some((e) => e.code === 'duplicate_feed_row')).toBe(true)
  })

  it('phone all 30 together with phone instagram feed 10 → feed_platform_conflict; phone all 30 with desktop youtube feed 10 → ok and feedByDevice.phone 30', () => {
    const conflicting = [
      row({ device: 'phone', platform: 'all', minutes: 30 }),
      row({ device: 'phone', platform: 'instagram', minutes: 10 }),
    ]
    const conflictResult = validateFeedRows(conflicting)
    expect(conflictResult.ok).toBe(false)
    if (conflictResult.ok) throw new Error('expected validation failure')
    expect(conflictResult.errors.some((e) => e.code === 'feed_platform_conflict')).toBe(true)

    const okRows = [
      row({ device: 'phone', platform: 'all', minutes: 30 }),
      row({ device: 'desktop', platform: 'youtube', minutes: 10 }),
    ]
    expect(validateFeedRows(okRows).ok).toBe(true)
    expect(feedAggregates(okRows).feedByDevice.phone).toBe(30)
  })

  it('an all row with scope app_total or source device_report → feed_platform_conflict', () => {
    const wrongScope = validateFeedRows([
      row({ platform: 'all', measurementScope: 'app_total', minutes: 10 }),
    ])
    expect(wrongScope.ok).toBe(false)
    if (wrongScope.ok) throw new Error('expected validation failure')
    expect(wrongScope.errors.some((e) => e.code === 'feed_platform_conflict')).toBe(true)

    const wrongSource = validateFeedRows([
      row({ platform: 'all', source: 'device_report', minutes: 10 }),
    ])
    expect(wrongSource.ok).toBe(false)
    if (wrongSource.ok) throw new Error('expected validation failure')
    expect(wrongSource.errors.some((e) => e.code === 'feed_platform_conflict')).toBe(true)
  })

  it('phone instagram feed 10 + phone youtube feed 15 with no all row → feedByDevice.phone 25', () => {
    const rows = [
      row({ device: 'phone', platform: 'instagram', minutes: 10 }),
      row({ device: 'phone', platform: 'youtube', minutes: 15 }),
    ]
    expect(validateFeedRows(rows).ok).toBe(true)
    expect(feedAggregates(rows).feedByDevice.phone).toBe(25)
  })

  it('55 minutes against a 20-minute allowance validates (no allowance rule)', () => {
    const rows = [row({ device: 'phone', minutes: 55 })]
    expect(validateFeedRows(rows).ok).toBe(true)
    expect(feedAggregates(rows).feedDeviceMinutes).toBe(55)
  })

  it('device_report source is carried through unchanged', () => {
    const original = row({
      device: 'desktop',
      platform: 'youtube',
      minutes: 12,
      source: 'device_report',
    })
    const rows = [original]
    expect(validateFeedRows(rows).ok).toBe(true)
    expect(feedAggregates(rows).feedByDevice.desktop).toBe(12)
    expect(rows[0]).toEqual(original)
    expect(rows[0]?.source).toBe('device_report')
  })
})
