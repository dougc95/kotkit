import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import type { SessionResponseValue } from '@attention-lab/shared'

import { renderWithProviders } from '../../test/renderWithProviders.js'
import { ActiveSessionCard } from './ActiveSessionCard.js'

/**
 * task 8.2.5's brief, the `ActiveSessionCard.test.tsx` half of its 10-case
 * verify list (8 cases; the remaining 2 — the caller-owned query's 204/200
 * branch — live in `features/today/TodayActiveSession.test.tsx` since they
 * need a query-owning harness, not just this pure component). Every case
 * here mounts `ActiveSessionCard` directly with a plain `session` prop — no
 * API stub, matching the brief's "no local state" (this component issues no
 * request of its own).
 */

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

afterEach(() => {
  cleanup()
})

describe('ActiveSessionCard', () => {
  it('running practice hides Start and links Return to /focus/:id', () => {
    const session = makeSession({ id: 'session-a', kind: 'practice', lifecycle: 'running' })

    renderWithProviders(<ActiveSessionCard session={session} />)

    expect(screen.queryByRole('button', { name: /start/i })).not.toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Return to your session' })
    expect(link).toHaveAttribute('href', '/focus/session-a')
  })

  it('paused practice links /focus/:id', () => {
    const session = makeSession({ id: 'session-b', kind: 'practice', lifecycle: 'paused' })

    renderWithProviders(<ActiveSessionCard session={session} />)

    const link = screen.getByRole('link', { name: 'Return to your session' })
    expect(link).toHaveAttribute('href', '/focus/session-b')
  })

  it('awaiting-review practice links /review/:id', () => {
    const session = makeSession({ id: 'session-c', kind: 'practice', lifecycle: 'awaiting_review' })

    renderWithProviders(<ActiveSessionCard session={session} />)

    const link = screen.getByRole('link', { name: 'Finish your pending review' })
    expect(link).toHaveAttribute('href', '/review/session-c')
  })

  it('awaiting-review benchmark links recall when not locked', () => {
    const session = makeSession({
      id: 'session-d',
      kind: 'benchmark',
      slotId: 'slot-baseline-a',
      lifecycle: 'awaiting_review',
      review: { ...makeSession().review, sessionId: 'session-d', recallLockedAt: null },
    })

    renderWithProviders(<ActiveSessionCard session={session} />)

    const link = screen.getByRole('link', { name: 'Continue to recall' })
    expect(link).toHaveAttribute('href', '/benchmark/session-d/recall')
  })

  it('awaiting-review benchmark links scoring when locked', () => {
    const session = makeSession({
      id: 'session-e',
      kind: 'benchmark',
      slotId: 'slot-baseline-a',
      lifecycle: 'awaiting_review',
      review: { ...makeSession().review, sessionId: 'session-e', recallLockedAt: '2026-09-08T09:05:00.000Z' },
    })

    renderWithProviders(<ActiveSessionCard session={session} />)

    const link = screen.getByRole('link', { name: 'Continue scoring' })
    expect(link).toHaveAttribute('href', '/benchmark/session-e/scoring')
  })

  it('running benchmark links /benchmark/:slotId', () => {
    const session = makeSession({
      id: 'session-f',
      kind: 'benchmark',
      slotId: 'slot-baseline-a',
      lifecycle: 'running',
    })

    renderWithProviders(<ActiveSessionCard session={session} />)

    const link = screen.getByRole('link', { name: 'Return to your benchmark' })
    expect(link).toHaveAttribute('href', '/benchmark/slot-baseline-a')
  })

  it('staleNotice renders This session was updated in another tab above the current lifecycle line', () => {
    const session = makeSession({ id: 'session-g', kind: 'practice', lifecycle: 'running' })

    const { container } = renderWithProviders(<ActiveSessionCard session={session} staleNotice />)

    const notice = screen.getByRole('status')
    expect(notice).toHaveTextContent('This session was updated in another tab')

    const text = container.textContent ?? ''
    const noticeIndex = text.indexOf('This session was updated in another tab')
    const lifecycleIndex = text.indexOf('Practice session in progress')
    expect(noticeIndex).toBeGreaterThanOrEqual(0)
    expect(lifecycleIndex).toBeGreaterThan(noticeIndex)
  })

  it('a stale awaiting_review current renders the Finish-review link, not the stale running one', () => {
    // The caller's own transition attempted `end` on a `running` session and
    // received 409 stale_version; `details.current` (D18) is already
    // `awaiting_review` (another tab ended it first) by the time this
    // renders — the card must reflect that current truth, never the
    // `running` state the caller started from.
    const session = makeSession({ id: 'session-h', kind: 'practice', lifecycle: 'awaiting_review' })

    renderWithProviders(<ActiveSessionCard session={session} staleNotice />)

    expect(screen.getByRole('link', { name: 'Finish your pending review' })).toHaveAttribute(
      'href',
      '/review/session-h',
    )
    expect(screen.queryByRole('link', { name: 'Return to your session' })).not.toBeInTheDocument()
  })
})
