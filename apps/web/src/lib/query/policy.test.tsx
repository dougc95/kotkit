import type { ReactNode } from 'react'
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ConflictError, NetworkError } from '../api/errors.js'
import { createQueryClient } from './client.js'
import { createSessionModeRef } from './sessionMode.js'
import { makeSession } from './testSessionFixture.js'

/**
 * D15's session-aware refetch policy (`client.ts`'s `createQueryClient`),
 * exercised directly against a probe query rather than through
 * `SessionModeProvider` — the policy only needs a `SessionModeRef` (its own
 * `isActive()` set by hand here), not the provider's boot side effects.
 */

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
}

function makeWrapper(queryClient: ReturnType<typeof createQueryClient>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('policy', () => {
  it('with a running session in the cache, dispatching window focus and document visibilitychange leaves a stale query fn called exactly once (no refetch)', async () => {
    const modeRef = createSessionModeRef()
    modeRef.set(makeSession({ lifecycle: 'running' }))

    const queryClient = createQueryClient(modeRef)
    const queryFn = vi.fn().mockResolvedValue('value')

    renderHook(() => useQuery({ queryKey: ['probe-active'], queryFn }), {
      wrapper: makeWrapper(queryClient),
    })
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1))

    setVisibility('hidden')
    act(() => {
      window.dispatchEvent(new Event('visibilitychange'))
    })
    setVisibility('visible')
    act(() => {
      window.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
    })

    // Give any refetch TanStack Query might have scheduled a chance to run.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(queryFn).toHaveBeenCalledTimes(1)
  })

  it('with no active session and staleTime 0, visibilitychange visible triggers exactly one refetch', async () => {
    const modeRef = createSessionModeRef()
    modeRef.set(null)

    const queryClient = createQueryClient(modeRef)
    const queryFn = vi.fn().mockResolvedValue('value')

    renderHook(() => useQuery({ queryKey: ['probe-inactive'], queryFn, staleTime: 0 }), {
      wrapper: makeWrapper(queryClient),
    })
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1))

    setVisibility('visible')
    act(() => {
      window.dispatchEvent(new Event('visibilitychange'))
    })

    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
  })

  it('NetworkError is retried at most twice and ConflictError is never retried', async () => {
    const modeRef = createSessionModeRef()
    const queryClient = createQueryClient(modeRef)

    const networkFn = vi.fn().mockRejectedValue(new NetworkError('offline'))
    const { result: networkResult } = renderHook(
      () => useQuery({ queryKey: ['network-probe'], queryFn: networkFn, retryDelay: 0 }),
      { wrapper: makeWrapper(queryClient) },
    )
    await waitFor(() => expect(networkResult.current.isError).toBe(true))
    // failureCount is 0-indexed when `retry` is called; `n < 2` allows two
    // retries after the first failure, so the query function runs 3 times.
    expect(networkFn).toHaveBeenCalledTimes(3)

    const conflictError = new ConflictError(409, {
      code: 'active_session_exists',
      message: 'A session is already active.',
      retryable: false,
      requestId: 'req-1',
    })
    const conflictFn = vi.fn().mockRejectedValue(conflictError)
    const { result: conflictResult } = renderHook(
      () => useQuery({ queryKey: ['conflict-probe'], queryFn: conflictFn, retryDelay: 0 }),
      { wrapper: makeWrapper(queryClient) },
    )
    await waitFor(() => expect(conflictResult.current.isError).toBe(true))
    expect(conflictFn).toHaveBeenCalledTimes(1)
  })
})
