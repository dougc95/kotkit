import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MeResponseValue, SessionResponseValue } from '@attention-lab/shared'

// `mockClient.js` (its `vi.mock('@/lib/api/client', ...)`) MUST be imported
// before `AppBootstrap.js`/`useSessionEvents.js` below: this file's whole
// graph imports `client.ts` through two different specifiers
// (`hooks.ts`'s `'../api/client.js'` and this hook's own
// `'../../lib/api/client.js'`), and on this toolchain importing the
// unmocked side of that graph first left `GET /me` hitting a real
// (failing) `fetch` despite `respond('me.get', ...)` — confirmed by
// swapping the two import lines with nothing else changed. DemoBanner.test.tsx
// already orders it this way for the same reason.
import { mockApi, respond } from '../../test/mockClient.js'
import { AppBootstrap } from '../../app/AppBootstrap.js'
import { makeSession } from '../../lib/query/testSessionFixture.js'
import { createFakeOutbox, type FakeOutbox } from '../../test/fakeOutbox.js'
import { EventButtons, type EventButtonsVariant } from './EventButtons.js'
import { Tallies } from './Tallies.js'
import { useSessionEvents } from './useSessionEvents.js'

/**
 * task 8.5.1's `EventButtons.test.tsx` half of the 11-case verify list (the
 * remaining case, D11's pure tally rules, lives in `tallies.test.ts`). Every
 * case here mounts a small harness wiring `useSessionEvents` straight into
 * `EventButtons`/`Tallies` — the same "hook + its own presentational
 * consumer, self-contained" shape as `TimerDisplay.test.tsx`'s
 * `useRemaining` cases, since Focus (8.5.3) and Benchmark Running (8.3.3),
 * the screens that will actually wire these together, do not exist yet.
 *
 * Deliberately uses `fireEvent`, never `userEvent`, and never
 * `vi.useFakeTimers()`: this hook runs no `setInterval`/heartbeat of its
 * own (see its module doc comment), so every case here works correctly
 * against real timers — avoiding the userEvent-vs-fake-timers interaction
 * `renderWithProviders`'s bundled `userEvent.setup()` does not configure
 * for. The one case that needs a controlled monotonic clock
 * (`performance.now`) stubs it directly, the same `vi.spyOn` pattern
 * `lib/clock/useSessionClock.test.tsx` already established.
 */

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

interface HarnessProps {
  readonly session: SessionResponseValue
  readonly variant: EventButtonsVariant
  readonly outbox: FakeOutbox
}

function Harness({ session, variant, outbox }: HarnessProps) {
  const { tallies, record, undo, canUndo } = useSessionEvents(session.id, session, outbox)
  return (
    <>
      <Tallies
        offTask={tallies.offTask}
        external={tallies.external}
        {...(variant === 'practice' ? { agentChecks: tallies.agentChecks } : {})}
      />
      <EventButtons
        sessionId={session.id}
        variant={variant}
        onRecord={(type, details) => {
          void record(type, details)
        }}
        onUndo={() => {
          void undo()
        }}
        canUndo={canUndo}
      />
    </>
  )
}

interface MountOptions {
  session?: SessionResponseValue
  variant?: EventButtonsVariant
  me?: MeResponseValue
}

function mount(options: MountOptions = {}) {
  const { session = makeSession(), variant = 'practice', me = meFixture() } = options
  respond('me.get', me)
  const outbox = createFakeOutbox()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <AppBootstrap>
        <Harness session={session} variant={variant} outbox={outbox} />
      </AppBootstrap>
    </QueryClientProvider>,
  )
  return { ...utils, outbox, session, queryClient }
}

/** Reads a `<Tallies>` label's own `<dd>` figure — never a summed value, since each label owns exactly one number. */
function tallyText(label: string): string {
  const dt = screen.getByText(label)
  return dt.nextElementSibling?.textContent ?? ''
}

function acceptAllPostEvents(): void {
  mockApi.sessions.postEvents.mockImplementation(
    async (_id: string, body: { events: Array<{ clientEventId: string }> }) => ({
      accepted: body.events.map((event) => event.clientEventId),
      duplicates: [],
    }),
  )
}

/** The default for every case below: nothing this hook posts is ever
 * acknowledged, so a recorded event stays "unsent" for the whole test
 * unless a case explicitly opts into `acceptAllPostEvents()`. */
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

