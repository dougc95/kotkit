/**
 * Server-truth timer derivation (D5): `started_at`, `target_seconds`,
 * `paused_seconds` and `current_pause_started_at` are the source of truth,
 * not a client-accumulated interval. This module is pure and stateless — it
 * never reads `Date.now()` or starts a timer of its own. A caller captures a
 * `ClockAnchor` once per server response (session start, reload, a
 * pause/resume or other transition) and re-derives remaining time against a
 * monotonic clock (`performance.now()`) on every tick; see
 * `useSessionClock.ts` (7.2.3) for the ticking wrapper.
 *
 * `serverNowMs` reconstructs "what time the server would say it is right
 * now" from the anchor plus how far the monotonic clock has moved since the
 * anchor was captured — so a device clock that jumps around (`Date.now()`
 * changing underneath us) never leaks into elapsed/remaining. `deviceClock`
 * (`Date.now()`, wall time) is deliberately never consulted here; drift
 * between it and the monotonic clock is `gapDetector.ts`'s (7.2.2) job.
 *
 * See specs/session-recovery/spec.md ("Reload recovers the active session" —
 * "Refresh during practice", "Refresh after target passed") and D20 (every
 * session response carries a `serverNow` ISO field).
 */

/** The subset of a `SessionResponse` (D20) this module needs. Mirrors
 * `focus_sessions.started_at`, `target_seconds`, `paused_seconds`,
 * `current_pause_started_at` and `lifecycle`. */
export interface ServerTimerFields {
  readonly startedAt: string
  readonly targetSeconds: number
  readonly pausedSeconds: number
  readonly currentPauseStartedAt: string | null
  readonly lifecycle: 'running' | 'paused' | 'awaiting_review' | 'finalized' | 'abandoned'
}

/** Captured once per server response: the server's clock and the
 * monotonic clock, at the same instant. Every later derivation replays the
 * monotonic delta against this pair instead of trusting `Date.now()`. */
export interface ClockAnchor {
  readonly serverNowAtLoadMs: number
  readonly monotonicAtLoadMs: number
}

export type TimerDisplay = 'running' | 'paused' | 'deadline_reached' | 'awaiting_review' | 'ended'

export interface DerivedRemaining {
  readonly elapsedSeconds: number
  readonly remainingSeconds: number
  readonly deadlineReached: boolean
  readonly display: TimerDisplay
}

/** Reconstructs the server's current time from the anchor and how far the
 * monotonic clock has moved since it was captured. */
export function serverNowMs(anchor: ClockAnchor, monotonicNowMs: number): number {
  return anchor.serverNowAtLoadMs + (monotonicNowMs - anchor.monotonicAtLoadMs)
}

/** Elapsed milliseconds since `startedAt`, excluding paused time, as of
 * `monotonicNowMs`. Unclamped (can be negative before start, or exceed
 * `targetSeconds` past the deadline) — used for event stamping, where the
 * value is what the server needs to reconcile a batch. Rounded to the
 * nearest whole millisecond: `performance.now()` carries sub-millisecond
 * precision, but `EventInput.elapsedMs` (contracts/sessions.ts) is a wire
 * integer — an unrounded value here fails the server's schema validation on
 * every single event submission (confirmed empirically: `POST
 * /sessions/{id}/events` 400 `malformed_request`, `elapsedMs: "must be
 * integer"`, whenever this ran against a real, un-faked monotonic clock). */
export function elapsedMsForEvent(
  fields: ServerTimerFields,
  anchor: ClockAnchor,
  monotonicNowMs: number,
): number {
  const nowMs = serverNowMs(anchor, monotonicNowMs)
  const startedAtMs = Date.parse(fields.startedAt)
  let pausedMs = fields.pausedSeconds * 1000
  if (fields.lifecycle === 'paused' && fields.currentPauseStartedAt !== null) {
    pausedMs += nowMs - Date.parse(fields.currentPauseStartedAt)
  }
  return Math.round(nowMs - startedAtMs - pausedMs)
}

/** Derives remaining time and display state purely from server-truth
 * fields, an anchor and a monotonic instant. Never accumulates: calling
 * this twice with the same arguments always returns the same result. */
export function deriveRemaining(
  fields: ServerTimerFields,
  anchor: ClockAnchor,
  monotonicNowMs: number,
): DerivedRemaining {
  const elapsedSeconds = Math.floor(elapsedMsForEvent(fields, anchor, monotonicNowMs) / 1000)
  const remainingSecondsRaw = fields.targetSeconds - elapsedSeconds
  const remainingSeconds = Math.max(0, remainingSecondsRaw)
  const deadlineReached = remainingSecondsRaw <= 0

  let display: TimerDisplay
  if (fields.lifecycle === 'finalized' || fields.lifecycle === 'abandoned') {
    display = 'ended'
  } else if (fields.lifecycle === 'awaiting_review') {
    display = 'awaiting_review'
  } else if (fields.lifecycle === 'paused') {
    display = 'paused'
  } else if (deadlineReached) {
    // lifecycle === 'running' and the target has been reached: awaiting the
    // server's confirmation of the `end` transition (D24). Deliberately not
    // a `completed` state — a GET never confirms completion.
    display = 'deadline_reached'
  } else {
    display = 'running'
  }

  return { elapsedSeconds, remainingSeconds, deadlineReached, display }
}

/** Formats whole seconds as `mm:ss`, flooring negative or fractional input
 * at `00:00`. */
export function formatRemaining(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(clamped / 60)
  const seconds = clamped % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
