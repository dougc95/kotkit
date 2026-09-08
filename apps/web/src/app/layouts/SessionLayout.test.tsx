import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, Outlet, RouterProvider, type RouteObject } from 'react-router'
import type { MeResponseValue } from '@attention-lab/shared'

import { respond } from '../../test/mockClient.js'
import { replayOnLoad } from '../../lib/outbox/flush.js'
import { purgeOtherSessions } from '../../lib/outbox/store.js'
import { createQueryClient } from '../../lib/query/client.js'
import { createSessionModeRef, SessionModeProvider } from '../../lib/query/sessionMode.js'
import { AppBootstrap } from '../AppBootstrap.js'
import { ScreenPlaceholder } from '../ScreenPlaceholder.js'
import { SessionLayout } from './SessionLayout.js'

/**
 * task 7.1.4's verify list: the four SessionLayout cases. `AppBootstrap`
 * wraps the route tree (as it does in the real composition — Root.tsx's
 * header comment) because `DemoBanner`, mounted by `SessionLayout` itself,
 * reads `MeContext` and throws outside it. `SessionLayout` itself (Group 8's
 * 8.10.2/8.10.7 wiring) now calls `useSessionMode()` to conditionally mount
 * `ClockGapPrompt`/`AbandonSession`, so this file builds its own
 * `QueryClientProvider > SessionModeProvider > RouterProvider` stack
 * (mirroring `router.test.tsx`/`SessionLeaveGuard.test.tsx`) instead of the
 * shared `renderWithProviders` harness, which does not include
 * `SessionModeProvider`. `sessions.active` is stubbed to resolve `null`, so
 * `activeSession` stays `null` and neither ClockGapPrompt nor AbandonSession
 * ever mounts — this file is not testing either of them.
 *
 * The mount-time `replayOnLoad`/`purgeOtherSessions` calls
 * `SessionModeProvider`'s boot effect fires are mocked to no-ops (jsdom has
 * no real IndexedDB), matching `SessionLeaveGuard.test.tsx`'s own recipe.
 *
 * The five session paths and their placeholder names mirror router.tsx's
 * `sessionRoutes` table exactly (7.1.1's binding brief) — this test does not
 * import that table (router.tsx is centrally wired by 7.1.1 and not owned by
 * this task), so the shape is duplicated here rather than reused.
 */
vi.mock('../../lib/outbox/flush.js', () => ({ replayOnLoad: vi.fn() }))
vi.mock('../../lib/outbox/store.js', () => ({ purgeOtherSessions: vi.fn() }))
const ME_LOCAL_DEMO: MeResponseValue = {
  principalId: 'local-demo',
  identityMode: 'local-demo',
  realm: 'demo',
  timezone: 'America/Los_Angeles',
  preferences: {
    hideTimerDefault: false,
    endChime: true,
    visibilityContext: false,
    milestoneAnnouncements: false,
  },
  demoClockOffsetSeconds: 0,
}

const SESSION_PATH_TO_NAME: Array<[string, string]> = [
  ['/benchmark/s1', 'Benchmark Ready'],
  ['/benchmark/s1/recall', 'Benchmark Recall'],
  ['/benchmark/s1/scoring', 'Benchmark Scoring'],
  ['/focus/s1', 'Focus'],
  ['/review/s1', 'Practice Review'],
]

function AppBootstrapOutlet() {
  return (
    <AppBootstrap>
      <Outlet />
    </AppBootstrap>
  )
}

function sessionTestRoutes(): RouteObject[] {
  return [
    {
      path: '/',
      element: <AppBootstrapOutlet />,
      children: [
        {
          element: <SessionLayout />,
          children: [
            { path: 'benchmark/:slotId', element: <ScreenPlaceholder name="Benchmark Ready" /> },
            { path: 'benchmark/:sessionId/recall', element: <ScreenPlaceholder name="Benchmark Recall" /> },
            { path: 'benchmark/:sessionId/scoring', element: <ScreenPlaceholder name="Benchmark Scoring" /> },
            { path: 'focus/:sessionId', element: <ScreenPlaceholder name="Focus" /> },
            { path: 'review/:sessionId', element: <ScreenPlaceholder name="Practice Review" /> },
          ],
        },
      ],
    },
  ]
}

/** Renders the session route tree at `path`, with `/me` and `/sessions/active` stubbed and the outbox boot effect mocked. */
function renderSessionLayoutAt(path: string) {
  vi.mocked(replayOnLoad).mockResolvedValue({ outcome: 'synced', acceptedCount: 0, duplicateCount: 0 })
  vi.mocked(purgeOtherSessions).mockResolvedValue(undefined)
  respond('sessions.active', null)
  respond('me.get', ME_LOCAL_DEMO)

  const modeRef = createSessionModeRef()
  const queryClient = createQueryClient(modeRef)
  const router = createMemoryRouter(sessionTestRoutes(), { initialEntries: [path] })

  return render(
    <QueryClientProvider client={queryClient}>
      <SessionModeProvider modeRef={modeRef}>
        <RouterProvider router={router} />
      </SessionModeProvider>
    </QueryClientProvider>,
  )
}

// See DemoBanner.test.tsx's header comment: this harness does not run with
// `test.globals: true`, so Testing Library's auto-cleanup never activates
// and each test must clean up its own render(s).
afterEach(() => {
  cleanup()
})

describe('SessionLayout', () => {
  it('at /focus/s1 no navigation landmark is rendered', async () => {
    renderSessionLayoutAt('/focus/s1')

    await screen.findByRole('heading', { name: 'Focus' })
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('no link to /today, /progress, /research or /settings exists', async () => {
    const { container } = renderSessionLayoutAt('/focus/s1')

    await screen.findByRole('heading', { name: 'Focus' })
    for (const href of ['/today', '/progress', '/research', '/settings']) {
      expect(container.querySelector(`a[href="${href}"]`)).toBeNull()
    }
  })

  it('DemoBanner is visible at /focus/s1, /benchmark/s1/recall and /review/s1', async () => {
    for (const path of ['/focus/s1', '/benchmark/s1/recall', '/review/s1']) {
      renderSessionLayoutAt(path)

      const banner = await screen.findByLabelText('Demonstration data notice')
      expect(banner).toBeVisible()
      cleanup()
    }
  })

  it('all five session paths render inside SessionLayout', async () => {
    for (const [path, name] of SESSION_PATH_TO_NAME) {
      const { container } = renderSessionLayoutAt(path)

      const heading = await screen.findByRole('heading', { name })
      const main = container.querySelector('main#main')
      expect(main).not.toBeNull()
      expect(main).toContainElement(heading)
      expect(container.querySelector('[aria-label="Demonstration data notice"]')).not.toBeNull()
      cleanup()
    }
  })
})
