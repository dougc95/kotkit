/**
 * PracticeReview — the practice session's one-write review screen (task
 * 8.6.2; design.md D4, D9, D11, D16, D20, D31; specs/practice-sessions:
 * "Session review saves honest outcomes" / "Partial output", "Early
 * finish"; specs/practice-sessions: "Interruption events with undo and
 * subtypes" / "Agent check that was also off-task"; specs/practice-sessions:
 * "Practice timer and elapsed time" / "Target reached"; specs/app-shell:
 * "One dominant action per screen", "Implementation details are not
 * user-facing"). Route `/review/:sessionId`, rendered inside `SessionLayout`
 * (7.1.4, no navigation).
 *
 * On mount: flush the outbox's still-unsent rows for this session (7.3.2's
 * `flush`), then read `GET /sessions/{id}` (D20) through a `useQuery` keyed
 * by `queryKeys.sessions.byId` — the SAME cache entry `useFinalizeSession`
 * (7.3.5) reads `eventCount` from at finalize time, so this screen must be
 * the one populating it before Save can be pressed meaningfully. When the
 * flush settles, the query is invalidated so a session whose tallies moved
 * (events that were still buffered client-side at mount) is re-fetched and
 * prefills recompute for every count field the user has not yet touched
 * (D31's prefill rule, reapplied per field).
 *
 * `episodeCount`/`externalCount`/`unplannedAgentChecks` (S/E/agent checks)
 * are prefilled from `session.tallies` with `countMethod: 'event'` — but
 * only `episodeCount` carries a `countMethod` on the wire (`ReviewInputSchema`
 * has exactly one `countMethod` field, paired with `episodeCount`); the
 * other two counts have no method concept to submit. A tally of 0 leaves
 * its field BLANK, never prefilled with 0 (D31: prefill fires only "when
 * any counted event exists" — a 0 tally means none did). Editing a field
 * marks it `touched`, which both switches `episodeCount`'s `countMethod` to
 * 'retrospective' and stops any later prefill refresh from overwriting what
 * the user typed.
 *
 * Save calls `useFinalizeSession(sessionId).finalize(review)` (7.3.5) —
 * never `POST /sessions/{id}/finalize` directly. That hook's `status` alone
 * drives the Save button (disabled only while it is actively flushing or
 * submitting — not for the terminal recovery states below, since Save
 * itself remains a valid way to resubmit current form state) and the
 * message region: 'flushing'/'submitting' show no message; both 'mismatch'
 * (the hook's brief, internally-batched intermediate state between its own
 * automatic retries) and the terminal 'unsaved_entries' show the same "Some
 * entries have not been saved yet" copy with Retry (`retry()`, the same
 * Idempotency-Key) — 'mismatch' is never actually visible on screen (React
 * batches the `setStatus('mismatch')` the hook issues together with the
 * `setStatus('submitting')` that immediately follows it in the same
 * synchronous loop turn, so only 'submitting' ever paints), so sharing one
 * message with the terminal state is what a user can actually see, not a
 * cosmetic simplification of two genuinely different screens; 'error' shows
 * "The review could not be saved. Retry." (the hook does not expose the
 * rejected error's `fieldErrors` on any status — 7.3.5's `status: 'error'`
 * carries no error object at all — so a 400 `fieldErrors` response from
 * finalize is indistinguishable from any other failure here and falls back
 * to this same generic copy and Retry). Nothing on this screen ever renders
 * the word "completed" or "focused" for the recorded-time line, which reads
 * `elapsedSeconds`/`targetSeconds` from the server verbatim (D20) rather
 * than any client-side timer.
 */
