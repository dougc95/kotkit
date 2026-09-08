/**
 * Running — the benchmark's active-interval screen (task 8.3.3; design.md
 * D5, D9, D11, D15, D24, D25, D39; specs/benchmark-assessment: "Fixed
 * interval with no valid pause" — "Interval reached", "Stop early", "Tab
 * hidden during benchmark"; "Interruption recording during the benchmark" —
 * "Record after returning", "Undo accidental duplicate"; specs/session-
 * recovery: "Events are buffered, deduplicated and acknowledged", "Stale
 * writes conflict instead of overwriting" / "Two tabs end a session";
 * specs/app-shell: "Navigation exists outside session mode only",
 * "Benchmarks are visually distinct from practice"). Rendered by
 * `BenchmarkRoute.tsx` (8.3.1) inside `SessionLayout` (7.1.4, no
 * navigation) once `GET /sessions/active` (`useActiveSession`, the SAME
 * cache entry `Ready` itself reads) is a running/paused benchmark whose
 * `slotId` matches this route — this component renders no `<nav>` of its
 * own.
 *
 * Timer: `TimerDisplay` (8.3.2) fed by `useSessionClock` (7.2.3, D5) against
 * the session's own `targetSeconds` (always 1200 for a benchmark, D30) —
 * this screen never accumulates elapsed time itself and never reads
 * `Date.now()`.
 *
 * Events: `useSessionEvents` (8.5.1) + `EventButtons variant="benchmark"`
 * (Record off-task episode primary, External interruption secondary, Undo;
 * no Agent check control — a benchmark attempt has no agent-waiting
 * concept) and `Tallies`. No visibilitychange/focus listener of this
 * component's own — D15: app visibility is never attention, a hidden tab
 * never creates an off-task episode. `useSessionEvents`'s own opt-in
 * `visibility` event (gated by `preferences.visibilityContext`, off by
 * default) is the only thing that ever responds to `visibilitychange`, and
 * it is excluded from every tally.
 *
 * No pause control and no Abandon control exist anywhere in this
 * component's DOM — Abandon is the shared `AbandonSession` (8.10.7),
 * mounted once by `SessionLayout` for every session route; Running renders
 * no Abandon of its own.
 *
 * 'Stop early' (secondary) opens an inline confirm ("This attempt will be
 * recorded as incomplete"); confirming posts `transitions {expectedVersion,
 * type:'end'}` and, once that resolves, navigates to
 * `/benchmark/:sessionId/recall`. `Recall` (8.4.1) itself renders the
 * "Incomplete attempt" label and the skip-recall option straight from the
 * session's own `completeInterval: false` (D25, set server-side by this
 * SAME `end` transition) — this screen sends no separate signal for that.
 *
 * At remaining 0 (`deadlineReached`, D24) the event controls are replaced by
 * "Close your reading material" and "I'm ready for recall" — clicking it
 * posts the SAME `end` transition (D24: a GET never confirms completion,
 * only a transition does) and navigates to recall once THAT resolves;
 * nothing here assumes the interval is over, and no `finalize` call is ever
 * made from this screen.
 *
 * `409 stale_version` on either `end` transition (another tab already ended
 * this session) reads `error.details.current` (D18) to seed
 * `['sessions', id]`, triggers a confirming refetch of that same query, and
 * renders `ActiveSessionCard` (8.2.5) with `staleNotice` in place of this
 * screen's own content once a value is available — no second transition is
 * ever sent (`endMutation` is not retried; a fresh click is a fresh call
 * this branch never offers, since Running's own controls are gone once
 * `staleConflict` is true).
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import type { SessionResponseValue } from '@attention-lab/shared'

import { api } from '../../lib/api/client.js'
import { useSessionClock } from '../../lib/clock/useSessionClock.js'
import { queryKeys } from '../../lib/query/keys.js'
import { Button } from '../../ui/Button.js'
import { EventButtons } from '../focus/EventButtons.js'
import { SyncStatus } from '../focus/SyncStatus.js'
import { Tallies } from '../focus/Tallies.js'
import { TimerDisplay } from '../focus/TimerDisplay.js'
import { useSessionEvents } from '../focus/useSessionEvents.js'
import { ActiveSessionCard } from '../session/ActiveSessionCard.js'

const LEAVING_NOTE = 'Leaving this page to read does not count as distraction.'
const END_FAILED_NOTICE = 'The attempt could not be ended. Retry.'

// ---------------------------------------------------------------------------
// Error duck-typing — mirrors Recall.tsx/useAbandonSession.ts's own
// `asKnownApiError`: the real `api` client throws typed `ApiError`
// subclasses, but `mockClient.ts`'s `reject()` (every component test in this
// codebase) only builds a plain `Error` with the same shape, which
// `instanceof` would miss.
// ---------------------------------------------------------------------------

interface KnownApiError {
  readonly status: number
  readonly code: string
  readonly details?: Record<string, unknown>
}

function asKnownApiError(error: unknown): KnownApiError | null {
  if (typeof error !== 'object' || error === null) {
    return null
  }
  const record = error as Record<string, unknown>
  if (typeof record.status !== 'number' || typeof record.code !== 'string') {
    return null
  }
  return record as unknown as KnownApiError
}

export interface RunningProps {
  readonly session: SessionResponseValue
}

export function Running({ session }: RunningProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [confirmStopEarly, setConfirmStopEarly] = useState(false)
  const [staleConflict, setStaleConflict] = useState(false)
  const [endFailed, setEndFailed] = useState(false)

  // Only ever fetched after a 409 stale_version conflict below — `enabled:
  // false` means this never issues its own request on a normal mount; the
  // cache is seeded synchronously from `error.details.current` (D18) and
  // then confirmed by an explicit `refetch()`.
  const staleSessionQuery = useQuery<SessionResponseValue>({
    queryKey: queryKeys.sessions.byId(session.id),
    queryFn: () => api.sessions.get(session.id),
    enabled: false,
  })

  const clock = useSessionClock({ fields: session, serverNowMs: Date.parse(session.serverNow) })
  const { tallies, record, undo, canUndo, undoNotice } = useSessionEvents(session.id, session)

  const endMutation = useMutation<SessionResponseValue, unknown, void>({
    mutationFn: () => api.sessions.transition(session.id, { expectedVersion: session.version, type: 'end' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.active })
      navigate(`/benchmark/${session.id}/recall`)
    },
    onError: (error) => {
      const known = asKnownApiError(error)
      if (known !== null && known.status === 409 && known.code === 'stale_version') {
        const current = known.details?.['current'] as SessionResponseValue | undefined
        if (current !== undefined) {
          queryClient.setQueryData(queryKeys.sessions.byId(session.id), current)
        }
        setStaleConflict(true)
        void staleSessionQuery.refetch()
        return
      }
      setEndFailed(true)
    },
  })

  function handleEnd(): void {
    setEndFailed(false)
    endMutation.mutate()
  }

  if (staleConflict) {
    const current = staleSessionQuery.data ?? session
    return (
      <div data-mode="benchmark" className="mx-auto max-w-xl px-4 py-6">
        <ActiveSessionCard session={current} staleNotice />
      </div>
    )
  }

  const remainingSeconds = clock?.remainingSeconds ?? session.timing.remainingSeconds
  const deadlineReached = clock?.deadlineReached ?? session.timing.deadlineReached
  const endPending = endMutation.isPending

  return (
    <div data-mode="benchmark" className="mx-auto max-w-xl px-4 py-6 space-y-6 border-t-4 border-t-amber-500">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold text-[var(--color-text)]">Fixed 20-minute assessment</h1>
        <p className="text-sm text-[var(--color-text-muted)]">{LEAVING_NOTE}</p>
      </header>

      <TimerDisplay remainingSeconds={remainingSeconds} />

      {deadlineReached ? (
        <div className="space-y-3">
          <p role="status">Close your reading material</p>
          <Button onClick={handleEnd} disabled={endPending}>
            I&apos;m ready for recall
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <Tallies offTask={tallies.offTask} external={tallies.external} />
          <EventButtons
            sessionId={session.id}
            variant="benchmark"
            onRecord={(type, details) => {
              void record(type, details)
            }}
            onUndo={() => {
              void undo()
            }}
            canUndo={canUndo}
          />
          {undoNotice !== null ? <p role="alert">{undoNotice}</p> : null}

          {confirmStopEarly ? (
            <div role="group" aria-label="Confirm stop early" className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] p-3">
              <p className="text-sm text-[var(--color-text)]">This attempt will be recorded as incomplete.</p>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  disabled={endPending}
                  onClick={() => {
                    setConfirmStopEarly(false)
                    handleEnd()
                  }}
                >
                  Stop early
                </Button>
                <Button variant="quiet" disabled={endPending} onClick={() => setConfirmStopEarly(false)}>
                  Keep going
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="secondary" disabled={endPending} onClick={() => setConfirmStopEarly(true)}>
              Stop early
            </Button>
          )}
        </div>
      )}

      {endFailed ? <p role="alert">{END_FAILED_NOTICE}</p> : null}

      <SyncStatus sessionId={session.id} />
    </div>
  )
}
