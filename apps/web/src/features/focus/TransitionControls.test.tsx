import { act, cleanup, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionResponseValue } from '@attention-lab/shared'

// Imported first (before anything that transitively reaches the real
// `lib/api/client.js`, e.g. `lib/query/hooks.js` and this file's own
// `TransitionControls.js`): `vi.mock('@/lib/api/client', ...)` inside this
// module only intercepts imports of that module requested AFTER it runs,
// mirroring AbandonSession.test.tsx/ClockGapPrompt.test.tsx's own import
// ordering.
import { mockApi, reject, respond } from '../../test/mockClient.js'

import { useSession } from '../../lib/query/hooks.js'
import { makeSession as buildSession } from '../../lib/query/testSessionFixture.js'
import { renderWithProviders } from '../../test/renderWithProviders.js'
import { EventButtons } from './EventButtons.js'
import { TransitionControls } from './TransitionControls.js'
import { useRemaining, type RemainingSessionInput } from './useRemaining.js'

/**
 * task 8.5.4's verify list, all 9 named cases. This file is deliberately
 * self-contained: it never renders the real `Focus` screen (8.5.3, a
 * different task's file — see this task's own `centralWiringNeeded` report
 * for the one-line slot edit `Focus.tsx` still needs) or imports anything
 * from it. `Harness`/`EventsHarness` below mount `TransitionControls`
 * against a `useSession(id)` query the SAME way `Focus.tsx` will once
 * wired — subscribed to the identical `['sessions', id]` cache entry
 * `useTransition`'s mutation writes to — so the optimistic-freeze and
 * stale-conflict assertions below exercise the real cache-sharing
 * mechanism `Focus.tsx`'s own module doc describes, not a stand-in.
 *
 * The "reaches zero after 19 minutes of wall time" case never combines fake
 * timers with `userEvent`/`findBy*`'s own polling (this codebase's
 * established precedent — see `ClockGapPrompt.test.tsx`'s header comment,
 * citing `EventButtons.test.tsx`/`Recall.test.tsx`): the click-driven part
 * runs entirely under real timers, and the pure D5 math claim is checked
 * afterward, in total isolation, via a second `renderHook(useRemaining)`
 * tree under fake timers + a mocked `performance.now` — the exact pattern
 * `TimerDisplay.test.tsx`'s own `useRemaining` describe block already uses.
 */

afterEach(() => {
  cleanup()
})

const START_ISO = '2026-09-08T09:00:00.000Z'
const START_MS = Date.parse(START_ISO)

function makeSession(overrides: Partial<SessionResponseValue> = {}): SessionResponseValue {
  return buildSession({
    id: 'focus-session',
    kind: 'practice',
    lifecycle: 'running',
    targetSeconds: 900,
    startedAt: START_ISO,
    serverNow: START_ISO,
    pausedSeconds: 0,
    currentPauseStartedAt: null,
    version: 1,
    ...overrides,
  })
}

/**
 * A minimal in-memory "server" backing BOTH `sessions.get` and
 * `sessions.transition` consistently: `useTransition`'s own
 * `onSuccess` invalidates `['sessions', id]` (per this task's brief) in
 * addition to writing the fresh value directly, and with an active
 * `useSession` observer (`Harness`) that invalidation triggers a REAL
 * refetch — a `respond('sessions.get', ...)` call fixed to the ORIGINAL
 * session would let that refetch clobber the just-applied update with stale
 * data, which is a test-mock artifact only (the real server would already
 * reflect the change). Any test asserting on the DOM state reached after a
 * transition resolves needs this, not a static `respond()`.
 */
function mockSessionServer(initial: SessionResponseValue): {
  resolveNextTransitionWith(session: SessionResponseValue): void
} {
  let current = initial
  mockApi.sessions.get.mockImplementation(() => Promise.resolve(current))
  return {
    resolveNextTransitionWith(session: SessionResponseValue): void {
      mockApi.sessions.transition.mockImplementationOnce(() => {
        current = session
        return Promise.resolve(session)
      })
    },
  }
}

/** Mounts `TransitionControls` off the SAME `['sessions', id]` query
 * `Focus.tsx` will read once wired — never a prop this file fabricates by
 * hand — so cache writes from `useTransition`'s mutation flow back into
 * what this component renders exactly the way they will in the real app. */
function Harness({ sessionId }: { readonly sessionId: string }) {
  const { data: session } = useSession(sessionId)
  if (session === undefined) {
    return null
  }
  return <TransitionControls session={session} />
}

/** Same as `Harness`, plus `EventButtons` (8.5.1) alongside it — only the
 * "exactly one primary control" case needs both mounted together. */
function EventsHarness({ sessionId }: { readonly sessionId: string }) {
  const { data: session } = useSession(sessionId)
  if (session === undefined) {
    return null
  }
  return (
    <>
      <EventButtons sessionId={session.id} variant="practice" onRecord={() => {}} onUndo={() => {}} canUndo={false} />
      <TransitionControls session={session} />
    </>
  )
}

