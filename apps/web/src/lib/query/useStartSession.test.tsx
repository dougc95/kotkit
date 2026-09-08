import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CreateSessionBodyValue, SessionResponseValue } from '@attention-lab/shared'

import { ConflictError, NetworkError } from '../api/errors.js'
import { replayOnLoad } from '../outbox/flush.js'
import { purgeOtherSessions } from '../outbox/store.js'
import { mockApi, respond } from '../../test/mockClient.js'
import { createQueryClient } from './client.js'
import { queryKeys } from './keys.js'
import { createSessionModeRef, SessionModeProvider, type SessionModeRef } from './sessionMode.js'
import { makeSession } from './testSessionFixture.js'
import { useStartSession } from './useStartSession.js'

/** Mirrors `useStartSession.ts`'s own `RETRY_DELAY_MS` (not exported). */
const RETRY_DELAY_MS = 1000

/**
 * `SessionModeProvider` (mounted for every case below, per the task's own
 * "renderHook inside QueryClientProvider + SessionModeProvider" test recipe)
 * runs its own `GET /sessions/active` query and D17 boot replay/purge on
 * first resolution. Neither is what this unit tests, so both outbox calls
 * are stubbed to no-ops rather than touching (unavailable, in jsdom)
 * IndexedDB or the network — the same stubbing `hooks.test.tsx` and
 * `sessionMode.test.tsx` already use for the identical reason.
 */
vi.mock('../outbox/flush.js', () => ({ replayOnLoad: vi.fn() }))
vi.mock('../outbox/store.js', () => ({ purgeOtherSessions: vi.fn() }))

beforeEach(() => {
  vi.mocked(replayOnLoad).mockResolvedValue({ outcome: 'synced', acceptedCount: 0, duplicateCount: 0 })
  vi.mocked(purgeOtherSessions).mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

function mountTree(modeRef: SessionModeRef) {
  const queryClient = createQueryClient(modeRef)
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <SessionModeProvider modeRef={modeRef}>{children}</SessionModeProvider>
      </QueryClientProvider>
    )
  }
  return { queryClient, Wrapper }
}

function practiceBody(overrides: Partial<CreateSessionBodyValue> = {}): CreateSessionBodyValue {
  return {
    programId: 'program-1',
    kind: 'practice',
    intendedOutput: 'a draft paragraph',
    targetSeconds: 900,
    ...overrides,
  }
}

/** `mockApi.sessions.create`'s N-th call's `{ idempotencyKey }` option argument. */
function idempotencyKeyOfCall(callIndex: number): string {
  const call = mockApi.sessions.create.mock.calls[callIndex] as unknown as [
    CreateSessionBodyValue,
    { idempotencyKey: string },
  ]
  const options = call[1]
  return options.idempotencyKey
}

