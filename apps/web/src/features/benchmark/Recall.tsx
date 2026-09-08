/**
 * Recall — the benchmark's separate, timed, then locked first review write
 * (task 8.4.1; design.md D5, D7.3, D10, D25, D27; specs/benchmark-assessment:
 * "Recall is a separate, timed, then locked step" — "Recall started
 * promptly", "Recall started after a long break", "Recall text is immutable
 * after save"; specs/benchmark-assessment: "Fixed interval with no valid
 * pause" — "Stop early"; specs/benchmark-assessment: "Self-scoring is
 * unavailable until recall is locked" — "Incomplete attempt finalized
 * without recall"; specs/app-shell: "Navigation exists outside session mode
 * only"). Route `/benchmark/:sessionId/recall`, rendered inside
 * `SessionLayout` (7.1.4, no navigation) — this component renders no `<nav>`
 * of its own.
 *
 * Loads `GET /sessions/{id}` (D20). Three states ahead of the recall flow
 * itself, checked in this order:
 *  1. `session.review.recallLockedAt !== null` — already locked (a second
 *     tab, a reload after save, or a replay) -> redirect to
 *     `/benchmark/:sessionId/scoring`, never re-showing the recall form.
 *  2. `session.lifecycle === 'running'` — the `end` transition (D24) has not
 *     landed yet -> "The interval has not been confirmed yet" with a Retry
 *     (`sessionQuery.refetch()`) and no Start recall control at all.
 *  3. Otherwise (`awaiting_review`) — the confirm/writing flow below.
 *
 * `session.completeInterval === false` (D25, an incomplete attempt — Stop
 * early or `save_incomplete`) additionally renders "Incomplete attempt" and
 * a "Skip recall" action beside "Start recall": Skip goes straight to
 * scoring with NO write to `/recall` at all (eligibility later carries
 * `recall_missing`, computed server-side — this screen asserts nothing about
 * eligibility itself). A complete interval offers only "Start recall".
 *
 * "Start recall" captures `startedAt` via `serverNowMs(anchor, performance.
 * now())` (7.2.1, D27) — never `Date.now()`, which would let a skewed client
 * clock distort `recall_delay_seconds`/`recall_duration_seconds` server-side
 * — and begins a fixed 3:00 (180 s) countdown rendered through the shared
 * `TimerDisplay` (8.3.2). The anchor itself is re-derived synchronously
 * during render whenever `session.serverNow` changes (mirrors
 * `useSessionClock.ts`'s documented pattern), so the very first render after
 * the session loads already has a usable anchor.
 *
 * Five blank-allowed textareas (`RecallPoints`) collect the five points.
 * Reaching 0:00 shows "Time is up — save when you are ready" but the form
 * stays fully editable and Save still works — overrun (>210 s) is a
 * server-side flag on the locked review, never a client block (D7.3).
 *
 * "Save recall" posts `POST /sessions/{id}/recall` (Idempotency-Key, D6/D16
 * — one key per logical save, minted once and reused for a same-content
 * retry) with `{ points, startedAt, durationSeconds }`, `durationSeconds`
 * computed the same server-aligned way at the moment Save is pressed:
 * `round((serverNowMs(anchor, performance.now()) - startedAt) / 1000)`. No
 * delay/overrun computation happens on the client — those are server-derived
 * flags on the locked review.
 *
 * Outcomes: 200 -> navigate to scoring. 409 (already locked with different
 * content) -> navigate to scoring carrying a "Recall was already saved"
 * notice (the scoring screen, 8.4.2, is responsible for rendering it and for
 * loading the stored points from the session it itself fetches — this
 * screen does not render scoring's UI). 422 `recall_before_interval_end`
 * (D27) -> a fresh `serverNowMs` is captured as the new `startedAt` and a
 * fresh Idempotency-Key is minted (the content changed, so reusing the old
 * key would itself be a mismatch) so the NEXT Save press retries cleanly.
 * Any other rejection (network failure, 422 `not benchmark`, ...) shows
 * "The recall could not be saved. Retry." with a Retry action that resends
 * the EXACT SAME body under the SAME Idempotency-Key (never a fresh one —
 * the content has not changed).
 *
 * `RecallPointSchema` (packages/shared/src/contracts/sessions.ts) caps each
 * point at 500 characters on the wire; the textarea's `maxLength` and
 * counter mirror that number (this task's own brief prose says 2000, which
 * does not match the actual shared contract — the wire contract wins, see
 * this task's `notes`).
 */
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, useNavigate, useParams } from 'react-router'
import type { RecallBodyValue, ReviewResponseValue, SessionResponseValue } from '@attention-lab/shared'

