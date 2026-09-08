import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MeResponseValue, SessionResponseValue } from '@attention-lab/shared'

// `mockClient.js` MUST be imported before `AppBootstrap.js`/`Running.js`
// below — EventButtons.test.tsx's own comment explains why on this
// toolchain (importing the unmocked side of the graph first leaves
// `GET /me` hitting a real, failing `fetch` despite `respond('me.get', ...)`).
import { mockApi, reject, respond } from '../../test/mockClient.js'
import { AppBootstrap } from '../../app/AppBootstrap.js'
import { makeSession } from '../../lib/query/testSessionFixture.js'
import { enqueue } from '../../lib/outbox/store.js'
import { LiveRegion } from '../../ui/LiveRegion.js'
import { Running } from './Running.js'

/**
 * task 8.3.3's 11-case verify list. `lib/outbox/store.js` (7.3.1) is
 * swapped for 7.1.1's `fakeOutbox` harness (in-memory, no real IndexedDB in
 * jsdom) — `SyncStatus.test.tsx`'s own established pattern: an async
 * factory with a dynamic `import()` builds the one fake instance for this
 * file (`vi.mock`'s factory cannot close over a plain top-level import
 * binding). Every test uses its own unique session id so this one
 * module-scoped fake never leaks state between cases.
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

function meFixture(overrides: Partial<MeResponseValue['preferences']> = {}): MeResponseValue {
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
      ...overrides,
    },
    demoClockOffsetSeconds: 0,
  }
}

/** A running benchmark, 1200 s target, well before the deadline by default
 * (`startedAt === serverNow` so `elapsedSeconds` starts at 0). */
function benchmarkSession(overrides: Partial<SessionResponseValue> = {}): SessionResponseValue {
  return makeSession({
    id: 'session-1',
    kind: 'benchmark',
    slotId: 'slot-baseline-a',
    targetSeconds: 1200,
    lifecycle: 'running',
    startedAt: '2026-09-08T09:00:00.000Z',
    serverNow: '2026-09-08T09:00:00.000Z',
    timing: { elapsedSeconds: 0, remainingSeconds: 1200, deadlineReached: false, isPaused: false },
    review: { ...makeSession().review, sessionId: 'session-1' },
    ...overrides,
  })
}

interface MountOptions {
  session?: SessionResponseValue
  me?: MeResponseValue
  route?: string
}

function mount(options: MountOptions = {}) {
  const { session = benchmarkSession(), me = meFixture() } = options
  const route = options.route ?? `/benchmark/${session.slotId ?? session.id}`
  respond('me.get', me)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const router = createMemoryRouter(
    [
      {
        path: '/benchmark/:slotId',
        element: (
          <LiveRegion>
            <AppBootstrap>
              <Running session={session} />
            </AppBootstrap>
          </LiveRegion>
        ),
      },
      { path: '/benchmark/:sessionId/recall', element: <div data-testid="recall-route">Recall route</div> },
    ],
    { initialEntries: [route] },
  )
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { ...utils, router, session, queryClient }
}

/** Reads a `<Tallies>` label's own `<dd>` figure. */
function tallyText(label: string): string {
  const dt = screen.getByText(label)
  return dt.nextElementSibling?.textContent ?? ''
}

function neverResolvePostEvents(): void {
  mockApi.sessions.postEvents.mockImplementation(() => new Promise(() => {}))
}

beforeEach(() => {
  neverResolvePostEvents()
})

async function mountReady(options: MountOptions = {}) {
  const result = mount(options)
  await screen.findByText('Record off-task episode')
  return result
}

/** A running benchmark whose interval has already elapsed — 1260 s before
 * `serverNow`, past the 1200 s target, so `deadlineReached` is derived
 * `true` synchronously at mount with no fake timers needed. */
function deadlineSession(overrides: Partial<SessionResponseValue> = {}): SessionResponseValue {
  return benchmarkSession({
    id: 'session-deadline',
    startedAt: '2026-09-08T08:39:00.000Z',
    serverNow: '2026-09-08T09:00:00.000Z',
    timing: { elapsedSeconds: 1260, remainingSeconds: 0, deadlineReached: true, isPaused: false },
    ...overrides,
  })
}

async function mountAtDeadline(session: SessionResponseValue, options: Omit<MountOptions, 'session'> = {}) {
  const result = mount({ ...options, session })
  await screen.findByText('Close your reading material')
  return result
}

