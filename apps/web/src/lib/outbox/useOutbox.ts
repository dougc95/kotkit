/**
 * `useOutbox(sessionId, api)` — the one hook a session screen (group 8) uses
 * to record events, watch Pending/Saved/Could-not-save (7.3.3; design.md D6,
 * D11; specs/session-recovery: "Events are buffered, deduplicated and
 * acknowledged", "Pending, saved and could-not-save are distinct").
 *
 * `record()` dispatches its `useReducer` state SYNCHRONOUSLY — before the
 * first `await` — so tally feedback is on-screen within the same tick
 * (spec: "Local tally feedback SHALL appear within 100 ms regardless of
 * network state"), independent of whatever the IndexedDB write or the
 * network flush do afterward. The `clientEventId` used for that synchronous
 * dispatch is minted right there in `record()` and threaded through to
 * `store.ts`'s `enqueue()` (7.3.1) and, on a local-write failure, to
 * `flush.ts`'s `sendDirect()` (7.3.2) — one id for the whole lifetime of one
 * recorded event, never a second one assigned later by a lower layer.
 *
 * Tally rule (D11): `off_task` -> offTask; `agent_check` -> agentCheck, and
 * additionally offTask when `details.alsoOffTask` is true (the SAME event,
 * never summed into a combined total); `external` -> external; `pause`,
 * `resume`, `clock_gap` and `visibility` contribute to neither tally (they
 * are still part of `recordedCount`, since the user did record them — only
 * the two named tallies are type-selective). A voided id (`markVoided`) is
 * excluded from both from that point on, matching D9's append-only/void
 * pattern applied locally: the entry stays in the recorded list (an audit
 * trail, not a deletion) but is skipped by every derived count.
 *
 * Per D31/D17, a per-screen `replayOnLoad` also runs once on mount when
 * `sessionId` is non-null — defense in depth alongside 7.4.2's app-boot
 * replay; both are safe to run redundantly since `flush()` dedupes
 * concurrent calls for the same session.
 */
import { useCallback, useEffect, useReducer, useRef } from 'react'

import { flush, replayOnLoad, sendDirect, type FlushApi, type FlushResult } from './flush.js'
import { deriveSyncState, SYNC_STATE_COPY, type SyncState } from './syncState.js'
import { enqueue, OutboxWriteError, type OutboxEventDraft } from './store.js'

export interface OutboxTallies {
  offTask: number
  external: number
  agentCheck: number
}

interface RecordedEntry {
  clientEventId: string
  type: string
  alsoOffTask: boolean
}

interface LocalWriteFailureEntry {
  clientEventId: string
  draft: OutboxEventDraft
}

interface OutboxReducerState {
  recorded: RecordedEntry[]
  voided: Set<string>
  unsentCount: number
  inFlight: boolean
  localWriteFailures: LocalWriteFailureEntry[]
}

type OutboxAction =
  | { kind: 'recorded'; clientEventId: string; eventType: string; alsoOffTask: boolean }
  | { kind: 'local_write_failed'; clientEventId: string; draft: OutboxEventDraft }
  | { kind: 'local_write_failures_cleared' }
  | { kind: 'voided'; clientEventId: string }
  | { kind: 'flush_start' }
  | { kind: 'flush_settled'; result: FlushResult }

const NETWORK_ERROR_RESULT: FlushResult = { outcome: 'network_error', acceptedCount: 0, duplicateCount: 0 }

function initialState(): OutboxReducerState {
  return { recorded: [], voided: new Set(), unsentCount: 0, inFlight: false, localWriteFailures: [] }
}

function reducer(state: OutboxReducerState, action: OutboxAction): OutboxReducerState {
  switch (action.kind) {
    case 'recorded':
      return {
        ...state,
        recorded: [
          ...state.recorded,
          { clientEventId: action.clientEventId, type: action.eventType, alsoOffTask: action.alsoOffTask },
        ],
        // Counted the instant the reducer runs — before enqueue/flush have
        // had a chance to run at all, let alone settle.
        unsentCount: state.unsentCount + 1,
      }
    case 'local_write_failed':
      return {
        ...state,
        // The row never reached the buffer, so it stops being "unsent" and
        // becomes "could not save" instead — the two are mutually exclusive
        // for a given event (deriveSyncState already gives could_not_save
        // priority regardless, but this keeps unsentCount meaning exactly
        // "rows written locally, awaiting acknowledgement").
        unsentCount: Math.max(0, state.unsentCount - 1),
        localWriteFailures: [
          ...state.localWriteFailures,
          { clientEventId: action.clientEventId, draft: action.draft },
        ],
      }
    case 'local_write_failures_cleared':
      return { ...state, localWriteFailures: [] }
    case 'voided': {
      if (state.voided.has(action.clientEventId)) {
        return state
      }
      const voided = new Set(state.voided)
      voided.add(action.clientEventId)
      return { ...state, voided }
    }
    case 'flush_start':
      return { ...state, inFlight: true }
    case 'flush_settled': {
      // Only an acknowledged chunk (accepted or duplicate — both mean the
      // server has it) reduces unsentCount; a network error or a rejection
      // leaves every row exactly where it was, still unsent.
      const acknowledged =
        action.result.outcome === 'synced' ? action.result.acceptedCount + action.result.duplicateCount : 0
      return { ...state, inFlight: false, unsentCount: Math.max(0, state.unsentCount - acknowledged) }
    }
    default:
      return state
  }
}

