import { cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RouteObject } from 'react-router'
import type { MeResponseValue, SessionResponseValue } from '@attention-lab/shared'

// `respond`/`mockApi` (mockClient.js) imported BEFORE AppBootstrap/Recall
// deliberately (matches TimerDisplay.test.tsx/EventButtons.test.tsx): it is
// the module that calls `vi.mock('@/lib/api/client', ...)`, and ES module
// imports evaluate in declaration order.
import { mockApi, respond } from '../../test/mockClient.js'
import { expectNoIdentifiers } from '../../test/expectNoIdentifiers.js'
import { renderWithProviders } from '../../test/renderWithProviders.js'
import { AppBootstrap } from '../../app/AppBootstrap.js'
import { LiveRegion } from '../../ui/LiveRegion.js'
import { Recall } from './Recall.js'

/**
 * task 8.4.1's verify list: the 11 named Recall cases. Deliberately never
 * uses `vi.useFakeTimers()` (EventButtons.test.tsx's own precedent, for the
 * same reason: combining fake timers with `userEvent`/`findBy*`'s internal
 * polling is unreliable). `performance.now()` is stubbed directly with a
 * mutable counter (the `lib/clock/useSessionClock.test.tsx` pattern) — every
 * case that needs a controlled elapsed time just moves the counter, then
 * forces a re-render through an ordinary user interaction (a click or a
 * keystroke) rather than through a `setInterval` tick, so nothing here
 * depends on real wall-clock time passing.
 */

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const SESSION_ID = '11111111-1111-4111-8111-111111111111'
const SERVER_NOW_ISO = '2026-09-08T09:20:00.000Z'
const SERVER_NOW_MS = Date.parse(SERVER_NOW_ISO)

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
  return {
    id: SESSION_ID,
    programId: '22222222-2222-4222-8222-222222222222',
    slotId: '33333333-3333-4333-8333-333333333333',
    revisionId: '44444444-4444-4444-8444-444444444444',
    realm: 'demo',
    kind: 'benchmark',
    lifecycle: 'awaiting_review',
    targetSeconds: 1200,
    startedAt: '2026-09-08T09:00:00.000Z',
    endedAt: '2026-09-08T09:20:00.000Z',
    pausedSeconds: 0,
    currentPauseStartedAt: null,
    localDate: '2026-09-08',
    intendedOutput: null,
    timeSource: 'demo_clock',
    timerQuality: 'ok',
    clockGapSeconds: null,
    completeInterval: true,
    eligible: null,
    exclusionReasons: [],
    replacementReason: null,
    version: 1,
    serverNow: SERVER_NOW_ISO,
    timing: { elapsedSeconds: 1200, remainingSeconds: 0, deadlineReached: true, isPaused: false },
    tallies: { offTask: 0, external: 0, agentChecks: 0 },
    eventCount: 0,
    events: [],
    review: {
      sessionId: SESSION_ID,
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

function routes(): RouteObject[] {
  return [
    {
      path: '/benchmark/:sessionId/recall',
      element: (
        <LiveRegion>
          <AppBootstrap>
            <Recall />
          </AppBootstrap>
        </LiveRegion>
      ),
    },
    { path: '/benchmark/:sessionId/scoring', element: <div>Scoring screen</div> },
  ]
}

function renderRecall(sessionId: string = SESSION_ID) {
  respond('me.get', meFixture())
  return renderWithProviders(<Recall />, { route: `/benchmark/${sessionId}/recall`, routes: routes() })
}

async function waitForConfirmStep(): Promise<void> {
  await screen.findByText('Is your reading material closed?')
}

function lastRecallCall(): { body: Record<string, unknown>; idempotencyKey: string } {
  const call = mockApi.sessions.recall.mock.calls.at(-1) as [string, Record<string, unknown>, { idempotencyKey: string }]
  return { body: call[1], idempotencyKey: call[2].idempotencyKey }
}

/** A mutable `performance.now()` stub — moved manually, never by advancing any timer. */
function stubMonotonicClock(): { set: (ms: number) => void; advanceSeconds: (seconds: number) => void } {
  let monoMs = 0
  vi.spyOn(performance, 'now').mockImplementation(() => monoMs)
  return {
    set(ms: number) {
      monoMs = ms
    },
    advanceSeconds(seconds: number) {
      monoMs += seconds * 1000
    },
  }
}

describe('Recall', () => {
  it('countdown does not run before material-closed confirm', async () => {
    respond('sessions.get', makeSession())

    renderRecall()
    await waitForConfirmStep()

    expect(screen.queryByTestId('timer-digits')).not.toBeInTheDocument()
    expect(screen.queryByTestId('timer-hidden-text')).not.toBeInTheDocument()
  })

  it('startedAt equals serverNowMs at confirm and durationSeconds equals elapsed at save (190 s)', async () => {
    const clock = stubMonotonicClock()
    respond('sessions.get', makeSession())
    respond('sessions.recall', {})

    const { user } = renderRecall()
    await waitForConfirmStep()

    await user.click(screen.getByRole('button', { name: 'Start recall' }))
    await screen.findByTestId('timer-digits')

    clock.advanceSeconds(190)
    await user.click(screen.getByRole('button', { name: 'Save recall' }))

    await waitFor(() => expect(mockApi.sessions.recall).toHaveBeenCalled())
    const { body } = lastRecallCall()
    expect(body.startedAt).toBe(new Date(SERVER_NOW_MS).toISOString())
    expect(body.durationSeconds).toBe(190)
  })

  it('blank points sent as empty strings and the array has length 5', async () => {
    respond('sessions.get', makeSession())
    respond('sessions.recall', {})

    const { user } = renderRecall()
    await waitForConfirmStep()

    await user.click(screen.getByRole('button', { name: 'Start recall' }))
    await screen.findByTestId('timer-digits')
    await user.click(screen.getByRole('button', { name: 'Save recall' }))

    await waitFor(() => expect(mockApi.sessions.recall).toHaveBeenCalled())
    const { body } = lastRecallCall()
    expect(body.points).toEqual(['', '', '', '', ''])
    expect((body.points as unknown[]).length).toBe(5)
  })

  it('after 3:00 the form stays editable, Time is up is shown and Save still posts', async () => {
    const clock = stubMonotonicClock()
    respond('sessions.get', makeSession())
    respond('sessions.recall', {})

    const { user } = renderRecall()
    await waitForConfirmStep()

    await user.click(screen.getByRole('button', { name: 'Start recall' }))
    await screen.findByTestId('timer-digits')

    clock.advanceSeconds(181)
    const firstPoint = screen.getByLabelText('Point 1')
    // Typing forces the re-render that picks up the advanced monotonic clock
    // (this component never re-derives on a bare timer tick in this test —
    // no fake timers are running here, see the file header comment).
    await user.type(firstPoint, 'still typing after time is up')

    expect(await screen.findByText('Time is up — save when you are ready')).toBeInTheDocument()
    expect(firstPoint).not.toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Save recall' }))
    await waitFor(() => expect(mockApi.sessions.recall).toHaveBeenCalled())
  })

  it('locked review redirects to scoring', async () => {
    const base = makeSession()
    respond('sessions.get', makeSession({ review: { ...base.review, recallLockedAt: '2026-09-08T09:21:00.000Z' } }))

    const { router } = renderRecall()

    await waitFor(() => expect(router.state.location.pathname).toBe(`/benchmark/${SESSION_ID}/scoring`))
    await screen.findByText('Scoring screen')
  })

  it('409 shows notice and navigates to scoring', async () => {
    respond('sessions.get', makeSession())
    mockApi.sessions.recall.mockRejectedValue(
      Object.assign(new Error('Recall was already saved'), {
        status: 409,
        code: 'idempotency_mismatch',
        retryable: false,
        requestId: 'req-409',
      }),
    )

    const { user, router } = renderRecall()
    await waitForConfirmStep()

    await user.click(screen.getByRole('button', { name: 'Start recall' }))
    await screen.findByTestId('timer-digits')
    await user.click(screen.getByRole('button', { name: 'Save recall' }))

    await waitFor(() => expect(router.state.location.pathname).toBe(`/benchmark/${SESSION_ID}/scoring`))
    expect(router.state.location.state).toEqual({ notice: 'Recall was already saved' })
  })

  it('retry reuses the same Idempotency-Key', async () => {
    respond('sessions.get', makeSession())
    mockApi.sessions.recall.mockRejectedValueOnce(
      Object.assign(new Error('The request could not be completed.'), {
        status: 0,
        code: 'network_error',
        retryable: true,
        requestId: '',
      }),
    )
    mockApi.sessions.recall.mockResolvedValueOnce({})

    const { user } = renderRecall()
    await waitForConfirmStep()

    await user.click(screen.getByRole('button', { name: 'Start recall' }))
    await screen.findByTestId('timer-digits')
    await user.click(screen.getByRole('button', { name: 'Save recall' }))

    expect(await screen.findByText('The recall could not be saved. Retry.')).toBeInTheDocument()
    const firstCall = lastRecallCall()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(mockApi.sessions.recall).toHaveBeenCalledTimes(2))
    const secondCall = lastRecallCall()
    expect(secondCall.idempotencyKey).toBe(firstCall.idempotencyKey)
    expect(secondCall.body).toEqual(firstCall.body)
  })

  it('incomplete attempt renders Skip recall alongside Start recall and Skip navigates to scoring with no POST to /recall', async () => {
    respond('sessions.get', makeSession({ completeInterval: false }))

    const { user, router } = renderRecall()
    await waitForConfirmStep()

    expect(screen.getByText('Incomplete attempt')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start recall' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Skip recall' }))

    await waitFor(() => expect(router.state.location.pathname).toBe(`/benchmark/${SESSION_ID}/scoring`))
    expect(mockApi.sessions.recall).not.toHaveBeenCalled()
  })

  it('complete attempt renders only Start recall, no Skip recall control', async () => {
    respond('sessions.get', makeSession({ completeInterval: true }))

    renderRecall()
    await waitForConfirmStep()

    expect(screen.getByRole('button', { name: 'Start recall' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Skip recall' })).not.toBeInTheDocument()
    expect(screen.queryByText('Incomplete attempt')).not.toBeInTheDocument()
  })

  it('lifecycle running renders interval-not-confirmed with Retry and no Start recall', async () => {
    respond('sessions.get', makeSession({ lifecycle: 'running' }))

    renderRecall()

    expect(await screen.findByText('The interval has not been confirmed yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start recall' })).not.toBeInTheDocument()
  })

  it('no navigation landmarks are rendered', async () => {
    respond('sessions.get', makeSession())

    renderRecall()
    await waitForConfirmStep()

    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expectNoIdentifiers(document.body)
  })
})