import { api } from '../../lib/api/client.js'
import { newIdempotencyKey } from '../../lib/api/newIdempotencyKey.js'
import { serverNowMs, type ClockAnchor } from '../../lib/clock/remaining.js'
import { queryKeys } from '../../lib/query/keys.js'
import { Button } from '../../ui/Button.js'
import { TimerDisplay } from '../focus/TimerDisplay.js'

const RECALL_TARGET_SECONDS = 180
const MAX_POINT_LENGTH = 500
const BLANK_POINTS: readonly [string, string, string, string, string] = ['', '', '', '', '']

type Phase = 'confirm' | 'writing'

// ---------------------------------------------------------------------------
// RecallPoints
// ---------------------------------------------------------------------------

export interface RecallPointsProps {
  readonly values: readonly [string, string, string, string, string]
  readonly onChange: (index: number, value: string) => void
  readonly disabled: boolean
}

/** Five blank-allowed textareas, "Point 1".."Point 5" — blank is a valid, sent value, never coerced to anything else. */
export function RecallPoints({ values, onChange, disabled }: RecallPointsProps) {
  return (
    <div className="space-y-4">
      {values.map((value, index) => {
        const id = `recall-point-${index + 1}`
        return (
          <div key={id} className="space-y-1">
            <label htmlFor={id} className="block text-sm font-medium text-[var(--color-text)]">
              Point {index + 1}
            </label>
            <textarea
              id={id}
              value={value}
              maxLength={MAX_POINT_LENGTH}
              rows={2}
              disabled={disabled}
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] disabled:opacity-70"
              onChange={(event) => onChange(index, event.target.value)}
            />
            <p className="text-xs text-[var(--color-text-muted)]">
              {value.length}/{MAX_POINT_LENGTH}
            </p>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Error duck-typing — mirrors ReadinessForm.tsx/useAbandonSession.ts: the
// real `api` client throws typed `ApiError` subclasses, but `mockClient.ts`'s
// `reject()` (every component test in this codebase) only builds a plain
// `Error` with the same shape, which `instanceof` would miss.
// ---------------------------------------------------------------------------

interface KnownApiError {
  readonly status: number
  readonly code: string
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

// ---------------------------------------------------------------------------
// Recall
// ---------------------------------------------------------------------------

export function Recall() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [phase, setPhase] = useState<Phase>('confirm')
  const [points, setPoints] = useState<[string, string, string, string, string]>([...BLANK_POINTS])
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey())
  const [, forceTick] = useState(0)

  // Anchor (D5): re-derived synchronously during render whenever
  // `session.serverNow` changes, never in an effect — see useSessionClock.ts's
  // own comment on why (the first render after a load must already have a
  // usable anchor rather than being one tick stale).
  const anchorRef = useRef<ClockAnchor | null>(null)
  const lastServerNowRef = useRef<string | null>(null)
  const startedAtMsRef = useRef<number | null>(null)
  const pendingBodyRef = useRef<RecallBodyValue | null>(null)

  const sessionQuery = useQuery<SessionResponseValue>({
    queryKey: queryKeys.sessions.byId(sessionId ?? ''),
    queryFn: () => api.sessions.get(sessionId ?? ''),
    enabled: sessionId !== undefined,
  })

  const session = sessionQuery.data

  if (session !== undefined && session.serverNow !== lastServerNowRef.current) {
    anchorRef.current = { serverNowAtLoadMs: Date.parse(session.serverNow), monotonicAtLoadMs: performance.now() }
    lastServerNowRef.current = session.serverNow
  }

  // 1 s re-render tick while writing, purely to advance the displayed
  // countdown — never accumulates a total itself (remaining is always
  // re-derived from the anchor + startedAtMsRef at render time, D5).
  useEffect(() => {
    if (phase !== 'writing') {
      return
    }
    const id = setInterval(() => forceTick((count) => count + 1), 1000)
    return () => clearInterval(id)
  }, [phase])

  const mutation = useMutation<ReviewResponseValue, unknown, RecallBodyValue>({
    mutationFn: (body) => api.sessions.recall(sessionId ?? '', body, { idempotencyKey }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.byId(sessionId ?? '') })
      navigate(`/benchmark/${sessionId}/scoring`)
    },
    onError: (error) => {
      const known = asKnownApiError(error)
      if (known !== null && known.status === 409) {
        navigate(`/benchmark/${sessionId}/scoring`, { state: { notice: 'Recall was already saved' } })
        return
      }
      if (known !== null && known.status === 422 && known.code === 'recall_before_interval_end' && anchorRef.current !== null) {
        // D27: the server rejected startedAt as before ended_at. Capture a
        // fresh server-aligned "now" as the new startedAt and mint a fresh
        // key — the content changed, so reusing the old key would itself be
        // a mismatch. The NEXT Save press sends this new body.
        startedAtMsRef.current = serverNowMs(anchorRef.current, performance.now())
        setIdempotencyKey(newIdempotencyKey())
      }
    },
  })

  function handleStartRecall(): void {
    if (anchorRef.current === null) {
      return
    }
    startedAtMsRef.current = serverNowMs(anchorRef.current, performance.now())
    setPhase('writing')
  }

  function handleSkipRecall(): void {
    navigate(`/benchmark/${sessionId}/scoring`)
  }

  function handlePointChange(index: number, value: string): void {
    setPoints((previous) => {
      const next = [...previous] as [string, string, string, string, string]
      next[index] = value
      return next
    })
  }

  function handleSave(): void {
    if (anchorRef.current === null || startedAtMsRef.current === null) {
      return
    }
    const nowMs = serverNowMs(anchorRef.current, performance.now())
    const durationSeconds = Math.max(0, Math.round((nowMs - startedAtMsRef.current) / 1000))
    const body: RecallBodyValue = {
      points,
      startedAt: new Date(startedAtMsRef.current).toISOString(),
      durationSeconds,
    }
    pendingBodyRef.current = body
    mutation.mutate(body)
  }

  function handleRetry(): void {
    if (pendingBodyRef.current === null) {
      return
    }
    mutation.mutate(pendingBodyRef.current)
  }

  if (sessionId === undefined) {
    return <p>Session not found</p>
  }

  if (sessionQuery.isPending || session === undefined) {
    return (
      <div className="mx-auto max-w-xl px-4 py-6" aria-busy="true">
        Loading recall
      </div>
    )
  }

  if (sessionQuery.isError) {
    return (
      <div className="mx-auto max-w-xl px-4 py-6 space-y-4">
        <p>The recall could not be loaded.</p>
        <Button
          onClick={() => {
            void sessionQuery.refetch()
          }}
        >
          Retry
        </Button>
      </div>
    )
  }

  if (session.review.recallLockedAt !== null) {
    return <Navigate to={`/benchmark/${sessionId}/scoring`} replace />
  }

  if (session.lifecycle === 'running') {
    return (
      <div className="mx-auto max-w-xl px-4 py-6 space-y-4">
        <p>The interval has not been confirmed yet</p>
        <Button
          onClick={() => {
            void sessionQuery.refetch()
          }}
        >
          Retry
        </Button>
      </div>
    )
  }

  const remainingSeconds =
    phase === 'writing' && anchorRef.current !== null && startedAtMsRef.current !== null
      ? Math.max(
          0,
          RECALL_TARGET_SECONDS -
            Math.floor((serverNowMs(anchorRef.current, performance.now()) - startedAtMsRef.current) / 1000),
        )
      : RECALL_TARGET_SECONDS

  const timeIsUp = phase === 'writing' && remainingSeconds <= 0
  const showSkip = phase === 'confirm' && session.completeInterval === false

  const knownError = mutation.isError ? asKnownApiError(mutation.error) : null
  const isRecallBeforeIntervalEnd =
    knownError !== null && knownError.status === 422 && knownError.code === 'recall_before_interval_end'
  const showRetryRow = mutation.isError && knownError !== null && knownError.status !== 409 && !isRecallBeforeIntervalEnd

  return (
    <div className="mx-auto max-w-xl px-4 py-6 space-y-6">
      <h1 className="text-lg font-semibold text-[var(--color-text)]">Recall</h1>

      {phase === 'confirm' ? (
        <div className="space-y-4">
          {session.completeInterval === false ? (
            <p className="inline-block rounded-full border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]">
              Incomplete attempt
            </p>
          ) : null}
          <p>Is your reading material closed?</p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={handleStartRecall}>Start recall</Button>
            {showSkip ? (
              <Button variant="secondary" onClick={handleSkipRecall}>
                Skip recall
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <TimerDisplay remainingSeconds={remainingSeconds} />
          {timeIsUp ? <p role="status">Time is up — save when you are ready</p> : null}

          <RecallPoints values={points} disabled={false} onChange={handlePointChange} />

          <div className="space-y-2">
            <Button onClick={handleSave} disabled={mutation.isPending}>
              Save recall
            </Button>
            {showRetryRow ? (
              <div role="status" className="flex items-center gap-3 text-sm text-[var(--color-text)]">
                <p>The recall could not be saved. Retry.</p>
                <Button variant="secondary" onClick={handleRetry}>
                  Retry
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
