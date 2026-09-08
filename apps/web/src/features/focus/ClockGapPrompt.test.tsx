import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EventResponseValue, SessionResponseValue } from '@attention-lab/shared'

// Imported first (before anything that transitively reaches the real
// `lib/api/client.js`, e.g. `lib/query/hooks.js` and this file's own
// `ClockGapPrompt.js`/`useClockGap.js`): mirrors AbandonSession.test.tsx's
// own import ordering — `vi.mock('@/lib/api/client', ...)` inside this
// module only intercepts imports of that module requested AFTER it runs.
import { mockApi, respond } from '../../test/mockClient.js'

import { listUnsent } from '../../lib/outbox/store.js'
import { useSession } from '../../lib/query/hooks.js'
import { makeSession as buildSession } from '../../lib/query/testSessionFixture.js'
import { renderWithProviders } from '../../test/renderWithProviders.js'
import type { GapDetector, GapDetectorOptions, GapEvent } from '../../lib/clock/gapDetector.js'
import { ClockGapPrompt } from './ClockGapPrompt.js'

/**
 * task 8.10.2's verify list, all 8 named cases. Uses `fake-indexeddb`, not
 * `src/test/fakeOutbox.ts`'s in-memory stand-in (AbandonSession.test.tsx's
 * own precedent): `useClockGap` calls `lib/outbox/store.ts`'s real `enqueue`
 * directly (it needs a caller-supplied `clientEventId` it can later
 * overwrite, which neither `useOutbox` nor the fake outbox's simplified
 * two-arg `enqueue` support), so exercising the real (fake-IndexedDB) store
 * is what actually proves the "updates the event details.resolution" cases.
 *
 * A "fake detector" substitutes `createGapDetector` itself (a `createDetector`
 * prop `ClockGapPrompt`/`useClockGap` accept only for tests) rather than
 * driving the real heartbeat through `vi.useFakeTimers()`: this codebase's
 * own precedent (`EventButtons.test.tsx`, `Recall.test.tsx`) deliberately
 * avoids combining fake timers with `userEvent`/`findBy*`'s internal
 * polling, which is unreliable.
 */

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

afterEach(() => {
  cleanup()
})

function makeSession(overrides: Partial<SessionResponseValue> = {}): SessionResponseValue {
  return buildSession({ serverNow: '2026-09-08T09:00:00.000Z', ...overrides })
}

function clockGapEvent(overrides: Partial<EventResponseValue> = {}): EventResponseValue {
  return {
    id: 'evt-1',
    clientEventId: 'client-evt-1',
    type: 'clock_gap',
    elapsedMs: 60_000,
    occurredAt: '2026-09-08T09:01:00.000Z',
    receivedAt: '2026-09-08T09:01:01.000Z',
    details: { gapSeconds: 300 },
    voidedAt: null,
    ...overrides,
  }
}

/** Captures the `onGap` callback a `createDetector` call is given, letting a
 * test fire a gap directly instead of driving the real 5 s heartbeat. */
function makeFakeDetector() {
  let onGap: ((event: GapEvent) => void) | null = null
  const factory = (options: GapDetectorOptions): GapDetector => {
    onGap = options.onGap
    return { start: () => {}, stop: () => {}, rebase: () => {} }
  }
  return {
    factory,
    fire: (event: GapEvent): void => {
      onGap?.(event)
    },
  }
}

async function openAlertDialog(): Promise<HTMLElement> {
  return screen.findByRole('alertdialog')
}

