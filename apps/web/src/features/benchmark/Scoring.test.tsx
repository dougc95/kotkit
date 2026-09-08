import { cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReviewResponseValue, SessionResponseValue } from '@attention-lab/shared'

import { renderWithProviders } from '../../test/renderWithProviders.js'
import { PointRow, Scoring } from './Scoring.js'

/**
 * task 8.4.2's verify list: the 10 named Scoring cases. `Scoring` takes
 * `session`/`review` as plain props (no `GET /sessions/{id}` of its own —
 * `BenchmarkReviewPage`, tested separately, owns that fetch), so every case
 * here mounts it directly with a hand-built fixture, matching
 * `RailLayout.test.tsx`/`DemoBanner.test.tsx`'s isolated-component style.
 */

// jsdom does not implement ResizeObserver; Radix's RadioGroup item
// (`@radix-ui/react-use-size`) needs one to mount at all — same stub
// `PracticeReview.test.tsx` (8.6.2) uses, scoped to this file since
// `src/test/setup.ts` is 7.1.1's shared harness.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver
}

// `test.globals: true` (vitest.config.ts) disables Testing Library's
// framework-detected auto-cleanup — every component test file here calls
// `cleanup()` itself.
afterEach(() => {
  cleanup()
})

const SESSION_ID = '11111111-1111-4111-8111-111111111111'
const LOCKED_AT = '2026-09-08T09:23:00.000Z'
const FIVE_POINTS: [string, string, string, string, string] = [
  'The introduction argued X',
  'Section two covered Y',
  'A worked example followed',
  'The conclusion restated the thesis',
  'A caveat about scope closed it',
]

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
    recallLockedAt: null,
    recallDelaySeconds: null,
    recallDurationSeconds: null,
    recallFlags: [],
    recallScores: null,
    recallScore: null,
    conditions: { deviceFormat: null, language: null, materialLevel: null, accommodations: [] },
    finalizedAt: null,
    version: 1,
    ...overrides,
  }
}

function makeSession(overrides: Partial<SessionResponseValue> = {}): SessionResponseValue {
  const review = overrides.review ?? makeReview()
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
    review,
    agentPlan: null,
    amendments: [],
    ...overrides,
  }
}

function renderScoring(session: SessionResponseValue, review: ReviewResponseValue, onChange = vi.fn()) {
  const utils = renderWithProviders(<Scoring session={session} review={review} onChange={onChange} />)
  return { ...utils, onChange }
}