describe('Running', () => {
  it('no control named pause exists', async () => {
    await mountReady({ session: benchmarkSession({ id: 'session-no-pause' }) })
    expect(screen.queryByText(/pause/i)).not.toBeInTheDocument()
  })

  it('no control named abandon exists', async () => {
    await mountReady({ session: benchmarkSession({ id: 'session-no-abandon' }) })
    expect(screen.queryByText(/abandon/i)).not.toBeInTheDocument()
  })

  it('Record twice then Undo leaves one non-voided event and tally 1', async () => {
    await mountReady({ session: benchmarkSession({ id: 'session-undo' }) })

    fireEvent.click(screen.getByText('Record off-task episode'))
    fireEvent.click(screen.getByText('Record off-task episode'))
    await waitFor(() => expect(tallyText('Off-task')).toBe('2'))

    fireEvent.click(screen.getByText('Undo'))
    await waitFor(() => expect(tallyText('Off-task')).toBe('1'))
  })

  it('dispatching visibilitychange with hidden=true creates no event and remaining is still derived from server fields', async () => {
    await mountReady({ session: benchmarkSession({ id: 'session-visibility' }) })
    const before = screen.getByTestId('timer-digits').textContent

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    fireEvent(document, new Event('visibilitychange'))
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })

    expect(tallyText('Off-task')).toBe('0')
    expect(tallyText('External interruptions')).toBe('0')
    expect(screen.getByTestId('timer-digits').textContent).toBe(before)
  })

  it('recorded event carries elapsedMs from the clock (07:42 -> 462000)', async () => {
    let monoMs = 0
    vi.spyOn(performance, 'now').mockImplementation(() => monoMs)

    try {
      const session = benchmarkSession({ id: 'session-elapsed' })
      await mountReady({ session })

      monoMs = 7 * 60 * 1000 + 42 * 1000 // 07:42 of wall time since the anchor was captured at mount
      fireEvent.click(screen.getByText('Record off-task episode'))

      await waitFor(() => expect(vi.mocked(enqueue)).toHaveBeenCalledTimes(1))
      const call = vi.mocked(enqueue).mock.calls[0]
      expect(call?.[0]).toBe(session.id)
      expect(call?.[1].elapsedMs).toBe(462000)
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('deadline shows Close your reading material and I am ready for recall with no finalize call and no navigation before the click', async () => {
    const session = deadlineSession({ id: 'session-deadline-1' })
    const { router } = await mountAtDeadline(session)

    expect(screen.getByText("I'm ready for recall")).toBeInTheDocument()
    expect(screen.queryByText('Record off-task episode')).not.toBeInTheDocument()
    expect(mockApi.sessions.finalize).not.toHaveBeenCalled()
    expect(mockApi.sessions.transition).not.toHaveBeenCalled()
    expect(router.state.location.pathname).toBe(`/benchmark/${session.slotId}`)
  })

  it('I am ready for recall posts transitions end with expectedVersion then navigates to /benchmark/:sessionId/recall only after it resolves', async () => {
    const session = deadlineSession({ id: 'session-deadline-2', version: 5 })
    let resolveTransition: (value: SessionResponseValue) => void = () => {}
    mockApi.sessions.transition.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTransition = resolve
        }),
    )

    const { router } = await mountAtDeadline(session)

    fireEvent.click(screen.getByText("I'm ready for recall"))

    await waitFor(() =>
      expect(mockApi.sessions.transition).toHaveBeenCalledWith(session.id, { expectedVersion: 5, type: 'end' }),
    )
    expect(router.state.location.pathname).not.toBe(`/benchmark/${session.id}/recall`)

    resolveTransition({ ...session, lifecycle: 'awaiting_review', completeInterval: true })

    await waitFor(() => expect(router.state.location.pathname).toBe(`/benchmark/${session.id}/recall`))
    expect(mockApi.sessions.transition).toHaveBeenCalledTimes(1)
  })

  it('Stop early confirms, sends transition end and routes to recall with the incomplete label', async () => {
    const session = benchmarkSession({ id: 'session-stop-early', version: 2 })
    respond('sessions.transition', { ...session, lifecycle: 'awaiting_review', completeInterval: false })

    const { router } = await mountReady({ session })

    fireEvent.click(screen.getByText('Stop early'))
    await screen.findByText('This attempt will be recorded as incomplete.')
    expect(mockApi.sessions.transition).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Stop early'))

    await waitFor(() =>
      expect(mockApi.sessions.transition).toHaveBeenCalledWith(session.id, { expectedVersion: 2, type: 'end' }),
    )
    // Recall (8.4.1) itself renders the "Incomplete attempt" label from the
    // session's own `completeInterval: false` (D25) once it loads there —
    // this screen's own job is only to reach that route after the `end`
    // transition resolves.
    await waitFor(() => expect(router.state.location.pathname).toBe(`/benchmark/${session.id}/recall`))
  })

  it('409 stale on the end transition renders ActiveSessionCard notice and sends no second transition', async () => {
    const session = deadlineSession({ id: 'session-stale', version: 3 })
    const currentFromServer: SessionResponseValue = {
      ...session,
      lifecycle: 'awaiting_review',
      version: 4,
      review: { ...session.review, recallLockedAt: null },
    }
    reject('sessions.transition', { status: 409, code: 'stale_version', details: { current: currentFromServer } })
    respond('sessions.get', currentFromServer)

    await mountAtDeadline(session)

    fireEvent.click(screen.getByText("I'm ready for recall"))

    await screen.findByText('This session was updated in another tab')
    expect(screen.getByRole('link', { name: 'Continue to recall' })).toHaveAttribute(
      'href',
      `/benchmark/${session.id}/recall`,
    )
    expect(mockApi.sessions.transition).toHaveBeenCalledTimes(1)
  })

  it('tally updates before the network promise resolves (<100 ms)', async () => {
    let releasePostEvents: (value: { accepted: string[]; duplicates: string[] }) => void = () => {}
    mockApi.sessions.postEvents.mockImplementation(
      () =>
        new Promise((resolve) => {
          releasePostEvents = resolve
        }),
    )

    await mountReady({ session: benchmarkSession({ id: 'session-fast-tally' }) })
    fireEvent.click(screen.getByText('Record off-task episode'))

    await waitFor(() => expect(tallyText('Off-task')).toBe('1'), { timeout: 100 })

    releasePostEvents({ accepted: [], duplicates: [] })
  })

  it('no navigation landmarks are rendered and SyncStatus is present', async () => {
    respond('sessions.postEvents', { accepted: [], duplicates: [] })
    await mountReady({ session: benchmarkSession({ id: 'session-landmarks' }) })

    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    await screen.findByText(/Pending|Saved/)
  })
})
