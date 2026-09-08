/**
 * `useClockGap(session, createDetector?)` — drives `ClockGapPrompt` (task
 * 8.10.2; design.md D5, D18-D20, D25, D26; specs/session-recovery: "Clock
 * gaps are detected and resolved by the user" / "Laptop slept during a
 * benchmark", "Laptop slept during a benchmark" / "Deadline passed during
 * sleep", "Abandon and save-incomplete are always available" / "Save
 * incomplete after uncertainty").
 *
 * Wraps 7.2.2's `createGapDetector` directly (never `useSessionClock`, which
 * embeds its own separate detector instance for a screen's own timer display
 * — this hook is mounted once, centrally, by `SessionLayout`, independent of
 * whichever screen is currently showing). `createDetector` defaults to the
 * real `createGapDetector` and is overridable only for this file's own
 * tests: a "fake detector" factory that captures `onGap` and lets a test
 * invoke it directly, sidestepping `vi.useFakeTimers()` — this codebase's
 * established tests (`EventButtons.test.tsx`, `Recall.test.tsx`) avoid
 * combining fake timers with `userEvent`/`findBy*`'s internal polling.
 *
 * On a gap (`|gapSeconds| > 60`, mirroring `gapDetector.ts`'s own D5
 * threshold as defense in depth against a substitute detector that does not
 * enforce it): stamps `elapsedMs`/`occurredAt` the same anchor-based way
 * `useSessionEvents.ts` does, mints a `clientEventId`, and writes an
 * UNRESOLVED `clock_gap` event straight to `lib/outbox/store.ts` (never
 * `useOutbox`/`useSessionEvents`, neither of which lets a caller supply and
 * later overwrite the same id) — `details: { gapSeconds }`, no `resolution`.
 * That local row is deliberately never flushed by this hook itself; it stays
 * an unsent local draft (updatable in place, since IndexedDB `put` on the
 * same key overwrites) until `resolve()` fills in `resolution`, exactly like
 * every other unsent row, it reaches the server whenever the outbox's
 * existing flush paths (another recorded event, the next reload's replay)
 * next run — carrying the resolution from the very first time it is ever
 * sent, since events are append-only and cannot be edited after the server
 * has seen them (D9).
 *
 * `resolve(resolution)`:
 *  1. Overwrites the local outbox draft's `details` (skipped when the
 *     pending gap has no local draft at all — see below) with
 *     `{ gapSeconds, resolution }`.
 *  2. `POST /sessions/{id}/clock-gap { gapSeconds, resolution }` — the
 *     session-level source of truth (`clockGapSeconds` accumulation,
 *     `timerQuality`, and for `save_incomplete` the end transition, D25/D26).
 *     No `session_events` row is written by this route (design.md's
 *     `resolveClockGap` comment) — step 1 is this hook's only way of ever
 *     getting the resolved `details` into the event the server eventually
 *     stores.
 *  3. On success: the returned `SessionResponse` becomes `latestSession`
 *     (immediate, correct `timerQuality`/`timing` for this component's own
 *     render, never waiting on a refetch); `['sessions', id]` and
 *     `['sessions','active']` are invalidated so lib/clock (7.2.1/7.2.3)
 *     re-seeds its anchor from the refetched `serverNow` everywhere else
 *     that reads this session, never client arithmetic (D5); `save_incomplete`
 *     navigates to the incomplete review (`/review/:id` for practice,
 *     `/benchmark/:id/recall` for benchmark — Recall.tsx's own
 *     `completeInterval === false` branch offers Skip recall there, D25).
 *  4. 409/404 (the session changed or is gone) -> "This session has changed.
 *     Reloading.", the same two queries invalidated so the current server
 *     state replaces this stale prop everywhere. Any other failure ->
 *     "Could not save. Retry." — the dialog stays open, unresolved, for
 *     another attempt.
 *
 * Reload reopening (D26): once, per `session.id` (React's documented
 * "adjust state during rendering" pattern — comparing a ref to the current
 * prop and calling `setState` synchronously in the render body, the same
 * shape `useSessionClock.ts`'s anchor and `useSessionEvents.ts`'s seed use,
 * needed here because `ClockGapPrompt` is mounted once by `SessionLayout`
 * and is never itself remounted just because the active session id changes),
 * this hook scans `session.events` for the most recent (`elapsedMs`
 * descending) unvoided `clock_gap` event. One with no `details.resolution`
 * re-opens the prompt with no local `clientEventId` to update (it already
 * reached the server unresolved — an earlier reload's replay, or a race with
 * another flush — so `resolve()` skips step 1 above and relies on the
 * `/clock-gap` endpoint alone for that case); one that already carries a
 * `resolution` never reopens it.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { ClockGapResolution, EventResponseValue, SessionResponseValue } from '@attention-lab/shared'

import { api } from '../../lib/api/client.js'
import {
  createGapDetector,
  type GapDetector,
  type GapDetectorOptions,
  type GapEvent,
} from '../../lib/clock/gapDetector.js'
import {
  elapsedMsForEvent,
  serverNowMs as deriveServerNowMs,
  type ClockAnchor,
  type ServerTimerFields,
} from '../../lib/clock/remaining.js'
import { enqueue as storeEnqueue } from '../../lib/outbox/store.js'
import { queryKeys } from '../../lib/query/keys.js'

/** D5: the same 60 s magnitude `gapDetector.ts` itself enforces — checked
 * again here so a substitute `createDetector` (this file's own tests) that
 * does not apply the threshold cannot open the prompt for sub-threshold drift. */
