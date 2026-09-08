import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

import {
  deriveRemaining,
  elapsedMsForEvent,
  formatRemaining,
  serverNowMs,
  type ClockAnchor,
  type ServerTimerFields,
  type TimerDisplay,
} from './remaining.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('remaining', () => {
  it('refresh at 06:00 of a 15-minute block -> remainingSeconds 540', () => {
    const fields: ServerTimerFields = {
      startedAt: '2026-09-08T10:00:00.000Z',
      targetSeconds: 900,
      pausedSeconds: 0,
      currentPauseStartedAt: null,
      lifecycle: 'running',
    }
    const anchor: ClockAnchor = {
      serverNowAtLoadMs: Date.parse('2026-09-08T10:06:00.000Z'),
      monotonicAtLoadMs: 0,
    }

    const result = deriveRemaining(fields, anchor, 0)

    expect(result.elapsedSeconds).toBe(360)
    expect(result.remainingSeconds).toBe(540)
    expect(result.display).toBe('running')
  })

  it('240 paused seconds are excluded from elapsed', () => {
    const fields: ServerTimerFields = {
      startedAt: '2026-09-08T10:00:00.000Z',
      targetSeconds: 1200,
      pausedSeconds: 240,
      currentPauseStartedAt: null,
      lifecycle: 'running',
    }
    const anchor: ClockAnchor = {
      serverNowAtLoadMs: Date.parse('2026-09-08T10:10:00.000Z'),
      monotonicAtLoadMs: 0,
    }

    const result = deriveRemaining(fields, anchor, 0)

    // 10 minutes elapsed on the wall clock, minus 240 already-paused seconds.
    expect(result.elapsedSeconds).toBe(360)
  })

  it('currently paused: remaining unchanged while monotonic advances 30 s', () => {
    const fields: ServerTimerFields = {
      startedAt: '2026-09-08T10:00:00.000Z',
      targetSeconds: 1200,
      pausedSeconds: 100,
      currentPauseStartedAt: '2026-09-08T10:05:00.000Z',
      lifecycle: 'paused',
    }
    const anchor: ClockAnchor = {
      serverNowAtLoadMs: Date.parse('2026-09-08T10:05:30.000Z'),
      monotonicAtLoadMs: 0,
    }

    const before = deriveRemaining(fields, anchor, 0)
    const after = deriveRemaining(fields, anchor, 30_000)

    expect(before.display).toBe('paused')
    expect(after.remainingSeconds).toBe(before.remainingSeconds)
    expect(after.elapsedSeconds).toBe(before.elapsedSeconds)
  })

  it('target passed -> remaining 0, deadlineReached true, display deadline_reached', () => {
    const fields: ServerTimerFields = {
      startedAt: '2026-09-08T10:00:00.000Z',
      targetSeconds: 1200,
      pausedSeconds: 0,
      currentPauseStartedAt: null,
      lifecycle: 'running',
    }
    const anchor: ClockAnchor = {
      serverNowAtLoadMs: Date.parse('2026-09-08T10:00:00.000Z'),
      monotonicAtLoadMs: 0,
    }

    // 20 minutes and 5 seconds of monotonic time have passed.
    const result = deriveRemaining(fields, anchor, 1_205_000)

    expect(result.remainingSeconds).toBe(0)
    expect(result.deadlineReached).toBe(true)
    expect(result.display).toBe('deadline_reached')
  })

  it('display union contains no completed value (expectTypeOf)', () => {
    expectTypeOf<ReturnType<typeof deriveRemaining>['display']>().toEqualTypeOf<TimerDisplay>()
    expectTypeOf<TimerDisplay>().toEqualTypeOf<
      'running' | 'paused' | 'deadline_reached' | 'awaiting_review' | 'ended'
    >()
  })

  it('Date.now mocked 1 h off has no effect on the result', () => {
    const fields: ServerTimerFields = {
      startedAt: '2026-09-08T10:00:00.000Z',
      targetSeconds: 900,
      pausedSeconds: 0,
      currentPauseStartedAt: null,
      lifecycle: 'running',
    }
    const anchor: ClockAnchor = {
      serverNowAtLoadMs: Date.parse('2026-09-08T10:06:00.000Z'),
      monotonicAtLoadMs: 0,
    }

    const unmocked = deriveRemaining(fields, anchor, 0)

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-08T11:06:00.000Z'))
    const mocked = deriveRemaining(fields, anchor, 0)

    expect(mocked).toEqual(unmocked)
    expect(mocked.remainingSeconds).toBe(540)
  })

  it('elapsedMsForEvent 100 ms apart differs by exactly 100 ms', () => {
    const fields: ServerTimerFields = {
      startedAt: '2026-09-08T10:00:00.000Z',
      targetSeconds: 900,
      pausedSeconds: 0,
      currentPauseStartedAt: null,
      lifecycle: 'running',
    }
    const anchor: ClockAnchor = {
      serverNowAtLoadMs: Date.parse('2026-09-08T10:00:00.000Z'),
      monotonicAtLoadMs: 0,
    }

    const a = elapsedMsForEvent(fields, anchor, 1_000)
    const b = elapsedMsForEvent(fields, anchor, 1_100)

    expect(b - a).toBe(100)
  })

  it('serverNowMs advances exactly with the monotonic delta', () => {
    const anchor: ClockAnchor = {
      serverNowAtLoadMs: Date.parse('2026-09-08T10:00:00.000Z'),
      monotonicAtLoadMs: 1_000,
    }

    expect(serverNowMs(anchor, 1_000)).toBe(anchor.serverNowAtLoadMs)
    expect(serverNowMs(anchor, 31_000) - serverNowMs(anchor, 1_000)).toBe(30_000)
  })

  it('formatRemaining(-5) is 00:00 and formatRemaining(540) is 09:00', () => {
    expect(formatRemaining(-5)).toBe('00:00')
    expect(formatRemaining(540)).toBe('09:00')
  })
})
