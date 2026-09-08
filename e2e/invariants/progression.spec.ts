/**
 * Task 9.2.6 — Invariant: progression suggestion timing, hold, Partly and
 * missed days.
 *
 * `packages/shared/src/domain/progression.ts`'s `suggestProgression` is the
 * one place this rule is computed (design.md D4): a +5 minute step is
 * offered only after two *consecutive* local days each had two qualifying
 * practice blocks at the CURRENT target, and only when the step stays within
 * the band ceiling that governs the day the suggestion is being evaluated
 * for (`DEFAULT_BAND_CEILINGS`: Days 1-3 -> 10 min, 4-7 -> 15 min, 8-10 -> 20
 * min, 11-14 -> 25 min). This file proves five corners of that rule end to
 * end against the real `acceptance` project (D37's single-origin
 * build-and-serve topology), all seeded from `demo.load('working-day')`
 * (Day 4, revision 2's target already 900 s = 15 min, matching the Days 4-7
 * ceiling exactly):
 *
 *  1. Two qualifying days (5, 6) produce NO suggestion on Day 7 — the pair
 *     is real, but 900 + 300 = 1200 exceeds the Days 4-7 ceiling of 900.
 *  2. The SAME pair, evaluated on Day 8 after a Day 7 with no sessions at
 *     all, DOES produce a suggestion (the Days 8-10 ceiling is 1200) — a
 *     missed day after a qualifying pair holds it rather than resetting it
 *     (CLAUDE.md: "Missed days hold the suggestion... never trigger
 *     punitive messaging"), and Today's next action and copy stay neutral.
 *  3. Hold (`SuggestionBanner`'s own "Hold the target" scenario,
 *     specs/practice-sessions): the next session still starts at the
 *     unmodified current target, no revision is created, and the suggestion
 *     is offered again once that session is finalized — proven via the API
 *     rather than a same-tab reload, because `SuggestionBanner.tsx` holds
 *     "this visit only" via a `sessionStorage` flag keyed by (programId,
 *     day), which a same-tab reload on the same day would still read.
 *  4. A block saved Partly breaks that day's qualification (`blockQualifies`
 *     requires `outputQuality === 'yes'`), which breaks the whole pair —
 *     Day 8 shows no suggestion.
 *  5. A block reported with 2 episodes breaks qualification the same way
 *     (`blockQualifies` requires `episodeCount <= 1`) — Day 8 shows no
 *     suggestion.
 *
 * Spec refs: practice-sessions "Progression suggestion follows the protocol
 * rule" / "Two qualifying days" / "Partly output breaks the streak of
 * qualifying days" · practice-sessions "Practice requires a short intended
 * output" / "Hold the target" · practice-sessions "Today shows one next
 * action and two blocks" / Missed day · app-shell "Copy never punishes or
 * gamifies" / Missed day.
 */
import type { Page } from '@playwright/test'
import { PROGRESSION_STEP_SECONDS } from '@attention-lab/shared'
import type { FinalizeBodyValue, ReviewInputValue, TransitionBodyValue } from '@attention-lab/shared'

import { expect, test } from '../support/demo.js'
import type { CompletePracticeBlockOptions, DemoClient } from '../support/demo.js'
import { expectNoPunitiveCopy } from '../support/copy.js'
import { advance, installClock } from '../support/clock.js'

// ---------------------------------------------------------------------------
// Local helpers (this file may not import from another `.spec.ts` file —
// Playwright's own full-suite discovery rejects that).
// ---------------------------------------------------------------------------

/**
 * Builds `days.length * 2` qualifying practice blocks — two per day, in
 * order, via `setDay` + `completePracticeBlock` (task 9.1.1) — at
 * `targetSeconds`, which MUST equal the revision currently governing the
 * program (`blockQualifies` requires `block.targetSeconds ===
 * currentTargetSeconds`; a stale value here would silently build blocks that
 * never qualify). `completePracticeBlock`'s own defaults already produce a
 * qualifying block (`outputQuality: 'yes'`, `episodeCount: 0`); `overrides`
 * is for a caller that wants every block THIS call makes to deliberately
 * miss. Tests that need only ONE block of a day to break (Partly, two
 * episodes) call `demo.completePracticeBlock` directly for that day instead
 * — this helper only ever covers the simple "the whole day qualifies" case,
 * matching this task's own brief. Returns every session id created, in
 * order, so a caller can assert on the underlying blocks directly.
 */
async function qualify(
  demo: DemoClient,
  programId: string,
  targetSeconds: number,
  days: readonly number[],
  overrides?: CompletePracticeBlockOptions,
): Promise<string[]> {
  const sessionIds: string[] = []
  for (const day of days) {
    await demo.setDay(day)
    const block1 = await demo.completePracticeBlock(programId, targetSeconds, overrides)
    const block2 = await demo.completePracticeBlock(programId, targetSeconds, overrides)
    sessionIds.push(block1.sessionId, block2.sessionId)
  }
  return sessionIds
}

