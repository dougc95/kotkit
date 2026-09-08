import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RouteObject } from 'react-router'
import type { CreateSessionBodyValue, SessionResponseValue, TodayBlockValue } from '@attention-lab/shared'

import { ConflictError, NetworkError } from '../../lib/api/errors.js'
import { mockApi, respond } from '../../test/mockClient.js'
import { renderWithProviders } from '../../test/renderWithProviders.js'
import { BlockCard, type BlockCardProps } from './BlockCard.js'

/**
 * task 8.2.2's verify list, all 10 cases. `mockApi.sessions.create` is
 * stubbed directly with real `ConflictError`/`NetworkError` instances for
 * the two failure cases that need one — `useStartSession` (7.4.4) itself
 * branches on `instanceof NetworkError`/`instanceof ConflictError`
 * internally, so `mockClient.ts`'s `reject()` (a plain `Error` with assigned
 * fields, not a real subclass instance) would not exercise those branches —
 * the same choice `useStartSession.test.tsx` already makes. Every case that
 * needs an actual clock tick (the exhausted-`NetworkError` retry loop) uses
 * `fireEvent` + `vi.useFakeTimers()`, never `userEvent`, mirroring
 * `EventButtons.test.tsx`'s documented reason: `renderWithProviders`'s
 * bundled `userEvent.setup()` is not configured for fake timers.
 */

const RETRY_DELAY_MS = 1000 // mirrors useStartSession.ts's own (unexported) constant.

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function makeBlock(overrides: Partial<TodayBlockValue> = {}): TodayBlockValue {
  return { index: 1, status: 'not_started', targetSeconds: 900, sessionId: null, ...overrides }
}

function defaultProps(overrides: Partial<BlockCardProps> = {}): BlockCardProps {
  return { block: makeBlock(), target: 900, isNext: true, programId: 'program-1', ...overrides }
}

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
    intendedOutput: 'a draft',
    timeSource: 'demo_clock',
    timerQuality: 'ok',
    clockGapSeconds: null,
    completeInterval: null,
    eligible: null,
    exclusionReasons: [],
    replacementReason: null,
    version: 1,
    serverNow: '2026-09-08T09:00:00.000Z',
    timing: { elapsedSeconds: 0, remainingSeconds: 900, deadlineReached: false, isPaused: false },
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

function routes(props: BlockCardProps): RouteObject[] {
  return [
    { path: '/today', element: <BlockCard {...props} /> },
    { path: '/focus/:sessionId', element: <h1>Focus screen</h1> },
  ]
}

function mount(props: BlockCardProps) {
  return renderWithProviders(<></>, { route: '/today', routes: routes(props) })
}

function outputTextbox(): HTMLTextAreaElement {
  return screen.getByRole('textbox', { name: 'What will you produce?' }) as HTMLTextAreaElement
}

function startButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Start' })
}

/** `mockApi.sessions.create`'s N-th call's `{ idempotencyKey }` option argument. */
function idempotencyKeyOfCall(callIndex: number): string {
  const call = mockApi.sessions.create.mock.calls[callIndex] as unknown as [
    CreateSessionBodyValue,
    { idempotencyKey: string },
  ]
  return call[1].idempotencyKey
}

