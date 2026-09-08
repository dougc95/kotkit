import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FinalizeResponseValue, ReviewInputValue, SessionResponseValue } from '@attention-lab/shared'

import { ConflictError, NetworkError, ServerError } from '../api/errors.js'
import { enqueue, listUnsent, type OutboxEventDraft } from './store.js'
import { abandonWithPurge, finalizeWithSync, type FinalizeApi } from './finalize.js'

interface PostedEvent {
  clientEventId: string
  type: string
  elapsedMs: number
  occurredAt: string
  details?: Record<string, unknown>
}

// Fresh, empty database before every test (mirrors store.test.ts / flush.test.ts).
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

function makeApi(
  postEvents: ReturnType<typeof vi.fn>,
  finalize: ReturnType<typeof vi.fn>,
  transition: ReturnType<typeof vi.fn> = vi.fn(),
): FinalizeApi {
  return { sessions: { postEvents, finalize, transition } } as unknown as FinalizeApi
}

function draft(elapsedMs: number, type = 'off_task'): OutboxEventDraft {
  return { type, elapsedMs, occurredAt: '2026-09-08T00:00:00.000Z' }
}

async function seed(sessionId: string, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await enqueue(sessionId, draft(i * 1000))
  }
}

/** Accepts every event in the batch it is given (mirrors flush.test.ts's helper). */
function acceptAllResponder() {
  return vi.fn().mockImplementation(async (_id: string, body: { events: PostedEvent[] }) => ({
    accepted: body.events.map((event) => event.clientEventId),
    duplicates: [],
  }))
}

const REVIEW: ReviewInputValue = {}

function fakeFinalizeResponse(sessionId: string): FinalizeResponseValue {
  return {
    session: { id: sessionId } as unknown as SessionResponseValue,
    review: { sessionId } as unknown as FinalizeResponseValue['review'],
    eligible: true,
    exclusionReasons: [],
  }
}

