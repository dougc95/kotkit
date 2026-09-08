/**
 * Task 8.4.6 (design.md D18, D19, D20, D24, D25, D31; benchmark-assessment:
 * "Self-scoring is unavailable until recall is locked" — "Attempt to score
 * before recall", "Incomplete attempt finalized without recall";
 * "Disruption is a required self-attestation" — "Attestation unanswered";
 * "Fixed interval with no valid pause" — "Interval reached", "Stop early";
 * "Recall is a separate, timed, then locked step" — "Recall started
 * promptly"; "First-switch time has three distinct states" — "No switches";
 * "Counts are confirmed at review and blank means unknown" — "Explicit
 * zero"; "Eligibility is derived server-side with explicit reasons" — "All
 * conditions met"). Drives the real `Running` (8.3.3) -> `Recall` (8.4.1) ->
 * `Scoring`/`BenchmarkReviewPage` (8.4.2-8.4.5) screens through TWO full
 * benchmark attempts on the SAME program (baseline A, then baseline B),
 * proving three invariants:
 *
 *  - Self-scoring is inert before recall is locked (D10, D25): visiting
 *    `/benchmark/:id/scoring` while `review.recallLockedAt` is still `null`
 *    on a COMPLETE interval renders zero native radio inputs and "Recall
 *    must be saved first" — never a scoring UI a user could interact with
 *    before recall exists to score.
 *  - Finalize is refused, both client- and server-side, without the
 *    required disruption attestation (D7.2): the UI's own Finalize button
 *    stays disabled and names the missing answer; a raw API finalize call
 *    that omits `materiallyDisrupted` gets a real 400 with
 *    `fieldErrors.materiallyDisrupted`, and the session's `review.finalizedAt`
 *    stays `null` until the real Finalize succeeds.
 *  - Stop early's "Skip recall" path (D25) never touches `POST
 *    /sessions/{id}/recall` at all, and the resulting attempt is finalized
 *    carrying `interval_incomplete`, `recall_missing` AND `scoring_incomplete`
 *    together, with no recall score anywhere in the summary.
 *
 * `startBaselineA` (8.3.4's own export, `benchmark-running.spec.ts`) gets
 * this test to "a running baseline A session, already started" without
 * re-typing that climb; baseline B is started the same way `startBaselineA`
 * itself does past `completeSetup` — a fresh `/today` load, the same "Start
 * with your baseline" link (D23's `nextAction` rule now points at the next
 * pending baseline slot once baseline A is finalized), then Ready's own
 * "Start" — never a second `completeSetup` call, which would 409
 * `program_exists` on the same program.
 *
 * `S = 0` (baseline A) is an explicit, reported zero — CLAUDE.md's "unknown
 * != zero" the other way around: `deriveFirstSwitch`/`formatFirstSwitch`
 * read a reported `0` as "no switch occurred" and render the capped state
 * "20+, capped", never "Unknown" (that word is reserved for an episode that
 * DID occur with an unrecorded time — a disjoint branch this attempt never
 * takes).
 */
import type { APIResponse } from '@playwright/test'
import type { FinalizeBodyValue } from '@attention-lab/shared'

import { expect, test } from './support/demo.js'
import { advance, installClock } from './support/clock.js'
import { startBaselineA } from './helpers/session.js'

test.beforeEach(async ({ demo }) => {
  await demo.reset()
})