/**
 * Ends and finalizes a session that was already started through the REAL UI
 * (its id read from the `/focus/:id` URL) — `demo.completePracticeBlock`
 * cannot be reused here since it always starts a fresh session of its own
 * via the raw API; this finalizes the exact session the UI already created.
 * Mirrors `completePracticeBlock`'s own end-then-finalize sequence
 * (`e2e/support/demo.ts`), except time is moved with `advance` (`clock.ts`)
 * — the page's own fake timers and the server's demo clock together, in
 * lockstep — rather than poking `demo.setClock` alone, since the caller's
 * Focus screen is still live and mounted; the finalize call itself reaches
 * the server via `page.request` against the `acceptance` project's single
 * origin (D37), since `DemoClient`'s own `APIRequestContext` is private to
 * that class.
 */
async function endAndFinalize(
  page: Page,
  demo: DemoClient,
  sessionId: string,
  targetSeconds: number,
  review: ReviewInputValue = { outputQuality: 'yes', episodeCount: 0, countMethod: 'event' },
): Promise<void> {
  const session = await demo.session(sessionId)
  await advance(page, demo, targetSeconds + 5)

  const transitionBody: TransitionBodyValue = { type: 'end', expectedVersion: session.version }
  const endResponse = await page.request.post(`/api/v1/sessions/${sessionId}/transitions`, { data: transitionBody })
  if (!endResponse.ok()) {
    const bodyText = await endResponse.text().catch(() => '<unreadable body>')
    throw new Error(`POST /sessions/${sessionId}/transitions -> ${endResponse.status()}: ${bodyText}`)
  }

  const finalizeBody: FinalizeBodyValue = { expectedEventCount: 0, review }
  const finalizeResponse = await page.request.post(`/api/v1/sessions/${sessionId}/finalize`, {
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    data: finalizeBody,
  })
  if (!finalizeResponse.ok()) {
    const bodyText = await finalizeResponse.text().catch(() => '<unreadable body>')
    throw new Error(`POST /sessions/${sessionId}/finalize -> ${finalizeResponse.status()}: ${bodyText}`)
  }
}

/** `demo.current()`'s program/revision, narrowed — every test needs both. */
async function currentProgramAndTarget(
  demo: DemoClient,
): Promise<{ programId: string; targetSeconds: number; revisionId: string; revisionNumber: number }> {
  const current = await demo.current()
  if (current.program === null || current.revision === null) {
    throw new Error('progression.spec.ts: working-day did not load a program with a governing revision')
  }
  return {
    programId: current.program.id,
    targetSeconds: current.revision.settings.practiceTargetSeconds,
    revisionId: current.revision.id,
    revisionNumber: current.revision.revision,
  }
}

test.beforeEach(async ({ demo }) => {
  await demo.reset()
  await demo.load('working-day')
})

// ---------------------------------------------------------------------------
// (1) Two qualifying days, but the ceiling for THIS band is already met.
// ---------------------------------------------------------------------------

