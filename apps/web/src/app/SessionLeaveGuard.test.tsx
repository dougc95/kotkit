import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, Outlet, RouterProvider, useNavigate, type RouteObject } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SessionResponseValue } from '@attention-lab/shared'

import { mockApi, respond } from '../test/mockClient.js'
import { replayOnLoad } from '../lib/outbox/flush.js'
import { purgeOtherSessions } from '../lib/outbox/store.js'
import { createQueryClient } from '../lib/query/client.js'
import { queryKeys } from '../lib/query/keys.js'
import { createSessionModeRef, SessionModeProvider } from '../lib/query/sessionMode.js'
import { makeSession } from '../lib/query/testSessionFixture.js'
import { SessionLeaveGuard } from './SessionLeaveGuard.js'

/**
 * `SessionModeProvider` (mounted for every case below, exactly like
 * `useStartSession.test.tsx`'s own recipe) runs its own `GET /sessions/
 * active` query and D17 boot replay/purge on first resolution. Neither is
 * under test here, so both outbox calls are stubbed to no-ops rather than
 * touching (unavailable, in jsdom) IndexedDB.
 */
vi.mock('../lib/outbox/flush.js', () => ({ replayOnLoad: vi.fn() }))
vi.mock('../lib/outbox/store.js', () => ({ purgeOtherSessions: vi.fn() }))

beforeEach(() => {
  vi.mocked(replayOnLoad).mockResolvedValue({ outcome: 'synced', acceptedCount: 0, duplicateCount: 0 })
  vi.mocked(purgeOtherSessions).mockResolvedValue(undefined)
})

// This project does not run with `test.globals: true`, so Testing
// Library's framework-detected auto-cleanup never activates — see
// DemoBanner.test.tsx / router.test.tsx's identical manual `cleanup()`.
afterEach(() => {
  cleanup()
})

function FocusScreen() {
  const navigate = useNavigate()
  return (
    <div>
      <p>Focus screen</p>
      <button onClick={() => navigate('/progress')}>Go to progress</button>
      <button onClick={() => navigate('/review/s1')}>Go to review</button>
    </div>
  )
}

function ReviewScreen() {
  return <p>Review screen</p>
}

function ProgressScreen() {
  return <p>Progress screen</p>
}

/** Mirrors router.tsx's Root: `SessionLeaveGuard` mounted above the routed screens, inside `SessionModeProvider`. */
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
      { path: 'focus/:sessionId', element: <FocusScreen /> },
      { path: 'review/:sessionId', element: <ReviewScreen /> },
      { path: 'progress', element: <ProgressScreen /> },
    ],
  },
]

function renderTree(session: SessionResponseValue | null, initialPath = '/focus/s1') {
  respond('sessions.active', session)
  const modeRef = createSessionModeRef()
  const queryClient = createQueryClient(modeRef)
  queryClient.setQueryData(queryKeys.sessions.active, session)
  const router = createMemoryRouter(testRoutes, { initialEntries: [initialPath] })

  const utils = render(
    <QueryClientProvider client={queryClient}>
      <SessionModeProvider modeRef={modeRef}>
        <RouterProvider router={router} />
      </SessionModeProvider>
    </QueryClientProvider>,
  )

  return { ...utils, user: userEvent.setup(), queryClient, modeRef, router }
}

describe('SessionLeaveGuard', () => {
  it('at /focus/s1 with a running session in the cache, navigate(/progress) shows the dialog, location stays /focus/s1, and api.sessions.transition and api.sessions.postEvents were never called', async () => {
    const running = makeSession({ id: 's1', lifecycle: 'running' })
    const { user, router } = renderTree(running)

    await screen.findByText('Focus screen')
    await user.click(screen.getByRole('button', { name: 'Go to progress' }))

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText('A session is in progress')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/focus/s1')
    expect(mockApi.sessions.transition).not.toHaveBeenCalled()
    expect(mockApi.sessions.postEvents).not.toHaveBeenCalled()
  })

  it('Return to session closes the dialog and stays', async () => {
    const running = makeSession({ id: 's1', lifecycle: 'running' })
    const { user, router } = renderTree(running)

    await screen.findByText('Focus screen')
    await user.click(screen.getByRole('button', { name: 'Go to progress' }))
    await screen.findByRole('alertdialog')

    await user.click(screen.getByRole('button', { name: 'Return to session' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(router.state.location.pathname).toBe('/focus/s1')
    expect(screen.getByText('Focus screen')).toBeInTheDocument()
  })

  it('Leave anyway navigates to /progress and isActive() remains true', async () => {
    const running = makeSession({ id: 's1', lifecycle: 'running' })
    const { user, router, modeRef } = renderTree(running)

    await screen.findByText('Focus screen')
    await user.click(screen.getByRole('button', { name: 'Go to progress' }))
    await screen.findByRole('alertdialog')

    await user.click(screen.getByRole('button', { name: 'Leave anyway' }))

    await screen.findByText('Progress screen')
    expect(router.state.location.pathname).toBe('/progress')
    expect(modeRef.isActive()).toBe(true)
  })

  it('/focus/s1 -> /review/s1 is not blocked', async () => {
    const running = makeSession({ id: 's1', lifecycle: 'running' })
    const { user, router } = renderTree(running)

    await screen.findByText('Focus screen')
    await user.click(screen.getByRole('button', { name: 'Go to review' }))

    await screen.findByText('Review screen')
    expect(router.state.location.pathname).toBe('/review/s1')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('no active session -> no dialog on navigation', async () => {
    const { user, router } = renderTree(null)

    await screen.findByText('Focus screen')
    await user.click(screen.getByRole('button', { name: 'Go to progress' }))

    await screen.findByText('Progress screen')
    expect(router.state.location.pathname).toBe('/progress')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('Tab reaches both dialog buttons and Escape returns to the session', async () => {
    const running = makeSession({ id: 's1', lifecycle: 'running' })
    const { user, router } = renderTree(running)

    await screen.findByText('Focus screen')
    await user.click(screen.getByRole('button', { name: 'Go to progress' }))
    await screen.findByRole('alertdialog')

    const returnButton = screen.getByRole('button', { name: 'Return to session' })
    const leaveButton = screen.getByRole('button', { name: 'Leave anyway' })

    await waitFor(() => expect(returnButton).toHaveFocus())
    await user.tab()
    expect(leaveButton).toHaveFocus()

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(router.state.location.pathname).toBe('/focus/s1')
  })
})
