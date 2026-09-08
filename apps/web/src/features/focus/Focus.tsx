/**
 * Focus — the practice session frame: header, timer, event recording, sync
 * status and the explicit end-of-block transition (task 8.5.3; design.md D5,
 * D15, D18, D20, D24; specs/practice-sessions: "Practice timer and elapsed
 * time" / "Target reached"; specs/app-shell: "Navigation exists outside
 * session mode only", "Leaving a session by URL"; specs/session-recovery:
 * "Reload recovers the active session" / "Refresh during practice", "Refresh
 * after target passed", "Stale writes conflict instead of overwriting" /
 * "Two tabs end a session"). Route `/focus/:sessionId`, rendered inside
 * `SessionLayout` (7.1.4, no navigation) — this component renders no `<nav>`
 * of its own; the route-leave guard (7.4.3's `SessionLeaveGuard`, mounted
 * once in `Root.tsx`) blocks in-app navigation away from this screen while
 * the session is running/paused/awaiting review, offering only "Return to
 * session" / "Leave anyway" — this component sends no transition of its own
 * for that.
 *
 * Loads `GET /sessions/{id}` (D20) against `queryKeys.sessions.byId(id)` —
 * the SAME `['sessions', id]` cache entry `lib/query/hooks.ts`'s `useSession`
 * reads, under the app's one D15 session-aware `QueryClient` policy (no
 * local override here); inlined the same way Recall.tsx/Ready.tsx already do
 * rather than through that hook, so an undefined route param can gate
 * `enabled` before any fetch fires. `remaining`
 * comes from `useRemaining(session)` (7.2.3/8.3.2's shared wrapper over
 * `lib/clock`, D5) — this component never accumulates ticks or reads
 * `Date.now()` itself. `SessionHeader` renders the intended output and the
 * target duration only; it never renders an "elapsed"/"focused" figure of
 * its own (CLAUDE.md: "app visibility is not attention", "no invented
 * attention score" — this screen's only time figure is the countdown
 * `TimerDisplay` (8.3.2) itself renders, labeled by neither "focused" nor
 * "attention").
 *
 * `EventButtons` (variant 'practice') + `Tallies`, both driven by
 * `useSessionEvents(sessionId, session)` (8.5.1), and `SyncStatus` (8.5.2)
 * are mounted exactly as those tasks built them — this component wires no
 * event-recording or sync logic of its own. A `TransitionControls` slot
 * (8.5.4, a later wave) is a commented placeholder below; pause/resume/
 * finish-early are that task's job, not this one's (this component holds no
 * local lifecycle state beyond the deadline Review mutation).
 *
 * Deadline (D24): once `remaining` reaches 0 — whether the countdown ticked
 * there live or the session was already past its target on mount/reload
 * (session-recovery: "Refresh after target passed") — the screen replaces
 * the timer/event-recording controls with "Block time reached — save your
 * review to record it" and a single primary "Review" action. Reaching zero
 * on its own NEVER posts a transition or navigates; only the Review click
 * does: `POST /sessions/{id}/transitions {expectedVersion, type:'end'}`, and
 * only once that resolves does the screen `navigate('/review/:sessionId')` —
 * a GET never confirms completion (D24), and timer expiry alone proves
 * nothing (CLAUDE.md: "timer expiry never proves completion").
 *
 * 409 `stale_version` on that transition (another tab already ended this
 * session, D18) seeds `['sessions', id]` from the error's `details.current`
 * and renders `ActiveSessionCard` (8.2.5) with `staleNotice` in place of the
 * controls — reading whatever `lifecycle` the refreshed session actually
 * carries, never a second `end` transition sent from here.
 *
 * A 404 on the initial GET (an abandoned/foreign/never-existed session id)
 * navigates to `/today` with a neutral notice, replacing this route in
 * history; any other GET failure offers Retry in place.
 */
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router'
import type { SessionResponseValue, TransitionBodyValue } from '@attention-lab/shared'

import { api } from '../../lib/api/client.js'
import { queryKeys } from '../../lib/query/keys.js'
import { Button } from '../../ui/Button.js'
import { ActiveSessionCard } from '../session/ActiveSessionCard.js'
import { AgentPanel } from './AgentPanel.js'
import { EventButtons } from './EventButtons.js'
import { SyncStatus } from './SyncStatus.js'
import { Tallies } from './Tallies.js'
import { TimerDisplay } from './TimerDisplay.js'
import { TransitionControls } from './TransitionControls.js'
import { useRemaining } from './useRemaining.js'
import { useSessionEvents } from './useSessionEvents.js'

const DEADLINE_MESSAGE = 'Block time reached — save your review to record it'
const NOT_FOUND_NOTICE = 'Session not found.'

// ---------------------------------------------------------------------------
// SessionHeader — intended output + target only (Component line: props
// intendedOutput, targetSeconds). Never renders an elapsed/focused figure.
// ---------------------------------------------------------------------------

export interface SessionHeaderProps {
  readonly intendedOutput: string | null
  readonly targetSeconds: number
}

export function SessionHeader({ intendedOutput, targetSeconds }: SessionHeaderProps) {
  const targetMinutes = Math.round(targetSeconds / 60)
  return (
    <header className="space-y-1">
      <h1 className="text-lg font-semibold text-[var(--color-text)]">Practice block</h1>
      <p className="text-sm text-[var(--color-text)]">{intendedOutput ?? 'No intended output recorded'}</p>
      <p className="text-sm text-[var(--color-text-muted)]">{`Target: ${targetMinutes} min`}</p>
    </header>
  )
}

