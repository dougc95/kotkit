import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NetworkError, ValidationError } from '../api/errors.js'
import { enqueue, listUnsent, type OutboxEventDraft } from './store.js'
import { flush, sendDirect, type FlushApi } from './flush.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface PostedEvent {
  clientEventId: string
  type: string
  elapsedMs: number
  occurredAt: string
  details?: Record<string, unknown>
}

interface PostEventsCall {
  0: string
  1: { events: PostedEvent[] }
}

// Fresh, empty database before every test (mirrors store.test.ts).
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

function makeApi(postEvents: ReturnType<typeof vi.fn>): FlushApi {
  return { sessions: { postEvents } } as unknown as FlushApi
}

function draft(elapsedMs: number, type = 'off_task'): OutboxEventDraft {
  return { type, elapsedMs, occurredAt: '2026-09-08T00:00:00.000Z' }
}

async function seed(sessionId: string, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await enqueue(sessionId, draft(i * 1000))
  }
}

function acceptAllResponder() {
  return vi.fn().mockImplementation(async (_id: string, body: { events: PostedEvent[] }) => ({
    accepted: body.events.map((event) => event.clientEventId),
    duplicates: [],
  }))
}

describe('flush', () => {
  it('250 queued -> three POSTs of 100/100/50 in elapsedMs order, all acked, buffer empty', async () => {
    const sessionId = 'session-1'
    await seed(sessionId, 250)

    const postEvents = acceptAllResponder()
    const api = makeApi(postEvents)

    const result = await flush(sessionId, api)

    expect(result).toEqual({ outcome: 'synced', acceptedCount: 250, duplicateCount: 0 })
    expect(postEvents).toHaveBeenCalledTimes(3)

    const calls = postEvents.mock.calls as unknown as PostEventsCall[]
    expect(calls[0]?.[1].events).toHaveLength(100)
    expect(calls[1]?.[1].events).toHaveLength(100)
    expect(calls[2]?.[1].events).toHaveLength(50)

    const allElapsed = calls.flatMap((call) => call[1].events.map((event) => event.elapsedMs))
    expect(allElapsed).toEqual([...allElapsed].sort((a, b) => a - b))
    expect(new Set(allElapsed).size).toBe(250)

    expect(await listUnsent(sessionId)).toHaveLength(0)
  })

  it('retry after a network error re-sends identical clientEventIds; the server lists them in duplicates[] -> acked, duplicateCount 100, buffer empty', async () => {
    const sessionId = 'session-2'
    await seed(sessionId, 100)

    let firstCallIds: string[] = []
    const postEvents = vi
      .fn()
      .mockImplementationOnce(async (_id: string, body: { events: PostedEvent[] }) => {
        firstCallIds = body.events.map((event) => event.clientEventId)
        throw new NetworkError('offline')
      })
      .mockImplementationOnce(async (_id: string, body: { events: PostedEvent[] }) => {
        const secondCallIds = body.events.map((event) => event.clientEventId)
        expect(secondCallIds).toEqual(firstCallIds)
        return { accepted: [], duplicates: secondCallIds }
      })
    const api = makeApi(postEvents)

    const first = await flush(sessionId, api)
    expect(first.outcome).toBe('network_error')
    expect(await listUnsent(sessionId)).toHaveLength(100)

    const second = await flush(sessionId, api)
    expect(second).toEqual({ outcome: 'synced', acceptedCount: 0, duplicateCount: 100 })
    expect(await listUnsent(sessionId)).toHaveLength(0)
  })

  it('network error on the second batch keeps the second batch and returns network_error with acceptedCount 100', async () => {
    const sessionId = 'session-3'
    await seed(sessionId, 150)

    const postEvents = vi
      .fn()
      .mockImplementationOnce(async (_id: string, body: { events: PostedEvent[] }) => ({
        accepted: body.events.map((event) => event.clientEventId),
        duplicates: [],
      }))
      .mockImplementationOnce(async () => {
        throw new NetworkError('offline')
      })
    const api = makeApi(postEvents)

    const result = await flush(sessionId, api)

    expect(result).toEqual({ outcome: 'network_error', acceptedCount: 100, duplicateCount: 0 })
    expect(postEvents).toHaveBeenCalledTimes(2)
    expect(await listUnsent(sessionId)).toHaveLength(50)
  })

  it('422 keeps rows and returns rejected with offendingClientEventId resolved from fieldErrors', async () => {
    const sessionId = 'session-4'
    await seed(sessionId, 3)
    const rowsBefore = await listUnsent(sessionId)
    const offendingId = rowsBefore[1]?.clientEventId
    expect(offendingId).toBeDefined()

    const fieldErrors = { 'events[1]': 'Impossible offset' }
    const postEvents = vi.fn().mockRejectedValue(
      new ValidationError(422, {
        code: 'impossible_offset',
        message: 'Impossible offset',
        fieldErrors,
        retryable: false,
        requestId: 'req-1',
      }),
    )
    const api = makeApi(postEvents)

    const result = await flush(sessionId, api)

    expect(result.outcome).toBe('rejected')
    expect(result.acceptedCount).toBe(0)
    expect(result.duplicateCount).toBe(0)
    expect(result.offendingClientEventId).toBe(offendingId)
    expect(result.fieldErrors).toEqual(fieldErrors)
    expect(await listUnsent(sessionId)).toHaveLength(3)
  })

  it('two concurrent flush() calls produce one POST', async () => {
    const sessionId = 'session-5'
    await seed(sessionId, 5)

    const postEvents = acceptAllResponder()
    const api = makeApi(postEvents)

    const [a, b] = await Promise.all([flush(sessionId, api), flush(sessionId, api)])

    expect(postEvents).toHaveBeenCalledTimes(1)
    expect(a).toEqual({ outcome: 'synced', acceptedCount: 5, duplicateCount: 0 })
    expect(b).toBe(a)
    expect(await listUnsent(sessionId)).toHaveLength(0)
  })

  it('sendDirect posts one event with a pre-assigned clientEventId and writes nothing to IndexedDB', async () => {
    const sessionId = 'session-6'
    const postEvents = vi.fn().mockResolvedValue({ accepted: [], duplicates: [] })
    const api = makeApi(postEvents)

    const eventDraft = draft(4000, 'external')
    const { clientEventId } = await sendDirect(sessionId, eventDraft, api)

    expect(clientEventId).toMatch(UUID_RE)
    expect(postEvents).toHaveBeenCalledTimes(1)
    expect(postEvents).toHaveBeenCalledWith(sessionId, {
      events: [
        {
          clientEventId,
          type: 'external',
          elapsedMs: 4000,
          occurredAt: '2026-09-08T00:00:00.000Z',
        },
      ],
    })

    expect(await listUnsent(sessionId)).toHaveLength(0)
  })

  it('rows remain present while the POST promise is pending (no ack before response)', async () => {
    const sessionId = 'session-7'
    await seed(sessionId, 2)
    const before = await listUnsent(sessionId)
    const ids = before.map((row) => row.clientEventId)

    let resolvePost: (value: { accepted: string[]; duplicates: string[] }) => void = () => {}
    const postEvents = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve
        }),
    )
    const api = makeApi(postEvents)

    const flushPromise = flush(sessionId, api)

    await vi.waitFor(() => expect(postEvents).toHaveBeenCalledTimes(1))
    expect(await listUnsent(sessionId)).toHaveLength(2)

    resolvePost({ accepted: ids, duplicates: [] })
    const result = await flushPromise

    expect(result).toEqual({ outcome: 'synced', acceptedCount: 2, duplicateCount: 0 })
    expect(await listUnsent(sessionId)).toHaveLength(0)
  })
})
