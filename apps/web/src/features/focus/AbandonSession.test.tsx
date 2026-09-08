import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SessionResponseValue } from '@attention-lab/shared'

// Imported first (before anything that transitively reaches the real
// `lib/api/client.js`, e.g. `lib/query/hooks.js` and this file's own
// `AbandonSession.js`): `vi.mock('@/lib/api/client', ...)` inside this
// module only intercepts imports of that module requested AFTER it runs,
// mirroring RailLayout.test.tsx/hooks.test.tsx's own import ordering.
import { mockApi, reject, respond } from '../../test/mockClient.js'

import { enqueue, listUnsent } from '../../lib/outbox/store.js'
import { useActiveSession } from '../../lib/query/hooks.js'
import { renderWithProviders } from '../../test/renderWithProviders.js'
import { AbandonSession } from './AbandonSession.js'

/**
 * task 8.10.7's verify list, all 6 cases. Mirrors `PracticeReview.test.tsx`'s
 * choice of `fake-indexeddb` (not `src/test/fakeOutbox.ts`'s in-memory
 * stand-in) so 7.3.4's real `abandonWithPurge` — reached through this
 * file's own `useAbandonSession`, never mocked here — purges a real (fake)
 * IndexedDB while only `api.*` (`mockClient.ts`) is stubbed.
 */
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

// `test.globals: true` (vitest.config.ts) disables Testing Library's
// framework-detected auto-cleanup — every component test file here calls
// `cleanup()` itself (DemoBanner.test.tsx / router.test.tsx's pattern).
afterEach(() => {
  cleanup()
})

function makeSession(overrides: Partial<SessionResponseValue> = {}): SessionResponseValue {
  return {
    id: 'session-1',
    programId: 'program-1',
    slotId: null,
    revisionId: 'revision-1',
    realm: 'demo',
    kind: 'practice',
    lifecycle: 'running',
    targetSeconds: 900,
    startedAt: '2026-09-08T09:00:00.000Z',
    endedAt: null,
    pausedSeconds: 0,
    currentPauseStartedAt: null,
    localDate: '2026-09-08',
    intendedOutput: 'a draft outline',
    timeSource: 'demo_clock',
    timerQuality: 'ok',
    clockGapSeconds: null,
    completeInterval: null,
    eligible: null,
    exclusionReasons: [],
    replacementReason: null,
    version: 3,
    serverNow: '2026-09-08T09:05:00.000Z',
    timing: { elapsedSeconds: 300, remainingSeconds: 600, deadlineReached: false, isPaused: false },
    tallies: { offTask: 0, external: 0, agentChecks: 0 },
    eventCount: 0,
    events: [],
    review: {
      sessionId: 'session-1',
      episodeCount: null,
      countMethod: null,
      firstSwitch: null,
      firstSwitchMethod: null,
      externalCount: null,
      unplannedAgentChecks: null,
      mindWanderingCount: null,
      outputQuality: null,
      outputNote: null,
      reviewNote: null,
      materiallyDisrupted: null,
      disruptionNote: null,
      recallPoints: null,
      recallStartedAt: null,
      recallLockedAt: null,
      recallDelaySeconds: null,
      recallDurationSeconds: null,
      recallFlags: [],
      recallScores: null,
      recallScore: null,
      conditions: { deviceFormat: null, language: null, materialLevel: null, accommodations: [] },
      finalizedAt: null,
      version: 1,
    },
    agentPlan: null,
    amendments: [],
    ...overrides,
  }
}

/** Mounts alongside `AbandonSession` as an active observer of `['sessions','active']`, so a `409 stale_version` invalidation this file asserts on actually triggers a real refetch rather than only marking the cache stale with no observer to react. */
function ActiveSessionProbe() {
  useActiveSession()
  return null
}

async function openDialog(user: ReturnType<typeof renderWithProviders>['user']): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Abandon session' }))
  await screen.findByRole('alertdialog')
}

async function confirm(user: ReturnType<typeof renderWithProviders>['user']): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Abandon' }))
}

