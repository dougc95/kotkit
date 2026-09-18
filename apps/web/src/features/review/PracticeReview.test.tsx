import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RouteObject } from 'react-router'
import type { FinalizeResponseValue, SessionResponseValue } from '@attention-lab/shared'

import { ConflictError, NotFoundError } from '../../lib/api/errors.js'
import { enqueue, listUnsent } from '../../lib/outbox/store.js'
import { expectNoIdentifiers } from '../../test/expectNoIdentifiers.js'
import { mockApi, respond } from '../../test/mockClient.js'
import { renderWithProviders } from '../../test/renderWithProviders.js'
import { PracticeReview } from './PracticeReview.js'

/**
 * task 8.6.2's verify list: the 13 named PracticeReview cases. `fake-indexeddb`
 * (not `src/test/fakeOutbox.ts`'s in-memory stand-in) backs `src/lib/outbox/
 * store.ts` for real here — the same choice `useOutbox.test.tsx`/`finalize.test.ts`
 * already make for every outbox-touching unit in this codebase — so `flush()`
 * and `useFinalizeSession`'s real `finalizeWithSync` run unmodified against a
 * real (fake) IndexedDB while only `api.*` (`mockClient.ts`) is stubbed.
 */
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

// jsdom does not implement ResizeObserver; Radix's RadioGroup item
// (`@radix-ui/react-use-size`) needs one to mount at all. `src/test/setup.ts`
// is 7.1.1's shared harness (never edited by feature tasks), so this stub is
// scoped to this test file rather than added there.
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
// `cleanup()` itself (DemoBanner.test.tsx / router.test.tsx's pattern).
afterEach(() => {
  cleanup()
})

