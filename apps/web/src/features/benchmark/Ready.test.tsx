import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import type { RouteObject } from 'react-router'
import type {
  CurrentProgramResponseValue,
  SessionResponseValue,
  SlotAttemptValue,
  SlotResponseValue,
  TodayResponseValue,
} from '@attention-lab/shared'

import { mockApi, reject, respond } from '../../test/mockClient.js'
import { expectNoIdentifiers } from '../../test/expectNoIdentifiers.js'
import { renderWithProviders } from '../../test/renderWithProviders.js'
import { Ready } from './Ready.js'

/**
 * task 8.3.1's verify list: the 13 named Ready cases. Fixture shapes and
 * `respond`/`reject` usage follow `Today.test.tsx` (8.2.1) and
 * `TodayActiveSession.test.tsx` (8.2.5) — the two sibling files this task's
 * own brief points at for convention.
 */

afterEach(() => {
  cleanup()
})

const SLOT_ID = 'slot-baseline-a'
const PROGRAM_ID = 'program-1'
const ON_DATE = '2026-09-08'

function makeSlot(overrides: Partial<SlotResponseValue> = {}): SlotResponseValue {
  return {
    id: SLOT_ID,
    phase: 'baseline',
    label: 'A',
    materialRef: 'Article: The Deep Work Habit',
    language: null,
    deviceFormat: null,
    materialLevel: null,
    plannedLocalTime: '09:00',
    assignedLocalDate: ON_DATE,
    frozenAt: null,
    attempts: [] as SlotAttemptValue[],
    ...overrides,
  }
}

function makeCurrent(slot: SlotResponseValue, overrides: Partial<CurrentProgramResponseValue> = {}): CurrentProgramResponseValue {
  return {
    program: {
      id: PROGRAM_ID,
      realm: 'demo',
      status: 'active',
      baselineDate: ON_DATE,
      timezone: 'America/Los_Angeles',
      leisureAllowanceMinutes: 20,
      feedEstimateMinutes: null,
      currentRevisionId: 'rev-1',
      version: 1,
    },
    revision: {
      id: 'rev-1',
      revision: 1,
      effectiveDay: 0,
      settings: { practiceTargetSeconds: 900, bandCeilings: [], leisureAllowanceMin: 20 },
      reason: 'initial plan',
      createdAt: '2026-09-01T00:00:00.000Z',
    },
    slots: [slot],
    day: 0,
    nextAction: { kind: 'benchmark', slotId: slot.id },
    ...overrides,
  }
}

function makeToday(overrides: Partial<TodayResponseValue> = {}): TodayResponseValue {
  return {
    day: 0,
    localDate: ON_DATE,
    blocks: [
      { index: 1, status: 'not_started', targetSeconds: 900, sessionId: null },
      { index: 2, status: 'not_started', targetSeconds: 900, sessionId: null },
    ],
    checkin: {
      status: 'not_reported',
      missing: ['sleep', 'feed'],
      values: { sleepMinutes: null, phoneFeedMinutes: null, desktopFeedMinutes: null },
    },
    nextAction: { kind: 'benchmark', slotId: SLOT_ID },
    ...overrides,
  }
}

