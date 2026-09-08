import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, Outlet, RouterProvider, useLocation, type RouteObject } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MeResponseValue, SessionResponseValue } from '@attention-lab/shared'

// `respond`/`mockApi` (mockClient.js) imported BEFORE AppBootstrap/Focus
// deliberately (matches Recall.test.tsx/TimerDisplay.test.tsx): mockClient.js
// is the module that calls `vi.mock('@/lib/api/client', ...)`, and ES module
// imports evaluate in declaration order.
import { mockApi, reject, respond } from '../../test/mockClient.js'
import { renderWithProviders } from '../../test/renderWithProviders.js'
import { AppBootstrap } from '../../app/AppBootstrap.js'
import { SessionLeaveGuard } from '../../app/SessionLeaveGuard.js'
import { createQueryClient } from '../../lib/query/client.js'
import { queryKeys } from '../../lib/query/keys.js'
import { createSessionModeRef, SessionModeProvider } from '../../lib/query/sessionMode.js'
import { makeSession as buildSession } from '../../lib/query/testSessionFixture.js'
import { LiveRegion } from '../../ui/LiveRegion.js'
import { Focus } from './Focus.js'

/**
 * task 8.5.3's verify list, all 10 named cases. `lib/outbox/store.js` (7.3.1)
 * is swapped for 7.1.1's `fakeOutbox` harness (in-memory, no real IndexedDB
 * in jsdom) — `SyncStatus.test.tsx`'s own precedent, shared by every case
 * here since Focus mounts both `useSessionEvents` (8.5.1, default outbox)
 * and `SyncStatus` (8.5.2), both of which import this module's real exports
 * directly rather than accepting an injected fake. One fake instance for the
 * whole file (module-scoped) — every case below uses its own unique
 * `sessionId` so it never leaks state between cases.
 */
