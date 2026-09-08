/**
 * Sends the active session's buffered events to the server (task 7.3.2;
 * design.md D6, D18-D21; specs/session-recovery: "Events are buffered,
 * deduplicated and acknowledged", "Pending, saved and could-not-save are
 * distinct" / "Acknowledged after retry", "Recovery buffer is bounded and
 * purged" / "Buffer after sync", "Reload recovers the active session").
 *
 * Three exports:
 *  - `flush(sessionId, api)`: reads `store.ts`'s `listUnsent`, chunks rows
 *    into `POST /sessions/{id}/events` batches of at most 100 (already in
 *    `elapsedMs` order — `listUnsent` sorts them), sends chunks one at a
 *    time, and `ack()`s a chunk's `accepted`/`duplicates` ids as soon as
 *    (and only once) that chunk's response resolves — never before. Stops
 *    at the first chunk that fails and reports why; unsent rows for a
 *    stopped-at or not-yet-attempted chunk are left in the buffer for the
 *    next call. One in-flight flush per `sessionId`: concurrent callers
 *    while a flush for that session is already running get the SAME
 *    promise rather than issuing a second request.
 *  - `replayOnLoad(activeSessionId, api)`: `openOutbox()` (the store's
 *    seven-day sweep) then `flush(activeSessionId, api)` — the "replay
 *    outbox" step of design.md's Reload flow, called once at app boot by
 *    D17/7.4.2 and, per 7.3.3, defensively on every screen's mount (both
 *    idempotent since `flush` already dedupes concurrent calls per
 *    session).
 *  - `sendDirect(sessionId, draft, api)`: the could-not-save fallback (spec:
 *    "Local storage unavailable" — "offers to keep trying the server
 *    directly"). Assigns a fresh `clientEventId` and posts a one-event
 *    batch straight to the server, never touching IndexedDB.
 *
 * `FlushApi` is intentionally the narrowest slice of `src/lib/api/client.ts`
 * this module needs (`sessions.postEvents` only) rather than the whole
 * `api` object, so a test can hand it a bare `{ sessions: { postEvents } }`
 * stub instead of the full client surface; the real `api` singleton
 * satisfies it structurally.
 */
import type { EventInputValue, EventsBatchResponseValue } from '@attention-lab/shared'

import type { api } from '../api/client.js'
import { NetworkError, ValidationError } from '../api/errors.js'
import { ack, listUnsent, openOutbox, type OutboxEventDraft, type OutboxRecord } from './store.js'

const MAX_BATCH_SIZE = 100

/** Matches a `fieldErrors` key naming a rejected item's position in the batch, e.g. "events[2]" or "events[2].elapsedMs". */
const EVENT_INDEX_PATTERN = /^events\[(\d+)\]/

/** The one client method `flush`/`sendDirect` need — see the module comment. */
export interface FlushApi {
  sessions: {
    postEvents: typeof api.sessions.postEvents
  }
}

export type FlushOutcome = 'synced' | 'network_error' | 'rejected'

export interface FlushResult {
  outcome: FlushOutcome
  acceptedCount: number
  duplicateCount: number
  /** Set only for `outcome: 'rejected'` when a `fieldErrors` key resolves to a batch position. */
  offendingClientEventId?: string
  /** Set only for `outcome: 'rejected'`; the server's raw `fieldErrors`, unchanged. */
  fieldErrors?: Record<string, string>
}

/** Promises for flushes currently in flight, keyed by `sessionId` (module-level: shared across every caller in this tab). */
const inFlightFlushes = new Map<string, Promise<FlushResult>>()

function chunkRows(rows: OutboxRecord[], size: number): OutboxRecord[][] {
  const chunks: OutboxRecord[][] = []
  for (let start = 0; start < rows.length; start += size) {
    chunks.push(rows.slice(start, start + size))
  }
  return chunks
}

/**
 * Strips `sessionId`/`createdAt` (store-only fields) and rebuilds exactly
 * the contract's `EventInput` item shape. `details` is included only when
 * present, never as an explicit `undefined` (`exactOptionalPropertyTypes`).
 * The cast is safe: every row was enqueued from an already-typed event
 * draft (7.3.1/7.3.3), so `type`/`details` already match one of
 * `EventInputValue`'s two branches — `OutboxRecord` just cannot express
 * that union statically (it stores whatever `type: string` it was given).
 */
function toEventInput(row: OutboxRecord): EventInputValue {
  const base = {
    clientEventId: row.clientEventId,
    type: row.type,
    elapsedMs: row.elapsedMs,
    occurredAt: row.occurredAt,
  }
  const withDetails = row.details !== undefined ? { ...base, details: row.details } : base
  return withDetails as unknown as EventInputValue
}