function makeSession(overrides: Partial<SessionResponseValue> = {}): SessionResponseValue {
  return {
    id: 'session-active',
    programId: PROGRAM_ID,
    slotId: SLOT_ID,
    revisionId: 'rev-1',
    realm: 'demo',
    kind: 'benchmark',
    lifecycle: 'running',
    targetSeconds: 1200,
    startedAt: '2026-09-08T09:00:00.000Z',
    endedAt: null,
    pausedSeconds: 0,
    currentPauseStartedAt: null,
    localDate: ON_DATE,
    intendedOutput: null,
    timeSource: 'demo_clock',
    timerQuality: 'ok',
    clockGapSeconds: null,
    completeInterval: null,
    eligible: null,
    exclusionReasons: [],
    replacementReason: null,
    version: 1,
    serverNow: '2026-09-08T09:00:00.000Z',
    timing: { elapsedSeconds: 0, remainingSeconds: 1200, deadlineReached: false, isPaused: false },
    tallies: { offTask: 0, external: 0, agentChecks: 0 },
    eventCount: 0,
    events: [],
    review: {
      sessionId: 'session-active',
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
  return [{ path: '/benchmark/:slotId', element: <Ready /> }]
}

function renderReady(slot: SlotResponseValue, options: { today?: TodayResponseValue; active?: SessionResponseValue | null } = {}) {
  respond('programs.current', makeCurrent(slot))
  respond('programs.today', options.today ?? makeToday())
  respond('sessions.active', options.active ?? null)
  return renderWithProviders(<Ready />, { route: `/benchmark/${slot.id}`, routes: routes() })
}

describe('Ready', () => {
  it('slot on its date offers Start with no timing-deviation notice', async () => {
    renderReady(makeSlot({ assignedLocalDate: ON_DATE }))

    await screen.findByRole('button', { name: 'Start' })
    expect(screen.queryByText(/timing deviation/i)).not.toBeInTheDocument()
  })

  it('slot before its date hides Start and shows scheduled date and time', async () => {
    renderReady(makeSlot({ assignedLocalDate: '2026-09-15', plannedLocalTime: '10:30' }))

    expect(await screen.findByText('Scheduled for 2026-09-15 at 10:30')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument()
  })

  it('slot after its date offers Start with the timing-deviation notice', async () => {
    renderReady(makeSlot({ assignedLocalDate: '2026-09-01' }))

    await screen.findByRole('button', { name: 'Start' })
    expect(
      screen.getByText(
        'This slot was assigned to 2026-09-01. An attempt today will be labeled a timing deviation.',
      ),
    ).toBeInTheDocument()
  })

  it('body carries kind benchmark and slotId and no intendedOutput or targetSeconds', async () => {
    respond('sessions.create', makeSession())
    const { user } = renderReady(makeSlot())

    await user.click(await screen.findByRole('button', { name: 'Start' }))

    await waitFor(() => expect(mockApi.sessions.create).toHaveBeenCalled())
    const [body] = mockApi.sessions.create.mock.calls.at(-1) as [Record<string, unknown>, unknown]
    expect(body).toEqual({ programId: PROGRAM_ID, kind: 'benchmark', slotId: SLOT_ID })
    expect(body).not.toHaveProperty('intendedOutput')
    expect(body).not.toHaveProperty('targetSeconds')
  })

  it('prior ineligible attempt from slot.attempts requires a reason before Start enables and sends replacementReason', async () => {
    respond('sessions.create', makeSession())
    const attempts: SlotAttemptValue[] = [
      { sessionId: 'prior-1', lifecycle: 'finalized', eligible: false, excludedByAmendment: false },
    ]
    const { user } = renderReady(makeSlot({ attempts }))

    const startButton = await screen.findByRole('button', { name: 'Start' })
    expect(startButton).toBeDisabled()

    await user.type(screen.getByLabelText('Reason for replacement'), 'Fire alarm interrupted the attempt')
    expect(startButton).toBeEnabled()

    await user.click(startButton)

    await waitFor(() => expect(mockApi.sessions.create).toHaveBeenCalled())
    const [body] = mockApi.sessions.create.mock.calls.at(-1) as [Record<string, unknown>, unknown]
    expect(body.replacementReason).toBe('Fire alarm interrupted the attempt')
  })

  it('prior eligible attempt shows not-retaken and no Start', async () => {
    const attempts: SlotAttemptValue[] = [
      { sessionId: 'prior-1', lifecycle: 'finalized', eligible: true, excludedByAmendment: false },
    ]
    renderReady(makeSlot({ attempts }))

    expect(await screen.findByText('Eligible attempts are not retaken')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument()
  })

  it('two prior attempts -> no Start', async () => {
    const attempts: SlotAttemptValue[] = [
      { sessionId: 'prior-1', lifecycle: 'finalized', eligible: false, excludedByAmendment: false },
      { sessionId: 'prior-2', lifecycle: 'finalized', eligible: false, excludedByAmendment: false },
    ]
    renderReady(makeSlot({ attempts }))

    expect(await screen.findByText('This slot already has two attempts')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument()
  })

  it('server 422 message is rendered', async () => {
    reject('sessions.create', {
      status: 422,
      code: 'before_slot_date',
      message: 'This attempt cannot start before the assigned date.',
    })
    const { user } = renderReady(makeSlot())

    await user.click(await screen.findByRole('button', { name: 'Start' }))

    expect(await screen.findByText('This attempt cannot start before the assigned date.')).toBeInTheDocument()
  })

  it('network failure -> could not be started and no countdown rendered', async () => {
    reject('sessions.create', { status: 0, code: 'network_error', message: 'The request could not be completed.' })
    const { user } = renderReady(makeSlot())

    await user.click(await screen.findByRole('button', { name: 'Start' }))

    expect(await screen.findByText('The benchmark could not be started. Retry.')).toBeInTheDocument()
    expect(screen.queryByTestId('timer-digits')).not.toBeInTheDocument()
  })

  it('an existing active session renders ActiveSessionCard instead of every Start control', async () => {
    renderReady(makeSlot(), { active: makeSession() })

    await screen.findByTestId('active-session-card')
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument()
  })

  it('labels fixed 20-minute, carries the leaving note and data-mode benchmark', async () => {
    const { container } = renderReady(makeSlot())

    await screen.findByRole('button', { name: 'Start' })
    expect(screen.getByText(/Fixed 20-minute assessment/)).toBeInTheDocument()
    expect(screen.getByText('Leaving this page to read does not count as distraction.')).toBeInTheDocument()
    expect(container.querySelector('[data-mode="benchmark"]')).not.toBeNull()
  })

  it('final phase renders Final A', async () => {
    renderReady(makeSlot({ phase: 'final', label: 'A' }))

    expect(await screen.findByText(/Final A/)).toBeInTheDocument()
  })

  it('no navigation landmarks are rendered', async () => {
    renderReady(makeSlot())

    await screen.findByRole('button', { name: 'Start' })
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expectNoIdentifiers(document.body)
  })
})
