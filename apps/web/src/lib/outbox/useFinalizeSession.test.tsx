import type { ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FinalizeResponseValue, SessionResponseValue } from '@attention-lab/shared'

// 7.1.1 harness: mocks '@/lib/api/client' entirely so the real fetch-backed
// `api` singleton this hook imports (and forwards, unused otherwise, into
// the mocked finalizeWithSync/abandonWithPurge below) is never touched.
import '../../test/mockClient.js'
import { queryKeys } from '../query/keys.js'
import { ConflictError, ServerError } from '../api/errors.js'

// `finalizeWithSync`/`abandonWithPurge` are this hook's only two
// dependencies (per the task brief: "mocked finalizeWithSync/
// abandonWithPurge") — 7.3.4's own finalize.test.ts already covers their
// real behavior; this file only proves useFinalizeSession's own wiring:
// key lifecycle, status transitions and the mismatch-retry cap.
const { finalizeWithSync, abandonWithPurge } = vi.hoisted(() => ({
  finalizeWithSync: vi.fn(),
  abandonWithPurge: vi.fn(),
}))
vi.mock('./finalize.js', () => ({ finalizeWithSync, abandonWithPurge }))

import { useFinalizeSession } from './useFinalizeSession.js'

function storageKey(sessionId: string): string {
  return `finalize:${sessionId}`
}

function mismatchError(expected: number, stored: number): ConflictError {
  return new ConflictError(409, {
    code: 'event_count_mismatch',
    message: 'Event count mismatch',
    details: { expected, stored },
    retryable: false,
    requestId: 'req-mismatch',
  })
}

function fakeFinalizeResponse(sessionId: string): FinalizeResponseValue {
  return {
    session: { id: sessionId } as unknown as SessionResponseValue,
    review: { sessionId } as unknown as FinalizeResponseValue['review'],
    eligible: true,
    exclusionReasons: [],
  }
}

/** Mounts the hook with a QueryClient whose `sessions.byId(sessionId)` cache entry already carries `eventCount`, mirroring the consuming screen's own `useSession(sessionId)` call. */
function mountHook(sessionId: string, eventCount: number) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  queryClient.setQueryData(queryKeys.sessions.byId(sessionId), { eventCount } as unknown as SessionResponseValue)

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }

  return renderHook(() => useFinalizeSession(sessionId), { wrapper: Wrapper })
}

beforeEach(() => {
  sessionStorage.clear()
})

