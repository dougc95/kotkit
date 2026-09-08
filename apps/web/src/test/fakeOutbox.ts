import { vi } from 'vitest'

/**
 * An in-memory stand-in for the 7.3 outbox interface (src/lib/outbox/store.ts,
 * created later by 7.3.1). Mirrors that module's event-record shape (D6: the
 * buffer holds only `{ sessionId, events[] }`) so 7.3.x's own hooks/tests can
 * swap the real IndexedDB-backed store for this one without changing call
 * sites.
 */
export interface FakeOutboxEventDraft {
  type: string
  elapsedMs: number
  occurredAt: string
  details?: Record<string, unknown>
}

export interface FakeOutboxRecord extends FakeOutboxEventDraft {
  clientEventId: string
  sessionId: string
  createdAt: number
}

export interface FakeOutboxState {
  records: FakeOutboxRecord[]
}

export interface FakeOutbox {
  enqueue: (
    sessionId: string,
    draft: FakeOutboxEventDraft,
  ) => Promise<{ clientEventId: string }>
  listUnsent: (sessionId: string) => Promise<FakeOutboxRecord[]>
  ack: (clientEventIds: string[]) => Promise<void>
  purgeSession: (sessionId: string) => Promise<void>
  /** Test helper: replace the store's contents wholesale and notify listeners. */
  emit: (state: FakeOutboxState) => void
  /** Test helper: observe every state change (enqueue/ack/purgeSession/emit). */
  onChange: (listener: (state: FakeOutboxState) => void) => () => void
}

export function createFakeOutbox(): FakeOutbox {
  let records: FakeOutboxRecord[] = []
  const listeners = new Set<(state: FakeOutboxState) => void>()

  function notify() {
    const snapshot: FakeOutboxState = { records: [...records] }
    for (const listener of listeners) listener(snapshot)
  }

  const enqueue = vi.fn(async (sessionId: string, draft: FakeOutboxEventDraft) => {
    const clientEventId = crypto.randomUUID()
    records.push({ ...draft, clientEventId, sessionId, createdAt: Date.now() })
    notify()
    return { clientEventId }
  })

  const listUnsent = vi.fn(async (sessionId: string) => {
    return records.filter((record) => record.sessionId === sessionId).sort((a, b) => a.elapsedMs - b.elapsedMs)
  })

  const ack = vi.fn(async (clientEventIds: string[]) => {
    const ids = new Set(clientEventIds)
    records = records.filter((record) => !ids.has(record.clientEventId))
    notify()
  })

  const purgeSession = vi.fn(async (sessionId: string) => {
    records = records.filter((record) => record.sessionId !== sessionId)
    notify()
  })

  function emit(state: FakeOutboxState) {
    records = [...state.records]
    notify()
  }

  function onChange(listener: (state: FakeOutboxState) => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  return { enqueue, listUnsent, ack, purgeSession, emit, onChange }
}
