/**
 * Atomic, idempotent session finalize and abandon (task 7.3.4; design.md
 * D6, D18-D21, D28; specs/session-recovery: "Finalization is atomic and
 * idempotent", "Abandon and save-incomplete are always available",
 * "Recovery buffer is bounded and purged").
 *
 * Two exports:
 *  - `finalizeWithSync(...)`: flushes any unsent rows beyond the 100-row
 *    batch limit, computes `expectedEventCount` from the caller-supplied
 *    `knownServerEventCount` (D21: the session's `eventCount` field) plus
 *    the rows still unsent, and POSTs `/sessions/{id}/finalize` with the
 *    caller-owned Idempotency-Key. A `409 event_count_mismatch` is resolved
 *    by flushing once more (the server dedupes by `client_event_id`) and
 *    retrying EXACTLY once with the SAME key, `expectedEventCount = stored +
 *    <rows that retry flush actually got accepted>` — the flush already
 *    ack'd and purged whatever was unsent, so the retry sends no `lastBatch`
 *    at all (the contract's `EventsBatchBody.events` requires at least one
 *    item, so an "empty batch" is expressed by omitting the key, never by
 *    `{ events: [] }`). Success purges the outbox and returns the server
 *    payload unchanged — no local finalized state is ever synthesized
 *    (measurement-integrity invariant: "Timer expiry never proves
 *    completion"). A `NetworkError` from either the first call or the retry
 *    propagates with the outbox untouched, so the caller can retry later
 *    with the same key; any other rejection (including a second consecutive
 *    mismatch on the retry) also propagates and purges nothing.
 *  - `abandonWithPurge(...)`: posts an `abandon` transition then purges the
 *    outbox (D28: abandon discards unsent local entries; the server keeps
 *    minimal attempt status).
 *
 * `FinalizeApi` is the narrowest client slice this module needs
 * (`sessions.postEvents` via `flush`, `sessions.finalize`,
 * `sessions.transition`) so a test can hand it a bare stub rather than the
 * whole `api` object — the same pattern `flush.ts`'s `FlushApi` uses.
 */
import type { EventInputValue, FinalizeBodyValue, FinalizeResponseValue, ReviewInputValue } from '@attention-lab/shared'

import type { api } from '../api/client.js'
import { ConflictError, NetworkError } from '../api/errors.js'
import { flush, type FlushApi } from './flush.js'
import { listUnsent, purgeSession, type OutboxRecord } from './store.js'

const MAX_LAST_BATCH_SIZE = 100

/** The client slice `finalizeWithSync`/`abandonWithPurge` need — see the module comment. */
export interface FinalizeApi extends FlushApi {
  sessions: FlushApi['sessions'] & {
    finalize: typeof api.sessions.finalize
    transition: typeof api.sessions.transition
  }
}

export interface FinalizeWithSyncParams {
  readonly sessionId: string
  readonly idempotencyKey: string
  /** D21: the session's `eventCount` field — every stored row before this call's own `lastBatch`. */
  readonly knownServerEventCount: number
  readonly review: ReviewInputValue
  readonly api: FinalizeApi
}

export interface AbandonWithPurgeParams {
  readonly sessionId: string
  readonly expectedVersion: number
  readonly api: FinalizeApi
}

/**
 * Rebuilds exactly the contract's `EventInput` item shape from a stored
 * outbox row. Mirrors `flush.ts`'s own private `toEventInput` (not exported
 * from there, so duplicated here rather than reached into a sibling
 * module's internals) — the cast is safe for the same reason: every row was
 * enqueued from an already-typed event draft, so `type`/`details` already
 * match one of `EventInputValue`'s two branches.
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

/**
 * Builds the finalize body, adding `lastBatch` only when there is at least
 * one event to send (the schema's `EventsBatchBody.events` requires
 * `minItems: 1`, and `exactOptionalPropertyTypes` forbids an explicit
 * `lastBatch: undefined` — so an empty batch means the key is absent, never
 * present-with-empty-array or present-as-undefined).
 */
function buildFinalizeBody(
  expectedEventCount: number,
  review: ReviewInputValue,
  lastBatchEvents: EventInputValue[],
): FinalizeBodyValue {
  const body: FinalizeBodyValue = { expectedEventCount, review }
  return lastBatchEvents.length > 0 ? { ...body, lastBatch: { events: lastBatchEvents } } : body
}

/** `error.details` narrowed to `{ expected, stored }` only for a genuine 409 `event_count_mismatch`; `undefined` for anything else. */
function mismatchDetails(error: unknown): { expected: number; stored: number } | undefined {
  if (!(error instanceof ConflictError) || error.code !== 'event_count_mismatch') {
    return undefined
  }
  const details = error.details as { expected?: unknown; stored?: unknown } | undefined
  if (typeof details?.expected !== 'number' || typeof details?.stored !== 'number') {
    return undefined
  }
  return { expected: details.expected, stored: details.stored }
}

/**
 * Finalizes `sessionId`, flushing and retrying exactly once on an event-
 * count mismatch, then purges the outbox on success. See the module
 * comment for the full retry contract; rejects (with the outbox left
 * intact) for a network failure or any error the one retry does not clear.
 */
export async function finalizeWithSync(params: FinalizeWithSyncParams): Promise<FinalizeResponseValue> {
  const { sessionId, idempotencyKey, knownServerEventCount, review, api } = params

  let unsent = await listUnsent(sessionId)
  if (unsent.length > MAX_LAST_BATCH_SIZE) {
    await flush(sessionId, api)
    unsent = await listUnsent(sessionId)
  }

  const lastBatchEvents = unsent.slice(0, MAX_LAST_BATCH_SIZE).map(toEventInput)
  const expectedEventCount = knownServerEventCount + lastBatchEvents.length
  const body = buildFinalizeBody(expectedEventCount, review, lastBatchEvents)

  let result: FinalizeResponseValue
  try {
    result = await api.sessions.finalize(sessionId, body, { idempotencyKey })
  } catch (error) {
    if (error instanceof NetworkError) {
      throw error
    }
    const mismatch = mismatchDetails(error)
    if (mismatch === undefined) {
      throw error
    }

    // The server dedupes by client_event_id, so this flush is safe even if
    // the first finalize attempt's own lastBatch already reached it. It also
    // ack's and purges whatever was unsent, so the retry never has a
    // lastBatch of its own to send (buildFinalizeBody omits the key).
    const flushResult = await flush(sessionId, api)
    const retryBody = buildFinalizeBody(mismatch.stored + flushResult.acceptedCount, review, [])
    // A NetworkError or a second mismatch here propagates unchanged (no
    // second retry, no purge below) — the caller retries later with the
    // same idempotency key.
    result = await api.sessions.finalize(sessionId, retryBody, { idempotencyKey })
  }

  await purgeSession(sessionId)
  return result
}

/**
 * Abandons `sessionId` (no `reason` — D29 stores `reason` only on `pause`)
 * and purges its outbox rows. Purges nothing on failure.
 */
export async function abandonWithPurge(params: AbandonWithPurgeParams): Promise<void> {
  const { sessionId, expectedVersion, api } = params
  await api.sessions.transition(sessionId, { expectedVersion, type: 'abandon' })
  await purgeSession(sessionId)
}
