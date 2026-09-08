import { cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { RouteObject } from 'react-router'
import type { SessionResponseValue } from '@attention-lab/shared'

import { mockApi, respond } from '../../test/mockClient.js'
import { renderWithProviders } from '../../test/renderWithProviders.js'
import { BenchmarkReviewPage } from './BenchmarkReviewPage.js'

/**
 * Smoke coverage for the page shell itself (task 8.4.2) — the fetch/loading/
 * error states, and that it hands the fetched `session`/`review` down to
 * `Scoring` (covered exhaustively by its own `Scoring.test.tsx`, which is
 * this task's actual named verify list). jsdom needs the same
 * `ResizeObserver` stub `Scoring.test.tsx`/`PracticeReview.test.tsx` use —
 * `Scoring`'s locked branch mounts a Radix `RadioGroup`.
 */
if (typeof globalThis.ResizeObserver === 'undefined') {
  class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver
}

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
  return [{ path: '/benchmark/:sessionId/scoring', element: <BenchmarkReviewPage /> }]
}

function renderPage() {
  return renderWithProviders(<BenchmarkReviewPage />, {
    route: `/benchmark/${SESSION_ID}/scoring`,
    routes: routes(),
  })
}

describe('BenchmarkReviewPage', () => {
  it('shows a loading state while the session query is pending', () => {
    mockApi.sessions.get.mockReturnValue(new Promise(() => {}))

    renderPage()

    expect(screen.getByText('Loading review')).toBeInTheDocument()
  })

  it('mounts the Scoring section with the fetched session and review', async () => {
    respond('sessions.get', makeSession())

    renderPage()

    expect(await screen.findByText('Recall must be saved first')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /recall/i })).toHaveAttribute('href', `/benchmark/${SESSION_ID}/recall`)
  })

  it('error state offers Retry that refetches the session', async () => {
    mockApi.sessions.get.mockRejectedValueOnce(
      Object.assign(new Error('boom'), { status: 500, code: 'server_error', retryable: true, requestId: 'r1' }),
    )
    mockApi.sessions.get.mockResolvedValueOnce(makeSession())

    const { user } = renderPage()

    expect(await screen.findByText('The review could not be loaded.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(screen.getByText('Recall must be saved first')).toBeInTheDocument())
  })
})