vi.mock('../../lib/outbox/store.js', async () => {
  const { createFakeOutbox } = await import('../../test/fakeOutbox.js')
  const fake = createFakeOutbox()
  return {
    enqueue: fake.enqueue,
    listUnsent: fake.listUnsent,
    ack: fake.ack,
    purgeSession: fake.purgeSession,
    purgeOtherSessions: vi.fn().mockResolvedValue(undefined),
    openOutbox: vi.fn().mockResolvedValue(undefined),
  }
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function meFixture(): MeResponseValue {
  return {
    principalId: 'local-demo',
    identityMode: 'local-demo',
    realm: 'demo',
    timezone: 'America/Los_Angeles',
    preferences: {
      hideTimerDefault: false,
      endChime: false,
      visibilityContext: false,
      milestoneAnnouncements: false,
    },
    demoClockOffsetSeconds: 0,
  }
}

function makeSession(overrides: Partial<SessionResponseValue> = {}): SessionResponseValue {
  return buildSession({
    kind: 'practice',
    lifecycle: 'running',
    ...overrides,
  })
}

function TodayStub() {
  const location = useLocation() as { state?: { notice?: string } }
  return <p>{`Today${location.state?.notice ? `: ${location.state.notice}` : ''}`}</p>
}

function routes(): RouteObject[] {
  return [
    {
      path: '/focus/:sessionId',
      element: (
        <LiveRegion>
          <AppBootstrap>
            <Focus />
          </AppBootstrap>
        </LiveRegion>
      ),
    },
    { path: '/review/:sessionId', element: <div>Review screen</div> },
    { path: '/today', element: <TodayStub /> },
  ]
}

function renderFocus(sessionId: string) {
  respond('me.get', meFixture())
  return renderWithProviders(<Focus />, { route: `/focus/${sessionId}`, routes: routes() })
}

describe('Focus', () => {
  it('no navigation landmarks are rendered', async () => {
    const session = makeSession({ id: 'session-nav' })
    respond('sessions.get', session)

    const { container } = renderFocus(session.id)
    await screen.findByTestId('timer-digits')

    expect(container.querySelector('nav')).not.toBeInTheDocument()
    expect(screen.queryAllByRole('navigation')).toHaveLength(0)
  })

  it('header shows the intended output and no text matches /focused time|attention score/i', async () => {
    const session = makeSession({ id: 'session-header', intendedOutput: 'Draft the outline' })
    respond('sessions.get', session)

    renderFocus(session.id)
    await screen.findByText('Draft the outline')

    expect(document.body.textContent ?? '').not.toMatch(/focused time|attention score/i)
  })

  it('mounting with a session started 6 minutes ago shows about 09:00 remaining', async () => {
    const session = makeSession({
      id: 'session-remaining',
      targetSeconds: 900,
      startedAt: '2026-09-08T09:00:00.000Z',
      serverNow: '2026-09-08T09:06:00.000Z',
    })
    respond('sessions.get', session)

    renderFocus(session.id)

    const digits = await screen.findByTestId('timer-digits')
    expect(digits).toHaveTextContent('09:00')
  })

  it('mounting after the target passed shows Block time reached with the Review CTA and no completed wording', async () => {
    const session = makeSession({
      id: 'session-passed',
      targetSeconds: 900,
      startedAt: '2026-09-08T09:00:00.000Z',
      serverNow: '2026-09-08T09:25:00.000Z',
    })
    respond('sessions.get', session)

    renderFocus(session.id)

    await screen.findByText('Block time reached — save your review to record it')
    expect(screen.getByRole('button', { name: 'Review' })).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toMatch(/\bcompleted\b/i)
  })

  it('Review posts transitions end with expectedVersion and navigates to /review/:sessionId only after it resolves', async () => {
    const session = makeSession({
      id: 'session-review',
      version: 3,
      targetSeconds: 900,
      startedAt: '2026-09-08T09:00:00.000Z',
      serverNow: '2026-09-08T09:25:00.000Z',
    })
    respond('sessions.get', session)

    let resolveTransition: (value: SessionResponseValue) => void = () => {}
    mockApi.sessions.transition.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTransition = resolve
        }),
    )

    const { user, router } = renderFocus(session.id)
    await screen.findByText('Block time reached — save your review to record it')

    await user.click(screen.getByRole('button', { name: 'Review' }))

    expect(mockApi.sessions.transition).toHaveBeenCalledWith(session.id, { expectedVersion: 3, type: 'end' })
    expect(router.state.location.pathname).toBe(`/focus/${session.id}`)

    await act(async () => {
      resolveTransition({ ...session, lifecycle: 'awaiting_review' })
      await Promise.resolve()
    })

    await waitFor(() => expect(router.state.location.pathname).toBe(`/review/${session.id}`))
  })

  it('reaching zero via fake timers calls no finalize and does not navigate on its own', async () => {
    let monoMs = 0
    vi.useFakeTimers()
    vi.spyOn(performance, 'now').mockImplementation(() => monoMs)

    const session = makeSession({
      id: 'session-zero',
      targetSeconds: 10,
      startedAt: '2026-09-08T09:00:00.000Z',
      serverNow: '2026-09-08T09:00:00.000Z',
    })
    respond('sessions.get', session)

    const { router } = renderFocus(session.id)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(screen.getByTestId('timer-digits')).toHaveTextContent('00:10')

    await act(async () => {
      for (let i = 0; i < 12; i++) {
        monoMs += 1000
        await vi.advanceTimersByTimeAsync(1000)
      }
    })

    expect(mockApi.sessions.transition).not.toHaveBeenCalled()
    expect(mockApi.sessions.finalize).not.toHaveBeenCalled()
    expect(router.state.location.pathname).toBe(`/focus/${session.id}`)
  })

  it('404 routes to /today with a notice', async () => {
    reject('sessions.get', { status: 404, code: 'not_found', message: 'Not found' })

    const { router } = renderFocus('session-missing')

    await waitFor(() => expect(router.state.location.pathname).toBe('/today'))
    expect(router.state.location.state).toEqual({ notice: 'Session not found.' })
  })

  it('navigating to /progress while running renders the leave-guard prompt and sends no transition', async () => {
    respond('me.get', meFixture())
    const session = makeSession({ id: 'session-guard' })
    respond('sessions.get', session)
    respond('sessions.active', session)

    const modeRef = createSessionModeRef()
    const queryClient = createQueryClient(modeRef)
    queryClient.setQueryData(queryKeys.sessions.active, session)

    function TestRoot() {
      return (
        <>
          <SessionLeaveGuard />
          <Outlet />
        </>
      )
    }

    const testRoutes: RouteObject[] = [
      {
        path: '/',
        element: <TestRoot />,
        children: [
          {
            path: 'focus/:sessionId',
            element: (
              <LiveRegion>
                <AppBootstrap>
                  <Focus />
                </AppBootstrap>
              </LiveRegion>
            ),
          },
          { path: 'progress', element: <p>Progress screen</p> },
        ],
      },
    ]
    const router = createMemoryRouter(testRoutes, { initialEntries: [`/focus/${session.id}`] })

    render(
      <QueryClientProvider client={queryClient}>
        <SessionModeProvider modeRef={modeRef}>
          <RouterProvider router={router} />
        </SessionModeProvider>
      </QueryClientProvider>,
    )

    await screen.findByTestId('timer-digits')

    act(() => {
      void router.navigate('/progress')
    })

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/focus/${session.id}`)
    expect(mockApi.sessions.transition).not.toHaveBeenCalled()
  })

  it("409 stale on the end transition renders ActiveSessionCard's notice and sends no second transition", async () => {
    const session = makeSession({
      id: 'session-stale',
      version: 1,
      targetSeconds: 900,
      startedAt: '2026-09-08T09:00:00.000Z',
      serverNow: '2026-09-08T09:25:00.000Z',
    })
    respond('sessions.get', session)

    const updated = makeSession({ id: 'session-stale', lifecycle: 'awaiting_review', version: 2 })
    reject('sessions.transition', {
      status: 409,
      code: 'stale_version',
      message: 'Stale version.',
      details: { current: updated },
    })

    const { user } = renderFocus(session.id)
    await screen.findByText('Block time reached — save your review to record it')

    // The mount fetch already resolved with the pre-conflict `session` above;
    // re-stubbing now only affects the LATER refetch the 409 handler triggers
    // (`invalidateQueries`) — mirroring the real server, which would answer
    // that confirming GET with exactly the row it just returned as
    // `details.current`.
    mockApi.sessions.get.mockResolvedValue(updated)

    await user.click(screen.getByRole('button', { name: 'Review' }))

    await screen.findByText('This session was updated in another tab')
    await screen.findByText('Finish your pending review')
    expect(mockApi.sessions.transition).toHaveBeenCalledTimes(1)
  })

  it('sync status is rendered from the outbox state', async () => {
    const { enqueue } = await import('../../lib/outbox/store.js')
    const session = makeSession({ id: 'session-sync' })
    respond('sessions.get', session)
    await enqueue(session.id, { type: 'off_task', elapsedMs: 1000, occurredAt: '2026-09-08T09:00:01.000Z' })
    mockApi.sessions.postEvents.mockImplementation(() => new Promise(() => {}))

    renderFocus(session.id)

    await screen.findByText('Pending')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})
