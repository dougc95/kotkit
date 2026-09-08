/**
 * Task 6.2.4 — pure-function unit tests for `services/report/practice.ts`
 * (`mapPracticeRow`/`mapPracticeRows`) and `services/report/days.ts`
 * (`mapDayRow`/`reportDayRange`). No database; every case below is composed
 * entirely from plain fixture objects.
 */
import { describe, expect, it } from 'vitest'
import type { FeedRowInput } from '@attention-lab/shared'

import type { CheckinRowInput } from '../../src/services/checkinView.js'
import { mapDayRow, reportDayRange } from '../../src/services/report/days.js'
import {
  mapPracticeRow,
  mapPracticeRows,
  type PracticeQueryRow,
} from '../../src/services/report/practice.js'

function basePracticeRow(overrides: Partial<PracticeQueryRow> = {}): PracticeQueryRow {
  return {
    sessionId: 'practice-1',
    kind: 'practice',
    localDate: '2026-01-05',
    startedAt: new Date('2026-01-05T09:00:00.000Z'),
    endedAt: new Date('2026-01-05T09:10:00.000Z'),
    pausedSeconds: 0,
    targetSeconds: 600,
    completeInterval: true,
    lifecycle: 'finalized',
    timerQuality: 'ok',
    revisionId: 'revision-1',
    outputQuality: 'yes',
    episodeCount: 2,
    externalCount: 0,
    unplannedAgentChecks: 0,
    mindWanderingCount: 1,
    countMethod: 'event',
    ...overrides,
  }
}

describe('services/report/practice: mapPracticeRow and mapPracticeRows (unit)', () => {
  it('completedSeconds = ended − started − paused (240 s paused excluded); null when ended_at is null', () => {
    const ended = mapPracticeRow(
      basePracticeRow({
        startedAt: new Date('2026-01-05T09:00:00.000Z'),
        endedAt: new Date('2026-01-05T09:20:00.000Z'),
        pausedSeconds: 240,
      }),
      '2026-01-01',
    )
    expect(ended.completedSeconds).toBe(1200 - 240)

    const running = mapPracticeRow(basePracticeRow({ endedAt: null }), '2026-01-01')
    expect(running.completedSeconds).toBeNull()
  })

  it('blank practice counts stay null', () => {
    const mapped = mapPracticeRow(
      basePracticeRow({
        episodeCount: null,
        externalCount: null,
        unplannedAgentChecks: null,
        mindWanderingCount: null,
        countMethod: null,
      }),
      '2026-01-01',
    )
    expect(mapped.episodeCount).toBeNull()
    expect(mapped.externalCount).toBeNull()
    expect(mapped.unplannedAgentChecks).toBeNull()
    expect(mapped.mindWanderingCount).toBeNull()
    expect(mapped.countMethod).toBeNull()
  })

  it("kind='benchmark' rows are filtered out of practice", () => {
    const practiceRow = basePracticeRow({ sessionId: 'practice-row', kind: 'practice' })
    const benchmarkRow = basePracticeRow({ sessionId: 'benchmark-row', kind: 'benchmark' })

    const mapped = mapPracticeRows([practiceRow, benchmarkRow], '2026-01-01')

    expect(mapped).toHaveLength(1)
    expect(mapped[0]?.sessionId).toBe('practice-row')
    expect(mapped.some((row) => row.sessionId === 'benchmark-row')).toBe(false)
  })

  it('practice row with episode_count 3 and unplanned_agent_checks 2 → both reported as-is and no field equals 5 (nothing summed across tallies)', () => {
    const mapped = mapPracticeRow(
      basePracticeRow({ episodeCount: 3, unplannedAgentChecks: 2 }),
      '2026-01-01',
    )
    expect(mapped.episodeCount).toBe(3)
    expect(mapped.unplannedAgentChecks).toBe(2)
    expect(Object.values(mapped)).not.toContain(5)
  })

  it("running practice session (ended_at null) → listed with lifecycle 'running' and completedSeconds null", () => {
    const mapped = mapPracticeRow(basePracticeRow({ lifecycle: 'running', endedAt: null }), '2026-01-01')
    expect(mapped.lifecycle).toBe('running')
    expect(mapped.completedSeconds).toBeNull()
  })
})

describe('services/report/days: mapDayRow and reportDayRange (unit)', () => {
  it("days builder emits a not_reported, all-null entry for a day with no row and stops at min(today's program day, 14)", () => {
    const missing = mapDayRow(null, [], '2026-01-10', 9)
    expect(missing.status).toBe('not_reported')
    expect(missing.sleepMinutes).toBeNull()
    expect(missing.stress).toBeNull()
    expect(missing.mindfulnessMinutes).toBeNull()
    expect(missing.feedDeviceMinutes).toBeNull()
    expect(missing.feedByDevice).toEqual({ phone: null, desktop: null, tablet: null, unspecified: null })

    expect(reportDayRange(20)).toEqual(Array.from({ length: 15 }, (_, day) => day))
    expect(reportDayRange(3)).toEqual([0, 1, 2, 3])
    expect(reportDayRange(-1)).toEqual([])
  })

  it('daily entry for a desktop-only check-in has feedByDevice.phone null', () => {
    const row: CheckinRowInput = { sleepMinutes: 420, stress: 3, mindfulnessMinutes: null, note: null, version: 1 }
    const feedRows: FeedRowInput[] = [
      {
        device: 'desktop',
        platform: 'all',
        minutes: 30,
        shortVideoMinutes: null,
        measurementScope: 'feed',
        source: 'estimate',
        plannedWindow: null,
      },
    ]

    const mapped = mapDayRow(row, feedRows, '2026-01-05', 4)

    expect(mapped.feedByDevice.phone).toBeNull()
    expect(mapped.feedByDevice.desktop).toBe(30)
    expect(mapped.status).toBe('complete')
  })
})