describe('useFinalizeSession', () => {
  it('409 mismatch then success: finalizeWithSync is called twice with the identical Idempotency-Key and status ends success', async () => {
    const sessionId = 'session-1'
    const response = fakeFinalizeResponse(sessionId)
    finalizeWithSync.mockRejectedValueOnce(mismatchError(5, 4)).mockResolvedValueOnce(response)

    const { result } = mountHook(sessionId, 4)

    await act(async () => {
      await result.current.finalize({})
    })

    expect(result.current.status).toBe('success')
    expect(result.current.result).toEqual(response)
    expect(finalizeWithSync).toHaveBeenCalledTimes(2)

    const calls = finalizeWithSync.mock.calls as unknown as [{ idempotencyKey: string }][]
    expect(calls[0]?.[0].idempotencyKey).toBeDefined()
    expect(calls[1]?.[0].idempotencyKey).toBe(calls[0]?.[0].idempotencyKey)
    expect(result.current.mismatchAttempts).toBe(1)
  })

  it('three consecutive mismatches yield status unsaved_entries and a 4th finalizeWithSync call is never made until retry()', async () => {
    const sessionId = 'session-2'
    finalizeWithSync
      .mockRejectedValueOnce(mismatchError(5, 4))
      .mockRejectedValueOnce(mismatchError(6, 5))
      .mockRejectedValueOnce(mismatchError(7, 6))

    const { result } = mountHook(sessionId, 4)

    await act(async () => {
      await result.current.finalize({})
    })

    expect(result.current.status).toBe('unsaved_entries')
    expect(result.current.mismatchAttempts).toBe(3)
    expect(finalizeWithSync).toHaveBeenCalledTimes(3)

    // Nothing calls finalizeWithSync a 4th time on its own.
    await act(async () => {
      await Promise.resolve()
    })
    expect(finalizeWithSync).toHaveBeenCalledTimes(3)
  })

  it('retry() after unsaved_entries calls finalizeWithSync again with the same key', async () => {
    const sessionId = 'session-3'
    const response = fakeFinalizeResponse(sessionId)
    finalizeWithSync
      .mockRejectedValueOnce(mismatchError(5, 4))
      .mockRejectedValueOnce(mismatchError(6, 5))
      .mockRejectedValueOnce(mismatchError(7, 6))
      .mockResolvedValueOnce(response)

    const { result } = mountHook(sessionId, 4)

    await act(async () => {
      await result.current.finalize({})
    })
    expect(result.current.status).toBe('unsaved_entries')

    const priorCalls = finalizeWithSync.mock.calls as unknown as [{ idempotencyKey: string }][]
    const key = priorCalls[0]?.[0].idempotencyKey
    expect(priorCalls.every((call) => call[0].idempotencyKey === key)).toBe(true)

    await act(async () => {
      await result.current.retry()
    })

    expect(finalizeWithSync).toHaveBeenCalledTimes(4)
    const fourthCall = finalizeWithSync.mock.calls[3] as unknown as [{ idempotencyKey: string }]
    expect(fourthCall[0].idempotencyKey).toBe(key)
    expect(result.current.status).toBe('success')
  })

  it('a reload before success reads the key back from sessionStorage instead of minting a new one', async () => {
    const sessionId = 'session-4'
    sessionStorage.setItem(storageKey(sessionId), 'preexisting-key')
    // Never resolves: this test only inspects the synchronous first call.
    finalizeWithSync.mockReturnValueOnce(new Promise(() => {}))

    const { result } = mountHook(sessionId, 4)

    act(() => {
      void result.current.finalize({})
    })

    expect(finalizeWithSync).toHaveBeenCalledTimes(1)
    const call = finalizeWithSync.mock.calls[0] as unknown as [{ idempotencyKey: string }]
    expect(call[0].idempotencyKey).toBe('preexisting-key')
  })

  it('success removes the sessionStorage key and sessionStorage holds no other key', async () => {
    const sessionId = 'session-5'
    const response = fakeFinalizeResponse(sessionId)
    finalizeWithSync.mockResolvedValueOnce(response)

    const { result } = mountHook(sessionId, 4)

    await act(async () => {
      await result.current.finalize({})
    })

    expect(result.current.status).toBe('success')
    expect(sessionStorage.getItem(storageKey(sessionId))).toBeNull()
    expect(sessionStorage.length).toBe(0)
  })

  it('abandon() calls abandonWithPurge with the given expectedVersion and reason, and on success sets status success with result null', async () => {
    const sessionId = 'session-6'
    abandonWithPurge.mockResolvedValueOnce(undefined)

    const { result } = mountHook(sessionId, 0)

    await act(async () => {
      await result.current.abandon(3, 'changed my mind')
    })

    expect(abandonWithPurge).toHaveBeenCalledTimes(1)
    const [[args]] = abandonWithPurge.mock.calls as unknown as [
      [{ sessionId: string; expectedVersion: number; reason?: string }],
    ]
    expect(args.sessionId).toBe(sessionId)
    expect(args.expectedVersion).toBe(3)
    expect(args.reason).toBe('changed my mind')

    expect(result.current.status).toBe('success')
    expect(result.current.result).toBeNull()
  })

  it('a non-mismatch rejection sets status error and retry() reuses the same key', async () => {
    const sessionId = 'session-7'
    const serverError = new ServerError(500, {
      code: 'server_error',
      message: 'boom',
      retryable: true,
      requestId: 'req-server',
    })
    const response = fakeFinalizeResponse(sessionId)
    finalizeWithSync.mockRejectedValueOnce(serverError).mockResolvedValueOnce(response)

    const { result } = mountHook(sessionId, 4)

    await act(async () => {
      await result.current.finalize({})
    })
    expect(result.current.status).toBe('error')
    expect(finalizeWithSync).toHaveBeenCalledTimes(1)

    const firstCall = finalizeWithSync.mock.calls[0] as unknown as [{ idempotencyKey: string }]
    const key = firstCall[0].idempotencyKey

    await act(async () => {
      await result.current.retry()
    })

    expect(finalizeWithSync).toHaveBeenCalledTimes(2)
    const secondCall = finalizeWithSync.mock.calls[1] as unknown as [{ idempotencyKey: string }]
    expect(secondCall[0].idempotencyKey).toBe(key)
    expect(result.current.status).toBe('success')
  })
})