describe('useStartSession', () => {
  it('NetworkError then 200: both requests carry the identical Idempotency-Key and the active-session cache holds the returned session', async () => {
    vi.useFakeTimers()
    respond('sessions.active', null)
    const modeRef = createSessionModeRef()
    const { Wrapper, queryClient } = mountTree(modeRef)

    const started = makeSession({ id: 'started-1', lifecycle: 'running' })
    mockApi.sessions.create.mockRejectedValueOnce(new NetworkError('offline')).mockResolvedValueOnce(started)

    const { result } = renderHook(() => useStartSession(), { wrapper: Wrapper })
    const body = practiceBody()

    let startPromise!: Promise<SessionResponseValue>
    await act(async () => {
      startPromise = result.current.start(body)
      await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS)
    })
    const resolved = await startPromise

    expect(resolved).toEqual(started)
    expect(mockApi.sessions.create).toHaveBeenCalledTimes(2)
    expect(idempotencyKeyOfCall(0)).toBe(idempotencyKeyOfCall(1))
    expect(queryClient.getQueryData(queryKeys.sessions.active)).toEqual(started)
    expect(result.current.status).toBe('success')
  })

  it('while the request is pending the active-session cache is unchanged (no timer state before acknowledgement)', async () => {
    respond('sessions.active', null)
    const modeRef = createSessionModeRef()
    const { Wrapper, queryClient } = mountTree(modeRef)

    let resolveCreate!: (session: SessionResponseValue) => void
    mockApi.sessions.create.mockImplementationOnce(
      () =>
        new Promise<SessionResponseValue>((resolve) => {
          resolveCreate = resolve
        }),
    )

    const { result } = renderHook(() => useStartSession(), { wrapper: Wrapper })
    const body = practiceBody()

    act(() => {
      void result.current.start(body)
    })

    await waitFor(() => expect(result.current.status).toBe('pending'))
    // `SessionModeProvider`'s own `GET /sessions/active` already resolved to
    // `null` (stubbed above), so the cache entry exists and reads `null` —
    // "unchanged" means still that seeded value, not an absent entry.
    expect(queryClient.getQueryData(queryKeys.sessions.active)).toBeNull()

    const started = makeSession({ id: 'started-2' })
    await act(async () => {
      resolveCreate(started)
      await Promise.resolve()
    })

    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(queryClient.getQueryData(queryKeys.sessions.active)).toEqual(started)
  })

  it('exhausted NetworkError leaves the cache unchanged with status error, and a later start() with the same body reuses the same key', async () => {
    vi.useFakeTimers()
    respond('sessions.active', null)
    const modeRef = createSessionModeRef()
    const { Wrapper, queryClient } = mountTree(modeRef)

    mockApi.sessions.create.mockRejectedValue(new NetworkError('offline'))

    const { result } = renderHook(() => useStartSession(), { wrapper: Wrapper })
    const body = practiceBody()

    // A handler is attached to each promise in the SAME synchronous tick it
    // is created (before the timer-driven retry chain can settle it) —
    // attaching a handler only after `act()` returns would leave a real gap
    // where Node sees a genuinely unhandled rejection, since the promise
    // can finish rejecting entirely inside the awaited timer advance below.
    let firstError: unknown
    let firstPromise!: Promise<SessionResponseValue>
    await act(async () => {
      firstPromise = result.current.start(body)
      firstPromise.catch((thrown: unknown) => {
        firstError = thrown
      })
      await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 2)
    })
    expect(firstError).toBeInstanceOf(NetworkError)

    expect(mockApi.sessions.create).toHaveBeenCalledTimes(3)
    expect(result.current.status).toBe('error')
    // Still exactly the value `SessionModeProvider` seeded at mount — an
    // exhausted start never touches the active-session cache.
    expect(queryClient.getQueryData(queryKeys.sessions.active)).toBeNull()

    const firstKey = idempotencyKeyOfCall(0)
    mockApi.sessions.create.mockClear()
    mockApi.sessions.create.mockRejectedValue(new NetworkError('offline'))

    let secondError: unknown
    let secondPromise!: Promise<SessionResponseValue>
    await act(async () => {
      secondPromise = result.current.start(body)
      secondPromise.catch((thrown: unknown) => {
        secondError = thrown
      })
      await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 2)
    })
    expect(secondError).toBeInstanceOf(NetworkError)

    expect(idempotencyKeyOfCall(0)).toBe(firstKey)
  })

  it('ConflictError active_session_exists reads details.activeSessionId (D18) and invalidates queryKeys.sessions.active', async () => {
    respond('sessions.active', null)
    const modeRef = createSessionModeRef()
    const { Wrapper, queryClient } = mountTree(modeRef)

    const conflict = new ConflictError(409, {
      code: 'active_session_exists',
      message: 'A session is already active.',
      details: { activeSessionId: 'existing-session-1' },
      retryable: false,
      requestId: 'req-1',
    })
    mockApi.sessions.create.mockRejectedValueOnce(conflict)

    const { result } = renderHook(() => useStartSession(), { wrapper: Wrapper })
    const body = practiceBody()

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    await act(async () => {
      await expect(result.current.start(body)).rejects.toBe(conflict)
    })

    expect(result.current.activeSessionId).toBe('existing-session-1')
    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe(conflict)
    const invalidatedSessionsActive = invalidateSpy.mock.calls.some(([options]) => {
      const queryKey = (options as { queryKey?: readonly unknown[] } | undefined)?.queryKey
      return JSON.stringify(queryKey) === JSON.stringify(queryKeys.sessions.active)
    })
    expect(invalidatedSessionsActive).toBe(true)
  })

  it('after a success the next logical start uses a different key', async () => {
    respond('sessions.active', null)
    const modeRef = createSessionModeRef()
    const { Wrapper } = mountTree(modeRef)

    const sessionA = makeSession({ id: 'session-a' })
    const sessionB = makeSession({ id: 'session-b' })
    mockApi.sessions.create.mockResolvedValueOnce(sessionA).mockResolvedValueOnce(sessionB)

    const { result } = renderHook(() => useStartSession(), { wrapper: Wrapper })
    const body = practiceBody()

    await act(async () => {
      await result.current.start(body)
    })
    const firstKey = idempotencyKeyOfCall(0)

    await act(async () => {
      await result.current.start(body)
    })
    const secondKey = idempotencyKeyOfCall(1)

    expect(secondKey).not.toBe(firstKey)
  })

  it("calling start() again with an edited body before the first attempt's key is cleared mints a new Idempotency-Key instead of replaying the old content", async () => {
    vi.useFakeTimers()
    respond('sessions.active', null)
    const modeRef = createSessionModeRef()
    const { Wrapper } = mountTree(modeRef)

    const sessionB = makeSession({ id: 'session-b' })
    mockApi.sessions.create
      .mockRejectedValueOnce(new NetworkError('offline'))
      .mockResolvedValueOnce(sessionB)

    const { result } = renderHook(() => useStartSession(), { wrapper: Wrapper })
    const bodyA = practiceBody({ intendedOutput: 'first draft' })
    const bodyB = practiceBody({ intendedOutput: 'edited draft' })

    // Start with bodyA: attempt 0 rejects and the hook enters its 1 s retry
    // delay. The fake timer is never advanced past that point in this test,
    // so the pending retry never fires — bodyA's logical start is still
    // "in flight, key not yet cleared" for the rest of the test.
    let firstPromise: Promise<SessionResponseValue> | undefined
    act(() => {
      firstPromise = result.current.start(bodyA)
    })
    firstPromise?.catch(() => {
      // Deliberately left pending/unobserved for the rest of the test; a
      // rejection handler is attached only to satisfy "no unhandled
      // rejection" lint/runtime warnings if it ever does settle.
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    let secondPromise!: Promise<SessionResponseValue>
    await act(async () => {
      secondPromise = result.current.start(bodyB)
      await Promise.resolve()
      await Promise.resolve()
    })
    const resolvedB = await secondPromise

    expect(resolvedB).toEqual(sessionB)
    expect(mockApi.sessions.create).toHaveBeenCalledTimes(2)
    const firstKey = idempotencyKeyOfCall(0)
    const secondKey = idempotencyKeyOfCall(1)
    expect(secondKey).not.toBe(firstKey)
  })
})
