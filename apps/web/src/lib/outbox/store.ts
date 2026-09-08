/**
 * IndexedDB-backed outbox for the active session's unsent events (task
 * 7.3.1; design.md D6, D17). D6: "Outbox holds only `{sessionId, events[]}`
 * for the active session" — every stored row is exactly the `POST
 * /sessions/{id}/events` batch-item shape (`packages/shared/src/contracts/
 * sessions.ts`'s `EventInput`, task 2.7) plus `sessionId` and `createdAt`.
 * No tokens, preferences, note text or request ids are ever written;
 * `details` carries only the contract's structured fields (e.g.
 * `alsoOffTask`, `reason`, `gapSeconds`, `resolution`).
 *
 * This module owns no long-lived connection: every export opens its own
 * short-lived `IDBDatabase` handle and closes it once its transaction
 * settles. That keeps every function independently testable (no shared
 * module-level cache to reset between cases) and is cheap enough for the
 * call volumes here (per-event writes, per-session reads).
 *
 * Types deliberately mirror `src/test/fakeOutbox.ts`'s
 * `FakeOutboxEventDraft`/`FakeOutboxRecord` (built by 7.1.1 as this
 * module's future substitute) so 7.3.x's own hooks can swap the real store
 * for the fake without changing call sites (D16: one owner per shared
 * piece).
 *
 * See specs/session-recovery: "Events are buffered, deduplicated and
 * acknowledged", "Recovery buffer is bounded and purged" / "Buffer after
 * sync", "Pending, saved and could-not-save are distinct" / "Local storage
 * unavailable", and specs/identity-realm: "Private data is never written to
 * logs or stored insecurely".
 */

const DB_NAME = 'attention-lab-outbox'
const DB_VERSION = 1
const STORE_NAME = 'events'
const BY_SESSION_INDEX = 'bySession'
const BY_CREATED_AT_INDEX = 'byCreatedAt'
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

/** The draft a caller (7.3.2/7.3.3) passes before a `clientEventId` is assigned. */
export interface OutboxEventDraft {
  type: string
  elapsedMs: number
  occurredAt: string
  details?: Record<string, unknown>
}

/** One stored row: exactly the contract's event-batch item plus `sessionId`/`createdAt`. */
export interface OutboxRecord extends OutboxEventDraft {
  clientEventId: string
  sessionId: string
  createdAt: number
}

export interface OpenOutboxOptions {
  now?: () => number
}

/**
 * Raised for any IndexedDB failure while writing (`indexedDB` undefined,
 * the open request blocked/errored, the put itself failing,
 * `QuotaExceededError`, ...). Carries the original `draft` and its
 * pre-assigned `clientEventId` so the caller (7.3.3's `useOutbox`) can hand
 * it straight to `sendDirect` (7.3.2) instead of losing it.
 */
export class OutboxWriteError extends Error {
  readonly draft: OutboxEventDraft
  readonly clientEventId: string

  constructor(draft: OutboxEventDraft, clientEventId: string, cause?: unknown) {
    super('Outbox local write failed')
    this.name = new.target.name
    this.draft = draft
    this.clientEventId = clientEventId
    if (cause !== undefined) {
      this.cause = cause
    }
  }
}

/** Opens a fresh, short-lived connection; creates the store/indexes on first use. */
function openConnection(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB is unavailable in this browser/context'))
      return
    }

    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (error) {
      reject(error)
      return
    }

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'clientEventId' })
        store.createIndex(BY_SESSION_INDEX, 'sessionId')
        store.createIndex(BY_CREATED_AT_INDEX, 'createdAt')
      }
    }

    request.onblocked = () => reject(new Error('indexedDB open blocked'))
    request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'))
    request.onsuccess = () => resolve(request.result)
  })
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function promisifyTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}

/** Deletes every row for which `predicate` is true. Shared by purge/expire below. */
async function deleteWhere(predicate: (record: OutboxRecord) => boolean): Promise<void> {
  const db = await openConnection()
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    await new Promise<void>((resolve, reject) => {
      const cursorRequest = store.openCursor()
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result
        if (!cursor) {
          resolve()
          return
        }
        if (predicate(cursor.value as OutboxRecord)) {
          cursor.delete()
        }
        cursor.continue()
      }
      cursorRequest.onerror = () =>
        reject(cursorRequest.error ?? new Error('IndexedDB cursor failed'))
    })
    await promisifyTransaction(tx)
  } finally {
    db.close()
  }
}