const GAP_THRESHOLD_SECONDS = 60

export type CreateGapDetector = (options: GapDetectorOptions) => GapDetector

export type ClockGapStatus = 'idle' | 'pending' | 'error'

interface PendingGap {
  readonly gapSeconds: number
  /** `null` for a gap re-opened from an already-synced, still-unresolved
   * server event (D26) — there is no local outbox draft left to overwrite. */
  readonly clientEventId: string | null
  readonly elapsedMs: number | null
  readonly occurredAt: string | null
}

export interface UseClockGapResult {
  /** Non-null exactly when the AlertDialog should be open. */
  readonly pendingGap: { readonly gapSeconds: number } | null
  readonly status: ClockGapStatus
  readonly errorMessage: string | null
  /** The session response as of the last successful resolution, or the
   * original `session` prop before any resolution — never a stale snapshot
   * once a resolution has succeeded (see the module comment, step 3). */
  readonly latestSession: SessionResponseValue
  resolve(resolution: ClockGapResolution): Promise<void>
}

interface KnownApiError {
  status: number
}

function asKnownApiError(error: unknown): KnownApiError | null {
  if (typeof error !== 'object' || error === null) {
    return null
  }
  const record = error as Record<string, unknown>
  return typeof record.status === 'number' ? (record as unknown as KnownApiError) : null
}

/** The most recent (by `elapsedMs`) unvoided `clock_gap` event with no
 * `details.resolution`, or `null` when there is none — D26's reload check. */
function findUnresolvedClockGap(events: readonly EventResponseValue[]): PendingGap | null {
  let latest: EventResponseValue | null = null
  for (const event of events) {
    if (event.type !== 'clock_gap' || event.voidedAt !== null) {
      continue
    }
    if (latest === null || (event.elapsedMs ?? -Infinity) > (latest.elapsedMs ?? -Infinity)) {
      latest = event
    }
  }
  if (latest === null) {
    return null
  }
  const details = latest.details as { gapSeconds?: number; resolution?: string }
  if (typeof details.resolution === 'string') {
    return null
  }
  const gapSeconds = typeof details.gapSeconds === 'number' ? details.gapSeconds : 0
  return { gapSeconds, clientEventId: null, elapsedMs: null, occurredAt: null }
}

function isTicking(lifecycle: SessionResponseValue['lifecycle']): boolean {
  return lifecycle === 'running' || lifecycle === 'paused'
}