// ---------------------------------------------------------------------------
// Error duck-typing — mirrors Ready.tsx/Recall.tsx/useAbandonSession.ts: the
// real `api` client throws typed `ApiError` subclasses, but `mockClient.ts`'s
// `reject()` (every component test in this codebase) only builds a plain
// `Error` with the same shape, which `instanceof` would miss.
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

/** Minimal duck-typed check that `details.current` (D18) looks like a `SessionResponseValue` before trusting it. */
function extractCurrentSession(details: Record<string, unknown> | undefined): SessionResponseValue | null {
  const current = details?.['current']
  if (typeof current !== 'object' || current === null) {
    return null
  }
  const record = current as Record<string, unknown>
  if (typeof record.id !== 'string' || typeof record.lifecycle !== 'string' || typeof record.version !== 'number') {
    return null
  }
  return current as SessionResponseValue
}

// ---------------------------------------------------------------------------
// Retry (loading/error) — mirrors Ready.tsx's own RetryNotice.
// ---------------------------------------------------------------------------

function RetryNotice({ message, onRetry }: { readonly message: string; readonly onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-6 space-y-4">
      <p>{message}</p>
      <Button onClick={onRetry}>Retry</Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Focus
// ---------------------------------------------------------------------------

export function Focus() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [staleNotice, setStaleNotice] = useState(false)

  const sessionQuery = useQuery<SessionResponseValue>({
    queryKey: queryKeys.sessions.byId(sessionId ?? ''),
    queryFn: () => api.sessions.get(sessionId ?? ''),
    enabled: sessionId !== undefined,
  })

  const session = sessionQuery.data ?? null
  const remaining = useRemaining(session)
  const events = useSessionEvents(sessionId ?? null, session)

  const notFound = sessionQuery.isError && asKnownApiError(sessionQuery.error)?.status === 404

  // D24/session-recovery "404 -> /today with notice": a side effect, not
  // render output — this only ever fires once, since a successful navigate
  // replaces this route (and therefore unmounts this component) before any
  // later render could re-run it.
  useEffect(() => {
    if (notFound) {
      navigate('/today', { replace: true, state: { notice: NOT_FOUND_NOTICE } })
    }
  }, [notFound, navigate])

  const transitionMutation = useMutation<SessionResponseValue, unknown, TransitionBodyValue>({
    mutationFn: (body) => api.sessions.transition(sessionId as string, body),
    onSuccess: () => {
      if (sessionId !== undefined) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.byId(sessionId) })
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.active })
      navigate(`/review/${sessionId}`)
    },
    onError: (error) => {
      const known = asKnownApiError(error)
      if (known === null || known.status !== 409 || sessionId === undefined) {
        return
      }
      const current = extractCurrentSession(known.details)
      if (current !== null) {
        queryClient.setQueryData(queryKeys.sessions.byId(sessionId), current)
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.byId(sessionId) })
      setStaleNotice(true)
    },
  })

  function handleReview(): void {
    if (session === null) {
      return
    }
    transitionMutation.mutate({ expectedVersion: session.version, type: 'end' })
  }

  if (sessionId === undefined) {
    return <p>Session not found</p>
  }

  if (sessionQuery.isPending) {
    return (
      <div className="mx-auto max-w-xl px-4 py-6" aria-busy="true">
        Loading
      </div>
    )
  }

  if (notFound) {
    // The effect above is already navigating away — nothing useful to show
    // for the instant before that commits.
    return null
  }

  if (sessionQuery.isError || session === null) {
    return (
      <RetryNotice
        message="The session could not be loaded."
        onRetry={() => {
          void sessionQuery.refetch()
        }}
      />
    )
  }

  if (staleNotice) {
    return (
      <div className="mx-auto max-w-xl px-4 py-6">
        <ActiveSessionCard session={session} staleNotice />
      </div>
    )
  }

  const deadlineReached = remaining !== null && remaining <= 0

  return (
    <div data-mode="focus" className="mx-auto max-w-xl px-4 py-6 space-y-6">
      <SessionHeader intendedOutput={session.intendedOutput} targetSeconds={session.targetSeconds} />

      {deadlineReached ? (
        <div className="space-y-4">
          <p role="status">{DEADLINE_MESSAGE}</p>
          <Button
            onClick={handleReview}
            disabled={transitionMutation.isPending}
          >
            Review
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <TimerDisplay remainingSeconds={remaining ?? session.targetSeconds} />
          <TransitionControls session={session} />
          <AgentPanel
            sessionId={session.id}
            sessionVersion={session.version}
            plan={session.agentPlan}
            lifecycle={session.lifecycle}
          />
          <EventButtons
            sessionId={session.id}
            variant="practice"
            onRecord={(type, details) => {
              void events.record(type, details)
            }}
            onUndo={() => {
              void events.undo()
            }}
            canUndo={events.canUndo}
          />
          {events.undoNotice !== null ? <p role="alert">{events.undoNotice}</p> : null}
        </div>
      )}

      <Tallies offTask={events.tallies.offTask} external={events.tallies.external} agentChecks={events.tallies.agentChecks} />
      <SyncStatus sessionId={session.id} />
    </div>
  )
}
