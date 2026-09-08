/**
 * `useSessionEvents(sessionId, session)` — the shared event-recording hook
 * consumed by Focus (8.5.3) and Benchmark Running (8.3.3) (task 8.5.1;
 * design.md D5, D9, D11, D15, D39; specs/practice-sessions: "Interruption
 * events with undo and subtypes"; specs/benchmark-assessment: "Interruption
 * recording during the benchmark"; specs/session-recovery: "Events are
 * buffered, deduplicated and acknowledged").
 *
 * Keeps `{events[], voided set}` seeded once from `session.events` (D20's
 * `SessionResponse` shape) the first time a non-null `session` for this
 * `sessionId` is seen, then layers newly recorded events on top in the same
 * reducer. `record(type, details?)`:
 *
 *   1. stamps `elapsedMs`/`occurredAt` from `lib/clock/remaining.ts`'s pure
 *      `elapsedMsForEvent` (paused time excluded, D5) against an anchor
 *      re-derived whenever `session.serverNow` changes — this hook never
 *      runs a ticking `setInterval` of its own (that would duplicate the
 *      screen's own `useRemaining(session)`/`useSessionClock` instance and
 *      its heartbeat gap detector; this hook only needs a point-in-time
 *      stamp at the moment of a click, not a continuously ticking display);
 *   2. writes the draft to the outbox (`enqueue`) — the id used everywhere
 *      after this point is whatever `enqueue` returns, never one minted
 *      here, so this hook works identically against the real
 *      `lib/outbox/store.ts` (the default) and `src/test/fakeOutbox.ts`'s
 *      in-memory stand-in (injected via the `outbox` parameter — its
 *      `enqueue` does not accept a caller-supplied id, unlike the real
 *      module's optional third parameter);
 *   3. dispatches the reducer (tally re-render) with that id — synchronous
 *      with the (fast, local) `enqueue` resolving, never waiting on the
 *      network;
 *   4. best-effort posts every currently-unsent row for this session to
 *      `POST /sessions/{id}/events` (chunked at 100, the contract's cap) and
 *      acks whatever the response names accepted or duplicate. This is a
 *      deliberately small re-implementation of `lib/outbox/flush.ts`'s core
 *      loop rather than a call to `flush()` itself: `flush.ts`/`useOutbox.ts`
 *      import `enqueue`/`listUnsent`/`ack` directly from `./store.js` (real
 *      IndexedDB, hard-wired, not injectable), so this hook's own tests —
 *      which use `src/test/fakeOutbox.ts` to avoid IndexedDB in jsdom —
 *      could not substitute their fake outbox into that path without
 *      globally mocking a sibling module this task does not own. A network
 *      failure here simply leaves the row unsent; Pending/Saved/could-not-
 *      save display is `SyncStatus`'s job (8.5.2), not this hook's.
 *
 * `undo()` targets the most recent non-voided event (by `elapsedMs`): an
 * unsent one is dropped from the outbox (`ack([id])` — a local deletion,
 * never a server round trip, since the server never saw it); a sent one is
 * voided via `POST /sessions/{id}/events/{clientEventId}/void` (D9),
 * optimistically marked voided first and rolled back (with `undoNotice` set)
 * on failure — e.g. 409 `already_finalized`/`session_not_active` once the
 * session has been finalized, per D9 ("void is refused after finalize").
 *
 * When `preferences.visibilityContext` (`GET /me`, read via
 * `useMeContext()`) is `true`, a `visibilitychange` listener records a
 * `visibility` event through the SAME outbox path for the life of the
 * session (D39) — excluded from every tally (`sessionTallies.ts`). When it is
 * `false` or absent, no listener is attached at all (D15's default): app
 * visibility is never attention, and a hidden tab never creates an
 * off-task episode on its own.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { EventInputValue, SessionResponseValue } from '@attention-lab/shared'

import { useMeContext } from '../../app/AppBootstrap.js'
import { api } from '../../lib/api/client.js'
import { ConflictError } from '../../lib/api/errors.js'
import {
  elapsedMsForEvent,
  serverNowMs as deriveServerNowMs,
  type ClockAnchor,
  type ServerTimerFields,
} from '../../lib/clock/remaining.js'
import {
  ack as storeAck,
  enqueue as storeEnqueue,
  listUnsent as storeListUnsent,
  OutboxWriteError,
} from '../../lib/outbox/store.js'
import { tallies, type SessionTallies, type TalliedEvent } from './sessionTallies.js'
import { reportLocalWriteFailure, refreshOutboxStatus } from './useOutboxStatus.js'

/** The three event types a click in `EventButtons` can record. */
export type RecordableEventType = 'off_task' | 'external' | 'agent_check'
/** Every event type this hook tracks, including the opt-in `visibility` kind (D39). */
type TrackedEventType = RecordableEventType | 'visibility'

