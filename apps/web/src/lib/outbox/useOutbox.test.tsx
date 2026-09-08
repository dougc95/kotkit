import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NetworkError } from '../api/errors.js'
import { enqueue } from './store.js'
import * as storeModule from './store.js'
import type { FlushApi } from './flush.js'
import { useOutbox } from './useOutbox.js'

interface PostedEvent {
  clientEventId: string
  type: string
  elapsedMs: number
  occurredAt: string
  details?: Record<string, unknown>
}

// Fresh, empty database before every test (mirrors store.test.ts/flush.test.ts).
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

function makeApi(postEvents: ReturnType<typeof vi.fn>): FlushApi {
  return { sessions: { postEvents } } as unknown as FlushApi
}

/** Accepts every posted event — the common "server is up" responder. */
function acceptAllResponder() {
  return vi.fn().mockImplementation(async (_id: string, body: { events: PostedEvent[] }) => ({
    accepted: body.events.map((event) => event.clientEventId),
    duplicates: [],
  }))
}

describe('useOutbox', () => {
  it('record() increments offTask synchronously before a deferred IDB put resolves (asserted within 100 ms)', async () => {
    const sessionId = 'session-1'
    const postEvents = acceptAllResponder()
    const api = makeApi(postEvents)

    const { result } = renderHook(() => useOutbox(sessionId, api))
    // The mount-time replay finds nothing to send and settles immediately.
    await waitFor(() => expect(result.current.state).toBe('saved'))

    // A deferred local write: `enqueue()` (the layer that wraps the IDB
    // `put`) does not resolve until the test explicitly releases it, so the
    // assertions below prove the reducer dispatch ran before that promise —
    // and therefore before the underlying IDB write — ever settled.
    let releaseEnqueue: (value: { clientEventId: string }) => void = () => {}
    const enqueueSpy = vi.spyOn(storeModule, 'enqueue').mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseEnqueue = resolve
        }),
    )

    let recordPromise!: Promise<{ clientEventId: string }>
    act(() => {
      recordPromise = result.current.record({
        type: 'off_task',
        elapsedMs: 5000,
        occurredAt: '2026-09-08T00:05:00.000Z',
      })
    })

    // Synchronous: the reducer already ran, even though the deferred local
    // write this triggered is still pending (nothing has released it).
    expect(result.current.tallies.offTask).toBe(1)
    expect(result.current.recordedCount).toBe(1)
    expect(result.current.state).toBe('pending')

    await act(async () => {
      releaseEnqueue({ clientEventId: 'ignored-by-record-which-already-minted-its-own-id' })
      await recordPromise
    })

    enqueueSpy.mockRestore()
  })

  it('two events then a network error -> state pending, unsentCount 2, and retry() re-attempts the flush', async () => {
    const sessionId = 'session-2'
    const postEvents = vi.fn().mockRejectedValue(new NetworkError('offline'))
    const api = makeApi(postEvents)

    const { result } = renderHook(() => useOutbox(sessionId, api))
    await waitFor(() => expect(result.current.state).toBe('saved'))
    postEvents.mockClear()

    await act(async () => {
      await result.current.record({ type: 'off_task', elapsedMs: 1000, occurredAt: '2026-09-08T00:00:01.000Z' })
    })
    await act(async () => {
      await result.current.record({ type: 'external', elapsedMs: 2000, occurredAt: '2026-09-08T00:00:02.000Z' })
    })

    expect(result.current.state).toBe('pending')
    expect(result.current.unsentCount).toBe(2)
    expect(postEvents).toHaveBeenCalledTimes(2)

    postEvents.mockClear()
    await act(async () => {
      await result.current.retry()
    })

    expect(postEvents).toHaveBeenCalledTimes(1)
    const [, retryBody] = postEvents.mock.calls[0] as [string, { events: PostedEvent[] }]
    expect(retryBody.events).toHaveLength(2)
    expect(result.current.unsentCount).toBe(2)
  })

  it('state stays pending while a flush is in flight even though the request was dispatched', async () => {
    const sessionId = 'session-3'
    const postEvents = vi.fn()
    const api = makeApi(postEvents)

    const { result } = renderHook(() => useOutbox(sessionId, api))
    await waitFor(() => expect(result.current.state).toBe('saved'))

    let resolvePost: (value: { accepted: string[]; duplicates: string[] }) => void = () => {}
    postEvents.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve
        }),
    )

    let recordPromise!: Promise<{ clientEventId: string }>
    act(() => {
      recordPromise = result.current.record({ type: 'off_task', elapsedMs: 3000, occurredAt: '2026-09-08T00:00:03.000Z' })
    })

    await waitFor(() => expect(postEvents).toHaveBeenCalledTimes(1))
    // The request has been dispatched (postEvents was called) but has not
    // resolved — state must still read pending, never saved.
    expect(result.current.state).toBe('pending')

    await act(async () => {
      resolvePost({ accepted: [], duplicates: [] })
      await recordPromise
    })
  })

  it('saved only after acknowledgement with unsentCount 0', async () => {
    const sessionId = 'session-4'
    const postEvents = acceptAllResponder()
    const api = makeApi(postEvents)

    const { result } = renderHook(() => useOutbox(sessionId, api))
    await waitFor(() => expect(result.current.state).toBe('saved'))

    await act(async () => {
      await result.current.record({ type: 'external', elapsedMs: 4000, occurredAt: '2026-09-08T00:00:04.000Z' })
    })

    expect(result.current.state).toBe('saved')
    expect(result.current.stateLabel).toBe('Saved')
    expect(result.current.unsentCount).toBe(0)
  })

  it(
    'OutboxWriteError -> could_not_save with stateLabel "Entries could not be saved on this device"; ' +
      'sendDirectNow() posts the draft with its pre-assigned clientEventId and clears the failure',
    async () => {
      const sessionId = 'session-5'
      const postEvents = acceptAllResponder()
      const api = makeApi(postEvents)

      const { result } = renderHook(() => useOutbox(sessionId, api))
      await waitFor(() => expect(result.current.state).toBe('saved'))

      const putSpy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
        throw new DOMException('simulated quota failure', 'QuotaExceededError')
      })

      let recordedId = ''
      await act(async () => {
        const { clientEventId } = await result.current.record({
          type: 'off_task',
          elapsedMs: 5000,
          occurredAt: '2026-09-08T00:00:05.000Z',
        })
        recordedId = clientEventId
      })
      putSpy.mockRestore()

      expect(result.current.state).toBe('could_not_save')
      expect(result.current.stateLabel).toBe('Entries could not be saved on this device')

      postEvents.mockClear()

      await act(async () => {
        await result.current.sendDirectNow()
      })

      expect(postEvents).toHaveBeenCalledTimes(1)
      const [, body] = postEvents.mock.calls[0] as [string, { events: PostedEvent[] }]
      expect(body.events).toHaveLength(1)
      expect(body.events[0]?.clientEventId).toBe(recordedId)
      expect(result.current.state).toBe('saved')
    },
  )

  it('agent_check with alsoOffTask true -> offTask +1 and agentCheck +1; alsoOffTask false -> agentCheck +1 only; the tallies object has no combined key', async () => {
    const sessionId = 'session-6'
    const postEvents = acceptAllResponder()
    const api = makeApi(postEvents)

    const { result } = renderHook(() => useOutbox(sessionId, api))
    await waitFor(() => expect(result.current.state).toBe('saved'))

    await act(async () => {
      await result.current.record({
        type: 'agent_check',
        elapsedMs: 6000,
        occurredAt: '2026-09-08T00:00:06.000Z',
        details: { alsoOffTask: true },
      })
    })
    expect(result.current.tallies).toEqual({ offTask: 1, external: 0, agentCheck: 1 })

    await act(async () => {
      await result.current.record({
        type: 'agent_check',
        elapsedMs: 7000,
        occurredAt: '2026-09-08T00:00:07.000Z',
        details: { alsoOffTask: false },
      })
    })
    expect(result.current.tallies).toEqual({ offTask: 1, external: 0, agentCheck: 2 })
    expect(Object.keys(result.current.tallies).sort()).toEqual(['agentCheck', 'external', 'offTask'])
  })

  it('pause, resume, clock_gap and visibility events change no tally', async () => {
    const sessionId = 'session-7'
    const postEvents = acceptAllResponder()
    const api = makeApi(postEvents)

    const { result } = renderHook(() => useOutbox(sessionId, api))
    await waitFor(() => expect(result.current.state).toBe('saved'))

    for (const type of ['pause', 'resume', 'clock_gap', 'visibility']) {
      await act(async () => {
        await result.current.record({ type, elapsedMs: 8000, occurredAt: '2026-09-08T00:00:08.000Z' })
      })
    }

    expect(result.current.tallies).toEqual({ offTask: 0, external: 0, agentCheck: 0 })
    expect(result.current.recordedCount).toBe(4)
  })

  it('markVoided removes the event from tallies and recordedCount', async () => {
    const sessionId = 'session-8'
    const postEvents = acceptAllResponder()
    const api = makeApi(postEvents)

    const { result } = renderHook(() => useOutbox(sessionId, api))
    await waitFor(() => expect(result.current.state).toBe('saved'))

    let clientEventId = ''
    await act(async () => {
      const record = await result.current.record({
        type: 'off_task',
        elapsedMs: 9000,
        occurredAt: '2026-09-08T00:00:09.000Z',
      })
      clientEventId = record.clientEventId
    })
    expect(result.current.tallies.offTask).toBe(1)
    expect(result.current.recordedCount).toBe(1)

    act(() => {
      result.current.markVoided(clientEventId)
    })

    expect(result.current.tallies).toEqual({ offTask: 0, external: 0, agentCheck: 0 })
    expect(result.current.recordedCount).toBe(0)
  })

  it('mounting with two persisted unsent rows flushes them once (replayOnLoad) and ends saved', async () => {
    const sessionId = 'session-9'
    await enqueue(sessionId, { type: 'off_task', elapsedMs: 1000, occurredAt: '2026-09-08T00:00:01.000Z' })
    await enqueue(sessionId, { type: 'external', elapsedMs: 2000, occurredAt: '2026-09-08T00:00:02.000Z' })

    const postEvents = acceptAllResponder()
    const api = makeApi(postEvents)

    const { result } = renderHook(() => useOutbox(sessionId, api))

    await waitFor(() => expect(result.current.state).toBe('saved'))

    expect(postEvents).toHaveBeenCalledTimes(1)
    const [, body] = postEvents.mock.calls[0] as [string, { events: PostedEvent[] }]
    expect(body.events).toHaveLength(2)
    expect(result.current.unsentCount).toBe(0)
  })
})