describe('finalizeWithSync', () => {
  it('409 event_count_mismatch {expected 5, stored 4} with one unsent row -> flush posts that row (accepted 1) -> retry carries the identical Idempotency-Key with expectedEventCount 5 and lastBatch omitted -> success -> buffer purged', async () => {
    const sessionId = 'session-1'
    await seed(sessionId, 1)
    const [row] = await listUnsent(sessionId)
    const rowId = row?.clientEventId
    expect(rowId).toBeDefined()

    const postEvents = acceptAllResponder()
    const response = fakeFinalizeResponse(sessionId)
    const finalize = vi
      .fn()
      .mockRejectedValueOnce(
        new ConflictError(409, {
          code: 'event_count_mismatch',
          message: 'Event count mismatch',
          details: { expected: 5, stored: 4 },
          retryable: false,
          requestId: 'req-1',
        }),
      )
      .mockResolvedValueOnce(response)
    const api = makeApi(postEvents, finalize)

    const idempotencyKey = 'key-1'
    const result = await finalizeWithSync({
      sessionId,
      idempotencyKey,
      knownServerEventCount: 4,
      review: REVIEW,
      api,
    })

    expect(result).toEqual(response)
    expect(finalize).toHaveBeenCalledTimes(2)

    const [firstArgs, secondArgs] = finalize.mock.calls as unknown as [
      [string, { expectedEventCount: number; lastBatch?: { events: PostedEvent[] } }, { idempotencyKey: string }],
      [string, { expectedEventCount: number; lastBatch?: { events: PostedEvent[] } }, { idempotencyKey: string }],
    ]

    expect(firstArgs[1].expectedEventCount).toBe(5)
    expect(firstArgs[1].lastBatch?.events).toHaveLength(1)
    expect(firstArgs[1].lastBatch?.events[0]?.clientEventId).toBe(rowId)
    expect(firstArgs[2].idempotencyKey).toBe(idempotencyKey)

    expect(secondArgs[1].expectedEventCount).toBe(5)
    expect(secondArgs[1].lastBatch).toBeUndefined()
    expect(secondArgs[2].idempotencyKey).toBe(idempotencyKey)

    expect(postEvents).toHaveBeenCalledTimes(1)
    expect(await listUnsent(sessionId)).toHaveLength(0)
  })

  it('NetworkError on the first call rethrows and leaves rows; a second call with the same key sends the same header', async () => {
    const sessionId = 'session-2'
    await seed(sessionId, 2)

    const postEvents = acceptAllResponder()
    const response = fakeFinalizeResponse(sessionId)
    const networkError = new NetworkError('offline')
    const finalize = vi.fn().mockRejectedValueOnce(networkError).mockResolvedValueOnce(response)
    const api = makeApi(postEvents, finalize)

    const idempotencyKey = 'key-2'

    await expect(
      finalizeWithSync({ sessionId, idempotencyKey, knownServerEventCount: 0, review: REVIEW, api }),
    ).rejects.toBe(networkError)
    expect(await listUnsent(sessionId)).toHaveLength(2)

    const result = await finalizeWithSync({
      sessionId,
      idempotencyKey,
      knownServerEventCount: 0,
      review: REVIEW,
      api,
    })
    expect(result).toEqual(response)

    const [firstArgs, secondArgs] = finalize.mock.calls as unknown as [
      [string, unknown, { idempotencyKey: string }],
      [string, unknown, { idempotencyKey: string }],
    ]
    expect(firstArgs[2].idempotencyKey).toBe(idempotencyKey)
    expect(secondArgs[2].idempotencyKey).toBe(idempotencyKey)
    expect(await listUnsent(sessionId)).toHaveLength(0)
  })

  it('success purges the buffer and resolves exactly the server payload (deep-equal, no added fields)', async () => {
    const sessionId = 'session-3'
    await seed(sessionId, 1)

    const postEvents = acceptAllResponder()
    const response = fakeFinalizeResponse(sessionId)
    const finalize = vi.fn().mockResolvedValueOnce(response)
    const api = makeApi(postEvents, finalize)

    const result = await finalizeWithSync({
      sessionId,
      idempotencyKey: 'key-3',
      knownServerEventCount: 7,
      review: REVIEW,
      api,
    })

    expect(result).toEqual(response)
    expect(Object.keys(result)).toEqual(Object.keys(response))
    expect(await listUnsent(sessionId)).toHaveLength(0)
  })

  it('a non-mismatch 409 or ServerError leaves rows in place, purges nothing and rejects without any finalized result', async () => {
    const staleVersionError = new ConflictError(409, {
      code: 'stale_version',
      message: 'Stale version',
      details: { current: {} },
      retryable: false,
      requestId: 'req-a',
    })
    const postEventsA = acceptAllResponder()
    const finalizeA = vi.fn().mockRejectedValueOnce(staleVersionError)
    const apiA = makeApi(postEventsA, finalizeA)
    await seed('session-4a', 1)

    await expect(
      finalizeWithSync({
        sessionId: 'session-4a',
        idempotencyKey: 'key-4a',
        knownServerEventCount: 0,
        review: REVIEW,
        api: apiA,
      }),
    ).rejects.toBe(staleVersionError)
    expect(await listUnsent('session-4a')).toHaveLength(1)

    const serverError = new ServerError(500, {
      code: 'server_error',
      message: 'boom',
      retryable: true,
      requestId: 'req-b',
    })
    const postEventsB = acceptAllResponder()
    const finalizeB = vi.fn().mockRejectedValueOnce(serverError)
    const apiB = makeApi(postEventsB, finalizeB)
    await seed('session-4b', 1)

    await expect(
      finalizeWithSync({
        sessionId: 'session-4b',
        idempotencyKey: 'key-4b',
        knownServerEventCount: 0,
        review: REVIEW,
        api: apiB,
      }),
    ).rejects.toBe(serverError)
    expect(await listUnsent('session-4b')).toHaveLength(1)
  })

  it('with 130 unsent rows the pre-flush posts 100 and lastBatch has 30', async () => {
    const sessionId = 'session-5'
    await seed(sessionId, 130)

    const postEvents = vi
      .fn()
      .mockImplementationOnce(async (_id: string, body: { events: PostedEvent[] }) => ({
        accepted: body.events.map((event) => event.clientEventId),
        duplicates: [],
      }))
      .mockImplementationOnce(async () => {
        throw new NetworkError('offline mid pre-flush')
      })
    const response = fakeFinalizeResponse(sessionId)
    const finalize = vi.fn().mockResolvedValueOnce(response)
    const api = makeApi(postEvents, finalize)

    const result = await finalizeWithSync({
      sessionId,
      idempotencyKey: 'key-5',
      knownServerEventCount: 50,
      review: REVIEW,
      api,
    })

    expect(result).toEqual(response)
    expect(postEvents).toHaveBeenCalledTimes(2)
    const calls = postEvents.mock.calls as unknown as [string, { events: PostedEvent[] }][]
    expect(calls[0]?.[1].events).toHaveLength(100)
    expect(calls[1]?.[1].events).toHaveLength(30)

    expect(finalize).toHaveBeenCalledTimes(1)
    const [args] = finalize.mock.calls as unknown as [
      [string, { expectedEventCount: number; lastBatch?: { events: PostedEvent[] } }, unknown],
    ]
    expect(args[1].lastBatch?.events).toHaveLength(30)
    expect(args[1].expectedEventCount).toBe(50 + 30)

    // On success the whole outbox for the session is purged, including the
    // 30 rows that were only ever sent as this call's own lastBatch.
    expect(await listUnsent(sessionId)).toHaveLength(0)
  })
})

describe('abandonWithPurge', () => {
  it('posts { type: "abandon", expectedVersion } and leaves zero rows for the session', async () => {
    const sessionId = 'session-6'
    await seed(sessionId, 3)

    const postEvents = acceptAllResponder()
    const transition = vi.fn().mockResolvedValue({ id: sessionId } as unknown as SessionResponseValue)
    const api = makeApi(postEvents, vi.fn(), transition)

    await abandonWithPurge({ sessionId, expectedVersion: 3, api })

    expect(transition).toHaveBeenCalledTimes(1)
    expect(transition).toHaveBeenCalledWith(sessionId, { expectedVersion: 3, type: 'abandon' })
    expect(await listUnsent(sessionId)).toHaveLength(0)
  })
})