function buildResult(
  outcome: FlushOutcome,
  acceptedCount: number,
  duplicateCount: number,
  offendingClientEventId?: string,
  fieldErrors?: Record<string, string>,
): FlushResult {
  const result: FlushResult = { outcome, acceptedCount, duplicateCount }
  if (offendingClientEventId !== undefined) {
    result.offendingClientEventId = offendingClientEventId
  }
  if (fieldErrors !== undefined) {
    result.fieldErrors = fieldErrors
  }
  return result
}

/** Resolves a 422's `fieldErrors` to the batch item it names, per the task brief's `/^events\[(\d+)\]/` rule. */
function resolveOffendingClientEventId(
  fieldErrors: Record<string, string> | undefined,
  chunk: OutboxRecord[],
): string | undefined {
  if (fieldErrors === undefined) {
    return undefined
  }
  for (const key of Object.keys(fieldErrors)) {
    const match = EVENT_INDEX_PATTERN.exec(key)
    if (match?.[1] !== undefined) {
      const index = Number(match[1])
      return chunk[index]?.clientEventId
    }
  }
  return undefined
}

async function runFlush(sessionId: string, api: FlushApi): Promise<FlushResult> {
  const rows = await listUnsent(sessionId)
  const chunks = chunkRows(rows, MAX_BATCH_SIZE)

  let acceptedCount = 0
  let duplicateCount = 0

  for (const chunk of chunks) {
    const events = chunk.map(toEventInput)

    let response: EventsBatchResponseValue
    try {
      response = await api.sessions.postEvents(sessionId, { events })
    } catch (error) {
      if (error instanceof NetworkError) {
        return buildResult('network_error', acceptedCount, duplicateCount)
      }
      if (error instanceof ValidationError) {
        const offendingClientEventId = resolveOffendingClientEventId(error.fieldErrors, chunk)
        return buildResult('rejected', acceptedCount, duplicateCount, offendingClientEventId, error.fieldErrors)
      }
      throw error
    }

    // Ack only this chunk's own ids, only after its response resolved —
    // nothing is acked before the response comes back (spec: "Pending,
    // saved and could-not-save are distinct").
    const acknowledgedIds = [...response.accepted, ...response.duplicates]
    if (acknowledgedIds.length > 0) {
      await ack(acknowledgedIds)
    }
    acceptedCount += response.accepted.length
    duplicateCount += response.duplicates.length
  }

  return buildResult('synced', acceptedCount, duplicateCount)
}

/**
 * Flushes `sessionId`'s unsent rows. Concurrent calls for the same session
 * share one in-flight promise (removed from the map once it settles, so the
 * next call after that starts a fresh flush).
 */
export function flush(sessionId: string, api: FlushApi): Promise<FlushResult> {
  const existing = inFlightFlushes.get(sessionId)
  if (existing !== undefined) {
    return existing
  }

  const promise = runFlush(sessionId, api).finally(() => {
    inFlightFlushes.delete(sessionId)
  })
  inFlightFlushes.set(sessionId, promise)
  return promise
}

/**
 * D17's boot-time call site (7.4.2) and 7.3.3's per-screen mount effect:
 * sweep expired rows, then flush whatever remains for `activeSessionId`.
 */
export async function replayOnLoad(activeSessionId: string, api: FlushApi): Promise<FlushResult> {
  await openOutbox()
  return flush(activeSessionId, api)
}

/**
 * The could-not-save fallback (spec: "Local storage unavailable"): posts
 * `draft` straight to the server, touching no IndexedDB store at all.
 *
 * `clientEventId` defaults to a freshly assigned id, but 7.3.3's
 * `sendDirectNow()` passes the id `store.ts`'s `OutboxWriteError` already
 * carried (the one `useOutbox`'s `record()` minted and dispatched into its
 * reducer before the failed local write) — the draft that could not be
 * saved locally still reaches the server under the exact id the user's
 * screen already knows it by, never a second, different one.
 */
export async function sendDirect(
  sessionId: string,
  draft: OutboxEventDraft,
  api: FlushApi,
  clientEventId: string = crypto.randomUUID(),
): Promise<{ clientEventId: string }> {
  const base = {
    clientEventId,
    type: draft.type,
    elapsedMs: draft.elapsedMs,
    occurredAt: draft.occurredAt,
  }
  const event = (draft.details !== undefined ? { ...base, details: draft.details } : base) as unknown as EventInputValue

  await api.sessions.postEvents(sessionId, { events: [event] })
  return { clientEventId }
}