describe('EventButtons + useSessionEvents', () => {
  it('agent check marked also off-task -> offTask 1, agentChecks 1, and no element with text 2', async () => {
    await mountReady()

    fireEvent.click(screen.getByText('Agent check'))
    fireEvent.click(screen.getByLabelText('This was also an off-task episode'))
    fireEvent.click(screen.getByText('Log agent check'))

    await waitFor(() => expect(tallyText('Off-task')).toBe('1'))
    expect(tallyText('Agent checks')).toBe('1')
    expect(screen.queryByText('2')).not.toBeInTheDocument()
  })

  it('agent check without the flag -> offTask 0, agentChecks 1', async () => {
    await mountReady()

    fireEvent.click(screen.getByText('Agent check'))
    fireEvent.click(screen.getByText('Log agent check'))

    await waitFor(() => expect(tallyText('Agent checks')).toBe('1'))
    expect(tallyText('Off-task')).toBe('0')
  })

  it('one Record after five simulated hidden/shown toggles -> exactly one event', async () => {
    const { outbox } = await mountReady()

    for (let i = 0; i < 5; i++) {
      fireEvent(document, new Event('visibilitychange'))
    }
    fireEvent.click(screen.getByText('Record off-task episode'))

    await waitFor(() => expect(tallyText('Off-task')).toBe('1'))
    expect(outbox.enqueue).toHaveBeenCalledTimes(1)
  })

  it('preferences.visibilityContext false: visibilitychange dispatch creates no event and no listener is attached', async () => {
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener')
    const { outbox } = await mountReady({ me: meFixture({ visibilityContext: false }) })

    const attachedVisibilityListener = addEventListenerSpy.mock.calls.some(([type]) => type === 'visibilitychange')
    expect(attachedVisibilityListener).toBe(false)

    fireEvent(document, new Event('visibilitychange'))
    expect(outbox.enqueue).not.toHaveBeenCalled()

    addEventListenerSpy.mockRestore()
  })

  it('preferences.visibilityContext true: visibilitychange dispatch records one visibility event excluded from every tally', async () => {
    const { outbox } = await mountReady({ me: meFixture({ visibilityContext: true }) })

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    fireEvent(document, new Event('visibilitychange'))

    await waitFor(() => expect(outbox.enqueue).toHaveBeenCalledTimes(1))
    const [, draft] = vi.mocked(outbox.enqueue).mock.calls[0] as [string, { type: string; details?: { hidden?: boolean } }]
    expect(draft.type).toBe('visibility')
    expect(draft.details).toEqual({ hidden: true })

    expect(tallyText('Off-task')).toBe('0')
    expect(tallyText('External interruptions')).toBe('0')
    expect(tallyText('Agent checks')).toBe('0')

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
  })

  it('Undo removes an unsent event from the outbox', async () => {
    const { outbox, session } = await mountReady()

    fireEvent.click(screen.getByText('Record off-task episode'))
    await waitFor(() => expect(tallyText('Off-task')).toBe('1'))

    const beforeUndo = await outbox.listUnsent(session.id)
    expect(beforeUndo).toHaveLength(1)
    const clientEventId = beforeUndo[0]?.clientEventId

    fireEvent.click(screen.getByText('Undo'))

    await waitFor(async () => {
      const rows = await outbox.listUnsent(session.id)
      expect(rows).toHaveLength(0)
    })
    expect(outbox.ack).toHaveBeenCalledWith([clientEventId])
    expect(mockApi.sessions.void).not.toHaveBeenCalled()
  })

  it('Undo of a sent event calls void with its clientEventId', async () => {
    acceptAllPostEvents()
    respond('sessions.void', {
      id: 'evt-1',
      clientEventId: 'placeholder',
      type: 'off_task',
      elapsedMs: 0,
      occurredAt: '2026-09-08T00:00:00.000Z',
      receivedAt: '2026-09-08T00:00:00.000Z',
      details: {},
      voidedAt: '2026-09-08T00:00:01.000Z',
    })
    const { outbox, session } = await mountReady()

    fireEvent.click(screen.getByText('Record off-task episode'))

    // Wait until the event is acked out of the local outbox (i.e. sent).
    await waitFor(async () => {
      const rows = await outbox.listUnsent(session.id)
      expect(rows).toHaveLength(0)
    })
    expect(outbox.ack).toHaveBeenCalled()
    const ackedIds = vi.mocked(outbox.ack).mock.calls[0]?.[0] as string[] | undefined
    const clientEventId = ackedIds?.[0]
    expect(clientEventId).toBeTruthy()

    fireEvent.click(screen.getByText('Undo'))

    await waitFor(() => expect(mockApi.sessions.void).toHaveBeenCalledWith(session.id, clientEventId))
  })

  it('benchmark variant renders no Agent check control', async () => {
    await mountReady({ variant: 'benchmark' })

    expect(screen.queryByText('Agent check')).not.toBeInTheDocument()
    expect(screen.queryByText('Agent checks')).not.toBeInTheDocument()
    expect(screen.getByText('Record off-task episode')).toBeInTheDocument()
    expect(screen.getByText('External interruption')).toBeInTheDocument()
    expect(screen.getByText('Undo')).toBeInTheDocument()
  })

  it('tally updates before the network promise resolves (<100 ms)', async () => {
    let releasePostEvents: (value: { accepted: string[]; duplicates: string[] }) => void = () => {}
    mockApi.sessions.postEvents.mockImplementation(
      () =>
        new Promise((resolve) => {
          releasePostEvents = resolve
        }),
    )

    await mountReady()
    fireEvent.click(screen.getByText('Record off-task episode'))

    await waitFor(() => expect(tallyText('Off-task')).toBe('1'), { timeout: 100 })

    releasePostEvents({ accepted: [], duplicates: [] })
  })

  it('recorded elapsedMs excludes paused time (60 s pause then record at 5 min wall -> 240000)', async () => {
    let monoMs = 0
    vi.spyOn(performance, 'now').mockImplementation(() => monoMs)
    acceptAllPostEvents()

    try {
      const startIso = '2026-09-08T10:00:00.000Z'
      const session = makeSession({
        startedAt: startIso,
        serverNow: startIso,
        pausedSeconds: 60,
        lifecycle: 'running',
        targetSeconds: 900,
      })
      const { outbox } = await mountReady({ session })

      monoMs = 5 * 60 * 1000 // 5 minutes of wall time have passed since the anchor was captured at mount
      fireEvent.click(screen.getByText('Record off-task episode'))

      await waitFor(() => expect(outbox.enqueue).toHaveBeenCalledTimes(1))
      const [, draft] = vi.mocked(outbox.enqueue).mock.calls[0] as [string, { elapsedMs: number }]
      expect(draft.elapsedMs).toBe(240000)
    } finally {
      vi.restoreAllMocks()
    }
  })
})
