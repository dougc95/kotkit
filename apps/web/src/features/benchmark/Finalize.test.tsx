import { cleanup, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RouteObject } from 'react-router'
import type {
  FinalizeResponseValue,
  ReviewResponseValue,
  SessionResponseValue,
} from '@attention-lab/shared'

import { mockApi, respond } from '../../test/mockClient.js'
import { renderWithProviders } from '../../test/renderWithProviders.js'
import { BLANK_COUNT_FIELDS_VALUE } from './CountFields.js'
import { FinalizeSection, type FinalizeSectionProps } from './Finalize.js'
import type { FinalizeSessionStatus } from '../../lib/outbox/useFinalizeSession.js'

/**
 * task 8.4.5's own verify list, mounting `FinalizeSection` (this task's
 * container) with `useFinalizeSession` (7.3.5) fully mocked — per the task
 * brief: "Test ... (mocked useFinalizeSession from 7.3.5)". This keeps the
 * suite self-contained (no real outbox/IndexedDB, unlike `PracticeReview.
 * test.tsx`'s heavier fake-indexeddb harness) and in full control of every
 * `status`/`result` this hook can report.
 *
 * One named case from the task brief — "server fieldErrors.materiallyDisrupted
 * rendered beside the radio" — is replaced below with an equivalent, actually
 * achievable case. `useFinalizeSession`'s real `runChain` (verified against
 * its own source and `useFinalizeSession.test.tsx`) swallows every
 * non-mismatch rejection into a bare `status: 'error'` with NO error object
 * retained anywhere the hook exposes — there is no `fieldErrors` for this
 * component to read, from a hook this file may only ever call through (file
 * ownership forbids editing `apps/web/src/lib/**`). `PracticeReview.tsx`
 * (8.6.2), the only other screen built on this same hook, documented the
 * identical limitation and took the identical fallback: one generic message
 * for every failure. This suite proves that fallback instead; see this
 * task's own report for the follow-up this implies for `useFinalizeSession`.
 */
const { mockUseFinalizeSession } = vi.hoisted(() => ({ mockUseFinalizeSession: vi.fn() }))
vi.mock('../../lib/outbox/useFinalizeSession.js', () => ({ useFinalizeSession: mockUseFinalizeSession }))

afterEach(() => {
  cleanup()
})

const SESSION_ID = '11111111-1111-4111-8111-111111111111'

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
    serverNow: '2026-09-08T09:23:30.000Z',
    timing: { elapsedSeconds: 1200, remainingSeconds: 0, deadlineReached: true, isPaused: false },
    tallies: { offTask: 0, external: 0, agentChecks: 0 },
    eventCount: 0,
    events: [],
    review: makeReview(),
    agentPlan: null,
    amendments: [],
    ...overrides,
  }
}

function makeReview(overrides: Partial<ReviewResponseValue> = {}): ReviewResponseValue {
  return {
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
    recallLockedAt: '2026-09-08T09:22:00.000Z',
    recallDelaySeconds: 0,
    recallDurationSeconds: 30,
    recallFlags: [],
    recallScores: null,
    recallScore: null,
    conditions: { deviceFormat: null, language: null, materialLevel: null, accommodations: [] },
    finalizedAt: null,
    version: 1,
    ...overrides,
  }
}

function makeFinalizeResult(overrides: Partial<FinalizeResponseValue> = {}): FinalizeResponseValue {
  return {
    session: makeSession(),
    review: makeReview(),
    eligible: true,
    exclusionReasons: [],
    ...overrides,
  }
}

interface HookOverrides {
  finalize?: ReturnType<typeof vi.fn>
  retry?: ReturnType<typeof vi.fn>
  status?: FinalizeSessionStatus
  mismatchAttempts?: number
  result?: FinalizeResponseValue | null
}

function mockHook(overrides: HookOverrides = {}) {
  const finalize = overrides.finalize ?? vi.fn().mockResolvedValue(undefined)
  const retry = overrides.retry ?? vi.fn().mockResolvedValue(undefined)
  mockUseFinalizeSession.mockReturnValue({
    finalize,
    abandon: vi.fn(),
    status: overrides.status ?? 'idle',
    mismatch: null,
    mismatchAttempts: overrides.mismatchAttempts ?? 0,
    retry,
    result: overrides.result ?? null,
  })
  return { finalize, retry }
}

const READY_PROPS = {
  session: makeSession(),
  countFieldsValue: BLANK_COUNT_FIELDS_VALUE,
  recallScores: undefined,
  scoringComplete: true,
  materiallyDisrupted: 'no' as const,
  disruptionNote: '',
  conditions: { deviceFormat: null, language: null, materialLevel: null, accommodations: [] },
  conditionsConfirmed: true,
}

function renderSection(propsOverrides: Partial<FinalizeSectionProps> = {}, routes?: RouteObject[]) {
  return renderWithProviders(<FinalizeSection {...READY_PROPS} {...propsOverrides} />, routes ? { routes } : {})
}