const MAX_BATCH_SIZE = 100

export interface EventDraftDetails {
  readonly alsoOffTask?: boolean
}

interface SessionEventRecord {
  readonly clientEventId: string
  readonly type: TrackedEventType
  readonly elapsedMs: number
  readonly occurredAt: string
  readonly details?: Record<string, unknown>
  /** `null` = not voided. Set locally, optimistically, on `undo()`. */
  readonly voidedAt: string | null
  /** `false` until this hook's own flush acks it (or it was seeded already-`sent` from the server). */
  readonly sent: boolean
}

/** One row as `store.ts`'s real `listUnsent`/`src/test/fakeOutbox.ts`'s fake both return it. */
interface OutboxRow {
  readonly clientEventId: string
  readonly type: string
  readonly elapsedMs: number
  readonly occurredAt: string
  readonly details?: Record<string, unknown>
}

/** What `enqueue` is handed — the four fields every client-submitted event carries. */
interface OutboxDraft {
  readonly type: string
  readonly elapsedMs: number
  readonly occurredAt: string
  readonly details?: Record<string, unknown>
}

/**
 * The outbox surface this hook needs. Matches both `lib/outbox/store.ts`
 * (the default, real IndexedDB) and `src/test/fakeOutbox.ts`'s `FakeOutbox`
 * structurally (that fake exposes more methods than this interface lists,
 * which is fine — an object satisfies an interface by having at least these
 * members), so a test can pass `createFakeOutbox()` straight through as the
 * third argument without touching real IndexedDB in jsdom.
 */
export interface SessionEventsOutbox {
  enqueue(sessionId: string, draft: OutboxDraft): Promise<{ clientEventId: string }>
  listUnsent(sessionId: string): Promise<OutboxRow[]>
  ack(clientEventIds: string[]): Promise<void>
}

const defaultOutbox: SessionEventsOutbox = {
  enqueue: storeEnqueue,
  listUnsent: storeListUnsent,
  ack: storeAck,
}

export interface UseSessionEventsResult {
  readonly tallies: SessionTallies
  record(type: RecordableEventType, details?: EventDraftDetails): Promise<void>
  undo(): Promise<void>
  readonly canUndo: boolean
  /** Set only when the most recent void attempt on a sent event was refused
   * by the server (e.g. 409 after finalize, D9); cleared on the next `undo()`. */
  readonly undoNotice: string | null
}

// ---------------------------------------------------------------------------
// Reducer: {events by id, in a Map so `seed`/`recorded` can dedupe by
// `clientEventId` in O(1)} — no `order` array is kept; undo targets the
// latest by `elapsedMs`, not by insertion order, since a seeded (already on
// the server) event and a freshly recorded one are equally valid targets.
// ---------------------------------------------------------------------------

interface EventsState {
  readonly byId: ReadonlyMap<string, SessionEventRecord>
}

type EventsAction =
  | { kind: 'seed'; events: readonly SessionEventRecord[] }
  | { kind: 'recorded'; record: SessionEventRecord }
  | { kind: 'marked_sent'; clientEventIds: readonly string[] }
  | { kind: 'voided'; clientEventId: string; voidedAt: string }
  | { kind: 'unvoided'; clientEventId: string }

function initialState(): EventsState {
  return { byId: new Map() }
}

function reducer(state: EventsState, action: EventsAction): EventsState {
  switch (action.kind) {
    case 'seed': {
      const byId = new Map(state.byId)
      for (const event of action.events) {
        if (!byId.has(event.clientEventId)) {
          byId.set(event.clientEventId, event)
        }
      }
      return { byId }
    }
    case 'recorded': {
      const byId = new Map(state.byId)
      byId.set(action.record.clientEventId, action.record)
      return { byId }
    }
    case 'marked_sent': {
      const byId = new Map(state.byId)
      let changed = false
      for (const id of action.clientEventIds) {
        const existing = byId.get(id)
        if (existing !== undefined && !existing.sent) {
          byId.set(id, { ...existing, sent: true })
          changed = true
        }
      }
      return changed ? { byId } : state
    }
    case 'voided': {
      const existing = state.byId.get(action.clientEventId)
      if (existing === undefined || existing.voidedAt !== null) {
        return state
      }
      const byId = new Map(state.byId)
      byId.set(action.clientEventId, { ...existing, voidedAt: action.voidedAt })
      return { byId }
    }
    case 'unvoided': {
      const existing = state.byId.get(action.clientEventId)
      if (existing === undefined || existing.voidedAt === null) {
        return state
      }
      const byId = new Map(state.byId)
      byId.set(action.clientEventId, { ...existing, voidedAt: null })
      return { byId }
    }
    default:
      return state
  }
}

