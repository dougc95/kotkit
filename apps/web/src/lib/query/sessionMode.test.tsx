import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { respond } from '../../test/mockClient.js'
import { replayOnLoad } from '../outbox/flush.js'
import { enqueue, listUnsent, purgeOtherSessions } from '../outbox/store.js'
import { createQueryClient } from './client.js'
import { queryKeys } from './keys.js'
import { createSessionModeRef, SessionModeProvider, type SessionModeRef } from './sessionMode.js'
import { makeSession } from './testSessionFixture.js'

/**
 * D17's boot-time behavior: on the FIRST successful `GET /sessions/active`
 * resolution, `SessionModeProvider` replays the active session's outbox
 * then purges every other session's rows (or purges everything when no
 * session is active) — exactly once per app boot, never again on a later
 * cache update.
 *
 * `replayOnLoad` (7.3.2, network I/O) is stubbed throughout — these cases
 * are about the outbox purge, not the flush's own retry/error handling
 * (covered by `outbox/flush.test.ts`). `purgeOtherSessions` stays the REAL
 * implementation (`outbox/store.ts`) backed by `fake-indexeddb`, wrapped in
 * a `vi.fn()` only so call args/counts are assertable — its behavior is
 * unmocked, so every case also proves the actual rows left behind.
 */
vi.mock('../outbox/flush.js', () => ({ replayOnLoad: vi.fn() }))
vi.mock('../outbox/store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../outbox/store.js')>()
  return { ...actual, purgeOtherSessions: vi.fn() }
})

function draft(elapsedMs: number) {
  return { type: 'off_task', elapsedMs, occurredAt: '2026-09-08T00:00:00.000Z' }
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()

  const actualStore = await vi.importActual<typeof import('../outbox/store.js')>('../outbox/store.js')
  vi.mocked(purgeOtherSessions).mockImplementation(actualStore.purgeOtherSessions)
  vi.mocked(replayOnLoad).mockResolvedValue({ outcome: 'synced', acceptedCount: 0, duplicateCount: 0 })
})

function mount(modeRef: SessionModeRef) {
  const queryClient = createQueryClient(modeRef)
  render(
    <QueryClientProvider client={queryClient}>
      <SessionModeProvider modeRef={modeRef}>
        <div />
      </SessionModeProvider>
    </QueryClientProvider>,
  )
  return queryClient
}

describe('sessionMode boot replay/purge (D17)', () => {
  it('on boot with an active running session, replayOnLoad is called exactly once with that session id and purgeOtherSessions is called with that id', async () => {
    const running = makeSession({ id: 'active-1', lifecycle: 'running' })
    respond('sessions.active', running)
    const modeRef = createSessionModeRef()

    mount(modeRef)

    await waitFor(() => expect(replayOnLoad).toHaveBeenCalledTimes(1))
    expect(replayOnLoad).toHaveBeenCalledWith('active-1', expect.anything())
    await waitFor(() => expect(purgeOtherSessions).toHaveBeenCalledWith('active-1'))
    expect(purgeOtherSessions).toHaveBeenCalledTimes(1)
  })

  it("outbox rows belonging to a stale session are removed on boot while the active session's rows survive", async () => {
    await enqueue('active-1', draft(1000))
    await enqueue('stale-2', draft(2000))
    const running = makeSession({ id: 'active-1', lifecycle: 'running' })
    respond('sessions.active', running)
    const modeRef = createSessionModeRef()

    mount(modeRef)

    await waitFor(async () => {
      expect(await listUnsent('stale-2')).toHaveLength(0)
    })
    expect(await listUnsent('active-1')).toHaveLength(1)
  })

  it('on boot with no active session, purgeOtherSessions(null) removes every outbox row', async () => {
    await enqueue('leftover-1', draft(500))
    await enqueue('leftover-2', draft(700))
    respond('sessions.active', null)
    const modeRef = createSessionModeRef()

    mount(modeRef)

    await waitFor(() => expect(purgeOtherSessions).toHaveBeenCalledWith(null))
    expect(await listUnsent('leftover-1')).toHaveLength(0)
    expect(await listUnsent('leftover-2')).toHaveLength(0)
    expect(replayOnLoad).toHaveBeenCalledTimes(0)
  })

  it('a later mutation that flips isActive() via setQueryData does not trigger a second replay or purge', async () => {
    respond('sessions.active', null)
    const modeRef = createSessionModeRef()
    const queryClient = mount(modeRef)

    await waitFor(() => expect(purgeOtherSessions).toHaveBeenCalledTimes(1))
    expect(replayOnLoad).toHaveBeenCalledTimes(0)
    vi.mocked(purgeOtherSessions).mockClear()

    const running = makeSession({ id: 'later-1', lifecycle: 'running' })
    act(() => {
      queryClient.setQueryData(queryKeys.sessions.active, running)
    })

    await waitFor(() => expect(modeRef.isActive()).toBe(true))
    expect(replayOnLoad).toHaveBeenCalledTimes(0)
    expect(purgeOtherSessions).toHaveBeenCalledTimes(0)
  })
})
