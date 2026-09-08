/**
 * `useOutboxStatus(sessionId)` — the Pending/Saved/Could-not-save status for
 * one session's outbox (task 8.5.2; design.md D6, D16; specs/session-
 * recovery: "Pending, saved and could-not-save are distinct" / "Events are
 * buffered, deduplicated and acknowledged"; specs/app-shell: "Implementation
 * details are not user-facing" / "Sync state display").
 *
 * FILE LOCATION NOTE: tasks-detail.md's 8.5.2 brief places this hook in
 * `apps/web/src/lib/outbox` (a peer of `useOutbox.ts`, 7.3.3) so a future
 * `useSessionEvents` (8.5.1) could import the very same instance. This
 * workflow run's file-ownership rule forbids this task from writing
 * anything under `apps/web/src/lib/**` (shared across many parallel
 * tasks), so the hook lives here instead, self-contained, importing only
 * already-published `lib/outbox` exports (`store.ts`'s `listUnsent`/`ack`,
 * `flush.ts`'s `flush`/`replayOnLoad`/`sendDirect`, `syncState.ts`'s pure
 * derivation) rather than duplicating their logic. See this task's
 * `centralWiringNeeded` for the exact relocation + integration edit a
 * reviewer should apply once 8.5.1 exists.
 *
 * Unlike `useOutbox.ts` (built for the ONE component that records events,
 * tracking `unsentCount` incrementally from its own `record()` calls), this
 * hook never enqueues anything — Focus/Benchmark Running mount it purely to
 * DISPLAY sync status alongside a separate event-recording hook. Its
 * `unsentCount` is therefore always re-derived by reading
 * `listUnsent(sessionId)` fresh after every mount/flush, so it reflects
 * rows written by ANY caller in the tab (D6's outbox buffer is scoped to a
 * session, not to one hook instance).
 *
 * A local-write failure, by contrast, never reaches IndexedDB at all (D6:
 * "held in an in-memory queue") — nothing this hook can poll for. The only
 * way it learns of one is the exported `reportLocalWriteFailure()` below,
 * which the recording code path should call the moment its own `enqueue()`
 * throws. State lives in a tiny per-session module-level store, read via
 * `useSyncExternalStore`, so every `useOutboxStatus(sessionId)` mounted for
 * the same session (and any future caller of `reportLocalWriteFailure`)
 * observes the same values — and a re-render only happens when the derived
 * snapshot object actually changes, never on an unrelated timer tick.
 *
 * 422 `impossible_offset` (D19): `flush.ts` already stops at the first
 * rejected chunk and resolves `offendingClientEventId` from the server's
 * `fieldErrors`. This hook purges exactly that one row via `ack()` (so it
 * is never re-sent — "will not be retried") and surfaces a fixed notice;
 * every other currently-unsent row is left alone for the next Retry.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react'

import { api } from '../../lib/api/client.js'
import { ack, listUnsent, type OutboxEventDraft } from '../../lib/outbox/store.js'
import { flush, replayOnLoad, sendDirect, type FlushApi } from '../../lib/outbox/flush.js'
import { deriveSyncState, SYNC_STATE_COPY, type SyncState } from '../../lib/outbox/syncState.js'

export interface LocalWriteFailureEntry {
  clientEventId: string
  draft: OutboxEventDraft
}

interface OutboxStatusState {
  unsentCount: number
  inFlight: boolean
  localWriteFailures: LocalWriteFailureEntry[]
  rejectedNotice: string | null
}

interface SessionEntry {
  state: OutboxStatusState
  listeners: Set<() => void>
  /** Set once the mount-time `replayOnLoad` has been kicked off, so a second mounted instance for the same session does not re-trigger it. */
  replayStarted: boolean
}

/** Fixed copy (D19 `impossible_offset`) — never echoes the rejected entry's id or any field name. */
export const IMPOSSIBLE_OFFSET_NOTICE = 'One entry was rejected and will not be retried'

const sessionEntries = new Map<string, SessionEntry>()

function initialState(): OutboxStatusState {
  return { unsentCount: 0, inFlight: false, localWriteFailures: [], rejectedNotice: null }
}

function getEntry(sessionId: string): SessionEntry {
  let entry = sessionEntries.get(sessionId)
  if (entry === undefined) {
    entry = { state: initialState(), listeners: new Set(), replayStarted: false }
    sessionEntries.set(sessionId, entry)
  }
  return entry
}

function patch(sessionId: string, changes: Partial<OutboxStatusState>): void {
  const entry = getEntry(sessionId)
  entry.state = { ...entry.state, ...changes }
  for (const listener of entry.listeners) {
    listener()
  }
}

function subscribeSession(sessionId: string, listener: () => void): () => void {
  const entry = getEntry(sessionId)
  entry.listeners.add(listener)
  return () => {
    entry.listeners.delete(listener)
  }
}