function makeSession(overrides: Partial<SessionResponseValue> = {}): SessionResponseValue {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    programId: '22222222-2222-4222-8222-222222222222',
    slotId: null,
    revisionId: '33333333-3333-4333-8333-333333333333',
    realm: 'demo',
    kind: 'practice',
    lifecycle: 'awaiting_review',
    targetSeconds: 900,
    startedAt: '2026-09-08T09:00:00.000Z',
    endedAt: '2026-09-08T09:15:00.000Z',
    pausedSeconds: 0,
    currentPauseStartedAt: null,
    localDate: '2026-09-08',
    intendedOutput: 'a draft outline',
    timeSource: 'demo_clock',
    timerQuality: 'ok',
    clockGapSeconds: null,
    completeInterval: true,
    eligible: null,
    exclusionReasons: [],
    replacementReason: null,
    version: 1,
    serverNow: '2026-09-08T09:15:00.000Z',
    timing: { elapsedSeconds: 900, remainingSeconds: 0, deadlineReached: true, isPaused: false },
    tallies: { offTask: 0, external: 0, agentChecks: 0 },
    eventCount: 0,
    events: [],
    review: {
      sessionId: '11111111-1111-4111-8111-111111111111',
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

function fakeFinalizeResponse(session: SessionResponseValue): FinalizeResponseValue {
  return {
    session: { ...session, lifecycle: 'finalized' },
    review: session.review,
    eligible: null,
    exclusionReasons: [],
  }
}

function routes(): RouteObject[] {
  return [
    { path: '/review/:sessionId', element: <PracticeReview /> },
    { path: '/today', element: <div>Today screen</div> },
  ]
}

function renderReview(sessionId: string) {
  return renderWithProviders(<PracticeReview />, { route: `/review/${sessionId}`, routes: routes() })
}

/** Waits for the loaded form (the output-quality legend only renders once the session query resolves). */
async function waitForLoaded(): Promise<void> {
  await screen.findByRole('radio', { name: 'Yes' })
}

async function selectOutputQuality(user: ReturnType<typeof renderReview>['user'], label: 'Yes' | 'Partly' | 'No') {
  await user.click(screen.getByRole('radio', { name: label }))
}

function lastFinalizeReviewBody(): Record<string, unknown> {
  const call = mockApi.sessions.finalize.mock.calls.at(-1) as [string, { review: Record<string, unknown> }, unknown]
  return call[1].review
}

describe('PracticeReview', () => {
  it('flushes the outbox on mount then prefills S/E/agent counts from the server tallies with countMethod event', async () => {
    const session = makeSession({ tallies: { offTask: 3, external: 2, agentChecks: 1 } })
    await enqueue(session.id, { type: 'off_task', elapsedMs: 1000, occurredAt: '2026-09-08T09:01:00.000Z' })
    respond('sessions.get', session)
    // Accepts whatever clientEventId the seeded row actually got (mirrors flush.test.ts's own `acceptAllResponder`).
    mockApi.sessions.postEvents.mockImplementation(
      async (_id: string, body: { events: Array<{ clientEventId: string }> }) => ({
        accepted: body.events.map((event) => event.clientEventId),
        duplicates: [],
      }),
    )

    const { user } = renderReview(session.id)
    await waitForLoaded()

    const episodeInput = screen.getByLabelText('How many times did you switch away?') as HTMLInputElement
    const externalInput = screen.getByLabelText('How many were external interruptions?') as HTMLInputElement
    const agentInput = screen.getByLabelText('How many unplanned agent checks?') as HTMLInputElement

    expect(episodeInput.value).toBe('3')
    expect(externalInput.value).toBe('2')
    expect(agentInput.value).toBe('1')
    expect(screen.getAllByText('prefilled from recorded events')).toHaveLength(3)

    // The seeded row was actually flushed (and acked) on mount, not merely left buffered.
    await waitFor(async () => {
      const remaining = await listUnsent(session.id)
      expect(remaining).toHaveLength(0)
    })

    respond('sessions.finalize', fakeFinalizeResponse(session))
    await selectOutputQuality(user, 'Yes')
    await user.click(screen.getByRole('button', { name: 'Save review' }))

    await waitFor(() => expect(mockApi.sessions.finalize).toHaveBeenCalled())
    const body = lastFinalizeReviewBody()
    expect(body.episodeCount).toBe(3)
    expect(body.countMethod).toBe('event')
    expect(body.externalCount).toBe(2)
    expect(body.unplannedAgentChecks).toBe(1)
  })

  it('renders blank counts when tallies are 0 and sends no episodeCount, externalCount, unplannedAgentChecks and no countMethod', async () => {
    const session = makeSession({ tallies: { offTask: 0, external: 0, agentChecks: 0 } })
    respond('sessions.get', session)
    respond('sessions.finalize', fakeFinalizeResponse(session))

    const { user } = renderReview(session.id)
    await waitForLoaded()

    expect((screen.getByLabelText('How many times did you switch away?') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('How many were external interruptions?') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('How many unplanned agent checks?') as HTMLInputElement).value).toBe('')
    expect(screen.queryByText('prefilled from recorded events')).not.toBeInTheDocument()

    await selectOutputQuality(user, 'Yes')
    await user.click(screen.getByRole('button', { name: 'Save review' }))

    await waitFor(() => expect(mockApi.sessions.finalize).toHaveBeenCalled())
    const body = lastFinalizeReviewBody()
    expect(body).not.toHaveProperty('episodeCount')
    expect(body).not.toHaveProperty('externalCount')
    expect(body).not.toHaveProperty('unplannedAgentChecks')
    expect(body).not.toHaveProperty('countMethod')
  })

  it('editing a prefilled S switches countMethod to retrospective', async () => {
    const session = makeSession({ tallies: { offTask: 2, external: 0, agentChecks: 0 } })
    respond('sessions.get', session)
    respond('sessions.finalize', fakeFinalizeResponse(session))

    const { user } = renderReview(session.id)
    await waitForLoaded()

    const episodeInput = screen.getByLabelText('How many times did you switch away?')
    expect(screen.getByText('prefilled from recorded events')).toBeInTheDocument()

    await user.clear(episodeInput)
    await user.type(episodeInput, '5')

    expect(screen.queryByText('prefilled from recorded events')).not.toBeInTheDocument()

    await selectOutputQuality(user, 'Yes')
    await user.click(screen.getByRole('button', { name: 'Save review' }))

    await waitFor(() => expect(mockApi.sessions.finalize).toHaveBeenCalled())
    const body = lastFinalizeReviewBody()
    expect(body.episodeCount).toBe(5)
    expect(body.countMethod).toBe('retrospective')
  })

  it('explicit 0 is sent as 0, never omitted', async () => {
    const session = makeSession({ tallies: { offTask: 0, external: 0, agentChecks: 0 } })
    respond('sessions.get', session)
    respond('sessions.finalize', fakeFinalizeResponse(session))

    const { user } = renderReview(session.id)
    await waitForLoaded()

    const episodeInput = screen.getByLabelText('How many times did you switch away?')
    await user.type(episodeInput, '0')

    await selectOutputQuality(user, 'Yes')
    await user.click(screen.getByRole('button', { name: 'Save review' }))

    await waitFor(() => expect(mockApi.sessions.finalize).toHaveBeenCalled())
    const body = lastFinalizeReviewBody()
    expect(body.episodeCount).toBe(0)
    expect(body).toHaveProperty('episodeCount')
    expect(body.countMethod).toBe('retrospective')
  })

  it('tallies off-task 1 and agent checks 1 (alsoOffTask) render both and no summed figure 2 appears', async () => {
    const session = makeSession({ tallies: { offTask: 1, external: 0, agentChecks: 1 } })
    respond('sessions.get', session)

    renderReview(session.id)
    await waitForLoaded()

    const tallies = screen.getByTestId('recorded-tallies')
    expect(within(tallies).getByText('Off-task, recorded').nextElementSibling?.textContent).toBe('1')
    expect(within(tallies).getByText('Agent checks, recorded').nextElementSibling?.textContent).toBe('1')
    expect(within(tallies).getByText('External, recorded').nextElementSibling?.textContent).toBe('0')
    expect(within(tallies).queryByText('2')).not.toBeInTheDocument()
  })

  it('outputNote is optional and omitted from the body when blank; a typed one-liner is sent verbatim', async () => {
    const blankSession = makeSession({ id: '44444444-4444-4444-8444-444444444444' })
    respond('sessions.get', blankSession)
    respond('sessions.finalize', fakeFinalizeResponse(blankSession))

    const first = renderReview(blankSession.id)
    await waitForLoaded()
    await selectOutputQuality(first.user, 'Yes')
    await first.user.click(screen.getByRole('button', { name: 'Save review' }))
    await waitFor(() => expect(mockApi.sessions.finalize).toHaveBeenCalledTimes(1))
    expect(lastFinalizeReviewBody()).not.toHaveProperty('outputNote')

    cleanup()

    const typedSession = makeSession({ id: '55555555-5555-4555-8555-555555555555' })
    respond('sessions.get', typedSession)
    respond('sessions.finalize', fakeFinalizeResponse(typedSession))

    const second = renderReview(typedSession.id)
    await waitForLoaded()
    // `user.type` dispatches one real per-character timer-scheduled keystroke
    // per letter; under load that is slow enough to push this file past its
    // test timeout (same defect and fix as ReadinessForm.test.tsx, commit
    // 01fb558). Nothing here asserts on keystroke-by-keystroke behaviour, so
    // a single paste is equivalent.
    const secondOutputNoteInput = screen.getByLabelText('What did you finish? (optional)')
    await second.user.click(secondOutputNoteInput)
    await second.user.paste('drafted the outline')
    await selectOutputQuality(second.user, 'Yes')
    await second.user.click(screen.getByRole('button', { name: 'Save review' }))
    await waitFor(() => expect(mockApi.sessions.finalize).toHaveBeenCalledTimes(2))
    expect(lastFinalizeReviewBody().outputNote).toBe('drafted the outline')
  })

  it('reviewNote is optional and independent of outputNote; both can be set at once', async () => {
    const session = makeSession()
    respond('sessions.get', session)
    respond('sessions.finalize', fakeFinalizeResponse(session))

    const { user } = renderReview(session.id)
    await waitForLoaded()

    // Same per-character-timer defect and fix as above (commit 01fb558);
    // neither field is asserted keystroke-by-keystroke.
    const outputNoteInput = screen.getByLabelText('What did you finish? (optional)')
    await user.click(outputNoteInput)
    await user.paste('drafted the outline')
    const reviewNoteInput = screen.getByLabelText('Notes (optional)')
    await user.click(reviewNoteInput)
    await user.paste('felt distracted by chat notifications')
    await selectOutputQuality(user, 'Yes')
    await user.click(screen.getByRole('button', { name: 'Save review' }))

    await waitFor(() => expect(mockApi.sessions.finalize).toHaveBeenCalled())
    const body = lastFinalizeReviewBody()
    expect(body.outputNote).toBe('drafted the outline')
    expect(body.reviewNote).toBe('felt distracted by chat notifications')
  })

  it('Partly saves and navigates to /today with the notice Review saved.', async () => {
    const session = makeSession()
    respond('sessions.get', session)
    respond('sessions.finalize', fakeFinalizeResponse(session))

    const { user, router } = renderReview(session.id)
    await waitForLoaded()

    await selectOutputQuality(user, 'Partly')
    await user.click(screen.getByRole('button', { name: 'Save review' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/today'))
    expect(router.state.location.state).toEqual({ notice: 'Review saved.' })
    await screen.findByText('Today screen')

    const body = lastFinalizeReviewBody()
    expect(body.outputQuality).toBe('partly')
  })

  it('recorded-time line reads X min recorded of Y min target from response.timing.elapsedSeconds and the word focused never appears', async () => {
    const session = makeSession({
      targetSeconds: 900,
      timing: { elapsedSeconds: 485, remainingSeconds: 0, deadlineReached: true, isPaused: false },
    })
    respond('sessions.get', session)

    renderReview(session.id)
    await waitForLoaded()

    expect(screen.getByText('8 min recorded of 15 min target (pauses excluded)')).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toMatch(/focused/i)
  })

  it('missing outputQuality blocks submit with Choose Yes, Partly or No and no request is sent', async () => {
    const session = makeSession()
    respond('sessions.get', session)

    const { user } = renderReview(session.id)
    await waitForLoaded()

    await user.click(screen.getByRole('button', { name: 'Save review' }))

    expect(await screen.findByText('Choose Yes, Partly or No')).toBeInTheDocument()
    expect(mockApi.sessions.finalize).not.toHaveBeenCalled()
  })

  it('the blocked-submit error on output quality stays wired to the fieldset via aria-describedby and role=alert', async () => {
    const session = makeSession()
    respond('sessions.get', session)

    const { user } = renderReview(session.id)
    await waitForLoaded()

    const yesRadio = screen.getByRole('radio', { name: 'Yes' })

    await user.click(screen.getByRole('button', { name: 'Save review' }))

    const errorMessage = await screen.findByText('Choose Yes, Partly or No')
    expect(errorMessage).toHaveAttribute('role', 'alert')
    const fieldset = yesRadio.closest('fieldset')
    expect(fieldset).not.toBeNull()
    expect(fieldset).toHaveAttribute('aria-describedby', errorMessage.id)
  })

  it('the output-quality options sit in a named radiogroup', async () => {
    const session = makeSession()
    respond('sessions.get', session)

    renderReview(session.id)
    await waitForLoaded()

    expect(screen.getByRole('radiogroup', { name: 'Did you produce the planned output?' })).toBeInTheDocument()
  })

  it('pins the literal output-quality radio ids the Playwright suite tabs through', async () => {
    const session = makeSession()
    respond('sessions.get', session)

    renderReview(session.id)
    await waitForLoaded()

    // e2e/practice-review.spec.ts:262 tabs until document.activeElement.id
    // starts with 'output-quality-', then presses Space to answer it — these
    // three ids must stay exactly these literals and nothing else focusable
    // may take an id starting with 'output-quality-'.
    expect(document.getElementById('output-quality-yes')).toBe(screen.getByRole('radio', { name: 'Yes' }))
  })

  it('the blocked-submit error row is attention-coloured, never red', async () => {
    const session = makeSession()
    respond('sessions.get', session)

    const { user } = renderReview(session.id)
    await waitForLoaded()

    await user.click(screen.getByRole('button', { name: 'Save review' }))

    const errorMessage = await screen.findByText('Choose Yes, Partly or No')
    expect(errorMessage).toHaveClass('text-attention')
    expect(errorMessage).not.toHaveClass('text-red-600')
  })

  it('a 409 event_count_mismatch renders Some entries have not been saved yet with Retry and keeps the typed values', async () => {
    const session = makeSession()
    respond('sessions.get', session)
    mockApi.sessions.finalize.mockRejectedValue(
      new ConflictError(409, {
        code: 'event_count_mismatch',
        message: 'Event count mismatch',
        details: { expected: 5, stored: 4 },
        retryable: false,
        requestId: 'req-mismatch',
      }),
    )

    const { user } = renderReview(session.id)
    await waitForLoaded()

    // Same per-character-timer defect and fix as above (commit 01fb558); this
    // value is only ever asserted on as a whole string after Retry.
    const retryOutputNoteInput = screen.getByLabelText('What did you finish? (optional)')
    await user.click(retryOutputNoteInput)
    await user.paste('kept typing through the retry')
    await selectOutputQuality(user, 'Yes')
    await user.click(screen.getByRole('button', { name: 'Save review' }))

    expect(await screen.findByText('Some entries have not been saved yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect((screen.getByLabelText('What did you finish? (optional)') as HTMLInputElement).value).toBe(
      'kept typing through the retry',
    )
  })

  it('GET 404 renders Session not found with a link to Today', async () => {
    mockApi.sessions.get.mockRejectedValue(
      new NotFoundError(404, { code: 'not_found', message: 'Not found', retryable: false, requestId: 'req-404' }),
    )

    renderReview('66666666-6666-4666-8666-666666666666')

    expect(await screen.findByText('Session not found')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /today/i })).toHaveAttribute('href', '/today')
  })

  it('a non-404 load error renders inside an alert region, not a bare paragraph', async () => {
    mockApi.sessions.get.mockRejectedValue(new Error('network exploded'))

    renderReview('77777777-7777-4777-8777-777777777777')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The review could not be loaded.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()

    const message = within(alert).getByText('The review could not be loaded.')
    expect(message).toHaveClass('text-attention')
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1)
  })

  it('the pending session query renders multiple static ruled placeholder rows rather than a bare loading sentence', async () => {
    mockApi.sessions.get.mockImplementation(() => new Promise(() => {}))

    const { container } = renderReview('88888888-8888-4888-8888-888888888888')

    const busyRegion = container.querySelector('[aria-busy="true"]')
    expect(busyRegion).not.toBeNull()
    expect(busyRegion?.children.length ?? 0).toBeGreaterThan(1)
    expect(screen.getByText('Loading review')).toBeInTheDocument()

    expect(within(busyRegion as HTMLElement).getByText('Loading review')).toBeVisible()
  })

  it('expectNoIdentifiers passes on the rendered screen', async () => {
    const session = makeSession({ tallies: { offTask: 1, external: 1, agentChecks: 1 } })
    respond('sessions.get', session)

    renderReview(session.id)
    await waitForLoaded()

    expectNoIdentifiers(document.body)
  })

  it('count and note fields move onto shadcn Input/Textarea/Label while keeping their pinned DOM ids, and the count input grows to share the tallies grid column width', async () => {
    const session = makeSession({ tallies: { offTask: 1, external: 0, agentChecks: 0 } })
    respond('sessions.get', session)

    renderReview(session.id)
    await waitForLoaded()

    const episodeInput = screen.getByLabelText('How many times did you switch away?')
    expect(episodeInput).toHaveAttribute('id', 'episode-count')
    expect(episodeInput.className).toMatch(/\bw-full\b/)
    expect(episodeInput.className).not.toMatch(/\bw-28\b/)

    const outputNoteInput = screen.getByLabelText('What did you finish? (optional)')
    expect(outputNoteInput).toHaveAttribute('id', 'output-note')

    const reviewNoteInput = screen.getByLabelText('Notes (optional)')
    expect(reviewNoteInput).toHaveAttribute('id', 'review-note')
  })

  it('the Timing uncertain flag renders inside a Badge as the uncertain tier, not a plain chip', async () => {
    const session = makeSession({ timerQuality: 'uncertain' })
    respond('sessions.get', session)

    renderReview(session.id)
    await waitForLoaded()

    const badgeText = screen.getByText('Timing uncertain')
    expect(badgeText).toHaveAttribute('data-tier', 'uncertain')
  })

  it('a session with no intended output shows Planned output: Not reported in the absent tier, never the old None recorded string', async () => {
    const session = makeSession({ intendedOutput: null })
    respond('sessions.get', session)

    renderReview(session.id)
    await waitForLoaded()

    expect(screen.queryByText('None recorded', { exact: false })).not.toBeInTheDocument()
    const value = screen.getByText('Not reported')
    expect(value).toHaveAttribute('data-tier', 'absent')
  })

  // Controller deviation from the brief: `<Reported>` wraps ONLY the
  // placeholder ('Not reported'), never the user's own `intendedOutput`
  // text — a user whose planned output literally reads "Unknown" must see
  // their own words rendered plain, not amber. This guards that: if
  // `intendedOutput` were ever wrapped in `<Reported>` again, "Unknown"
  // would render inside a separate `data-tier="uncertain"` element instead
  // of as part of the paragraph's own direct text.
  it('an intended output of exactly "Unknown" renders as plain text, never the uncertain tier', async () => {
    const session = makeSession({ intendedOutput: 'Unknown' })
    respond('sessions.get', session)

    renderReview(session.id)
    await waitForLoaded()

    const plannedOutputParagraph = screen.getByText(/Planned output:/).closest('p')
    expect(plannedOutputParagraph).not.toBeNull()

    // `within(p)` includes `p` itself as a candidate (it matches the '*'
    // selector) alongside any descendants. Unwrapped, "Unknown" is a bare
    // text node directly inside `p`, so the only match is `p` itself
    // (substring match against its own text "Planned output: Unknown").
    // Wrapped in `<Reported>`, the match would instead be the nested
    // `data-tier` span.
    const match = within(plannedOutputParagraph as HTMLElement).queryByText('Unknown', { exact: false })
    expect(match === plannedOutputParagraph || match?.hasAttribute('data-tier') === false).toBe(true)
  })

  it('the recorded tallies and the counts you attest to share one three-column grid so their values line up', async () => {
    const session = makeSession({ tallies: { offTask: 1, external: 0, agentChecks: 0 } })
    respond('sessions.get', session)

    renderReview(session.id)
    await waitForLoaded()

    const tallies = screen.getByTestId('recorded-tallies')
    const attested = screen.getByTestId('attested-counts')
    expect(tallies.className).toMatch(/grid-cols-3/)
    expect(attested.className).toMatch(/grid-cols-3/)
  })

  it('CountField uses CSS subgrid so labels, inputs and hints share rows at every width (pre-existing)', async () => {
    const session = makeSession({ tallies: { offTask: 1, external: 0, agentChecks: 0 } })
    respond('sessions.get', session)

    renderReview(session.id)
    await waitForLoaded()

    const episodeInput = screen.getByLabelText('How many times did you switch away?')
    const root = episodeInput.parentElement
    expect(root).not.toBeNull()
    expect(root?.className).toContain('grid-rows-subgrid')
    expect(root?.className).toContain('row-span-3')
  })
})