function computeTallies(state: OutboxReducerState): OutboxTallies {
  let offTask = 0
  let external = 0
  let agentCheck = 0
  for (const entry of state.recorded) {
    if (state.voided.has(entry.clientEventId)) {
      continue
    }
    if (entry.type === 'off_task') {
      offTask += 1
    } else if (entry.type === 'external') {
      external += 1
    } else if (entry.type === 'agent_check') {
      agentCheck += 1
      if (entry.alsoOffTask) {
        offTask += 1
      }
    }
    // pause, resume, clock_gap, visibility: no tally (D11) — and in
    // practice never submitted through this hook at all: pause/resume are
    // server-written only (contracts/sessions.ts's client EventInput union
    // excludes them) and clock_gap/visibility carry no tally by design.
  }
  return { offTask, external, agentCheck }
}

function computeRecordedCount(state: OutboxReducerState): number {
  let count = 0
  for (const entry of state.recorded) {
    if (!state.voided.has(entry.clientEventId)) {
      count += 1
    }
  }
  return count
}

export interface UseOutboxResult {
  /** Records one event: synchronous tally feedback, then buffer + flush. Always resolves with the id it minted, even on a local-write failure. */
  record(draft: OutboxEventDraft): Promise<{ clientEventId: string }>
  /** Re-attempts the flush for this session's currently unsent rows. */
  retry(): Promise<void>
  /** Posts every currently-failed local write straight to the server (bypassing IndexedDB), clearing them on success. */
  sendDirectNow(): Promise<void>
  /** Excludes a previously recorded event from every derived count (an audit-trail void, not a deletion — D9's pattern applied locally). */
  markVoided(clientEventId: string): void
  state: SyncState
  stateLabel: string
  unsentCount: number
  recordedCount: number
  tallies: OutboxTallies
}

export function useOutbox(sessionId: string | null, api: FlushApi): UseOutboxResult {
  const [state, dispatch] = useReducer(reducer, undefined, initialState)

  // Read inside async callbacks (`sendDirectNow`) that need the state as of
  // the moment they run, not as of the render that created the closure.
  const stateRef = useRef(state)
  stateRef.current = state

  // Per-screen defense-in-depth replay (D17/7.4.2 already does this once at
  // app boot); idempotent since `flush()` dedupes concurrent calls per
  // session, so running it again here on every mount is always safe.
  useEffect(() => {
    if (sessionId === null) {
      return
    }
    let cancelled = false
    dispatch({ kind: 'flush_start' })
    replayOnLoad(sessionId, api)
      .then((result) => {
        if (!cancelled) {
          dispatch({ kind: 'flush_settled', result })
        }
      })
      .catch(() => {
        if (!cancelled) {
          dispatch({ kind: 'flush_settled', result: NETWORK_ERROR_RESULT })
        }
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, api])

  const record = useCallback(
    async (draft: OutboxEventDraft): Promise<{ clientEventId: string }> => {
      const clientEventId = crypto.randomUUID()
      const alsoOffTask = draft.type === 'agent_check' && draft.details?.['alsoOffTask'] === true
      // Synchronous — no `await` above this line — so tallies/recordedCount
      // reflect this event before enqueue or flush ever run.
      dispatch({ kind: 'recorded', clientEventId, eventType: draft.type, alsoOffTask })

      if (sessionId === null) {
        return { clientEventId }
      }

      try {
        await enqueue(sessionId, draft, clientEventId)
      } catch (error) {
        if (error instanceof OutboxWriteError) {
          dispatch({ kind: 'local_write_failed', clientEventId: error.clientEventId, draft: error.draft })
          return { clientEventId }
        }
        throw error
      }

      dispatch({ kind: 'flush_start' })
      const result = await flush(sessionId, api)
      dispatch({ kind: 'flush_settled', result })

      return { clientEventId }
    },
    [sessionId, api],
  )

  const retry = useCallback(async (): Promise<void> => {
    if (sessionId === null) {
      return
    }
    dispatch({ kind: 'flush_start' })
    const result = await flush(sessionId, api)
    dispatch({ kind: 'flush_settled', result })
  }, [sessionId, api])

  const sendDirectNow = useCallback(async (): Promise<void> => {
    if (sessionId === null) {
      return
    }
    const failures = stateRef.current.localWriteFailures
    if (failures.length === 0) {
      return
    }
    for (const failure of failures) {
      await sendDirect(sessionId, failure.draft, api, failure.clientEventId)
    }
    dispatch({ kind: 'local_write_failures_cleared' })
  }, [sessionId, api])

  const markVoided = useCallback((clientEventId: string): void => {
    dispatch({ kind: 'voided', clientEventId })
  }, [])

  const syncState = deriveSyncState({
    unsentCount: state.unsentCount,
    inFlight: state.inFlight,
    localWriteFailures: state.localWriteFailures,
  })

  return {
    record,
    retry,
    sendDirectNow,
    markVoided,
    state: syncState,
    stateLabel: SYNC_STATE_COPY[syncState],
    unsentCount: state.unsentCount,
    recordedCount: computeRecordedCount(state),
    tallies: computeTallies(state),
  }
}