function computeTallies(state: EventsState): SessionTallies {
  const events: TalliedEvent[] = []
  for (const event of state.byId.values()) {
    const alsoOffTask = event.details?.['alsoOffTask']
    events.push({
      type: event.type,
      voided: event.voidedAt !== null,
      ...(typeof alsoOffTask === 'boolean' ? { alsoOffTask } : {}),
    })
  }
  return tallies(events)
}

/** The most recent non-voided event by `elapsedMs`, or `null` when none exists. */
function findUndoTarget(state: EventsState): SessionEventRecord | null {
  let target: SessionEventRecord | null = null
  for (const event of state.byId.values()) {
    if (event.voidedAt !== null) {
      continue
    }
    if (target === null || event.elapsedMs > target.elapsedMs) {
      target = event
    }
  }
  return target
}

const TRACKED_EVENT_TYPES: readonly TrackedEventType[] = ['off_task', 'external', 'agent_check', 'visibility']

function isTrackedEventType(type: string): type is TrackedEventType {
  return (TRACKED_EVENT_TYPES as readonly string[]).includes(type)
}

/** Seeds this hook's reducer from `session.events` (D20) — only the four
 * client-recordable types; server-written `pause`/`resume`/`clock_gap` rows
 * play no part in this hook's tallies or undo target. */
function seedFromSession(session: SessionResponseValue): SessionEventRecord[] {
  const seeded: SessionEventRecord[] = []
  for (const event of session.events) {
    if (!isTrackedEventType(event.type)) {
      continue
    }
    seeded.push({
      clientEventId: event.clientEventId,
      type: event.type,
      elapsedMs: event.elapsedMs ?? 0,
      occurredAt: event.occurredAt,
      ...(event.details !== undefined ? { details: event.details as Record<string, unknown> } : {}),
      voidedAt: event.voidedAt,
      sent: true,
    })
  }
  return seeded
}

// ---------------------------------------------------------------------------
// The hook.
// ---------------------------------------------------------------------------

