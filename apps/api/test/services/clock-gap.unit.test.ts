/**
 * 5.5.1 — unit tests for the pure decision core of `resolveClockGap`
 * (`computeClockGapPatch`, which itself calls `endSession` for
 * `save_incomplete` — `services/session.ts`). Pure — no database, fake
 * `ctx.now`. Covered end to end by API integration in
 * `test/sessions/clock-gap.test.ts`. The last two cases exercise the 2.7
 * `ClockGapBody` contract itself (`packages/shared`), not the service.
 */
import { Value } from '@sinclair/typebox/value'
import { describe, expect, it } from 'vitest'

import { ClockGapBody } from '@attention-lab/shared'
import { computeClockGapPatch } from '../../src/services/session.js'

const NOW = new Date('2026-09-06T10:20:00.000Z')

interface BaseSession {
  readonly lifecycle: 'running' | 'paused' | 'awaiting_review'
  readonly timerQuality: 'ok' | 'uncertain'
  readonly clockGapSeconds: number | null
  readonly pausedSeconds: number
  readonly currentPauseStartedAt: Date | null
  readonly endedAt: Date | null
  readonly completeInterval: boolean | null
}

function baseSession(overrides: Partial<BaseSession> = {}): BaseSession {
  return {
    lifecycle: 'running',
    timerQuality: 'ok',
    clockGapSeconds: null,
    pausedSeconds: 0,
    currentPauseStartedAt: null,
    endedAt: null,
    completeInterval: null,
    ...overrides,
  }
}

describe('computeClockGapPatch — continued', () => {
  it('continued keeps timer_quality ok and records gap', () => {
    const patch = computeClockGapPatch(baseSession(), 300, 'continued', NOW)
    expect(patch.timerQuality).toBe('ok')
    expect(patch.clockGapSeconds).toBe(300)
    expect(patch.lifecycle).toBe('running')
  })

  it('continued after an earlier uncertain does not reset to ok', () => {
    const session = baseSession({ timerQuality: 'uncertain', clockGapSeconds: 100 })
    const patch = computeClockGapPatch(session, 50, 'continued', NOW)
    expect(patch.timerQuality).toBe('uncertain')
    expect(patch.clockGapSeconds).toBe(150)
  })
})

describe('computeClockGapPatch — uncertain', () => {
  it('uncertain sets timer_quality uncertain', () => {
    const patch = computeClockGapPatch(baseSession(), 120, 'uncertain', NOW)
    expect(patch.timerQuality).toBe('uncertain')
    expect(patch.lifecycle).toBe('running')
    expect(patch.endedAt).toBeNull()
  })
})

describe('computeClockGapPatch — clock_gap_seconds accumulation (D26)', () => {
  it('second gap accumulates clock_gap_seconds', () => {
    const session = baseSession({ clockGapSeconds: 300 })
    const patch = computeClockGapPatch(session, 200, 'continued', NOW)
    expect(patch.clockGapSeconds).toBe(500)
  })

  it('NULL clock_gap_seconds becomes gapSeconds without coalescing', () => {
    const session = baseSession({ clockGapSeconds: null })
    const patch = computeClockGapPatch(session, 45, 'uncertain', NOW)
    expect(patch.clockGapSeconds).toBe(45)
  })
})

describe('computeClockGapPatch — save_incomplete (D25)', () => {
  it('save_incomplete on running sets uncertain, ends now, complete_interval false', () => {
    const session = baseSession({ lifecycle: 'running' })
    const patch = computeClockGapPatch(session, 300, 'save_incomplete', NOW)
    expect(patch.timerQuality).toBe('uncertain')
    expect(patch.lifecycle).toBe('awaiting_review')
    expect(patch.endedAt).toEqual(NOW)
    expect(patch.completeInterval).toBe(false)
    expect(patch.currentPauseStartedAt).toBeNull()
  })

  it('save_incomplete during pause folds the open pause into paused_seconds', () => {
    const pauseStartedAt = new Date(NOW.getTime() - 90_000)
    const session = baseSession({
      lifecycle: 'paused',
      pausedSeconds: 60,
      currentPauseStartedAt: pauseStartedAt,
    })
    const patch = computeClockGapPatch(session, 10, 'save_incomplete', NOW)
    expect(patch.lifecycle).toBe('awaiting_review')
    expect(patch.pausedSeconds).toBe(150)
    expect(patch.currentPauseStartedAt).toBeNull()
    expect(patch.endedAt).toEqual(NOW)
    expect(patch.completeInterval).toBe(false)
  })

  it('save_incomplete on awaiting_review keeps ended_at and sets the flags', () => {
    const alreadyEndedAt = new Date('2026-09-06T10:15:00.000Z')
    const session = baseSession({
      lifecycle: 'awaiting_review',
      pausedSeconds: 30,
      endedAt: alreadyEndedAt,
      completeInterval: true,
    })
    const patch = computeClockGapPatch(session, 20, 'save_incomplete', NOW)
    expect(patch.lifecycle).toBe('awaiting_review')
    expect(patch.endedAt).toEqual(alreadyEndedAt)
    expect(patch.pausedSeconds).toBe(30)
    expect(patch.timerQuality).toBe('uncertain')
    expect(patch.completeInterval).toBe(false)
  })

  it('elapsed beyond target still yields complete_interval false', () => {
    // A benchmark started well over 20 minutes ago: an ordinary `end`
    // transition would compute completeInterval true from elapsed >= target,
    // but save_incomplete never lets elapsed decide (D25).
    const session = baseSession({ lifecycle: 'running' })
    const patch = computeClockGapPatch(session, 1500, 'save_incomplete', NOW)
    expect(patch.completeInterval).toBe(false)
  })
})

describe('ClockGapBody contract (2.7)', () => {
  it('negative gapSeconds rejected by contract', () => {
    expect(Value.Check(ClockGapBody, { gapSeconds: -1, resolution: 'continued' })).toBe(false)
  })

  it('unknown resolution rejected by contract', () => {
    expect(Value.Check(ClockGapBody, { gapSeconds: 10, resolution: 'something_else' })).toBe(false)
  })
})