async function openFinishDialog(user: ReturnType<typeof renderWithProviders>['user']): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Finish early' }))
  await screen.findByRole('alertdialog')
}

async function confirmFinish(user: ReturnType<typeof renderWithProviders>['user']): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Finish now' }))
}

describe('TransitionControls', () => {
  it('pause posts transition pause with expectedVersion and freezes remaining with a Paused label', async () => {
    const session = makeSession({ version: 4 })
    const server = mockSessionServer(session)
    server.resolveNextTransitionWith({
      ...session,
      lifecycle: 'paused',
      version: 5,
      currentPauseStartedAt: session.serverNow,
    })

    const { user, queryClient } = renderWithProviders(<Harness sessionId={session.id} />)
    await user.click(await screen.findByRole('button', { name: 'Pause' }))

    await waitFor(() =>
      expect(mockApi.sessions.transition).toHaveBeenCalledWith(session.id, { expectedVersion: 4, type: 'pause' }),
    )
    await screen.findByText('Paused')
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()

    const cached = queryClient.getQueryData<SessionResponseValue>(['sessions', session.id])
    expect(cached?.lifecycle).toBe('paused')
    expect(cached?.currentPauseStartedAt).not.toBeNull()
  })

  it('resume posts resume and a 15-minute block with a 4-minute pause reaches zero after 19 minutes of wall time', async () => {
    const running = makeSession({ version: 1 })
    const server = mockSessionServer(running)

    const paused: SessionResponseValue = {
      ...running,
      lifecycle: 'paused',
      version: 2,
      currentPauseStartedAt: START_ISO,
      serverNow: START_ISO,
    }
    server.resolveNextTransitionWith(paused)

    const resumeInstantMs = START_MS + 240_000 // 4 minutes paused
    const resumed: SessionResponseValue = {
      ...running,
      lifecycle: 'running',
      version: 3,
      pausedSeconds: 240,
      currentPauseStartedAt: null,
      serverNow: new Date(resumeInstantMs).toISOString(),
    }
    server.resolveNextTransitionWith(resumed)

    const { user } = renderWithProviders(<Harness sessionId={running.id} />)

    await user.click(await screen.findByRole('button', { name: 'Pause' }))
    await waitFor(() =>
      expect(mockApi.sessions.transition).toHaveBeenCalledWith(running.id, { expectedVersion: 1, type: 'pause' }),
    )
    await screen.findByText('Paused')

    await user.click(await screen.findByRole('button', { name: 'Resume' }))
    await waitFor(() =>
      expect(mockApi.sessions.transition).toHaveBeenCalledWith(running.id, { expectedVersion: 2, type: 'resume' }),
    )
    await screen.findByRole('button', { name: 'Pause' })

    // Pure D5 derivation check, a fully separate render tree — never
    // combined with the userEvent-driven part above.
    let monoMs = resumeInstantMs - START_MS
    vi.useFakeTimers()
    vi.spyOn(performance, 'now').mockImplementation(() => monoMs)
    try {
      function toInput(session: SessionResponseValue): RemainingSessionInput {
        return {
          startedAt: session.startedAt,
          targetSeconds: session.targetSeconds,
          pausedSeconds: session.pausedSeconds,
          currentPauseStartedAt: session.currentPauseStartedAt,
          lifecycle: session.lifecycle,
          serverNow: session.serverNow,
        }
      }

      const { result, rerender } = renderHook((s: RemainingSessionInput) => useRemaining(s), {
        initialProps: toInput(resumed),
      })
      // Immediately after resume: no running time has elapsed yet, and the
      // 240 paused seconds are already excluded via `pausedSeconds`.
      expect(result.current).toBe(900)

      // 15 more minutes of monotonic time (900 s), matching the 900 s
      // target: 4 min paused + 15 min running = 19 min of total wall time.
      act(() => {
        monoMs = resumeInstantMs - START_MS + 900_000
      })
      rerender(toInput(resumed))
      expect(result.current).toBe(0)
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })

  it('finish early confirms, posts end and routes to /review/:id', async () => {
    const session = makeSession({ version: 5 })
    respond('sessions.get', session)
    respond('sessions.transition', { ...session, lifecycle: 'awaiting_review', version: 6 })

    const { user, router } = renderWithProviders(<Harness sessionId={session.id} />, {
      route: `/focus/${session.id}`,
      routes: [
        { path: '/focus/:sessionId', element: <Harness sessionId={session.id} /> },
        { path: '/review/:sessionId', element: <div>Review screen</div> },
      ],
    })

    await screen.findByRole('button', { name: 'Pause' })
    await openFinishDialog(user)
    expect(mockApi.sessions.transition).not.toHaveBeenCalled()

    await confirmFinish(user)

    await waitFor(() =>
      expect(mockApi.sessions.transition).toHaveBeenCalledWith(session.id, { expectedVersion: 5, type: 'end' }),
    )
    await waitFor(() => expect(router.state.location.pathname).toBe(`/review/${session.id}`))
    await screen.findByText('Review screen')
  })

  it('finish early while paused posts end and routes to review', async () => {
    const session = makeSession({ lifecycle: 'paused', version: 8, currentPauseStartedAt: START_ISO })
    respond('sessions.get', session)
    respond('sessions.transition', { ...session, lifecycle: 'awaiting_review', version: 9 })

    const { user, router } = renderWithProviders(<Harness sessionId={session.id} />, {
      route: `/focus/${session.id}`,
      routes: [
        { path: '/focus/:sessionId', element: <Harness sessionId={session.id} /> },
        { path: '/review/:sessionId', element: <div>Review screen</div> },
      ],
    })

    await screen.findByRole('button', { name: 'Resume' })
    await openFinishDialog(user)
    await confirmFinish(user)

    await waitFor(() =>
      expect(mockApi.sessions.transition).toHaveBeenCalledWith(session.id, { expectedVersion: 8, type: 'end' }),
    )
    await waitFor(() => expect(router.state.location.pathname).toBe(`/review/${session.id}`))
  })

  it('no control named abandon is rendered here', async () => {
    const session = makeSession()
    respond('sessions.get', session)

    renderWithProviders(<Harness sessionId={session.id} />)
    await screen.findByRole('button', { name: 'Pause' })

    expect(screen.queryByRole('button', { name: /abandon/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/abandon/i)).not.toBeInTheDocument()
  })

  it("stale end 409 refetches, renders ActiveSessionCard's updated-in-another-tab notice and sends no second transition", async () => {
    const session = makeSession({ version: 7 })
    respond('sessions.get', session)
    const current: SessionResponseValue = { ...session, lifecycle: 'finalized', version: 9 }
    reject('sessions.transition', { status: 409, code: 'stale_version', details: { current } })

    const { user } = renderWithProviders(<Harness sessionId={session.id} />)
    await screen.findByRole('button', { name: 'Pause' })
    await openFinishDialog(user)
    await confirmFinish(user)

    await screen.findByText('This session was updated in another tab')
    expect(screen.getByTestId('active-session-card')).toBeInTheDocument()
    expect(mockApi.sessions.transition).toHaveBeenCalledTimes(1)

    // No second transition even if something (e.g. a stray re-render) tried.
    expect(screen.queryByRole('button', { name: 'Finish early' })).not.toBeInTheDocument()
  })

  it('network error on pause rolls back the optimistic freeze', async () => {
    const session = makeSession({ version: 2 })
    respond('sessions.get', session)

    let rejectTransition!: (error: unknown) => void
    mockApi.sessions.transition.mockReturnValueOnce(
      new Promise<SessionResponseValue>((_resolve, rej) => {
        rejectTransition = rej
      }),
    )

    const { user, queryClient } = renderWithProviders(<Harness sessionId={session.id} />)
    await user.click(await screen.findByRole('button', { name: 'Pause' }))

    // The optimistic freeze lands synchronously in `onMutate`, before the
    // (still-pending) mutation promise ever settles — observable now,
    // deterministically, regardless of microtask timing.
    await screen.findByText('Paused')

    rejectTransition(
      Object.assign(new Error('Mock 500 server_error'), {
        status: 500,
        code: 'server_error',
        retryable: true,
        requestId: 'mock-request-id',
      }),
    )

    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument())
    expect(screen.queryByText('Paused')).not.toBeInTheDocument()
    expect(screen.getByText('Could not save. Retry.')).toBeInTheDocument()

    const cached = queryClient.getQueryData<SessionResponseValue>(['sessions', session.id])
    expect(cached?.lifecycle).toBe('running')
    expect(cached?.currentPauseStartedAt).toBeNull()
  })

  it('exactly one primary-styled control (Record off-task episode) and Pause, External interruption and Finish early are secondary', async () => {
    const session = makeSession()
    respond('sessions.get', session)

    const { container } = renderWithProviders(<EventsHarness sessionId={session.id} />)
    await screen.findByRole('button', { name: 'Pause' })

    const primaries = container.querySelectorAll('[data-variant="primary"]')
    expect(primaries).toHaveLength(1)
    expect(primaries[0]).toHaveTextContent('Record off-task episode')

    expect(screen.getByRole('button', { name: 'Pause' })).toHaveAttribute('data-variant', 'secondary')
    expect(screen.getByRole('button', { name: 'External interruption' })).toHaveAttribute('data-variant', 'secondary')
    expect(screen.getByRole('button', { name: 'Finish early' })).toHaveAttribute('data-variant', 'secondary')
  })

  it('422 renders the server message', async () => {
    const session = makeSession({ version: 3 })
    respond('sessions.get', session)
    reject('sessions.transition', {
      status: 422,
      code: 'invalid_transition',
      message: 'This session cannot be paused right now.',
    })

    const { user } = renderWithProviders(<Harness sessionId={session.id} />)
    await user.click(await screen.findByRole('button', { name: 'Pause' }))

    await screen.findByText('This session cannot be paused right now.')
    // The optimistic freeze rolled back for a 422 too (only success/stale keep it).
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
  })
})