describe('BlockCard', () => {
  it('empty output marks the field required and sends nothing', () => {
    mount(defaultProps())

    fireEvent.click(startButton())

    expect(outputTextbox()).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Required')).toBeInTheDocument()
    expect(mockApi.sessions.create).not.toHaveBeenCalled()
  })

  it('201 characters is blocked', () => {
    mount(defaultProps())

    fireEvent.change(outputTextbox(), { target: { value: 'a'.repeat(201) } })

    expect(outputTextbox().value).toHaveLength(200)
    expect(screen.getByText('200/200')).toBeInTheDocument()
  })

  it('body has kind practice, targetSeconds from the revision and no slotId', async () => {
    const session = makeSession({ id: 'session-a' })
    respond('sessions.create', session)

    mount(defaultProps({ target: 900 }))
    fireEvent.change(outputTextbox(), { target: { value: 'a short draft' } })
    fireEvent.click(startButton())

    await waitFor(() => expect(mockApi.sessions.create).toHaveBeenCalledTimes(1))
    const [body, options] = mockApi.sessions.create.mock.calls[0] as [
      CreateSessionBodyValue,
      { idempotencyKey: string },
    ]
    expect(body).toEqual({
      programId: 'program-1',
      kind: 'practice',
      intendedOutput: 'a short draft',
      targetSeconds: 900,
    })
    expect(body).not.toHaveProperty('slotId')
    expect(typeof options.idempotencyKey).toBe('string')
    expect(options.idempotencyKey.length).toBeGreaterThan(0)
  })

  it('navigates only after the hook resolves and renders no timer before that', async () => {
    let resolveCreate!: (session: SessionResponseValue) => void
    mockApi.sessions.create.mockImplementationOnce(
      () =>
        new Promise<SessionResponseValue>((resolve) => {
          resolveCreate = resolve
        }),
    )

    const { router } = mount(defaultProps())
    fireEvent.change(outputTextbox(), { target: { value: 'a short draft' } })
    fireEvent.click(startButton())

    await waitFor(() => expect(mockApi.sessions.create).toHaveBeenCalledTimes(1))
    expect(router.state.location.pathname).toBe('/today')
    expect(screen.queryByText(/\d{1,2}:\d{2}/)).not.toBeInTheDocument()

    const session = makeSession({ id: 'session-99' })
    await act(async () => {
      resolveCreate(session)
      await Promise.resolve()
    })

    await waitFor(() => expect(router.state.location.pathname).toBe('/focus/session-99'))
  })

  it("active_session_exists leaves BlockCard rendering nothing further (Today's ActiveSessionCard, 8.2.5, takes over)", async () => {
    const conflict = new ConflictError(409, {
      code: 'active_session_exists',
      message: 'A session is already active.',
      details: { activeSessionId: 'existing-session' },
      retryable: false,
      requestId: 'req-1',
    })
    mockApi.sessions.create.mockRejectedValueOnce(conflict)

    mount(defaultProps())
    fireEvent.change(outputTextbox(), { target: { value: 'a short draft' } })
    fireEvent.click(startButton())

    await waitFor(() => expect(mockApi.sessions.create).toHaveBeenCalledTimes(1))

    expect(screen.queryByText('The session could not be started')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(outputTextbox().value).toBe('a short draft')
  })

  it('network failure shows could-not-start and keeps the typed output', async () => {
    vi.useFakeTimers()
    mockApi.sessions.create.mockRejectedValue(new NetworkError('offline'))

    mount(defaultProps())
    fireEvent.change(outputTextbox(), { target: { value: 'a short draft' } })

    await act(async () => {
      fireEvent.click(startButton())
      await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 2)
    })

    expect(mockApi.sessions.create).toHaveBeenCalledTimes(3)
    expect(screen.getByText('The session could not be started')).toBeInTheDocument()
    expect(outputTextbox().value).toBe('a short draft')
  })

  it("retry reuses the hook's own Idempotency-Key", async () => {
    vi.useFakeTimers()
    mockApi.sessions.create.mockRejectedValue(new NetworkError('offline'))

    mount(defaultProps())
    fireEvent.change(outputTextbox(), { target: { value: 'a short draft' } })

    await act(async () => {
      fireEvent.click(startButton())
      await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 2)
    })
    expect(screen.getByText('The session could not be started')).toBeInTheDocument()
    expect(mockApi.sessions.create).toHaveBeenCalledTimes(3)
    const firstKey = idempotencyKeyOfCall(0)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
      await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 2)
    })

    expect(mockApi.sessions.create).toHaveBeenCalledTimes(6)
    expect(idempotencyKeyOfCall(3)).toBe(firstKey)
  })

  it('renders all four status badges', () => {
    const cases: Array<{ status: TodayBlockValue['status']; label: string }> = [
      { status: 'not_started', label: 'Not started' },
      { status: 'in_progress', label: 'In progress' },
      { status: 'completed', label: 'Completed' },
      { status: 'partial', label: 'Partial' },
    ]

    for (const { status, label } of cases) {
      mount(defaultProps({ block: makeBlock({ status }), isNext: false }))
      expect(screen.getByText(label)).toBeInTheDocument()
      cleanup()
    }
  })

  it('Day 4 with block 1 completed: block 2 hosts the start form and shows 15 min from practiceTargetSeconds 900', () => {
    mount(defaultProps({ block: makeBlock({ index: 1, status: 'completed' }), isNext: false, target: 900 }))
    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'What will you produce?' })).not.toBeInTheDocument()
    cleanup()

    mount(defaultProps({ block: makeBlock({ index: 2, status: 'not_started' }), isNext: true, target: 900 }))
    expect(screen.getByText('15 min')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'What will you produce?' })).toBeInTheDocument()
  })

  it('Day 14 block start still posts kind practice with no slotId', async () => {
    const session = makeSession({ id: 'final-session' })
    respond('sessions.create', session)

    mount(defaultProps({ block: makeBlock({ index: 2, status: 'not_started' }), isNext: true, target: 900 }))
    fireEvent.change(outputTextbox(), { target: { value: 'final push' } })
    fireEvent.click(startButton())

    await waitFor(() => expect(mockApi.sessions.create).toHaveBeenCalledTimes(1))
    const [body] = mockApi.sessions.create.mock.calls[0] as [CreateSessionBodyValue, unknown]
    expect(body).toEqual({
      programId: 'program-1',
      kind: 'practice',
      intendedOutput: 'final push',
      targetSeconds: 900,
    })
    expect(body).not.toHaveProperty('slotId')
  })
})
