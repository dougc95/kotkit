import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockApi, respond } from '../../test/mockClient.js'
import { replayOnLoad } from '../outbox/flush.js'
import { purgeOtherSessions } from '../outbox/store.js'
import { createQueryClient } from './client.js'
import { useActiveSession } from './hooks.js'
import { queryKeys } from './keys.js'
import { createSessionModeRef, SessionModeProvider, type SessionModeRef } from './sessionMode.js'
import { makeSession } from './testSessionFixture.js'

// SessionModeProvider (mounted below for every case) runs the D17 boot
// replay/purge on its first successful resolution; these hooks tests only
// care about isActive()/useActiveSession(), so both outbox calls are
// stubbed to no-ops rather than touching (unavailable, in jsdom) IndexedDB
// or the network. Fresh per test: the shared harness's global
// `afterEach(vi.resetAllMocks)` (src/test/setup.ts) clears any
// `mockResolvedValue` set on a previous test's run, so it is reapplied here
// in `beforeEach` rather than once in the `vi.mock` factory.
vi.mock('../outbox/flush.js', () => ({ replayOnLoad: vi.fn() }))
vi.mock('../outbox/store.js', () => ({ purgeOtherSessions: vi.fn() }))

beforeEach(() => {
  vi.mocked(replayOnLoad).mockResolvedValue({ outcome: 'synced', acceptedCount: 0, duplicateCount: 0 })
  vi.mocked(purgeOtherSessions).mockResolvedValue(undefined)
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

describe('hooks', () => {
  it('useActiveSession maps 204 to null and isActive() is false', async () => {
    respond('sessions.active', null)
    const modeRef = createSessionModeRef()
    const { Wrapper } = mountTree(modeRef)

    const { result } = renderHook(() => useActiveSession(), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()
    expect(modeRef.isActive()).toBe(false)
  })

  it('lifecycle awaiting_review keeps isActive() true and finalized makes it false', async () => {
    const awaiting = makeSession({ lifecycle: 'awaiting_review' })
    respond('sessions.active', awaiting)
    const modeRef = createSessionModeRef()
    const { Wrapper, queryClient } = mountTree(modeRef)

    renderHook(() => useActiveSession(), { wrapper: Wrapper })
    await waitFor(() => expect(modeRef.isActive()).toBe(true))

    act(() => {
      queryClient.setQueryData(queryKeys.sessions.active, { ...awaiting, lifecycle: 'finalized' })
    })

    await waitFor(() => expect(modeRef.isActive()).toBe(false))
  })

  it('setQueryData(queryKeys.sessions.active, runningSession) flips isActive() to true before the next focus event', async () => {
    respond('sessions.active', null)
    const modeRef = createSessionModeRef()
    const { Wrapper, queryClient } = mountTree(modeRef)

    renderHook(() => useActiveSession(), { wrapper: Wrapper })
    await waitFor(() => expect(modeRef.isActive()).toBe(false))

    const running = makeSession({ lifecycle: 'running' })
    act(() => {
      queryClient.setQueryData(queryKeys.sessions.active, running)
    })

    // Flips via the provider's sync effect, well before any focus/visibility
    // event could be dispatched.
    await waitFor(() => expect(modeRef.isActive()).toBe(true))
  })

  it('visibility changes during an active session call api.sessions.postEvents and api.sessions.transition zero times', async () => {
    const running = makeSession({ lifecycle: 'running' })
    respond('sessions.active', running)
    const modeRef = createSessionModeRef()
    const { Wrapper } = mountTree(modeRef)

    renderHook(() => useActiveSession(), { wrapper: Wrapper })
    await waitFor(() => expect(modeRef.isActive()).toBe(true))

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    act(() => {
      window.dispatchEvent(new Event('visibilitychange'))
    })
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    act(() => {
      window.dispatchEvent(new Event('visibilitychange'))
    })

    expect(mockApi.sessions.postEvents).toHaveBeenCalledTimes(0)
    expect(mockApi.sessions.transition).toHaveBeenCalledTimes(0)
  })
})
