import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerTimerFields } from './remaining.js'
import { useSessionClock, type SessionClock, type UseSessionClockInput } from './useSessionClock.js'

const START_ISO = '2026-09-08T10:00:00.000Z'
const START_MS = Date.parse(START_ISO)

function runningFields(overrides: Partial<ServerTimerFields> = {}): ServerTimerFields {
  return {
    startedAt: START_ISO,
    targetSeconds: 1200,
    pausedSeconds: 0,
    currentPauseStartedAt: null,
    lifecycle: 'running',
    ...overrides,
  }
}

/**
 * `performance.now()` is replaced with a plain, test-controlled stub (rather
 * than trusting `vi.useFakeTimers()`'s own faked `performance`) so a test can
 * move the monotonic clock independently of the fake wall clock — the
 * decoupling clock-gap detection depends on.
 */
let monoMs = 0

beforeEach(() => {
  vi.useFakeTimers()
  monoMs = 0
  vi.spyOn(performance, 'now').mockImplementation(() => monoMs)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Advances the fake wall clock and the monotonic stub together, one second
 * at a time, so the heartbeat detector (5 s cadence) never observes drift
 * from a test that isn't about drift. */
function tickSecondsInLockstep(count: number): void {
  act(() => {
    for (let i = 0; i < count; i++) {
      monoMs += 1000
      vi.advanceTimersByTime(1000)
    }
  })
}

function currentClock(result: { current: SessionClock | null }): SessionClock {
  const clock = result.current
  if (clock === null) {
    throw new Error('expected useSessionClock to return a SessionClock, got null')
  }
  return clock
}

describe('useSessionClock', () => {
  it('advancing 90 s reduces remainingSeconds by 90', () => {
    const input: UseSessionClockInput = { fields: runningFields(), serverNowMs: START_MS }
    const { result } = renderHook((props: UseSessionClockInput | null) => useSessionClock(props), {
      initialProps: input,
    })

    expect(currentClock(result).remainingSeconds).toBe(1200)

    tickSecondsInLockstep(90)

    const clock = currentClock(result)
    expect(clock.remainingSeconds).toBe(1110)
    expect(clock.display).toBe('running')

    // stampEvent's timing fields ride the same anchor: ~90 s elapsed, and a
    // real ISO timestamp for the POST /sessions/{id}/events item shape.
    const stamped = clock.stampEvent()
    expect(stamped.elapsedMs).toBe(90_000)
    expect(() => new Date(stamped.occurredAt).toISOString()).not.toThrow()
    expect(stamped.occurredAt).toBe(new Date(stamped.occurredAt).toISOString())
  })

  it('performance.now jumps +90 s while only three 1 s ticks fire -> still −90 s (no accumulation)', () => {
    const input: UseSessionClockInput = { fields: runningFields(), serverNowMs: START_MS }
    const { result } = renderHook((props: UseSessionClockInput | null) => useSessionClock(props), {
      initialProps: input,
    })

    expect(currentClock(result).remainingSeconds).toBe(1200)

    act(() => {
      // A single, instantaneous jump — not 90 incremental steps.
      monoMs = 90_000
      // Only 3 s of fake wall time passes: three 1 s re-render ticks fire,
      // and the 5 s heartbeat does not fire at all (3 000 ms < 5 000 ms).
      vi.advanceTimersByTime(3000)
    })

    // If the hook accumulated "3 ticks x 1 000 ms" it would show 1 197 s
    // remaining. It must instead reflect the true (stubbed) monotonic delta.
    expect(currentClock(result).remainingSeconds).toBe(1110)
  })

  it('new input with lifecycle paused freezes remaining', () => {
    const running: UseSessionClockInput = { fields: runningFields(), serverNowMs: START_MS }
    const { result, rerender } = renderHook((props: UseSessionClockInput | null) => useSessionClock(props), {
      initialProps: running,
    })

    tickSecondsInLockstep(100)
    expect(currentClock(result).remainingSeconds).toBe(1100)

    const pauseInstantMs = START_MS + 100_000
    const paused: UseSessionClockInput = {
      fields: runningFields({ lifecycle: 'paused', currentPauseStartedAt: new Date(pauseInstantMs).toISOString() }),
      serverNowMs: pauseInstantMs,
    }
    rerender(paused)

    expect(currentClock(result).remainingSeconds).toBe(1100)
    expect(currentClock(result).display).toBe('paused')

    // Time keeps passing on both clocks, but a paused session's remaining
    // time is invariant to it.
    tickSecondsInLockstep(50)

    expect(currentClock(result).remainingSeconds).toBe(1100)
    expect(currentClock(result).display).toBe('paused')
  })

  it('past the deadline display is deadline_reached and no completion value is ever returned', () => {
    const input: UseSessionClockInput = {
      fields: runningFields({ targetSeconds: 120 }),
      serverNowMs: START_MS,
    }
    const { result } = renderHook((props: UseSessionClockInput | null) => useSessionClock(props), {
      initialProps: input,
    })

    tickSecondsInLockstep(130)

    const clock = currentClock(result)
    expect(clock.remainingSeconds).toBe(0)
    expect(clock.deadlineReached).toBe(true)
    expect(clock.display).toBe('deadline_reached')

    // The exact, closed set of properties this hook ever returns — no
    // `completed`/`isComplete`/anything else masquerading as a server
    // confirmation the client alone is not allowed to make (D24).
    expect(new Set(Object.keys(clock))).toEqual(
      new Set(['remainingSeconds', 'display', 'deadlineReached', 'stampEvent', 'gap', 'acknowledgeGap']),
    )
  })

  it('wall jump +300 s -> gap.gapSeconds 300; acknowledgeGap() clears it', () => {
    const wallAtMountMs = Date.now()
    const input: UseSessionClockInput = { fields: runningFields(), serverNowMs: START_MS }
    const { result } = renderHook((props: UseSessionClockInput | null) => useSessionClock(props), {
      initialProps: input,
    })

    expect(currentClock(result).gap).toBeNull()

    act(() => {
      // Wall clock jumps 300 s ahead (a system clock change / laptop
      // waking); the monotonic stub only advances the ordinary 5 s the
      // heartbeat's next tick is due at.
      vi.setSystemTime(wallAtMountMs + 300_000)
      monoMs += 5000
      vi.advanceTimersByTime(5000)
    })

    const gap = currentClock(result).gap
    expect(gap).not.toBeNull()
    expect(gap?.gapSeconds).toBe(300)
    expect(typeof gap?.detectedAtMs).toBe('number')

    act(() => {
      currentClock(result).acknowledgeGap()
    })

    expect(currentClock(result).gap).toBeNull()
  })

  it('document.hidden true plus visibilitychange for 3 min -> gap null, no callback invoked, remaining keeps counting (hidden tab creates nothing)', () => {
    const hiddenGetter = vi.fn(() => true)
    Object.defineProperty(document, 'hidden', { configurable: true, get: hiddenGetter })

    try {
      const input: UseSessionClockInput = { fields: runningFields(), serverNowMs: START_MS }
      const { result } = renderHook((props: UseSessionClockInput | null) => useSessionClock(props), {
        initialProps: input,
      })

      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })

      expect(currentClock(result).gap).toBeNull()

      // 3 minutes, in lockstep (no drift) — the detector must stay quiet
      // regardless of the hidden tab, and the countdown must keep moving.
      tickSecondsInLockstep(180)

      const clock = currentClock(result)
      expect(clock.gap).toBeNull()
      expect(clock.remainingSeconds).toBe(1200 - 180)
    } finally {
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => false,
      })
    }
  })

  it('null input returns null and no setInterval or detector tick occurs over 60 s of fake time', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')

    const { result } = renderHook((props: UseSessionClockInput | null) => useSessionClock(props), {
      initialProps: null as UseSessionClockInput | null,
    })

    expect(result.current).toBeNull()

    tickSecondsInLockstep(60)

    expect(result.current).toBeNull()
    expect(setIntervalSpy).not.toHaveBeenCalled()
  })
})