test('Days 5 and 6 qualify but Day 7 Today shows no suggestion because the Days 4-7 ceiling is 15', async ({
  page,
  demo,
}) => {
  const { programId, targetSeconds } = await currentProgramAndTarget(demo)
  expect(targetSeconds).toBe(900) // working-day's revision 2 — already at the Days 4-7 ceiling.

  const sessionIds = await qualify(demo, programId, targetSeconds, [5, 6])
  for (const sessionId of sessionIds) {
    const session = await demo.session(sessionId)
    expect(session.lifecycle).toBe('finalized')
    expect(session.completeInterval).toBe(true)
    expect(session.review.outputQuality).toBe('yes')
    expect(session.review.episodeCount).toBe(0)
  }

  await demo.setDay(7)

  const today = await demo.today(programId)
  expect(today.suggestion).toBeUndefined()

  await page.goto('/today')
  await expect(page.getByTestId('suggestion-banner')).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// (2) Same pair, evaluated on Day 8 (a new, higher band) after a Day 7 with
// no sessions at all — the missed day holds the pair rather than resetting
// it, and Today stays neutral.
// ---------------------------------------------------------------------------

test('Day 8 after a Day 7 with no sessions: Today offers +5 minutes and shows block 1 as the next action with neutral copy and no streak or lost-progress wording', async ({
  page,
  demo,
}) => {
  const { programId, targetSeconds } = await currentProgramAndTarget(demo)

  await qualify(demo, programId, targetSeconds, [5, 6])
  // Day 7: deliberately no `setDay(7)` visit and no sessions of any kind —
  // the qualifying pair (5, 6) must survive the gap untouched.
  await demo.setDay(8)

  const today = await demo.today(programId)
  expect(today.suggestion).toBeDefined()
  expect(today.suggestion?.suggestedTargetSeconds).toBe(targetSeconds + PROGRESSION_STEP_SECONDS)
  expect(today.nextAction).toEqual({ kind: 'practice', block: 1 })

  await page.goto('/today')

  const banner = page.getByTestId('suggestion-banner')
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('Ready for +5 minutes? (to 20 min)')
  await expect(page.getByRole('button', { name: 'Block 1 is next', exact: true })).toBeVisible()

  await expectNoPunitiveCopy(page)
  const bodyText = await page.locator('body').innerText()
  expect(bodyText).not.toMatch(/lost progress|broken streak|missed day/i)
})

// ---------------------------------------------------------------------------
// (3) Hold: the next session starts at the unmodified current target, no
// revision is created, and the suggestion is offered again once that
// session is finalized.
// ---------------------------------------------------------------------------

test('Hold: the session starts at 900 s (demo.active().targetSeconds 900) with no new revision, and after that session is finalized the suggestion is offered again', async ({
  page,
  demo,
}) => {
  // Installed before the first `page.goto` (clock.ts's own documented
  // requirement) since this test starts a real session and later needs
  // `advance` to reach its target while the Focus screen is live.
  await installClock(page)

  const { programId, targetSeconds, revisionId, revisionNumber } = await currentProgramAndTarget(demo)
  expect(targetSeconds).toBe(900)

  await qualify(demo, programId, targetSeconds, [5, 6])
  await demo.setDay(8)

  await page.goto('/today')
  await expect(page.getByTestId('suggestion-banner')).toBeVisible()

  // "Hold the target" (specs/practice-sessions): choosing Hold makes no
  // request of its own (`SuggestionBanner.tsx`'s own doc comment) — it only
  // hides the banner locally for the rest of this visit.
  await page.getByRole('button', { name: 'Hold', exact: true }).click()
  await expect(page.getByTestId('suggestion-banner')).toHaveCount(0)

  await page.getByLabel('What will you produce?').fill('Verify Hold starts the block at the current target')
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await page.waitForURL(/\/focus\/[0-9a-f-]{36}$/i)
  const sessionId = page.url().split('/focus/')[1]
  if (sessionId === undefined) {
    throw new Error(`Could not read a session id from ${page.url()}`)
  }

  const active = await demo.active()
  expect(active?.id).toBe(sessionId)
  expect(active?.targetSeconds).toBe(targetSeconds)
  expect(active?.revisionId).toBe(revisionId)

  await endAndFinalize(page, demo, sessionId, targetSeconds)

  const afterFinalize = await demo.current()
  expect(afterFinalize.revision?.id).toBe(revisionId)
  expect(afterFinalize.revision?.revision).toBe(revisionNumber)

  // Recomputed fresh from stored rows on every call (`deriveSuggestion`'s
  // own doc comment: "No hold state is stored anywhere by this module") —
  // checked via the API rather than a same-tab reload, because Hold's
  // `sessionStorage` flag is keyed by (programId, day) and would still read
  // back true for the REST of this same-day visit, making a UI re-check
  // indistinguishable from a real regression. A fresh visit (a new tab, or
  // the next day) is what "the suggestion remains available next time"
  // actually promises.
  const todayAfter = await demo.today(programId)
  expect(todayAfter.suggestion).toBeDefined()
  expect(todayAfter.suggestion?.suggestedTargetSeconds).toBe(targetSeconds + PROGRESSION_STEP_SECONDS)
})

// ---------------------------------------------------------------------------
// (4) Partly breaks qualification for the whole day, which breaks the pair.
// ---------------------------------------------------------------------------

test('Partly breaks qualification: with Day 6 block 2 saved as Partly, Day 8 Today shows no suggestion', async ({
  page,
  demo,
}) => {
  const { programId, targetSeconds } = await currentProgramAndTarget(demo)

  await qualify(demo, programId, targetSeconds, [5])

  await demo.setDay(6)
  await demo.completePracticeBlock(programId, targetSeconds, { outputQuality: 'yes' })
  const partlyBlock = await demo.completePracticeBlock(programId, targetSeconds, { outputQuality: 'partly' })
  expect((await demo.session(partlyBlock.sessionId)).review.outputQuality).toBe('partly')

  await demo.setDay(8)

  const today = await demo.today(programId)
  expect(today.suggestion).toBeUndefined()

  await page.goto('/today')
  await expect(page.getByTestId('suggestion-banner')).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// (5) Two episodes in one block breaks qualification the same way.
// ---------------------------------------------------------------------------

test('two episodes in one block break qualification: with Day 6 block 1 at episodeCount 2, Day 8 Today shows no suggestion', async ({
  page,
  demo,
}) => {
  const { programId, targetSeconds } = await currentProgramAndTarget(demo)

  await qualify(demo, programId, targetSeconds, [5])

  await demo.setDay(6)
  const twoEpisodeBlock = await demo.completePracticeBlock(programId, targetSeconds, { episodeCount: 2 })
  expect((await demo.session(twoEpisodeBlock.sessionId)).review.episodeCount).toBe(2)
  await demo.completePracticeBlock(programId, targetSeconds, { outputQuality: 'yes', episodeCount: 0 })

  await demo.setDay(8)

  const today = await demo.today(programId)
  expect(today.suggestion).toBeUndefined()

  await page.goto('/today')
  await expect(page.getByTestId('suggestion-banner')).toHaveCount(0)
})