describe('ClockGapPrompt', () => {
  it('drift of 61 s opens the prompt titled Did the interval continue uninterrupted? and enqueues a clock_gap event with no resolution; 59 s does nothing', async () => {
    const session = makeSession({ id: 'session-1' })
    const { factory, fire } = makeFakeDetector()
    renderWithProviders(<ClockGapPrompt session={session} createDetector={factory} />)

    act(() => fire({ gapSeconds: 59, detectedAtMs: Date.now() }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(await listUnsent(session.id)).toHaveLength(0)

    act(() => fire({ gapSeconds: 61, detectedAtMs: Date.now() }))
    const dialog = await openAlertDialog()
    expect(dialog).toHaveTextContent('Did the interval continue uninterrupted?')

    await waitFor(async () => {
      const rows = await listUnsent(session.id)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.type).toBe('clock_gap')
      expect(rows[0]?.details).toEqual({ gapSeconds: 61 })
    })
  })

  it('Yes posts resolution continued, updates the event details.resolution to continued and no uncertain chip appears', async () => {
    const session = makeSession({ id: 'session-2' })
    respond('sessions.clockGap', { ...session, timerQuality: 'ok' })
    const { factory, fire } = makeFakeDetector()
    const { user } = renderWithProviders(<ClockGapPrompt session={session} createDetector={factory} />)

    act(() => fire({ gapSeconds: 61, detectedAtMs: Date.now() }))
    await openAlertDialog()

    await user.click(screen.getByRole('button', { name: 'Yes, it continued' }))

    await waitFor(() =>
      expect(mockApi.sessions.clockGap).toHaveBeenCalledWith(session.id, { gapSeconds: 61, resolution: 'continued' }),
    )
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())

    await waitFor(async () => {
      const rows = await listUnsent(session.id)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.details).toEqual({ gapSeconds: 61, resolution: 'continued' })
    })

    expect(screen.queryByText('Timing uncertain')).not.toBeInTheDocument()
  })

  it('No and Not sure post uncertain and show Timing uncertain', async () => {
    for (const label of ['No', 'Not sure'] as const) {
      const session = makeSession({ id: `session-3-${label}` })
      respond('sessions.clockGap', { ...session, timerQuality: 'uncertain' })
      const { factory, fire } = makeFakeDetector()
      const { user } = renderWithProviders(<ClockGapPrompt session={session} createDetector={factory} />)

      act(() => fire({ gapSeconds: 90, detectedAtMs: Date.now() }))
      await openAlertDialog()

      await user.click(screen.getByRole('button', { name: label }))

      await waitFor(() =>
        expect(mockApi.sessions.clockGap).toHaveBeenCalledWith(session.id, { gapSeconds: 90, resolution: 'uncertain' }),
      )
      await screen.findByText('Timing uncertain')
      cleanup()
    }
  })

  it('Save as incomplete posts save_incomplete and navigates to the incomplete review where recall is skippable', async () => {
    const session = makeSession({ id: 'session-4', kind: 'benchmark' })
    respond('sessions.clockGap', {
      ...session,
      lifecycle: 'awaiting_review',
      completeInterval: false,
      timerQuality: 'uncertain',
    })
    const { factory, fire } = makeFakeDetector()
    const element = <ClockGapPrompt session={session} createDetector={factory} />
    const { user, router } = renderWithProviders(element, {
      route: '/start',
      routes: [
        { path: '/start', element },
        { path: '/benchmark/:sessionId/recall', element: <div>Recall route (recall may be skipped)</div> },
      ],
    })

    act(() => fire({ gapSeconds: 700, detectedAtMs: Date.now() }))
    await openAlertDialog()

    await user.click(screen.getByRole('button', { name: 'Save as incomplete' }))

    await waitFor(() =>
      expect(mockApi.sessions.clockGap).toHaveBeenCalledWith(session.id, {
        gapSeconds: 700,
        resolution: 'save_incomplete',
      }),
    )
    await waitFor(() => expect(router.state.location.pathname).toBe(`/benchmark/${session.id}/recall`))
    await screen.findByText('Recall route (recall may be skipped)')
  })

  it('after a resolution the clock store is re-seeded from the refetched server remaining', async () => {
    const session = makeSession({ id: 'session-5' })
    respond('sessions.get', session)
    const { factory, fire } = makeFakeDetector()

    function Probe() {
      const query = useSession(session.id)
      return <p data-testid="remaining">{query.data?.timing.remainingSeconds ?? 'loading'}</p>
    }

    const { user } = renderWithProviders(
      <>
        <Probe />
        <ClockGapPrompt session={session} createDetector={factory} />
      </>,
    )

    await waitFor(() => expect(screen.getByTestId('remaining')).toHaveTextContent('900'))

    // The GET a post-resolution invalidate refetches now returns a
    // different remaining time — proving any later render reflects the
    // refetched server value, not client arithmetic (D5).
    respond('sessions.get', { ...session, timing: { ...session.timing, remainingSeconds: 42 } })
    respond('sessions.clockGap', { ...session, timing: { ...session.timing, remainingSeconds: 700 } })

    act(() => fire({ gapSeconds: 200, detectedAtMs: Date.now() }))
    await openAlertDialog()
    await user.click(screen.getByRole('button', { name: 'Yes, it continued' }))

    await waitFor(() => expect(screen.getByTestId('remaining')).toHaveTextContent('42'))
  })

  it('remaining <= 0 after the gap renders awaiting review and never completed', async () => {
    const session = makeSession({ id: 'session-6' })
    respond('sessions.clockGap', {
      ...session,
      timing: { elapsedSeconds: 900, remainingSeconds: 0, deadlineReached: true, isPaused: false },
    })
    const { factory, fire } = makeFakeDetector()
    const { user } = renderWithProviders(<ClockGapPrompt session={session} createDetector={factory} />)

    expect(screen.queryByText('Awaiting review')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\bcompleted\b/i)

    act(() => fire({ gapSeconds: 900, detectedAtMs: Date.now() }))
    await openAlertDialog()
    expect(document.body.textContent).not.toMatch(/\bcompleted\b/i)

    await user.click(screen.getByRole('button', { name: 'Yes, it continued' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    await screen.findByText('Awaiting review')
    expect(document.body.textContent).not.toMatch(/\bcompleted\b/i)
  })

  it('Escape and outside click do not close the dialog', async () => {
    const session = makeSession({ id: 'session-7' })
    const { factory, fire } = makeFakeDetector()
    const { user } = renderWithProviders(<ClockGapPrompt session={session} createDetector={factory} />)

    act(() => fire({ gapSeconds: 90, detectedAtMs: Date.now() }))
    await openAlertDialog()

    await user.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()

    // Radix locks `pointer-events` on the rest of the document while an
    // AlertDialog is open, so "outside click" targets the overlay — the
    // element real "outside" pointer interactions land on — rather than
    // `document.body`, which `userEvent` would refuse to click at all.
    await user.click(screen.getByTestId('clock-gap-overlay'))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()

    expect(mockApi.sessions.clockGap).not.toHaveBeenCalled()
  })

  it('reload with a clock_gap event whose details carry no resolution re-opens the prompt; a resolved event does not', async () => {
    const unresolvedSession = makeSession({
      id: 'session-8a',
      events: [clockGapEvent({ details: { gapSeconds: 300 } })],
    })
    renderWithProviders(<ClockGapPrompt session={unresolvedSession} />)
    const dialog = await openAlertDialog()
    expect(dialog).toHaveTextContent('Did the interval continue uninterrupted?')
    cleanup()

    const resolvedSession = makeSession({
      id: 'session-8b',
      events: [clockGapEvent({ id: 'evt-2', clientEventId: 'client-evt-2', details: { gapSeconds: 300, resolution: 'continued' } })],
    })
    renderWithProviders(<ClockGapPrompt session={resolvedSession} />)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})