describe('AbandonSession', () => {
  it('renders for running, paused and awaiting_review sessions and not for finalized', async () => {
    const abandonable: SessionResponseValue['lifecycle'][] = ['running', 'paused', 'awaiting_review']
    for (const lifecycle of abandonable) {
      renderWithProviders(<AbandonSession session={makeSession({ lifecycle })} />)
      expect(screen.getByRole('button', { name: 'Abandon session' })).toBeInTheDocument()
      cleanup()
    }

    renderWithProviders(<AbandonSession session={makeSession({ lifecycle: 'finalized' })} />)
    expect(screen.queryByRole('button', { name: 'Abandon session' })).not.toBeInTheDocument()
  })

  it('nothing is posted without confirmation; confirm calls abandonWithPurge with type abandon and expectedVersion', async () => {
    const session = makeSession({ version: 4 })
    respond('sessions.transition', session)

    const { user } = renderWithProviders(<AbandonSession session={session} />)
    await openDialog(user)

    expect(mockApi.sessions.transition).not.toHaveBeenCalled()

    await confirm(user)

    await waitFor(() => expect(mockApi.sessions.transition).toHaveBeenCalledTimes(1))
    expect(mockApi.sessions.transition).toHaveBeenCalledWith(session.id, { expectedVersion: 4, type: 'abandon' })
  })

  it('success purges the outbox via abandonWithPurge and this component clears the finalize key, then navigates to /today with Session abandoned.', async () => {
    const session = makeSession({ id: 'focus-session', version: 3 })
    sessionStorage.setItem(`finalize:${session.id}`, 'pending-key')
    await enqueue(session.id, { type: 'off_task', elapsedMs: 1000, occurredAt: '2026-09-08T09:01:00.000Z' })
    respond('sessions.transition', session)

    const { user, router } = renderWithProviders(<AbandonSession session={session} />, {
      route: '/focus/focus-session',
      routes: [
        { path: '/focus/:sessionId', element: <AbandonSession session={session} /> },
        { path: '/today', element: <div>Today screen</div> },
      ],
    })
    await openDialog(user)
    await confirm(user)

    await waitFor(() => expect(router.state.location.pathname).toBe('/today'))
    expect(router.state.location.state).toEqual({ notice: 'Session abandoned.' })
    await screen.findByText('Today screen')

    expect(sessionStorage.getItem(`finalize:${session.id}`)).toBeNull()
    expect(await listUnsent(session.id)).toHaveLength(0)
  })

  it('no text matching /\\bcompleted\\b/i is rendered at any step', async () => {
    const session = makeSession({ version: 5 })
    const { user } = renderWithProviders(<AbandonSession session={session} />)

    expect(document.body.textContent).not.toMatch(/\bcompleted\b/i)

    await openDialog(user)
    expect(document.body.textContent).not.toMatch(/\bcompleted\b/i)

    reject('sessions.transition', { status: 500, code: 'server_error' })
    await confirm(user)
    await screen.findByText('Could not abandon. Retry.')
    expect(document.body.textContent).not.toMatch(/\bcompleted\b/i)

    respond('sessions.transition', session)
    await confirm(user)
    await waitFor(() => expect(mockApi.sessions.transition).toHaveBeenCalledTimes(2))
    expect(document.body.textContent).not.toMatch(/\bcompleted\b/i)
  })

  it('409 stale refetches, shows the updated-in-another-tab message and sends no second transition', async () => {
    const session = makeSession({ version: 6 })
    respond('sessions.active', null)
    reject('sessions.transition', { status: 409, code: 'stale_version', details: { current: session } })

    const { user } = renderWithProviders(
      <>
        <ActiveSessionProbe />
        <AbandonSession session={session} />
      </>,
    )

    await waitFor(() => expect(mockApi.sessions.active).toHaveBeenCalledTimes(1))

    await openDialog(user)
    await confirm(user)

    await screen.findByText('This session was updated in another tab')

    // The invalidated `['sessions','active']` query has an active observer
    // (ActiveSessionProbe), so invalidateQueries triggers a real refetch.
    await waitFor(() => expect(mockApi.sessions.active).toHaveBeenCalledTimes(2))
    expect(mockApi.sessions.transition).toHaveBeenCalledTimes(1)
  })

  it('after abandon, sessionStorage and the outbox hold nothing for the session id', async () => {
    const session = makeSession({ id: 'session-clean', version: 7 })
    const otherSessionId = 'session-other'
    sessionStorage.setItem(`finalize:${session.id}`, 'key-abc')
    sessionStorage.setItem(`finalize:${otherSessionId}`, 'key-untouched')
    await enqueue(session.id, { type: 'off_task', elapsedMs: 1000, occurredAt: '2026-09-08T09:01:00.000Z' })
    await enqueue(otherSessionId, { type: 'off_task', elapsedMs: 2000, occurredAt: '2026-09-08T09:02:00.000Z' })
    respond('sessions.transition', session)

    const { user } = renderWithProviders(<AbandonSession session={session} />)
    await openDialog(user)
    await confirm(user)

    await waitFor(async () => {
      expect(await listUnsent(session.id)).toHaveLength(0)
    })
    expect(sessionStorage.getItem(`finalize:${session.id}`)).toBeNull()

    // Another session's storage and outbox rows are left alone.
    expect(sessionStorage.getItem(`finalize:${otherSessionId}`)).toBe('key-untouched')
    expect(await listUnsent(otherSessionId)).toHaveLength(1)
  })
})