test('scoring is inoperable before recall is saved, finalize is refused without a disruption answer, and Skip recall carries an incomplete attempt through with no recall score', async ({
  page,
  demo,
}) => {
  // Two full benchmark attempts end to end (start, recall, scoring,
  // finalize — twice) genuinely runs close to or past Playwright's default
  // 30s per-test timeout; this is real interaction time, not a hang.
  test.setTimeout(60_000)

  // Must install before startBaselineA's first page.goto (clock.ts's own
  // documented requirement).
  await installClock(page)

  const { sessionId } = await startBaselineA(page, demo)

  // ---------------------------------------------------------------------
  // Baseline A: run the fixed 20-minute interval out, confirm the deadline
  // via the real `end` transition (D24), and land on Recall.
  // ---------------------------------------------------------------------
  await advance(page, demo, 20 * 60)
  await expect(page.getByText('Close your reading material')).toBeVisible()

  const endTransitionRequest = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().includes(`/sessions/${sessionId}/transitions`),
  )
  await page.getByRole('button', { name: "I'm ready for recall" }).click()
  const endRequest = await endTransitionRequest
  expect(endRequest.postDataJSON()).toMatchObject({ type: 'end' })
  await page.waitForURL(`**/benchmark/${sessionId}/recall`)

  // ---------------------------------------------------------------------
  // Scoring is inoperable before recall is saved (D10, D25): a complete
  // interval whose recall has not been saved yet renders no scoring UI at
  // all. `input[type="radio"]` (a literal native element, never Radix's own
  // `role="radio"` trigger button) stays at zero everywhere on this page
  // regardless of section state — none of BenchmarkReviewPage's RadioGroups
  // sit inside a `<form>`, so Radix never mounts its form-bridge input — but
  // in this `locked_required` mode Scoring itself renders no RadioGroup at
  // all in the first place, which is what this assertion is really after.
  // ---------------------------------------------------------------------
  await page.goto(`/benchmark/${sessionId}/scoring`)
  await expect(page.getByText('Recall must be saved first')).toBeVisible()
  await expect(page.locator('input[type="radio"]')).toHaveCount(0)

  // ---------------------------------------------------------------------
  // Return to recall, confirm the material is closed, save three of five
  // points.
  // ---------------------------------------------------------------------
  await page.goto(`/benchmark/${sessionId}/recall`)
  await page.getByRole('button', { name: 'Start recall' }).click()
  await page.getByLabel('Point 1').fill('The introduction argued for a single thesis.')
  await page.getByLabel('Point 2').fill('Section two walked through a worked example.')
  await page.getByLabel('Point 3').fill('The conclusion named one open question.')
  await page.getByRole('button', { name: 'Save recall' }).click()
  await page.waitForURL(`**/benchmark/${sessionId}/scoring`)

  // Scoring now shows radios: three non-blank points, each with an
  // Accurate/Not-accurate pair. `exact: true` matters here — a default
  // substring, case-insensitive match on "Accurate" also matches "Not
  // accurate" (it contains "accurate"), which would silently double this
  // count to 6.
  await expect(page.getByRole('radio', { name: 'Accurate', exact: true })).toHaveCount(3)
  await page.locator('#point-0-accurate').click()
  await page.locator('#point-1-accurate').click()
  await page.locator('#point-2-accurate').click()

  // S = 0: an explicit, reported zero (never left blank, never coerced from
  // blank) — no off-task episode was ever recorded during the 20-minute
  // interval above.
  await page.getByLabel('Off-task episodes (S)').fill('0')

  await page.getByLabel('These conditions are correct').check()

  // Disruption is left unanswered on purpose.
  await expect(page.getByRole('button', { name: 'Finalize' })).toBeDisabled()
  await expect(page.getByText('Answer whether the session was materially disrupted')).toBeVisible()

  // ---------------------------------------------------------------------
  // A raw finalize call missing the required disruption attestation is
  // refused server-side too (D7.2) — recall is already locked (the Save
  // above), so `assertBenchmarkReviewInput` reaches the disruption check
  // and rejects before touching `expectedEventCount` at all.
  // ---------------------------------------------------------------------
  const malformedBody: FinalizeBodyValue = { expectedEventCount: 0, review: {} }
  const malformedResponse: APIResponse = await page.request.post(`/api/v1/sessions/${sessionId}/finalize`, {
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    data: malformedBody,
  })
  expect([400, 422]).toContain(malformedResponse.status())
  const malformedJson = (await malformedResponse.json()) as { fieldErrors?: Record<string, string> }
  expect(malformedJson.fieldErrors?.materiallyDisrupted).toBeTruthy()

  const beforeFinalize = await demo.session(sessionId)
  expect(beforeFinalize.review.finalizedAt).toBeNull()

  // ---------------------------------------------------------------------
  // Answer No, Finalize for real.
  // ---------------------------------------------------------------------
  await page.locator('#materially-disrupted-no').click()
  await page.getByRole('button', { name: 'Finalize' }).click()

  const summaryA = page.getByTestId('eligibility-summary')
  await expect(summaryA).toBeVisible()
  await expect(summaryA.getByText('Eligible', { exact: true })).toBeVisible()
  await expect(summaryA.locator('dt:text-is("First switch:") + dd')).toHaveText('20+, capped')

  const bodyText = await page.locator('body').innerText()
  expect(bodyText).not.toContain('%')

  const sessionAAfter = await demo.session(sessionId)
  expect(sessionAAfter.review.recallScore).toBe(3)
  expect(sessionAAfter.review.episodeCount).toBe(0)
  expect(sessionAAfter.review.materiallyDisrupted).toBe(false)
  expect(sessionAAfter.eligible).toBe(true)

  // ---------------------------------------------------------------------
  // Second attempt (baseline B), startBaselineA-style: a second
  // `completeSetup` climb would 409 `program_exists` on the same program,
  // so this mirrors `startBaselineA`'s OWN remaining steps directly — a
  // fresh `/today` load (deriveNextAction, D23, now points at the next
  // pending baseline slot once baseline A's finalize is visible), the same
  // "Start with your baseline" link (`NextAction.tsx` renders that exact
  // label for ANY pending `benchmark` nextAction, not just slot A), then
  // Ready's own "Start". A full `page.goto` (rather than EligibilitySummary's
  // own in-page "Continue", which reuses the app's single long-lived
  // `QueryClient`) is deliberate: `useFinalizeSession`'s success path never
  // invalidates `['sessions','active']` (neither does `Recall`'s save), so
  // that cache entry can still hold baseline A's own pre-finalize
  // `awaiting_review` snapshot for up to its 30s `staleTime` — long enough,
  // under this test's own accelerated demo clock (which does not advance
  // real `Date.now()` between explicit `advance()` calls, so 30s of
  // wall-clock staleness is never crossed on its own), to make `Ready` show
  // baseline A's OWN stale `ActiveSessionCard` instead of slot B's Start
  // control if reached via `Continue`'s client-side navigation. A full
  // reload discards that in-memory cache entirely, so `Ready` fetches its
  // three queries fresh and correctly finds no active session.
  // ---------------------------------------------------------------------
  await page.goto('/today')
  await page.getByRole('link', { name: 'Start with your baseline' }).click()
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Record off-task episode' })).toBeVisible()

  const activeB = await demo.active()
  if (activeB === null) {
    throw new Error('benchmark-review: GET /sessions/active returned null after starting baseline B')
  }
  const sessionIdB = activeB.id

  // No POST to /sessions/{id}/recall is ever made for this attempt — Skip
  // recall (below) goes straight to scoring.
  const recallPostUrls: string[] = []
  const trackRecallPost = (request: { method(): string; url(): string }): void => {
    if (request.method() === 'POST' && request.url().includes(`/sessions/${sessionIdB}/recall`)) {
      recallPostUrls.push(request.url())
    }
  }
  page.on('request', trackRecallPost)

  await advance(page, demo, 8 * 60)
  await page.getByRole('button', { name: 'Stop early', exact: true }).click()
  await page.getByRole('button', { name: 'Stop early', exact: true }).click()
  await page.waitForURL(`**/benchmark/${sessionIdB}/recall`)

  await expect(page.getByText('Incomplete attempt')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Skip recall' })).toBeVisible()
  await page.getByRole('button', { name: 'Skip recall' }).click()
  await page.waitForURL(`**/benchmark/${sessionIdB}/scoring`)

  await expect(
    page.getByText('Recall not saved — this attempt will be recorded with recall missing'),
  ).toBeVisible()

  await page.locator('#materially-disrupted-no').click()
  await page.getByLabel('These conditions are correct').check()
  await page.getByRole('button', { name: 'Finalize' }).click()

  const summaryB = page.getByTestId('eligibility-summary')
  await expect(summaryB).toBeVisible()
  await expect(summaryB.getByText('Not eligible', { exact: true })).toBeVisible()
  await expect(summaryB.getByText('The full 20-minute interval was not completed.')).toBeVisible()
  await expect(summaryB.getByText('The recall step was not saved.')).toBeVisible()
  await expect(summaryB.getByText('Self-scoring was not finished.')).toBeVisible()
  await expect(summaryB.locator('dt:text-is("Recall score:") + dd')).toHaveText('Not reported')

  page.off('request', trackRecallPost)
  expect(recallPostUrls).toEqual([])

  const sessionBAfter = await demo.session(sessionIdB)
  expect(sessionBAfter.review.recallScore).toBeNull()
  expect(sessionBAfter.eligible).toBe(false)
  expect(sessionBAfter.exclusionReasons).toEqual(
    expect.arrayContaining(['interval_incomplete', 'recall_missing', 'scoring_incomplete']),
  )
})
