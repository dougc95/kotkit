import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, matchRoutes, RouterProvider } from 'react-router'
import type { MeResponseValue } from '@attention-lab/shared'

import { respond } from '../test/mockClient.js'
import { flush, replayOnLoad, sendDirect } from '../lib/outbox/flush.js'
import { ack, enqueue, listUnsent, purgeOtherSessions } from '../lib/outbox/store.js'
import { createQueryClient } from '../lib/query/client.js'
import { createSessionModeRef, SessionModeProvider } from '../lib/query/sessionMode.js'
import { routes } from './router.js'

/**
 * `routes` mounts the real `Root`, which (7.4.2/7.4.3) now gates on
 * `AppBootstrap` (`GET /me`) and mounts `SessionLeaveGuard` inside
 * `SessionModeProvider` (`GET /sessions/active`). Every case here needs the
 * same provider stack `providers.tsx` builds — mirroring
 * `SessionLeaveGuard.test.tsx`'s `renderTree` — instead of a bare
 * `RouterProvider`, plus both endpoints stubbed via mockClient. The outbox
 * module is mocked in full (not just `purgeOtherSessions`/`replayOnLoad`):
 * Group 8's real screens (Benchmark Running via `BenchmarkRoute`, Focus)
 * import `enqueue`/`listUnsent`/`ack`/`OutboxWriteError` from
 * `lib/outbox/store.js` at MODULE scope (`useSessionEvents.ts`'s top-level
 * `defaultOutbox` object), so a partial mock throws "no X export" the
 * moment `router.tsx`'s static import graph loads those modules — even
 * though this file never actually mounts the Running/Focus branch (jsdom
 * has no real IndexedDB either way, so every export here is a no-op stub).
 */
// Every export below is re-armed with a resolved value inside `renderRoutes`
// on each call (see its own comment) — the factory only needs to declare
// the shape here.
vi.mock('../lib/outbox/flush.js', () => ({
  replayOnLoad: vi.fn(),
  flush: vi.fn(),
  sendDirect: vi.fn(),
}))
vi.mock('../lib/outbox/store.js', () => ({
  purgeOtherSessions: vi.fn(),
  enqueue: vi.fn(),
  listUnsent: vi.fn(),
  ack: vi.fn(),
  OutboxWriteError: class OutboxWriteError extends Error {},
}))

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

afterEach(() => {
  cleanup()
})

function renderRoutes(path: string) {
  // Re-armed on every call: setup.ts's global `afterEach(() => vi.resetAllMocks())`
  // wipes these back to bare `vi.fn()` (resolving `undefined`, not a Promise)
  // between separate `it()` blocks, and several Group 8 screens (e.g.
  // PracticeReview) call `.catch()`/`.then()` on the result unconditionally.
  vi.mocked(replayOnLoad).mockResolvedValue({ outcome: 'synced', acceptedCount: 0, duplicateCount: 0 })
  vi.mocked(flush).mockResolvedValue({ outcome: 'synced', acceptedCount: 0, duplicateCount: 0 })
  vi.mocked(sendDirect).mockResolvedValue({ clientEventId: 'test-client-event-id' })
  vi.mocked(purgeOtherSessions).mockResolvedValue(undefined)
  vi.mocked(enqueue).mockResolvedValue({ clientEventId: 'test-client-event-id' })
  vi.mocked(listUnsent).mockResolvedValue([])
  vi.mocked(ack).mockResolvedValue(undefined)
  respond('me.get', ME_LOCAL_DEMO)
  respond('sessions.active', null)

  const modeRef = createSessionModeRef()
  const queryClient = createQueryClient(modeRef)
  const router = createMemoryRouter(routes, { initialEntries: [path] })

  render(
    <QueryClientProvider client={queryClient}>
      <SessionModeProvider modeRef={modeRef}>
        <RouterProvider router={router} />
      </SessionModeProvider>
    </QueryClientProvider>,
  )

  return router
}

/**
 * design.md's route map. Since Group 8 replaced every `ScreenPlaceholder`
 * with its real screen, this file no longer asserts a fixed placeholder
 * heading per path (each real screen has its own dedicated, thoroughly
 * mocked component test — PlanForm.test.tsx, Today.test.tsx, etc. — that
 * already covers its actual rendered content). This file's job is narrower:
 * prove the routing table wires the RIGHT component to each path without
 * the app crashing into the root `errorElement` boundary. Every screen's
 * own data queries beyond `me.get`/`sessions.active` are left unstubbed
 * here, so each one settles into its own error/retry state (query data
 * `undefined` -> TanStack Query v5's own thrown error, caught internally
 * by each screen) rather than a route-level throw — this is itself part of
 * what's under test: no route's screen may let a query error escape past
 * its own boundary into `RouteError`.
 */
const ROUTE_PATHS: readonly string[] = [
  '/today',
  '/setup',
  '/setup/readiness',
  '/checkin/2026-09-08',
  '/progress',
  '/research',
  '/settings',
  '/benchmark/slot-a',
  '/benchmark/session-1/recall',
  '/benchmark/session-1/scoring',
  '/focus/session-1',
  '/review/session-1',
]

describe('router', () => {
  it('every design.md route path mounts its real screen with no root error boundary', async () => {
    for (const path of ROUTE_PATHS) {
      renderRoutes(path)
      // `<main id="main">` is rendered unconditionally by both RailLayout
      // and SessionLayout once AppBootstrap's `GET /me` resolves — finding
      // it confirms the layout settled past boot, whatever the inner
      // screen's own query state is.
      await screen.findByRole('main')
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
      cleanup()
    }
  })

  it('/ redirects to /today', async () => {
    const router = renderRoutes('/')
    await screen.findByRole('main')
    expect(router.state.location.pathname).toBe('/today')
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
  })

  it('session paths match route id session and rail paths match route id rail', () => {
    const sessionMatches = matchRoutes(routes, '/focus/session-1')
    expect(sessionMatches?.some((match) => match.route.id === 'session')).toBe(true)
    expect(sessionMatches?.some((match) => match.route.id === 'rail')).toBe(false)

    const railMatches = matchRoutes(routes, '/today')
    expect(railMatches?.some((match) => match.route.id === 'rail')).toBe(true)
    expect(railMatches?.some((match) => match.route.id === 'session')).toBe(false)
  })

  it('an unknown path renders NotFound under route id rail with a link to /today', async () => {
    const matches = matchRoutes(routes, '/does-not-exist')
    expect(matches?.some((match) => match.route.id === 'rail')).toBe(true)

    renderRoutes('/does-not-exist')
    expect(await screen.findByText('This page is not available')).toBeInTheDocument()
    // Scoped to the exact accessible name: now that RailLayout wraps NotFound
    // (7.1.4's central wiring), its own nav also renders a "Today" link, so a
    // loose /today/i regex matches both.
    expect(screen.getByRole('link', { name: 'Go to Today' })).toHaveAttribute('href', '/today')
  })
})
