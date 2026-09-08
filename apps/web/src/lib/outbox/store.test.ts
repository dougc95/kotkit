import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ack,
  enqueue,
  listUnsent,
  openOutbox,
  OutboxWriteError,
  purgeOtherSessions,
  purgeSession,
  type OutboxEventDraft,
} from './store.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function draft(elapsedMs: number, type = 'off_task'): OutboxEventDraft {
  return { type, elapsedMs, occurredAt: '2026-09-08T00:00:00.000Z' }
}

// Fresh, empty database before every test — `fake-indexeddb/auto` (imported
// once above) installs the IndexedDB globals; reassigning a brand new
// `IDBFactory` here discards whatever any previous test stored, so tests
// never depend on ordering.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

describe('store', () => {
  it('enqueue assigns a UUID clientEventId before the put resolves and persists it', async () => {
    const putSpy = vi.spyOn(IDBObjectStore.prototype, 'put')
    const sessionId = 'session-1'
    const eventDraft = draft(1000)

    const { clientEventId } = await enqueue(sessionId, eventDraft)

    expect(clientEventId).toMatch(UUID_RE)
    expect(putSpy).toHaveBeenCalledTimes(1)
    // The id was already on the record handed to `put` — assigned before
    // the write, not derived from its result afterward.
    const putArg = putSpy.mock.calls[0]?.[0] as { clientEventId: string }
    expect(putArg.clientEventId).toBe(clientEventId)
    putSpy.mockRestore()

    const rows = await listUnsent(sessionId)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.clientEventId).toBe(clientEventId)
  })

  it("listUnsent returns only that session's rows in elapsedMs order", async () => {
    await enqueue('session-a', draft(3000))
    await enqueue('session-a', draft(1000))
    await enqueue('session-a', draft(2000))
    await enqueue('session-b', draft(500))

    const rows = await listUnsent('session-a')

    expect(rows.map((row) => row.elapsedMs)).toEqual([1000, 2000, 3000])
    expect(rows.every((row) => row.sessionId === 'session-a')).toBe(true)
  })

  it('ack removes exactly the given ids', async () => {
    const a = await enqueue('session-1', draft(100))
    const b = await enqueue('session-1', draft(200))
    const c = await enqueue('session-1', draft(300))

    await ack([a.clientEventId, c.clientEventId])

    const rows = await listUnsent('session-1')
    expect(rows.map((row) => row.clientEventId)).toEqual([b.clientEventId])
  })

  it("purgeSession leaves zero rows for the session and leaves another session's rows untouched", async () => {
    await enqueue('session-1', draft(100))
    await enqueue('session-1', draft(200))
    await enqueue('session-2', draft(100))

    await purgeSession('session-1')

    expect(await listUnsent('session-1')).toHaveLength(0)
    expect(await listUnsent('session-2')).toHaveLength(1)
  })

  it("purgeOtherSessions(keepId) removes rows for every other session while keeping keepId's rows, and purgeOtherSessions(null) removes every row", async () => {
    await enqueue('session-1', draft(100))
    await enqueue('session-2', draft(100))
    await enqueue('session-3', draft(100))

    await purgeOtherSessions('session-2')

    expect(await listUnsent('session-1')).toHaveLength(0)
    expect(await listUnsent('session-2')).toHaveLength(1)
    expect(await listUnsent('session-3')).toHaveLength(0)

    await purgeOtherSessions(null)

    expect(await listUnsent('session-2')).toHaveLength(0)
  })

  it('rows with createdAt older than 7 days are removed on open and 6-day-old rows are kept', async () => {
    const referenceNow = Date.parse('2026-09-08T00:00:00.000Z')
    const eightDaysAgo = referenceNow - 8 * 24 * 60 * 60 * 1000
    const sixDaysAgo = referenceNow - 6 * 24 * 60 * 60 * 1000

    // Only `Date.now` is stubbed (not the timer queue) so fake-indexeddb's
    // own internal `setImmediate`-based scheduling keeps running normally.
    const dateNowSpy = vi.spyOn(Date, 'now')
    dateNowSpy.mockReturnValue(eightDaysAgo)
    const old = await enqueue('session-1', draft(100))
    dateNowSpy.mockReturnValue(sixDaysAgo)
    const recent = await enqueue('session-1', draft(200))
    dateNowSpy.mockRestore()

    await openOutbox({ now: () => referenceNow })

    const rows = await listUnsent('session-1')
    expect(rows.map((row) => row.clientEventId)).toEqual([recent.clientEventId])
    expect(rows.map((row) => row.clientEventId)).not.toContain(old.clientEventId)
  })

  it('a failing put rejects with OutboxWriteError carrying the draft and clientEventId and nothing is stored', async () => {
    const putSpy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('simulated quota failure', 'QuotaExceededError')
    })

    const sessionId = 'session-1'
    const eventDraft = draft(100)

    let caught: unknown
    try {
      await enqueue(sessionId, eventDraft)
    } catch (error) {
      caught = error
    }
    putSpy.mockRestore()

    expect(caught).toBeInstanceOf(OutboxWriteError)
    const writeError = caught as OutboxWriteError
    expect(writeError.draft).toEqual(eventDraft)
    expect(writeError.clientEventId).toMatch(UUID_RE)

    expect(await listUnsent(sessionId)).toHaveLength(0)
  })

  it('indexedDB undefined rejects with OutboxWriteError', async () => {
    const original = globalThis.indexedDB
    Reflect.deleteProperty(globalThis, 'indexedDB')

    const sessionId = 'session-1'
    const eventDraft = draft(100)

    let caught: unknown
    try {
      await enqueue(sessionId, eventDraft)
    } catch (error) {
      caught = error
    }

    globalThis.indexedDB = original

    expect(caught).toBeInstanceOf(OutboxWriteError)
    const writeError = caught as OutboxWriteError
    expect(writeError.draft).toEqual(eventDraft)
    expect(writeError.clientEventId).toMatch(UUID_RE)
  })

  it('stored record keys are a subset of {clientEventId, sessionId, type, elapsedMs, occurredAt, details, createdAt} and never include note, token, requestId or preference keys', async () => {
    const allowedKeys = new Set([
      'clientEventId',
      'sessionId',
      'type',
      'elapsedMs',
      'occurredAt',
      'details',
      'createdAt',
    ])
    const forbiddenKeys = ['note', 'token', 'requestId', 'preference', 'preferences']

    const sessionId = 'session-1'
    const draftWithExtras = {
      type: 'agent_check',
      elapsedMs: 100,
      occurredAt: '2026-09-08T00:00:00.000Z',
      details: { alsoOffTask: true },
      note: 'must never be persisted',
      token: 'secret-token',
      requestId: 'req-123',
      preference: 'dark-mode',
    } as unknown as OutboxEventDraft

    await enqueue(sessionId, draftWithExtras)

    const rows = await listUnsent(sessionId)
    expect(rows).toHaveLength(1)
    const keys = Object.keys(rows[0] ?? {})
    for (const key of keys) {
      expect(allowedKeys.has(key)).toBe(true)
    }
    for (const forbidden of forbiddenKeys) {
      expect(keys).not.toContain(forbidden)
    }
  })
})