describe('FinalizeSection / FinalizeBar / EligibilitySummary', () => {
  it('Finalize disabled with the named disruption message when unanswered', () => {
    mockHook()
    renderSection({ materiallyDisrupted: null })

    expect(screen.getByText('Answer whether the session was materially disrupted')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Finalize' })).toBeDisabled()
  })

  it('Finalize disabled until conditions are confirmed', () => {
    mockHook()
    renderSection({ conditionsConfirmed: false })

    expect(screen.getByText('Confirm the observed conditions')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Finalize' })).toBeDisabled()
  })

  it('Finalize enabled on an incomplete attempt with recall missing once disruption and conditions are set, sending no recallScores', async () => {
    const { finalize } = mockHook()
    const { user } = renderSection({
      recallScores: undefined,
      scoringComplete: true, // Scoring's own recall_missing mode already reports complete: true (D25)
      materiallyDisrupted: 'no',
      conditionsConfirmed: true,
    })

    const button = screen.getByRole('button', { name: 'Finalize' })
    expect(button).toBeEnabled()
    await user.click(button)

    expect(finalize).toHaveBeenCalledTimes(1)
    const body = finalize.mock.calls[0]?.[0] as Record<string, unknown>
    expect('recallScores' in body).toBe(false)
  })

  it('status error shows the generic retry message and Finalize can be retried (useFinalizeSession exposes no per-field server error)', async () => {
    const { retry } = mockHook({ status: 'error' })
    const { user } = renderSection()

    expect(screen.getByText('The review could not be saved. Retry.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('status unsaved_entries after three mismatches shows Retry and never reports completion', () => {
    mockHook({ status: 'unsaved_entries', mismatchAttempts: 3 })
    renderSection()

    expect(screen.getByText('Some entries are still unsaved. Retry.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.queryByText('Eligible')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()
  })

  it('summary lists interval_incomplete, recall_missing and scoring_incomplete together for the incomplete-attempt case', () => {
    mockHook({
      status: 'success',
      result: makeFinalizeResult({
        eligible: false,
        exclusionReasons: ['interval_incomplete', 'recall_missing', 'scoring_incomplete'],
      }),
    })
    renderSection()

    expect(screen.getByText('Not eligible')).toBeInTheDocument()
    expect(screen.getByText('The full 20-minute interval was not completed.')).toBeInTheDocument()
    expect(screen.getByText('The recall step was not saved.')).toBeInTheDocument()
    expect(screen.getByText('Self-scoring was not finished.')).toBeInTheDocument()
  })

  it('timing_deviation reason rendered and the attempt still shown', () => {
    mockHook({
      status: 'success',
      result: makeFinalizeResult({
        eligible: false,
        exclusionReasons: ['timing_deviation'],
        review: makeReview({ episodeCount: 3, recallScore: 4, firstSwitch: { kind: 'known', seconds: 90 } }),
      }),
    })
    renderSection()

    expect(screen.getByText('This session ran outside its assigned date.')).toBeInTheDocument()
    // the attempt's own data is still rendered, not hidden by the exclusion
    const sRow = screen.getByText('Off-task episodes (S):').closest('div') as HTMLElement
    expect(within(sRow).getByText('3')).toBeInTheDocument()
    expect(screen.getByText('4/5 (self-reported)')).toBeInTheDocument()
    expect(screen.getByText('1:30')).toBeInTheDocument()
  })

  it('blank S renders not reported and no 0 in the S cell', () => {
    mockHook({
      status: 'success',
      result: makeFinalizeResult({ review: makeReview({ episodeCount: null }) }),
    })
    renderSection()

    const sRow = screen.getByText('Off-task episodes (S):').closest('div')
    expect(sRow).not.toBeNull()
    expect(within(sRow as HTMLElement).getByText('Not reported')).toBeInTheDocument()
    expect(within(sRow as HTMLElement).queryByText('0')).not.toBeInTheDocument()
  })

  it('reviewNote included only when non-blank', async () => {
    const blank = mockHook()
    const { user } = renderSection({}, undefined)
    await user.click(screen.getByRole('button', { name: 'Finalize' }))
    const blankBody = blank.finalize.mock.calls[0]?.[0] as Record<string, unknown>
    expect('reviewNote' in blankBody).toBe(false)
    cleanup()

    const typed = mockHook()
    const rendered = renderSection()
    await rendered.user.type(screen.getByLabelText('Anything else to note?'), 'Ran a bit long')
    await rendered.user.click(screen.getByRole('button', { name: 'Finalize' }))
    const typedBody = typed.finalize.mock.calls[0]?.[0] as Record<string, unknown>
    expect(typedBody.reviewNote).toBe('Ran a bit long')
  })

  it('summary contains no % text', () => {
    mockHook({
      status: 'success',
      result: makeFinalizeResult({ review: makeReview({ episodeCount: 5, recallScore: 3 }) }),
    })
    const { container } = renderSection()

    expect(container.textContent ?? '').not.toContain('%')
  })

  it('Continue routes to /benchmark/:slotId when nextAction is benchmark, else /today', async () => {
    mockHook({ status: 'success', result: makeFinalizeResult() })
    respond('programs.current', {
      program: null,
      revision: null,
      slots: [],
      day: 5,
      nextAction: { kind: 'benchmark', slotId: 'slot-next' },
    })

    const routes: RouteObject[] = [
      { path: '/benchmark/:sessionId/scoring', element: <FinalizeSection {...READY_PROPS} /> },
      { path: '/benchmark/:slotId', element: <p>Benchmark ready screen</p> },
      { path: '/today', element: <p>Today screen</p> },
    ]
    const { user, router } = renderWithProviders(<FinalizeSection {...READY_PROPS} />, {
      route: `/benchmark/${SESSION_ID}/scoring`,
      routes,
    })

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('Benchmark ready screen')
    expect(router.state.location.pathname).toBe('/benchmark/slot-next')
    cleanup()

    mockApi.programs.current.mockReset()
    mockHook({ status: 'success', result: makeFinalizeResult() })
    respond('programs.current', {
      program: null,
      revision: null,
      slots: [],
      day: 5,
      nextAction: { kind: 'progress' },
    })
    const second = renderWithProviders(<FinalizeSection {...READY_PROPS} />, {
      route: `/benchmark/${SESSION_ID}/scoring`,
      routes,
    })
    await second.user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('Today screen')
    expect(second.router.state.location.pathname).toBe('/today')
  })
})