export function useClockGap(
  session: SessionResponseValue,
  createDetector: CreateGapDetector = createGapDetector,
): UseClockGapResult {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Always the latest props/state, readable from callbacks a long-lived
  // effect closed over earlier — the same "ref mirrored every render"
  // pattern `useOutbox.ts`'s `stateRef` uses.
  const sessionRef = useRef(session)
  sessionRef.current = session

  const [pendingGap, setPendingGap] = useState<PendingGap | null>(null)
  const pendingGapRef = useRef<PendingGap | null>(null)
  pendingGapRef.current = pendingGap

  const [status, setStatus] = useState<ClockGapStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [latestSession, setLatestSession] = useState<SessionResponseValue>(session)

  // D26: seeded once per session id, in the render body (not an effect) so
  // the very first render of a reopened session already shows the dialog —
  // see the module comment.
  const seededSessionIdRef = useRef<string | null>(null)
  if (seededSessionIdRef.current !== session.id) {
    seededSessionIdRef.current = session.id
    setPendingGap(findUnresolvedClockGap(session.events))
    setLatestSession(session)
    setStatus('idle')
    setErrorMessage(null)
  }

  const anchorRef = useRef<ClockAnchor | null>(null)
  const lastServerNowRef = useRef<string | null>(null)
  if (session.serverNow !== lastServerNowRef.current) {
    anchorRef.current = { serverNowAtLoadMs: Date.parse(session.serverNow), monotonicAtLoadMs: performance.now() }
    lastServerNowRef.current = session.serverNow
  }

  const stampNow = useCallback((): { elapsedMs: number; occurredAt: string } | null => {
    if (anchorRef.current === null) {
      return null
    }
    const current = sessionRef.current
    const fields: ServerTimerFields = {
      startedAt: current.startedAt,
      targetSeconds: current.targetSeconds,
      pausedSeconds: current.pausedSeconds,
      currentPauseStartedAt: current.currentPauseStartedAt,
      lifecycle: current.lifecycle,
    }
    const monotonicNowMs = performance.now()
    const elapsedMs = elapsedMsForEvent(fields, anchorRef.current, monotonicNowMs)
    const occurredAt = new Date(deriveServerNowMs(anchorRef.current, monotonicNowMs)).toISOString()
    return { elapsedMs, occurredAt }
  }, [])

  const handleGap = useCallback(
    (event: GapEvent) => {
      if (pendingGapRef.current !== null) {
        // One unresolved gap at a time — a second drift while the prompt is
        // already open is not queued behind it.
        return
      }
      const gapSeconds = Math.abs(event.gapSeconds)
      if (gapSeconds <= GAP_THRESHOLD_SECONDS) {
        return
      }
      const stamp = stampNow()
      if (stamp === null) {
        return
      }
      const clientEventId = crypto.randomUUID()
      void storeEnqueue(
        sessionRef.current.id,
        { type: 'clock_gap', elapsedMs: stamp.elapsedMs, occurredAt: stamp.occurredAt, details: { gapSeconds } },
        clientEventId,
      ).catch(() => {
        // Local write failure never blocks showing the prompt: `resolve()`
        // still reaches the server-truth `/clock-gap` endpoint; only the
        // local audit-trail copy of the event is missing (matches
        // `useOutbox.ts`'s own could-not-save handling elsewhere).
      })
      const next: PendingGap = { gapSeconds, clientEventId, elapsedMs: stamp.elapsedMs, occurredAt: stamp.occurredAt }
      pendingGapRef.current = next
      setPendingGap(next)
    },
    [stampNow],
  )

  const ticking = isTicking(session.lifecycle)

  // Mounted only while running/paused (mirrors `useSessionClock.ts`'s own
  // `isTicking` effect exactly) — an `awaiting_review`/`finalized`/
  // `abandoned` session raises no further drift to watch for, and unmount
  // always stops the heartbeat (no dangling `setInterval`).
  useEffect(() => {
    if (!ticking) {
      return
    }
    const detector = createDetector({ onGap: handleGap })
    detector.start()
    return () => detector.stop()
  }, [ticking, session.id, createDetector, handleGap])

  const resolve = useCallback(
    async (resolution: ClockGapResolution): Promise<void> => {
      const gap = pendingGapRef.current
      if (gap === null) {
        return
      }
      setStatus('pending')
      setErrorMessage(null)

      if (gap.clientEventId !== null && gap.elapsedMs !== null && gap.occurredAt !== null) {
        try {
          await storeEnqueue(
            sessionRef.current.id,
            {
              type: 'clock_gap',
              elapsedMs: gap.elapsedMs,
              occurredAt: gap.occurredAt,
              details: { gapSeconds: gap.gapSeconds, resolution },
            },
            gap.clientEventId,
          )
        } catch {
          // Same rationale as the initial enqueue above: a local write
          // failure never blocks the authoritative server call below.
        }
      }

      try {
        const updated = await api.sessions.clockGap(sessionRef.current.id, { gapSeconds: gap.gapSeconds, resolution })
        setLatestSession(updated)
        pendingGapRef.current = null
        setPendingGap(null)
        setStatus('idle')
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.byId(sessionRef.current.id) })
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.active })

        if (resolution === 'save_incomplete') {
          const target =
            sessionRef.current.kind === 'benchmark'
              ? `/benchmark/${sessionRef.current.id}/recall`
              : `/review/${sessionRef.current.id}`
          navigate(target)
        }
      } catch (error) {
        const known = asKnownApiError(error)
        if (known !== null && (known.status === 409 || known.status === 404)) {
          setErrorMessage('This session has changed. Reloading.')
          void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.byId(sessionRef.current.id) })
          void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.active })
        } else {
          setErrorMessage('Could not save. Retry.')
        }
        setStatus('error')
      }
    },
    [navigate, queryClient],
  )

  return {
    pendingGap: pendingGap !== null ? { gapSeconds: pendingGap.gapSeconds } : null,
    status,
    errorMessage,
    latestSession,
    resolve,
  }
}
