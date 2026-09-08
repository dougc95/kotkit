import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import type { SessionResponseValue } from '@attention-lab/shared'

import { respond } from '../../test/mockClient.js'
import { renderWithProviders } from '../../test/renderWithProviders.js'
import { useActiveSession } from '../../lib/query/hooks.js'
import { ActiveSessionCard } from './ActiveSessionCard.js'

/**
 * task 8.2.5's brief, the remaining 2 of its 10-case verify list (the other
 * 8 live in `features/session/ActiveSessionCard.test.tsx`, exercising the
 * pure component directly). These two need a query-owning caller, which
 * `ActiveSessionCard` itself deliberately is not (its own "State" line: the
 * `['sessions','active']` query is "mounted by Today/Ready", not by this
 * component) — per this workflow's file-ownership rule, this file builds a
 * small local harness rather than rendering the real `Today.tsx` (owned by
 * 8.2.1, still a commented placeholder for this slot) or the real
 * `Ready.tsx` (owned by 8.3.1, next wave, does not exist yet). Both harnesses
 * below use the exact pattern Today's and Ready's own wiring will use — the
 * shared `useActiveSession()` hook (`lib/query/hooks.ts`, task 7.4.2) plus a
 * conditional render against this card — so once a human applies this
 * task's `centralWiringNeeded` edit, the real screens behave identically to
 * what is proven here. Imports `ActiveSessionCard` from this directory's own
 * re-export (`./ActiveSessionCard.js`), the same path Today's real wiring
 * will use.
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

/** Stands in for Today's own future wiring (8.2.1's centralWiringNeeded edit). */
function TodayLikeHarness() {
  const activeQuery = useActiveSession()
  if (activeQuery.isPending) {
    return <p aria-busy="true">Loading</p>
  }
  if (activeQuery.data) {
    return <ActiveSessionCard session={activeQuery.data} />
  }
  return <button type="button">Start</button>
}

/** Stands in for Benchmark Ready's own future wiring (8.3.1, next wave). */
function ReadyLikeHarness() {
  const activeQuery = useActiveSession()
  if (activeQuery.isPending) {
    return <p aria-busy="true">Loading</p>
  }
  if (activeQuery.data) {
    return <ActiveSessionCard session={activeQuery.data} />
  }
  return <button type="button">Start your baseline</button>
}

afterEach(() => {
  cleanup()
})

describe('ActiveSessionCard mounted by a Today-shaped caller', () => {
  it('204 renders the start controls', async () => {
    respond('sessions.active', null)

    renderWithProviders(<TodayLikeHarness />)

    await screen.findByRole('button', { name: 'Start' })
    expect(screen.queryByTestId('active-session-card')).not.toBeInTheDocument()
  })
})

describe('ActiveSessionCard mounted by a Ready-shaped caller', () => {
  it('Ready mounts the same card and hides its own Start control when a session exists', async () => {
    respond('sessions.active', makeSession({ id: 'session-active', kind: 'practice', lifecycle: 'running' }))

    renderWithProviders(<ReadyLikeHarness />)

    await screen.findByTestId('active-session-card')
    expect(screen.getByRole('link', { name: 'Return to your session' })).toHaveAttribute(
      'href',
      '/focus/session-active',
    )
    expect(screen.queryByRole('button', { name: 'Start your baseline' })).not.toBeInTheDocument()
  })
})
