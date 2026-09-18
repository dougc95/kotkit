import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

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

  it('the Return control renders through Button asChild: a primary anchor, never a button wrapping it', () => {
    const session = makeSession({ id: 'session-a', kind: 'practice', lifecycle: 'running' })

    renderWithProviders(<ActiveSessionCard session={session} />)

    const link = screen.getByRole('link', { name: 'Return to your session' })
    expect(link).toHaveAttribute('data-variant', 'primary')
    expect(link.closest('button')).toBeNull()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('the card root uses rounded-lg, not the Card primitive\'s rounded-xl, so a measurement record does not look pillowy (task V3)', () => {
    const session = makeSession({ id: 'session-a', kind: 'practice', lifecycle: 'running' })

    renderWithProviders(<ActiveSessionCard session={session} />)

    const card = screen.getByTestId('active-session-card')
    expect(card).toHaveClass('rounded-lg')
    expect(card).not.toHaveClass('rounded-xl')
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

describe('ActiveSessionCard token migration', () => {
  // `new URL('./ActiveSessionCard.tsx', import.meta.url)` alone is rewritten
  // by Vite's asset transform; wrapping `import.meta.url` in its own `URL`
  // first is the form that actually resolves to the source file on disk.
  function readSource(): string {
    return readFileSync(fileURLToPath(new URL('./ActiveSessionCard.tsx', new URL(import.meta.url))), 'utf8')
  }

  it('the card container and its text no longer reference the retired --color-border/surface/text-muted/text tokens', () => {
    const source = readSource()

    expect(source).not.toMatch(/--color-border/)
    expect(source).not.toMatch(/--color-surface/)
    expect(source).not.toMatch(/--color-text-muted/)
    expect(source).not.toMatch(/--color-text\)/)
    expect(source).toContain('<Card')
    expect(source).not.toContain('CONTAINER_CLASSES')
  })

  it('no legacy --color- custom property remains anywhere in the file', () => {
    const source = readSource()

    expect(source).not.toMatch(/--color-/)
    expect(source).not.toContain('LINK_CLASSES')
  })
})