function getSessionSnapshot(sessionId: string): OutboxStatusState {
  return getEntry(sessionId).state
}

async function refreshUnsentCount(sessionId: string): Promise<void> {
  const rows = await listUnsent(sessionId)
  patch(sessionId, { unsentCount: rows.length })
}

/** Runs one flush attempt, purges a rejected row (if any), then re-derives `unsentCount`. Shared by the mount-time replay and `retry()`. */
async function runFlushCycle(sessionId: string, flushApi: FlushApi, useReplay: boolean): Promise<void> {
  patch(sessionId, { inFlight: true })
  const result = useReplay ? await replayOnLoad(sessionId, flushApi) : await flush(sessionId, flushApi)
  if (result.outcome === 'rejected' && result.offendingClientEventId !== undefined) {
    await ack([result.offendingClientEventId])
    patch(sessionId, { rejectedNotice: IMPOSSIBLE_OFFSET_NOTICE })
  }
  await refreshUnsentCount(sessionId)
  patch(sessionId, { inFlight: false })
}

/**
 * The recording code path (today `useOutbox.ts`'s `record()`; eventually
 * `useSessionEvents`, 8.5.1) should call this the moment its own local
 * write throws `OutboxWriteError`, so any `SyncStatus` mounted for the same
 * session reflects the failure — see the module comment and this task's
 * `centralWiringNeeded`.
 */
export function reportLocalWriteFailure(sessionId: string, clientEventId: string, draft: OutboxEventDraft): void {
  const entry = getEntry(sessionId)
  patch(sessionId, { localWriteFailures: [...entry.state.localWriteFailures, { clientEventId, draft }] })
}

/**
 * The recording code path should also call this after every `enqueue`/`ack`
 * it performs itself (a successful record, an ack from its own best-effort
 * post, an undo) so a mounted `SyncStatus` for the same session re-derives
 * `unsentCount` from the real buffer instead of only the snapshot this
 * hook's own mount-time replay saw. Cheap (one `listUnsent` read) and safe
 * to call more often than strictly necessary — see this task's
 * `centralWiringNeeded`.
 */
export function refreshOutboxStatus(sessionId: string): Promise<void> {
  return refreshUnsentCount(sessionId)
}

/** Test-only: drop a session's (or every session's) in-memory status entry so cases stay isolated. Not imported by any production code path. */
export function __resetOutboxStatusForTests(sessionId?: string): void {
  if (sessionId !== undefined) {
    sessionEntries.delete(sessionId)
  } else {
    sessionEntries.clear()
  }
}

export interface UseOutboxStatusResult {
  state: SyncState
  stateLabel: string
  unsentCount: number
  rejectedNotice: string | null
  /** Re-attempts the flush for this session's currently unsent rows. */
  retry: () => Promise<void>
  /** Posts every currently-failed local write straight to the server, clearing them on success. */
  sendDirectNow: () => Promise<void>
}

export function useOutboxStatus(sessionId: string): UseOutboxStatusResult {
  const subscribe = useCallback((listener: () => void) => subscribeSession(sessionId, listener), [sessionId])
  const getSnapshot = useCallback(() => getSessionSnapshot(sessionId), [sessionId])

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  // Defense-in-depth replay, once per session regardless of how many
  // SyncStatus instances mount for it (mirrors 7.3.3's own per-screen
  // `replayOnLoad` call, D17).
  useEffect(() => {
    const entry = getEntry(sessionId)
    if (entry.replayStarted) {
      return
    }
    entry.replayStarted = true
    void runFlushCycle(sessionId, api, true)
  }, [sessionId])

  const retry = useCallback(() => runFlushCycle(sessionId, api, false), [sessionId])

  const sendDirectNow = useCallback(async (): Promise<void> => {
    const entry = getEntry(sessionId)
    const failures = entry.state.localWriteFailures
    if (failures.length === 0) {
      return
    }
    for (const failure of failures) {
      // eslint-disable-next-line no-await-in-loop -- each failed draft must reach the server under its own pre-assigned clientEventId, one at a time, before the next is attempted.
      await sendDirect(sessionId, failure.draft, api, failure.clientEventId)
    }
    patch(sessionId, { localWriteFailures: [] })
    await refreshUnsentCount(sessionId)
  }, [sessionId])

  const syncState = deriveSyncState({
    unsentCount: snapshot.unsentCount,
    inFlight: snapshot.inFlight,
    localWriteFailures: snapshot.localWriteFailures,
  })

  return {
    state: syncState,
    stateLabel: SYNC_STATE_COPY[syncState],
    unsentCount: snapshot.unsentCount,
    rejectedNotice: snapshot.rejectedNotice,
    retry,
    sendDirectNow,
  }
}
