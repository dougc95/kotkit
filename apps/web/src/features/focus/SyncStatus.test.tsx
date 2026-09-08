import { Profiler } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NetworkError, ValidationError } from '../../lib/api/errors.js'
import { enqueue, listUnsent } from '../../lib/outbox/store.js'
import { expectNoIdentifiers } from '../../test/expectNoIdentifiers.js'
import { mockApi, respond } from '../../test/mockClient.js'
import { SyncStatus } from './SyncStatus.js'
import { reportLocalWriteFailure } from './useOutboxStatus.js'

/**
 * `lib/outbox/store.js` (7.3.1) is swapped for 7.1.1's `fakeOutbox` harness
 * (in-memory, no real IndexedDB in jsdom) — the brief's own instruction. An
 * async factory with a dynamic `import()` builds the one fake instance for
 * this file (vi.mock's factory cannot close over a plain top-level import
 * binding — only `vi.hoisted` values or, as here, values obtained inside
 * the factory itself). `enqueue`/`listUnsent`/`ack` below (imported
 * straight from the module path) resolve to this same fake at runtime;
 * `openOutbox`'s 7-day sweep is irrelevant here and stubbed to a no-op.
 * Every test uses its own unique `sessionId` so the one fake instance
 * (module-scoped for the whole file) never leaks state between cases.
 */
vi.mock('../../lib/outbox/store.js', async () => {
  const { createFakeOutbox } = await import('../../test/fakeOutbox.js')
  const fake = createFakeOutbox()
  return {
    enqueue: fake.enqueue,
    listUnsent: fake.listUnsent,
    ack: fake.ack,
    purgeSession: fake.purgeSession,
    openOutbox: vi.fn().mockResolvedValue(undefined),
  }
})

afterEach(() => {
  cleanup()
})

function draft(elapsedMs: number, type = 'off_task') {
  return { type, elapsedMs, occurredAt: '2026-09-08T00:00:00.000Z' }
}

describe('SyncStatus', () => {
  it('unacknowledged local write renders Pending with Retry', async () => {
    const sessionId = 'session-1'
    await enqueue(sessionId, draft(1000))
    mockApi.sessions.postEvents.mockRejectedValue(new NetworkError('offline'))

    render(<SyncStatus sessionId={sessionId} />)

    await screen.findByText('Pending')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('dispatched request without ack still renders Pending', async () => {
    const sessionId = 'session-2'
    await enqueue(sessionId, draft(2000, 'external'))

    let resolvePost: (value: { accepted: string[]; duplicates: string[] }) => void = () => {}
    mockApi.sessions.postEvents.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve
        }),
    )

    render(<SyncStatus sessionId={sessionId} />)

    await waitFor(() => expect(mockApi.sessions.postEvents).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()

    await act(async () => {
      resolvePost({ accepted: [], duplicates: [] })
      await Promise.resolve()
    })
  })

  it('ack via accepted or duplicates renders Saved and the buffer is empty', async () => {
    const sessionId = 'session-3'
    const first = await enqueue(sessionId, draft(1000))
    const second = await enqueue(sessionId, draft(2000, 'external'))
    respond('sessions.postEvents', { accepted: [first.clientEventId], duplicates: [second.clientEventId] })

    render(<SyncStatus sessionId={sessionId} />)

    await screen.findByText('Saved')
    await waitFor(async () => expect(await listUnsent(sessionId)).toHaveLength(0))
  })

  it('local write failure renders Entries could not be saved on this device with the keep-trying offer', async () => {
    const sessionId = 'session-4'
    reportLocalWriteFailure(sessionId, 'evt-fail-1', draft(5000))
    respond('sessions.postEvents', { accepted: [], duplicates: [] })

    render(<SyncStatus sessionId={sessionId} />)

    await screen.findByText('Entries could not be saved on this device')
    expect(screen.getByRole('button', { name: 'Keep trying the server directly' })).toBeInTheDocument()
  })

  it('keep-trying posts events directly and renders Saved after ack', async () => {
    const sessionId = 'session-5'
    reportLocalWriteFailure(sessionId, 'evt-fail-2', draft(6000))
    respond('sessions.postEvents', { accepted: ['evt-fail-2'], duplicates: [] })

    const user = userEvent.setup()
    render(<SyncStatus sessionId={sessionId} />)

    await screen.findByText('Entries could not be saved on this device')
    await user.click(screen.getByRole('button', { name: 'Keep trying the server directly' }))

    await waitFor(() =>
      expect(mockApi.sessions.postEvents).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({ events: [expect.objectContaining({ clientEventId: 'evt-fail-2' })] }),
      ),
    )
    await screen.findByText('Saved')
  })

  it('422 impossible_offset marks one entry rejected without a retry loop', async () => {
    const sessionId = 'session-6'
    const first = await enqueue(sessionId, draft(1000))
    await enqueue(sessionId, draft(2000, 'external'))

    mockApi.sessions.postEvents.mockRejectedValue(
      new ValidationError(422, {
        code: 'impossible_offset',
        message: 'Impossible offset.',
        fieldErrors: { 'events[0]': 'impossible_offset' },
        retryable: false,
        requestId: 'req-1',
      }),
    )

    render(<SyncStatus sessionId={sessionId} />)

    await screen.findByText('One entry was rejected and will not be retried')
    expect(mockApi.sessions.postEvents).toHaveBeenCalledTimes(1)

    const remaining = await listUnsent(sessionId)
    expect(remaining.map((row) => row.clientEventId)).not.toContain(first.clientEventId)
    expect(remaining).toHaveLength(1)
  })

  it('no UUID-like text and no word idempotency/realm/revision in the DOM', async () => {
    const sessionId = 'session-7'
    respond('sessions.postEvents', { accepted: [], duplicates: [] })

    const { container } = render(<SyncStatus sessionId={sessionId} />)
    await screen.findByText('Saved')

    expectNoIdentifiers(container)
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/idempotency/i)
    expect(text).not.toMatch(/revision/i)
  })

  it('status region is aria-live polite and a render-count spy shows no re-render per timer tick', async () => {
    const sessionId = 'session-8'
    respond('sessions.postEvents', { accepted: [], duplicates: [] })

    const onRender = vi.fn()
    render(
      <Profiler id="sync-status" onRender={onRender}>
        <SyncStatus sessionId={sessionId} />
      </Profiler>,
    )

    await screen.findByText('Saved')
    const statusRegion = screen.getByRole('status')
    expect(statusRegion).toHaveAttribute('aria-live', 'polite')

    const rendersAfterSettling = onRender.mock.calls.length

    vi.useFakeTimers()
    try {
      vi.advanceTimersByTime(30_000)
      await Promise.resolve()
      vi.advanceTimersByTime(30_000)
      await Promise.resolve()
    } finally {
      vi.useRealTimers()
    }

    expect(onRender.mock.calls.length).toBe(rendersAfterSettling)
  })

  it('Saved is not shown after dispatch before ack', async () => {
    const sessionId = 'session-9'
    const { clientEventId } = await enqueue(sessionId, draft(3000))

    let resolvePost: (value: { accepted: string[]; duplicates: string[] }) => void = () => {}
    mockApi.sessions.postEvents.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve
        }),
    )

    render(<SyncStatus sessionId={sessionId} />)
    await waitFor(() => expect(mockApi.sessions.postEvents).toHaveBeenCalledTimes(1))

    expect(screen.queryByText('Saved')).not.toBeInTheDocument()

    await act(async () => {
      resolvePost({ accepted: [clientEventId], duplicates: [] })
      await Promise.resolve()
    })
    await screen.findByText('Saved')
  })
})
