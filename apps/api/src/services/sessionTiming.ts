/**
 * Task 5.2.1 — pure session timing derivation (design.md D5). `started_at`,
 * `target_seconds`, `paused_seconds` and `current_pause_started_at` are the
 * stored truth; this module derives everything a session response needs from
 * them and `now`, without writing to the database and without ever returning
 * a lifecycle value. That is what keeps `GET /sessions/{id}` and
 * `GET /sessions/active` strictly read-only (D24): the server only confirms
 * a reached deadline on the next `end` transition (5.4.2), never here — a
 * caller may read `deadlineReached: true` on a session that is still
 * `running` and must not treat that as completion.
 *
 * Rules (D5):
 *  - Effective end = `endedAt ?? now`. An ended session is measured to its
 *    `endedAt`, never to `now` — an early finish must not appear to keep
 *    accumulating elapsed time after it stopped.
 *  - An open pause (`currentPauseStartedAt !== null`) counts as paused from
 *    `currentPauseStartedAt` up to the effective end, on top of whatever is
 *    already banked in `pausedSeconds` from earlier, closed pauses — so
 *    `remainingSeconds` is frozen for as long as the session stays paused.
 *  - `elapsedSeconds = floor((end − startedAt) / 1000) − pausedSeconds −
 *    openPauseSeconds`, never allowed below 0.
 *  - `remainingSeconds = max(0, targetSeconds − elapsedSeconds)`.
 *  - `deadlineReached = elapsedSeconds >= targetSeconds`.
 *  - `isPaused = currentPauseStartedAt !== null`.
 *
 * No database import; no mutation. Shared by `sessionSerializer` (5.1.1),
 * `GET /sessions/{id}` (5.2.2), `GET /sessions/active` (5.2.3) and group 5b's
 * transitions/clock-gap/finalize routes.
 */

export interface SessionTimingInput {
  readonly startedAt: Date
  readonly endedAt: Date | null
  readonly targetSeconds: number
  readonly pausedSeconds: number
  readonly currentPauseStartedAt: Date | null
}

export interface SessionTiming {
  readonly elapsedSeconds: number
  readonly remainingSeconds: number
  readonly deadlineReached: boolean
  readonly isPaused: boolean
}

/** Whole seconds from `from` to `to`, floored (may be negative if `to` precedes `from`). */
function diffSeconds(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 1000)
}

export function deriveTiming(session: SessionTimingInput, now: Date): SessionTiming {
  const { startedAt, endedAt, targetSeconds, pausedSeconds, currentPauseStartedAt } = session
  const effectiveEnd = endedAt ?? now

  const openPauseSeconds =
    currentPauseStartedAt !== null ? diffSeconds(currentPauseStartedAt, effectiveEnd) : 0

  const rawElapsed = diffSeconds(startedAt, effectiveEnd) - pausedSeconds - openPauseSeconds
  const elapsedSeconds = Math.max(0, rawElapsed)
  const remainingSeconds = Math.max(0, targetSeconds - elapsedSeconds)

  return {
    elapsedSeconds,
    remainingSeconds,
    deadlineReached: elapsedSeconds >= targetSeconds,
    isPaused: currentPauseStartedAt !== null,
  }
}
