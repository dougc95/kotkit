import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGapDetector, type GapEvent } from './gapDetector.js'

/** A typed `onGap` spy, matching the style of vi.fn(impl) used elsewhere. */
function gapSpy() {
  return vi.fn((_event: GapEvent) => {})
}

// Controllable wall/monotonic sources. Tests drive both through the fake
// timers so the 5-second heartbeat's setInterval callback observes whatever
// values were set immediately before advancing the clock.
const TICK_MS = 5000
let wallMs: number
let monoMs: number

function now(): number {
  return wallMs
}

function mono(): number {
  return monoMs
}

/** One heartbeat tick with both clocks agreeing (no drift introduced). */
function tickNormally(): void {
  wallMs += TICK_MS
  monoMs += TICK_MS
  vi.advanceTimersByTime(TICK_MS)
}

/**
 * One heartbeat tick where the wall clock additionally jumps by `jumpMs` on
 * top of the normal tick advance while the monotonic clock only advances by
 * the normal tick amount — so the resulting drift equals `jumpMs` exactly,
 * regardless of the tick interval.
 */
function tickWithWallJump(jumpMs: number): void {
  wallMs += TICK_MS + jumpMs
  monoMs += TICK_MS
  vi.advanceTimersByTime(TICK_MS)
}

beforeEach(() => {
  vi.useFakeTimers()
  wallMs = 1_700_000_000_000
  monoMs = 0
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('createGapDetector', () => {
  it('both clocks advance 10 min together over 120 ticks -> onGap never called', () => {
    const onGap = gapSpy()
    const detector = createGapDetector({ now, mono, onGap })
    detector.start()

    for (let i = 0; i < 120; i++) {
      tickNormally()
    }

    expect(onGap).not.toHaveBeenCalled()
    detector.stop()
  })

  it('wall jumps +300 s at one tick -> onGap once with gapSeconds 300', () => {
    const onGap = gapSpy()
    const detector = createGapDetector({ now, mono, onGap })
    detector.start()

    tickWithWallJump(300_000)

    expect(onGap).toHaveBeenCalledTimes(1)
    expect(onGap).toHaveBeenCalledWith({ gapSeconds: 300, detectedAtMs: wallMs })
    detector.stop()
  })

  it('wall jumps +59 s -> no gap (threshold boundary)', () => {
    const onGap = gapSpy()
    const detector = createGapDetector({ now, mono, onGap })
    detector.start()

    tickWithWallJump(59_000)

    expect(onGap).not.toHaveBeenCalled()
    detector.stop()
  })

  it('wall jumps +61 s -> gap', () => {
    const onGap = gapSpy()
    const detector = createGapDetector({ now, mono, onGap })
    detector.start()

    tickWithWallJump(61_000)

    expect(onGap).toHaveBeenCalledTimes(1)
    expect(onGap.mock.calls[0]?.[0].gapSeconds).toBe(61)
    detector.stop()
  })

  it('after a gap the next drift-free tick reports nothing (rebase)', () => {
    const onGap = gapSpy()
    const detector = createGapDetector({ now, mono, onGap })
    detector.start()

    tickWithWallJump(300_000)
    expect(onGap).toHaveBeenCalledTimes(1)

    tickNormally()
    expect(onGap).toHaveBeenCalledTimes(1)

    detector.stop()
  })

  it('clock set back 120 s -> gapSeconds -120', () => {
    const onGap = gapSpy()
    const detector = createGapDetector({ now, mono, onGap })
    detector.start()

    tickWithWallJump(-120_000)

    expect(onGap).toHaveBeenCalledTimes(1)
    expect(onGap.mock.calls[0]?.[0].gapSeconds).toBe(-120)
    detector.stop()
  })

  it('stop() -> no further ticks', () => {
    const onGap = gapSpy()
    const detector = createGapDetector({ now, mono, onGap })
    detector.start()

    tickNormally()
    tickNormally()
    detector.stop()

    // Would be a 300 s gap if the heartbeat were still running.
    tickWithWallJump(300_000)
    tickWithWallJump(300_000)

    expect(onGap).not.toHaveBeenCalled()
  })

  it('visibilitychange with document.hidden true during the run -> onGap not called and no other side effect', () => {
    const addEventListener = vi.fn()
    const removeEventListener = vi.fn()
    const dispatchEvent = vi.fn(() => true)
    const fakeDocument = {
      hidden: true,
      addEventListener,
      removeEventListener,
      dispatchEvent,
    }
    vi.stubGlobal('document', fakeDocument)

    const onGap = gapSpy()
    const detector = createGapDetector({ now, mono, onGap })
    detector.start()

    // 3 minutes of drift-free heartbeats while "hidden".
    for (let i = 0; i < 36; i++) {
      tickNormally()
    }

    const visibilityEvent = new Event('visibilitychange')
    document.dispatchEvent(visibilityEvent)

    expect(onGap).not.toHaveBeenCalled()
    // The detector never subscribes to document events at all.
    expect(addEventListener).not.toHaveBeenCalled()
    expect(removeEventListener).not.toHaveBeenCalled()

    detector.stop()
  })
})