import { useEffect, useReducer, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import type { CountMethod, OutputQuality, ReviewInputValue, SessionResponseValue } from '@attention-lab/shared'

import { api } from '../../lib/api/client.js'
import { NotFoundError } from '../../lib/api/errors.js'
import { flush } from '../../lib/outbox/flush.js'
import { useFinalizeSession, type FinalizeSessionStatus } from '../../lib/outbox/useFinalizeSession.js'
import { queryKeys } from '../../lib/query/keys.js'
import { Button } from '../../ui/Button.js'
import { CountField } from './CountField.js'
import { OutputNoteField } from './OutputNoteField.js'
import { OutputQualityField } from './OutputQualityField.js'
import { ReviewNoteField } from './ReviewNoteField.js'

// ---------------------------------------------------------------------------
// Form state: D31's three counts, the two free-text notes, and per-count
// `touched` flags that gate both the prefill-refresh and the S field's
// countMethod switch.
// ---------------------------------------------------------------------------

interface TouchedFlags {
  readonly episodeCount: boolean
  readonly externalCount: boolean
  readonly unplannedAgentChecks: boolean
}

interface ReviewFormState {
  readonly outputQuality: OutputQuality | null
  readonly outputNote: string
  readonly reviewNote: string
  readonly episodeCount: number | null
  readonly countMethod: CountMethod | null
  readonly externalCount: number | null
  readonly unplannedAgentChecks: number | null
  readonly touched: TouchedFlags
}

type ReviewFormAction =
  | { kind: 'session_loaded'; tallies: { offTask: number; external: number; agentChecks: number } }
  | { kind: 'output_quality_changed'; value: OutputQuality }
  | { kind: 'output_note_changed'; value: string }
  | { kind: 'review_note_changed'; value: string }
  | { kind: 'episode_count_changed'; value: number | null }
  | { kind: 'external_count_changed'; value: number | null }
  | { kind: 'unplanned_agent_checks_changed'; value: number | null }

const INITIAL_STATE: ReviewFormState = {
  outputQuality: null,
  outputNote: '',
  reviewNote: '',
  episodeCount: null,
  countMethod: null,
  externalCount: null,
  unplannedAgentChecks: null,
  touched: { episodeCount: false, externalCount: false, unplannedAgentChecks: false },
}

/** D31: a count field is prefilled with the tally only when the tally is >= 1; otherwise it stays blank (never prefilled with 0). */
function prefillFromTally(tally: number): number | null {
  return tally >= 1 ? tally : null
}

function reviewFormReducer(state: ReviewFormState, action: ReviewFormAction): ReviewFormState {
  switch (action.kind) {
    case 'session_loaded': {
      const { tallies } = action
      return {
        ...state,
        episodeCount: state.touched.episodeCount ? state.episodeCount : prefillFromTally(tallies.offTask),
        countMethod: state.touched.episodeCount ? state.countMethod : tallies.offTask >= 1 ? 'event' : null,
        externalCount: state.touched.externalCount ? state.externalCount : prefillFromTally(tallies.external),
        unplannedAgentChecks: state.touched.unplannedAgentChecks
          ? state.unplannedAgentChecks
          : prefillFromTally(tallies.agentChecks),
      }
    }
    case 'output_quality_changed':
      return { ...state, outputQuality: action.value }
    case 'output_note_changed':
      return { ...state, outputNote: action.value }
    case 'review_note_changed':
      return { ...state, reviewNote: action.value }
    case 'episode_count_changed':
      return {
        ...state,
        episodeCount: action.value,
        // A blank count carries no method (D31: "no countMethod" alongside "never 0"); any non-blank
        // value the user just typed — whether or not the field started out prefilled — is 'retrospective'.
        countMethod: action.value === null ? null : 'retrospective',
        touched: { ...state.touched, episodeCount: true },
      }
    case 'external_count_changed':
      return { ...state, externalCount: action.value, touched: { ...state.touched, externalCount: true } }
    case 'unplanned_agent_checks_changed':
      return {
        ...state,
        unplannedAgentChecks: action.value,
        touched: { ...state.touched, unplannedAgentChecks: true },
      }
    default:
      return state
  }
}

/**
 * Builds the finalize `review` body: every optional field is present only
 * when it has a value (D7.1/D31 — blank is `null` client-side and OMITTED
 * on the wire, never sent as `0`; an explicit 0 the user typed IS sent).
 * Mirrors `flush.ts`/`finalize.ts`'s own spread-then-cast pattern for
 * building a `Static<>` contract type incrementally.
 */
function buildReviewBody(outputQuality: OutputQuality, state: ReviewFormState): ReviewInputValue {
  const body: Record<string, unknown> = { outputQuality }

  if (state.episodeCount !== null) {
    body.episodeCount = state.episodeCount
    if (state.countMethod !== null) {
      body.countMethod = state.countMethod
    }
  }
  if (state.externalCount !== null) {
    body.externalCount = state.externalCount
  }
  if (state.unplannedAgentChecks !== null) {
    body.unplannedAgentChecks = state.unplannedAgentChecks
  }
  if (state.outputNote.trim().length > 0) {
    body.outputNote = state.outputNote
  }
  if (state.reviewNote.trim().length > 0) {
    body.reviewNote = state.reviewNote
  }

  return body as unknown as ReviewInputValue
}

const OUTPUT_QUALITY_REQUIRED_MESSAGE = 'Choose Yes, Partly or No'

/** 'mismatch' and 'unsaved_entries' share one message — see the module comment on why 'mismatch' is never independently visible. */
function statusMessage(status: FinalizeSessionStatus): string | null {
  switch (status) {
    case 'mismatch':
    case 'unsaved_entries':
      return 'Some entries have not been saved yet'
    case 'error':
      return 'The review could not be saved. Retry.'
    default:
      return null
  }
}

export function PracticeReview() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [state, dispatch] = useReducer(reviewFormReducer, INITIAL_STATE)
  const [outputQualityErrorShown, setOutputQualityErrorShown] = useState(false)

  const finalizeHook = useFinalizeSession(sessionId ?? '')

  const sessionQuery = useQuery<SessionResponseValue>({
    queryKey: queryKeys.sessions.byId(sessionId ?? ''),
    queryFn: () => api.sessions.get(sessionId ?? ''),
    enabled: sessionId !== undefined,
  })

  // Flush this session's still-unsent outbox rows once on mount, then
  // invalidate the session query so any tallies those events affect (and,
  // through them, this screen's untouched prefills) reflect what actually
  // landed rather than a pre-flush snapshot.
  useEffect(() => {
    if (sessionId === undefined) {
      return
    }
    let cancelled = false
    flush(sessionId, api)
      .catch(() => {
        // flush() itself resolves a FlushResult for every ordinary failure
        // mode (network, rejected batch) — only a genuinely unexpected
        // rejection reaches here, and this screen has nothing narrower to
        // do about it than let the subsequent GET show the current server
        // state.
      })
      .finally(() => {
        if (!cancelled) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.byId(sessionId) })
        }
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, queryClient])

  const session = sessionQuery.data

  useEffect(() => {
    if (session !== undefined) {
      dispatch({ kind: 'session_loaded', tallies: session.tallies })
    }
  }, [session])

  useEffect(() => {
    if (finalizeHook.status === 'success' && session !== undefined) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.programs.current })
      void queryClient.invalidateQueries({ queryKey: queryKeys.programs.today(session.programId) })
      // Written synchronously, before navigating: `SessionLeaveGuard`'s
      // `useBlocker` predicate reads `isActive` from this same query
      // (`useSessionMode`) at the exact instant `navigate()` below runs. A
      // fire-and-forget `invalidateQueries` alone leaves the STALE
      // `awaiting_review` session (still counted "active") in that cache
      // until its async refetch resolves, so the guard's "A session is in
      // progress" dialog would intercept this very navigation, right after
      // the review was already saved — mirrors `useStartSession`'s own
      // `setQueryData(queryKeys.sessions.active, ...)` precedent.
      queryClient.setQueryData(queryKeys.sessions.active, null)
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.active })
      navigate('/today', { state: { notice: 'Review saved.' } })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- navigate/queryClient are stable and `session` is read for its value at the moment status flips, not tracked as a trigger; re-running this only on a status change is the point.
  }, [finalizeHook.status])

  if (sessionId === undefined) {
    return <p>Session not found</p>
  }

  if (sessionQuery.isError) {
    if (sessionQuery.error instanceof NotFoundError) {
      return (
        <div className="mx-auto max-w-xl px-4 py-6">
          <p>Session not found</p>
          <Link to="/today">Go to Today</Link>
        </div>
      )
    }
    return (
      <div className="mx-auto max-w-xl px-4 py-6">
        <p>The review could not be loaded.</p>
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

  if (sessionQuery.isPending || session === undefined) {
    return (
      <div className="mx-auto max-w-xl px-4 py-6" aria-busy="true">
        Loading review
      </div>
    )
  }

  if (session.lifecycle === 'finalized') {
    return (
      <div className="mx-auto max-w-xl px-4 py-6">
        <p>This review was already saved</p>
        <Link to="/today">Go to Today</Link>
      </div>
    )
  }

  const elapsedMinutes = Math.floor(session.timing.elapsedSeconds / 60)
  const targetMinutes = Math.floor(session.targetSeconds / 60)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (state.outputQuality === null) {
      setOutputQualityErrorShown(true)
      return
    }
    setOutputQualityErrorShown(false)
    const review = buildReviewBody(state.outputQuality, state)
    void finalizeHook.finalize(review)
  }

  const saveDisabled = finalizeHook.status === 'flushing' || finalizeHook.status === 'submitting'
  const message = statusMessage(finalizeHook.status)

  return (
    <div className="mx-auto max-w-xl px-4 py-6 space-y-6">
      <h1 className="text-lg font-semibold text-[var(--color-text)]">Practice review</h1>

      <div className="space-y-1 text-sm text-[var(--color-text)]">
        <p>Planned output: {session.intendedOutput ?? 'None recorded'}</p>
        <p>
          {elapsedMinutes} min recorded of {targetMinutes} min target (pauses excluded)
        </p>
        {session.timerQuality === 'uncertain' ? (
          <p className="inline-block rounded-full border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]">
            Timing uncertain
          </p>
        ) : null}
      </div>

      <dl data-testid="recorded-tallies" className="grid grid-cols-3 gap-3 text-sm text-[var(--color-text)]">
        <div>
          <dt className="text-[var(--color-text-muted)]">Off-task, recorded</dt>
          <dd>{session.tallies.offTask}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-text-muted)]">External, recorded</dt>
          <dd>{session.tallies.external}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-text-muted)]">Agent checks, recorded</dt>
          <dd>{session.tallies.agentChecks}</dd>
        </div>
      </dl>

      <form onSubmit={handleSubmit} className="space-y-6">
        <OutputQualityField
          value={state.outputQuality}
          onChange={(value) => dispatch({ kind: 'output_quality_changed', value })}
          error={outputQualityErrorShown ? OUTPUT_QUALITY_REQUIRED_MESSAGE : null}
        />

        <div className="flex flex-wrap gap-4">
          <CountField
            id="episode-count"
            label="How many times did you switch away?"
            value={state.episodeCount}
            prefilled={!state.touched.episodeCount && state.episodeCount !== null}
            onChange={(value) => dispatch({ kind: 'episode_count_changed', value })}
          />
          <CountField
            id="external-count"
            label="How many were external interruptions?"
            value={state.externalCount}
            prefilled={!state.touched.externalCount && state.externalCount !== null}
            onChange={(value) => dispatch({ kind: 'external_count_changed', value })}
          />
          <CountField
            id="unplanned-agent-checks"
            label="How many unplanned agent checks?"
            value={state.unplannedAgentChecks}
            prefilled={!state.touched.unplannedAgentChecks && state.unplannedAgentChecks !== null}
            onChange={(value) => dispatch({ kind: 'unplanned_agent_checks_changed', value })}
          />
        </div>

        <OutputNoteField value={state.outputNote} onChange={(value) => dispatch({ kind: 'output_note_changed', value })} />
        <ReviewNoteField value={state.reviewNote} onChange={(value) => dispatch({ kind: 'review_note_changed', value })} />

        <div className="space-y-2">
          <Button type="submit" variant="primary" disabled={saveDisabled}>
            Save review
          </Button>
          {message !== null ? (
            <div role="status" className="flex items-center gap-3 text-sm text-[var(--color-text)]">
              <p>{message}</p>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  void finalizeHook.retry()
                }}
              >
                Retry
              </Button>
            </div>
          ) : null}
        </div>
      </form>
    </div>
  )
}