/**
 * Opens the outbox and sweeps rows older than seven days before resolving
 * (spec: "Recovery buffer is bounded and purged" — "SHALL expire after
 * seven days"). `now` is injectable for tests; defaults to `Date.now`.
 */
export async function openOutbox(options: OpenOutboxOptions = {}): Promise<void> {
  const now = options.now ?? Date.now
  await expireOlderThan(now() - SEVEN_DAYS_MS)
}

/**
 * Assigns `clientEventId` BEFORE the put and resolves it once the write is
 * durable. Rejects with `OutboxWriteError` on any local-write failure —
 * nothing is left stored in that case.
 *
 * `clientEventId` may be supplied by the caller (7.3.3's `useOutbox`, which
 * mints one synchronously in `record()` — before this function's first
 * `await` — so the id it dispatches into its own reducer, the id this
 * function persists, and the id `flush.ts` later sends to the server are
 * always the exact same id); it defaults to a fresh `crypto.randomUUID()` so
 * every existing caller that does not pass one (7.3.1's own tests, 7.3.2's
 * `flush.test.ts` seed helper) is unaffected.
 */
export async function enqueue(
  sessionId: string,
  draft: OutboxEventDraft,
  clientEventId: string = crypto.randomUUID(),
): Promise<{ clientEventId: string }> {
  // Built explicitly (never spread from `draft`) so an unexpected property
  // on the caller's draft object can never end up persisted.
  const record: OutboxRecord = {
    clientEventId,
    sessionId,
    type: draft.type,
    elapsedMs: draft.elapsedMs,
    occurredAt: draft.occurredAt,
    createdAt: Date.now(),
  }
  if (draft.details !== undefined) {
    record.details = draft.details
  }

  try {
    const db = await openConnection()
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const request = tx.objectStore(STORE_NAME).put(record)
      await Promise.all([promisifyRequest(request), promisifyTransaction(tx)])
    } finally {
      db.close()
    }
  } catch (error) {
    throw new OutboxWriteError(draft, clientEventId, error)
  }

  return { clientEventId }
}

/** Resolves that session's unsent rows, ordered by `elapsedMs` ascending. */
export async function listUnsent(sessionId: string): Promise<OutboxRecord[]> {
  const db = await openConnection()
  try {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const index = tx.objectStore(STORE_NAME).index(BY_SESSION_INDEX)
    const rows = await promisifyRequest<OutboxRecord[]>(index.getAll(IDBKeyRange.only(sessionId)))
    await promisifyTransaction(tx)
    return rows.slice().sort((a, b) => a.elapsedMs - b.elapsedMs)
  } finally {
    db.close()
  }
}

/** Deletes exactly the given rows (acknowledged by the server). */
export async function ack(clientEventIds: string[]): Promise<void> {
  if (clientEventIds.length === 0) {
    return
  }
  const db = await openConnection()
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    for (const id of clientEventIds) {
      store.delete(id)
    }
    await promisifyTransaction(tx)
  } finally {
    db.close()
  }
}

/** Deletes every row for `sessionId` (confirmed sync or explicit abandon). */
export async function purgeSession(sessionId: string): Promise<void> {
  await deleteWhere((record) => record.sessionId === sessionId)
}

/**
 * Deletes every row whose `sessionId` is not `keepSessionId` — or every row
 * when `keepSessionId` is `null` (D17's boot-time cleanup, 7.4.2: no active
 * session means the buffer should hold nothing, since D6's buffer holds
 * only an active session's events).
 */
export async function purgeOtherSessions(keepSessionId: string | null): Promise<void> {
  await deleteWhere((record) => record.sessionId !== keepSessionId)
}

/** Deletes rows with `createdAt < ms`. */
export async function expireOlderThan(ms: number): Promise<void> {
  await deleteWhere((record) => record.createdAt < ms)
}
