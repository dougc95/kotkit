/**
 * Ticking wrapper over `remaining.ts`'s pure derivation (7.2.1) and
 * `gapDetector.ts`'s heartbeat (7.2.2) — the only place in the client that
 * runs a `setInterval` against session time (D5).
 *
 * A `ClockAnchor` (server time + the monotonic clock, at the same instant)
 * is captured whenever `input.serverNowMs` changes — a load, a pause/resume
 * or any other transition response all carry a fresh D20 `serverNow`. The
 * 1-second interval below never accumulates time itself: it only bumps a
 * counter to force a re-render, and every render re-reads `performance.now()`
 * and re-derives from the anchor via `deriveRemaining`/`elapsedMsForEvent`.
 * A throttled or entirely missed tick therefore loses nothing (the next
 * render, whenever it happens, still reflects the true monotonic delta), and
 * a burst of extra ticks gains nothing (repeated derivation from the same
 * instant is idempotent).
 *
 * `input === null` means the server has not acknowledged a session yet (no
 * `GET /sessions/active` result) — no timer, no detector, nothing runs, and
 * the hook returns `null`.
 *
 * See specs/session-recovery/spec.md ("Reload recovers the active session",
 * "Starting a session requires the server", "Clock gaps are detected and
 * resolved by the user" / "Deadline passed during sleep") and D5/D20.
 */
import { useEffect, useRef, useState } from 'react'
import { createGapDetector, type GapEvent } from './gapDetector.js'
import {
  deriveRemaining,
  elapsedMsForEvent,
  serverNowMs as deriveServerNowMs,
  type ClockAnchor,
  type ServerTimerFields,
  type TimerDisplay,
} from './remaining.js'

export interface UseSessionClockInput {
  readonly fields: ServerTimerFields
  /**
   * `Date.parse(response.serverNow)` — D20's `serverNow` ISO field, read
   * from the SAME session response `fields` came from (`GET
   * /sessions/active`, `GET /sessions/{id}`, or any transition response).
   */
  readonly serverNowMs: number
}

/** One detected, not-yet-acknowledged clock gap (7.2.2's `GapEvent`, held as
 * hook state until `acknowledgeGap()` clears it). */
export interface SessionClockGap {
  readonly gapSeconds: number
  readonly detectedAtMs: number
}

export interface SessionClock {
  readonly remainingSeconds: number
  readonly display: TimerDisplay
  readonly deadlineReached: boolean
  /**
   * The timing fields of one `POST /sessions/{id}/events` batch item —
   * `elapsedMs` (unclamped, `elapsedMsForEvent`) and `occurredAt` (this
   * hook's own anchor turned back into a wall-clock ISO string). The caller
   * (7.3.3's `useOutbox`) adds `clientEventId`, `type` and `details`.
   */
  stampEvent(): { elapsedMs: number; occurredAt: string }
  readonly gap: SessionClockGap | null
  acknowledgeGap(): void
}

const TICK_INTERVAL_MS = 1000

/** Lifecycles the heartbeat and the 1 s re-render tick run under. Every
 * other lifecycle (`awaiting_review`, `finalized`, `abandoned`) is a static
 * end state: nothing to keep ticking or watching for drift in. */
function isTicking(lifecycle: ServerTimerFields['lifecycle']): boolean {
  return lifecycle === 'running' || lifecycle === 'paused'
}

/**
 * `useSessionClock(input)` — `input` is `null` for a session the server has
 * not (yet) acknowledged; that never starts a timer or a detector.
 */
export function useSessionClock(input: UseSessionClockInput | null): SessionClock | null {
  const fields = input?.fields ?? null
  const active = fields !== null && isTicking(fields.lifecycle)

  // The anchor is re-derived synchronously during render whenever
  // `input.serverNowMs` changes, rather than in an effect: an effect would
  // leave the very first render (and the first render after any transition)
  // one tick stale, computing against the PREVIOUS anchor for one frame.
  // This is React's documented pattern for deriving state from a changed
  // prop without an extra render (comparing against a ref, not calling
  // setState) — see https://react.dev/learn/you-might-not-need-an-effect.
  const anchorRef = useRef<ClockAnchor | null>(null)
  const lastServerNowMsRef = useRef<number | null>(null)
  if (input === null) {
    anchorRef.current = null
    lastServerNowMsRef.current = null
  } else if (input.serverNowMs !== lastServerNowMsRef.current) {
    anchorRef.current = { serverNowAtLoadMs: input.serverNowMs, monotonicAtLoadMs: performance.now() }
    lastServerNowMsRef.current = input.serverNowMs
  }

  // 1 s re-render tick. Deliberately holds no elapsed total of its own —
  // see the module doc comment.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setTick((count) => count + 1), TICK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [active])

  // Heartbeat gap detection (7.2.2). Mounted only while running/paused;
  // stopped (unmounted) on awaiting_review/finalized/abandoned/null input,
  // per the task brief. The detector posts nothing and records nothing —
  // it only reports drift, which becomes hook state here until a caller
  // (8.10) resolves it and calls acknowledgeGap().
  const [gap, setGap] = useState<SessionClockGap | null>(null)
  useEffect(() => {
    if (!active) return
    const detector = createGapDetector({
      onGap: (event: GapEvent) => setGap({ gapSeconds: event.gapSeconds, detectedAtMs: event.detectedAtMs }),
    })
    detector.start()
    return () => detector.stop()
  }, [active])

  if (input === null || fields === null || anchorRef.current === null) {
    return null
  }

  const anchor = anchorRef.current
  const derived = deriveRemaining(fields, anchor, performance.now())

  function stampEvent(): { elapsedMs: number; occurredAt: string } {
    const monotonicNowMs = performance.now()
    const elapsedMs = elapsedMsForEvent(fields as ServerTimerFields, anchor, monotonicNowMs)
    const occurredAt = new Date(deriveServerNowMs(anchor, monotonicNowMs)).toISOString()
    return { elapsedMs, occurredAt }
  }

  function acknowledgeGap(): void {
    setGap(null)
  }

  return {
    remainingSeconds: derived.remainingSeconds,
    display: derived.display,
    deadlineReached: derived.deadlineReached,
    stampEvent,
    gap,
    acknowledgeGap,
  }
}