describe('Scoring', () => {
  it('unlocked review on a complete interval renders zero radio inputs and the recall-first link', () => {
    const session = makeSession({ completeInterval: true })
    const review = makeReview({ recallLockedAt: null })

    renderScoring(session, review)

    expect(screen.getByText('Recall must be saved first')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /recall/i })
    expect(link).toHaveAttribute('href', `/benchmark/${SESSION_ID}/recall`)
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
  })

  it('unlocked review on an incomplete interval renders Recall not saved — this attempt will be recorded with recall missing, zero radios and no link back to recall', () => {
    const session = makeSession({ completeInterval: false })
    const review = makeReview({ recallLockedAt: null })

    renderScoring(session, review)

    expect(
      screen.getByText('Recall not saved — this attempt will be recorded with recall missing'),
    ).toBeInTheDocument()
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('locked points render as read-only text with no textarea or text input', () => {
    const session = makeSession({ completeInterval: true })
    const review = makeReview({ recallLockedAt: LOCKED_AT, recallPoints: FIVE_POINTS })

    const { container } = renderScoring(session, review)

    expect(screen.getByText(FIVE_POINTS[0])).toBeInTheDocument()
    expect(screen.getByText(FIVE_POINTS[4])).toBeInTheDocument()
    expect(container.querySelectorAll('textarea')).toHaveLength(0)
    expect(container.querySelectorAll('input[type="text"]')).toHaveLength(0)
  })

  it('points 1–3 Accurate with 4–5 blank yields preview 3, two Scored 0 because blank and no radios for the blanks', async () => {
    const points: [string, string, string, string, string] = ['p1', 'p2', 'p3', '', '']
    const session = makeSession({ completeInterval: true })
    const review = makeReview({ recallLockedAt: LOCKED_AT, recallPoints: points })

    const { user } = renderScoring(session, review)

    const accurateRadios = screen.getAllByRole('radio', { name: 'Accurate' })
    expect(accurateRadios).toHaveLength(3)
    for (const radio of accurateRadios) {
      await user.click(radio)
    }

    expect(screen.getByText('Recall score (self-reported, preview): 3/5')).toBeInTheDocument()
    expect(screen.getAllByText('Scored 0 because blank')).toHaveLength(2)
    expect(screen.getAllByRole('radio')).toHaveLength(6)
  })

  it('score label contains self-reported', () => {
    const session = makeSession({ completeInterval: true })
    const review = makeReview({ recallLockedAt: LOCKED_AT, recallPoints: FIVE_POINTS })

    renderScoring(session, review)

    expect(screen.getByText(/self-reported/)).toBeInTheDocument()
  })

  it('recall_delayed flag renders visible deviation copy labeled not excluding', () => {
    const session = makeSession({ completeInterval: true })
    const review = makeReview({ recallLockedAt: LOCKED_AT, recallPoints: FIVE_POINTS, recallFlags: ['recall_delayed'] })

    renderScoring(session, review)

    const flagText = screen.getByText(/Recall started more than 10 minutes after the interval/)
    expect(flagText).toBeInTheDocument()
    expect(flagText.textContent).toContain('noted, not excluding')
  })

  it('recall_overrun flag renders visible deviation copy', () => {
    const session = makeSession({ completeInterval: true })
    const review = makeReview({ recallLockedAt: LOCKED_AT, recallPoints: FIVE_POINTS, recallFlags: ['recall_overrun'] })

    renderScoring(session, review)

    expect(screen.getByText(/Recall ran more than 30 s over 3:00/)).toBeInTheDocument()
  })

  it('complete flag false until every non-blank point is answered', async () => {
    const points: [string, string, string, string, string] = ['p1', 'p2', '', '', '']
    const session = makeSession({ completeInterval: true })
    const review = makeReview({ recallLockedAt: LOCKED_AT, recallPoints: points })

    const { user, onChange } = renderScoring(session, review)

    expect(onChange).toHaveBeenLastCalledWith(expect.anything(), false)

    const accurateRadios = screen.getAllByRole('radio', { name: 'Accurate' })
    expect(accurateRadios).toHaveLength(2)

    await user.click(accurateRadios[0] as HTMLElement)
    expect(onChange).toHaveBeenLastCalledWith(expect.anything(), false)

    await user.click(accurateRadios[1] as HTMLElement)
    expect(onChange).toHaveBeenLastCalledWith(expect.anything(), true)
  })

  it('recall-missing state reports complete true with no recallScores', () => {
    const session = makeSession({ completeInterval: false })
    const review = makeReview({ recallLockedAt: null })

    const { onChange } = renderScoring(session, review)

    expect(onChange).toHaveBeenCalledWith(undefined, true)
  })

  it('Tab order reaches every radio in point order', async () => {
    const session = makeSession({ completeInterval: true })
    const review = makeReview({ recallLockedAt: LOCKED_AT, recallPoints: FIVE_POINTS })

    const { user } = renderScoring(session, review)

    for (let index = 0; index < 5; index += 1) {
      await user.tab()
      expect(document.activeElement).toHaveAttribute('id', `point-${index}-accurate`)
    }
  })
})

// Exercised indirectly by every case above via `Scoring`; imported directly
// too so a future refactor that stops re-exporting `PointRow` from
// `Scoring.tsx` fails typecheck here rather than silently.
void PointRow
