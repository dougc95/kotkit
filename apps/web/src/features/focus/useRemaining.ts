/**
 * Thin wrapper over `lib/clock/useSessionClock` (7.2.3, D5) for screens that
 * only need the single ticking `remainingSeconds` number — Benchmark Running
 * (8.3.3), Focus (8.5.3) and Recall (8.4.1) each call `useRemaining(session)`
 * with the `SessionResponse` (D20) they already loaded via `useSession` /
 * `useActiveSession`, and pass the result straight into
 * `<TimerDisplay remainingSeconds={...} />`.
 *
 * `session` is `null`/`undefined` while the query is still pending (matches
 * `useSession`'s/`useActiveSession`'s pending state) — in that case this
 * hook starts no timer and returns `null`, same as `useSessionClock` itself.
 * Every re-derivation replays the server's own fields (D5); this module
 * never accumulates ticks or reads `Date.now()` directly.
 */
import { useSessionClock } from '../../lib/clock/useSessionClock.js'
import type { ServerTimerFields } from '../../lib/clock/remaining.js'

/** The subset of a `SessionResponse` (D20) this hook needs. */
export type RemainingSessionInput = ServerTimerFields & {
  /** D20's `serverNow` ISO field, from the SAME response `lifecycle`/`startedAt`/etc came from. */
  readonly serverNow: string
}

export function useRemaining(session: RemainingSessionInput | null | undefined): number | null {
  const input =
    session === null || session === undefined
      ? null
      : {
          fields: {
            startedAt: session.startedAt,
            targetSeconds: session.targetSeconds,
            pausedSeconds: session.pausedSeconds,
            currentPauseStartedAt: session.currentPauseStartedAt,
            lifecycle: session.lifecycle,
          },
          serverNowMs: Date.parse(session.serverNow),
        }

  const clock = useSessionClock(input)
  return clock?.remainingSeconds ?? null
}
