/**
 * `6.1.1` — unit tests for `buildCheckinView` (`checkinView.ts`). Pure — no
 * database, no Fastify. Builds `FeedRowInput` fixtures directly rather than
 * inserting through drizzle, since `buildCheckinView` only ever reads plain
 * fields off whatever row shape it is handed. Covered end to end by API
 * integration in `test/days.get.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import type { FeedRowInput } from '@attention-lab/shared'

import { buildCheckinView, type CheckinRowInput } from '../../src/services/checkinView.js'

const LOCAL_DATE = '2026-09-10'

function checkinRow(overrides: Partial<CheckinRowInput> = {}): CheckinRowInput {
  return {
    sleepMinutes: null,
    stress: null,
    mindfulnessMinutes: null,
    note: null,
    version: 1,
    ...overrides,
  }
}

function feedRow(overrides: Partial<FeedRowInput> = {}): FeedRowInput {
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

describe('buildCheckinView (unit)', () => {
  it('(1) no row -> checkin all-null with localDate set, feed [], status not_reported with missing [sleep, feed], aggregates.feedDeviceMinutes null, version 0', () => {
    const view = buildCheckinView(null, [], LOCAL_DATE)

    expect(view.checkin).toEqual({
      localDate: LOCAL_DATE,
      sleepMinutes: null,
      stress: null,
      mindfulnessMinutes: null,
      note: null,
    })
    expect(view.feed).toEqual([])
    expect(view.status).toEqual({ status: 'not_reported', missing: ['sleep', 'feed'] })
    expect(view.aggregates.feedDeviceMinutes).toBeNull()
    expect(view.version).toBe(0)
  })

  it('(2) desktop "all" 30 and no phone row -> feedByDevice.phone null, partial true, feedDeviceMinutes 30', () => {
    const view = buildCheckinView(
      checkinRow({ sleepMinutes: 400 }),
      [feedRow({ device: 'desktop', platform: 'all', minutes: 30 })],
      LOCAL_DATE,
    )

    expect(view.aggregates.feedByDevice.phone).toBeNull()
    expect(view.aggregates.partial).toBe(true)
    expect(view.aggregates.feedDeviceMinutes).toBe(30)
  })

  it('(3) phone "all" 0 + desktop "all" 20 -> feedByDevice.phone 0 (not null), partial false, feedDeviceMinutes 20', () => {
    const view = buildCheckinView(
      checkinRow(),
      [
        feedRow({ device: 'phone', platform: 'all', minutes: 0 }),
        feedRow({ device: 'desktop', platform: 'all', minutes: 20 }),
      ],
      LOCAL_DATE,
    )

    expect(view.aggregates.feedByDevice.phone).toBe(0)
    expect(view.aggregates.partial).toBe(false)
    expect(view.aggregates.feedDeviceMinutes).toBe(20)
  })

  it('(4) phone instagram app_total 60 + phone instagram feed 25 -> feedDeviceMinutes 25 and appTotals [{device: phone, platform: instagram, minutes: 60}]', () => {
    const view = buildCheckinView(
      checkinRow(),
      [
        feedRow({
          device: 'phone',
          platform: 'instagram',
          minutes: 60,
          measurementScope: 'app_total',
          source: 'device_report',
        }),
        feedRow({ device: 'phone', platform: 'instagram', minutes: 25, measurementScope: 'feed' }),
      ],
      LOCAL_DATE,
    )

    expect(view.aggregates.feedDeviceMinutes).toBe(25)
    expect(view.aggregates.appTotals).toEqual([
      {
        device: 'phone',
        platform: 'instagram',
        minutes: 60,
        shortVideoMinutes: null,
        measurementScope: 'app_total',
        source: 'device_report',
        plannedWindow: null,
      },
    ])
  })

  it('(5) phone 20 + desktop 20 -> feedDeviceMinutes 40 under unitLabel device-minutes and no elapsed-minutes field exists', () => {
    const view = buildCheckinView(
      checkinRow(),
      [
        feedRow({ device: 'phone', platform: 'all', minutes: 20 }),
        feedRow({ device: 'desktop', platform: 'all', minutes: 20 }),
      ],
      LOCAL_DATE,
    )

    expect(view.aggregates.unitLabel).toBe('device-minutes')
    expect(view.aggregates.feedDeviceMinutes).toBe(40)
    expect('elapsedMinutes' in view.aggregates).toBe(false)
  })

  it('(6) short-video 10 + 5 across two feed rows -> shortVideoDeviceMinutes 15 and feedDeviceMinutes unchanged', () => {
    const view = buildCheckinView(
      checkinRow(),
      [
        feedRow({ device: 'phone', platform: 'all', minutes: 30, shortVideoMinutes: 10 }),
        feedRow({ device: 'desktop', platform: 'all', minutes: 30, shortVideoMinutes: 5 }),
      ],
      LOCAL_DATE,
    )

    expect(view.aggregates.shortVideoDeviceMinutes).toBe(15)
    expect(view.aggregates.feedDeviceMinutes).toBe(60)
  })

  it('(7) sleep only -> status incomplete missing [feed]; sleep null with one feed row -> incomplete missing [sleep] and sleepMinutes stays null', () => {
    const sleepOnly = buildCheckinView(checkinRow({ sleepMinutes: 420 }), [], LOCAL_DATE)
    expect(sleepOnly.status).toEqual({ status: 'incomplete', missing: ['feed'] })

    const feedOnly = buildCheckinView(
      checkinRow({ sleepMinutes: null }),
      [feedRow({ device: 'phone', platform: 'all', minutes: 10 })],
      LOCAL_DATE,
    )
    expect(feedOnly.status).toEqual({ status: 'incomplete', missing: ['sleep'] })
    expect(feedOnly.checkin.sleepMinutes).toBeNull()
  })

  it('(8) every feed row keeps device, platform, minutes, shortVideoMinutes, measurementScope, source, plannedWindow with nulls preserved', () => {
    const view = buildCheckinView(
      checkinRow(),
      [
        feedRow({
          device: 'tablet',
          platform: 'youtube',
          minutes: 12,
          shortVideoMinutes: null,
          measurementScope: 'feed',
          source: 'device_report',
          plannedWindow: true,
        }),
      ],
      LOCAL_DATE,
    )

    expect(view.feed).toEqual([
      {
        device: 'tablet',
        platform: 'youtube',
        minutes: 12,
        shortVideoMinutes: null,
        measurementScope: 'feed',
        source: 'device_report',
        plannedWindow: true,
      },
    ])
  })
})