export function useSessionEvents(
  sessionId: string | null,
  session: SessionResponseValue | null,
  outbox: SessionEventsOutbox = defaultOutbox,
): UseSessionEventsResult {
  const { preferences } = useMeContext()
  const [state, dispatch] = useReducer(reducer, undefined, initialState)
  const [undoNotice, setUndoNotice] = useState<string | null>(null)

  // Seed once per session id — a route only ever hosts one session, so this
  // hook instance's whole lifetime is that one session's (a genuinely
  // different session means a remounted screen, and therefore a fresh hook
  // instance with its own ref starting at `null` again).
  const seededSessionIdRef = useRef<string | null>(null)
  if (session !== null && seededSessionIdRef.current !== session.id) {
    dispatch({ kind: 'seed', events: seedFromSession(session) })
    seededSessionIdRef.current = session.id
  }

  // D5: the anchor is re-derived whenever the session's `serverNow` moves
  // (load, a transition response, a refetch) — never accumulated, and never
  // driven by a `setInterval` this hook owns (see the module doc comment).
  const anchorRef = useRef<ClockAnchor | null>(null)
  const lastServerNowRef = useRef<string | null>(null)
  if (session !== null && session.serverNow !== lastServerNowRef.current) {
    anchorRef.current = { serverNowAtLoadMs: Date.parse(session.serverNow), monotonicAtLoadMs: performance.now() }
    lastServerNowRef.current = session.serverNow
  }

  const stampNow = useCallback((): { elapsedMs: number; occurredAt: string } | null => {
    if (session === null || anchorRef.current === null) {
      return null
    }
    const fields: ServerTimerFields = {
      startedAt: session.startedAt,
      targetSeconds: session.targetSeconds,
      pausedSeconds: session.pausedSeconds,
      currentPauseStartedAt: session.currentPauseStartedAt,
      lifecycle: session.lifecycle,
    }
    const monotonicNowMs = performance.now()
    const elapsedMs = elapsedMsForEvent(fields, anchorRef.current, monotonicNowMs)
    const occurredAt = new Date(deriveServerNowMs(anchorRef.current, monotonicNowMs)).toISOString()
    return { elapsedMs, occurredAt }
  }, [session])

  /** Best-effort: posts every currently-unsent row for this session, chunked
   * at the contract's 100-item cap, acking whatever comes back accepted or
   * duplicate. Never throws — a network failure just leaves rows unsent. */
  const flushNow = useCallback(async (): Promise<void> => {
    if (sessionId === null) {
      return
    }
    const unsent = await outbox.listUnsent(sessionId)
    for (let start = 0; start < unsent.length; start += MAX_BATCH_SIZE) {
      const chunk = unsent.slice(start, start + MAX_BATCH_SIZE)
      // Rebuilds exactly the contract's `EventInput` item shape, the same
      // way `flush.ts`'s own (unreachable from here) `toEventInput` does:
      // every row was enqueued from an already-typed draft, so `type`/
      // `details` already match one of `EventInputValue`'s branches —
      // `OutboxRow` just cannot express that union statically.
      const events = chunk.map((row): EventInputValue => {
        const base = { clientEventId: row.clientEventId, type: row.type, elapsedMs: row.elapsedMs, occurredAt: row.occurredAt }
        const withDetails = row.details !== undefined ? { ...base, details: row.details } : base
        return withDetails as unknown as EventInputValue
      })

      let response: Awaited<ReturnType<typeof api.sessions.postEvents>> | undefined
      try {
        response = await api.sessions.postEvents(sessionId, { events })
      } catch {
        return // network/validation error: leave every remaining row unsent
      }
      // Defensive against a test that leaves `sessions.postEvents` unstubbed
      // (resolves `undefined`, not a rejection) — treated the same as a
      // network error: nothing acknowledged, rows stay unsent.
      if (response === undefined || !Array.isArray(response.accepted) || !Array.isArray(response.duplicates)) {
        return
      }
      const acknowledged = [...response.accepted, ...response.duplicates]
      if (acknowledged.length > 0) {
        await outbox.ack(acknowledged)
        dispatch({ kind: 'marked_sent', clientEventIds: acknowledged })
        void refreshOutboxStatus(sessionId).catch(() => {})
      }
    }
  }, [sessionId, outbox])

  const recordEvent = useCallback(
    async (type: TrackedEventType, details?: Record<string, unknown>): Promise<void> => {
      if (sessionId === null) {
        return
      }
      const stamp = stampNow()
      if (stamp === null) {
        return
      }
      const draft: OutboxDraft = details !== undefined ? { type, ...stamp, details } : { type, ...stamp }
      let enqueued: { clientEventId: string }
      try {
        enqueued = await outbox.enqueue(sessionId, draft)
      } catch (error) {
        // Surfaces to `SyncStatus` (8.5.2) via its shared per-session status
        // store — only fires for the real store's own `OutboxWriteError`, so
        // a test's fake outbox (which never throws this class) is unaffected.
        if (error instanceof OutboxWriteError) {
          reportLocalWriteFailure(sessionId, error.clientEventId, error.draft)
        }
        throw error
      }
      const { clientEventId } = enqueued

      const record: SessionEventRecord = {
        clientEventId,
        type,
        elapsedMs: stamp.elapsedMs,
        occurredAt: stamp.occurredAt,
        ...(details !== undefined ? { details } : {}),
        voidedAt: null,
        sent: false,
      }
      dispatch({ kind: 'recorded', record })

      // Best-effort: keeps a mounted SyncStatus's unsentCount live the moment
      // this hook writes to the outbox, rather than only on SyncStatus's own
      // mount/retry. Never allowed to throw into this fire-and-forget path.
      void refreshOutboxStatus(sessionId).catch(() => {})
      void flushNow()
    },
    [sessionId, stampNow, outbox, flushNow],
  )

  const record = useCallback(
    (type: RecordableEventType, details?: EventDraftDetails): Promise<void> =>
      recordEvent(type, details as Record<string, unknown> | undefined),
    [recordEvent],
  )

  const undo = useCallback(async (): Promise<void> => {
    setUndoNotice(null)
    const target = findUndoTarget(state)
    if (target === null || sessionId === null) {
      return
    }

    if (!target.sent) {
      dispatch({ kind: 'voided', clientEventId: target.clientEventId, voidedAt: new Date().toISOString() })
      await outbox.ack([target.clientEventId])
      void refreshOutboxStatus(sessionId).catch(() => {})
      return
    }

    dispatch({ kind: 'voided', clientEventId: target.clientEventId, voidedAt: new Date().toISOString() })
    try {
      await api.sessions.void(sessionId, target.clientEventId)
    } catch (error) {
      dispatch({ kind: 'unvoided', clientEventId: target.clientEventId })
      setUndoNotice(
        error instanceof ConflictError
          ? 'This entry could not be removed: the session has already been finalized.'
          : 'This entry could not be removed. Try again.',
      )
    }
  }, [state, sessionId, outbox])

  // D39/D15: an opt-in `visibility` event through the same outbox path,
  // gated by `preferences.visibilityContext`. No listener at all when the
  // preference is false or absent — app visibility is never attention.
  useEffect(() => {
    if (!preferences.visibilityContext || sessionId === null) {
      return
    }
    function onVisibilityChange(): void {
      void recordEvent('visibility', { hidden: document.hidden })
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [preferences.visibilityContext, sessionId, recordEvent])

  return {
    tallies: computeTallies(state),
    record,
    undo,
    canUndo: findUndoTarget(state) !== null,
    undoNotice,
  }
}
