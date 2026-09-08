/**
 * Task 9.2.1 — Invariant: hidden tab never creates an episode (server truth).
 *
 * CLAUDE.md's own invariant: "App visibility is not attention. Reading in
 * another tab or working in an IDE is expected behavior. A hidden tab never
 * creates an off-task episode." (design.md D15). Four cases, each proving a
 * different corner of that rule against the real `acceptance` project
 * (D37's single-origin build-and-serve topology):
 *
 *  1. A benchmark hidden for a real 15-minute stretch creates zero events —
 *     the countdown, once shown again, still derives purely from server-
 *     truth fields (D5), never from anything the client accumulated while
 *     hidden.
 *  2. A practice block hidden/shown three times with no click creates no
 *     event of ANY kind — not even under the default (opt-out) preference.
 *  3. With `preferences.visibilityContext` opted in (D39), hide/show DOES
 *     record an opt-in `visibility` event through the normal outbox path —
 *     but that event is excluded from every tally (D11/D39) and the
 *     self-reported "switch" count on the practice review stays BLANK, not
 *     0 (D31/CLAUDE.md's "unknown != zero" — a tally of 0 leaves its count
 *     field unprefilled).
 *  4. Hide/show alone never triggers a `GET /sessions/active` refetch while
 *     a session is active — `lib/query/client.ts`'s `refetchOnWindowFocus:
 *     () => !modeRef.isActive()` policy (D15) turns off window-focus
 *     refetching for exactly as long as a session owns the screen.
 *
 * Spec refs: benchmark-assessment "Fixed interval with no valid pause / Tab
 * hidden during benchmark"; practice-sessions "Interruption events with undo
 * and subtypes / Hidden page creates nothing"; benchmark-assessment
 * "Interruption recording during the benchmark"; benchmark-assessment
 * "Counts are confirmed at review and blank means unknown / Blank count".
 *
 * Reconciliation note (see this task's own `notes` in the workflow report):
 * tasks-detail.md's prose for case (1) lists `advance(300)` BEFORE
 * `hideTab`, in addition to the `advance(900)` taken while hidden — but
 * 300 + 900 = 1200 = a benchmark's whole fixed target (D30), which would
 * leave the countdown at 00:00 (deadline reached), not the "05:00 +/-1 s"
 * the same sentence asserts. There is no reading of `advance()`'s documented
 * ABSOLUTE-delta contract (`clock.ts`) under which both the literal call
 * sequence and the literal outcome hold at once. This test keeps the
 * outcome ("05:00 +/-1 s", stated with an explicit tolerance) and the
 * "hidden for 15 minutes" framing (`advance(900)` taken entirely while
 * hidden, immediately after Start) — i.e. it drops the extra pre-hide
 * `advance(300)`, which is otherwise unreachable without breaking one of
 * the other two. This exact shape (hide immediately after Start, advance
 * 15 real minutes hidden, show) is also what the already-passing
 * `e2e/benchmark-running.spec.ts` (task 8.3.4) proves against the
 * dev-server-pair project, so this is not a new, unproven code path.
 *
 * `demo.reset()` never touches `user_profiles.preferences`
 * (`deletePrincipalData`'s own doc comment: "the profile row... survives a
 * reset"), so `setVisibilityContext` is called defensively in
 * `beforeEach` (every case starts from the documented default, `false`) and
 * explicitly restored to `false` at the end of case 3 — the one case that
 * opts in — so no later spec file sharing this principal inherits it set.
 */
import type { PatchPreferencesBodyValue, SessionResponseValue } from '@attention-lab/shared'
import type { Page } from '@playwright/test'

import { advance, hideTab, installClock, showTab } from '../support/clock.js'
import { expect, test } from '../support/demo.js'

// ---------------------------------------------------------------------------
// Local helpers (this file may not import from another `.spec.ts` file —
// Playwright's own full-suite discovery rejects that — so the mm:ss parser
// `e2e/benchmark-running.spec.ts` already proved is duplicated here rather
// than imported).
// ---------------------------------------------------------------------------

/** Parses `TimerDisplay`'s `mm:ss` text (`lib/clock/remaining.ts`'s `formatRemaining`) into whole seconds. */
function parseRemainingSeconds(text: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(text.trim())
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new Error(`Could not parse mm:ss from "${text}"`)
  }
  return Number(match[1]) * 60 + Number(match[2])
}

async function readRemainingSeconds(page: Page): Promise<number> {
  const text = await page.getByTestId('timer-digits').innerText()
  return parseRemainingSeconds(text)
}

/**
 * `PATCH /me/preferences` via `page.request` (relative to the `acceptance`
 * project's own `baseURL`, D37) rather than through `demo.ts` — `DemoClient`
 * exposes no generic preferences call (only what 9.1.1's own brief named),
 * and this task's brief calls this exact endpoint out by name. Used instead
 * of driving Settings' own "Record tab-visibility context" switch (8.9.2) so
 * this invariant test is not coupled to a second screen's own form/save
 * mechanics that are not what this task is about.
 */
async function setVisibilityContext(page: Page, visibilityContext: boolean): Promise<void> {
  const body: PatchPreferencesBodyValue = { visibilityContext }
  const response = await page.request.patch('/api/v1/me/preferences', { data: body })
  if (!response.ok()) {
    const bodyText = await response.text().catch(() => '<unreadable body>')
    throw new Error(`PATCH /me/preferences -> ${response.status()}: ${bodyText}`)
  }
}

/**
 * Starts working-day's remaining block (block 2 — block 1 is already
 * qualified) via the real Today form and resolves once Focus has fully
 * mounted — not merely once the URL has changed. `hideTab`/`showTab`
 * dispatch a real `visibilitychange` event the moment they are called; a
 * caller that fires one right after `page.waitForURL` alone (before
 * `useSessionEvents.ts`'s own opt-in listener effect has had a chance to run)
 * can race it, so the visibility-opt-in case (test 3, the one case where a
 * `visibility` event is REQUIRED to appear) needs `timer-digits` visible
 * first, the same explicit readiness signal test 1's own benchmark flow
 * already waits for before its own `hideTab`.
 */
async function startWorkingDayBlock(page: Page): Promise<string> {
  await page.goto('/today')
  await page.getByLabel('What will you produce?').fill('Verify D15: a hidden tab creates nothing')
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await page.waitForURL(/\/focus\/[0-9a-f-]{36}$/i)
  const sessionId = page.url().split('/focus/')[1]
  if (sessionId === undefined) {
    throw new Error(`Could not read a session id from ${page.url()}`)
  }
  await expect(page.getByTestId('timer-digits')).toBeVisible()
  return sessionId
}

const EMPTY_TALLIES = { offTask: 0, external: 0, agentChecks: 0 }

test.beforeEach(async ({ page, demo }) => {
  await demo.reset()
  // Defensive baseline (see module doc comment): `demo.reset()` never clears
  // this preference, so a prior spec file's own opt-in could otherwise leak
  // into this file's own default-preference cases.
  await setVisibilityContext(page, false)
})

// ---------------------------------------------------------------------------
// (1) Benchmark hidden for 15 minutes
// ---------------------------------------------------------------------------

test('benchmark hidden for 15 minutes: zero events server-side, tallies 0, remaining 05:00 +/-1 s when shown', async ({
  page,
  demo,
}) => {
  // Must install before the first page.goto (clock.ts's own documented requirement).
  await installClock(page)

  const { slots } = await demo.readyProgram()
  const baselineA = slots.find((slot) => slot.phase === 'baseline' && slot.label === 'A')
  if (baselineA === undefined) {
    throw new Error('readyProgram() did not seed a baseline A slot')
  }

  await page.goto('/today')
  await page.getByRole('link', { name: 'Start with your baseline' }).click()
  await page.waitForURL(new RegExp(`/benchmark/${baselineA.id}$`))
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(page.getByTestId('timer-digits')).toBeVisible()

  const active = await demo.active()
  if (active === null) {
    throw new Error('No active session after starting baseline A')
  }
  const sessionId = active.id

  // --- hidden for the entire 15-minute stretch (D15) ----------------------
  await hideTab(page)
  await advance(page, demo, 15 * 60)
  await showTab(page)

  // Remaining derives purely from server-truth fields (D5): the 20-minute
  // fixed target (D30) minus 15 elapsed minutes = 5:00, regardless of the
  // tab having been hidden for that whole stretch.
  await expect.poll(async () => Math.abs((await readRemainingSeconds(page)) - 5 * 60)).toBeLessThanOrEqual(1)

  // On-screen tallies (Running.tsx passes no `agentChecks` — a benchmark has
  // no agent-check control at all).
  await expect(page.locator('dt:text-is("Off-task") + dd')).toHaveText('0')
  await expect(page.locator('dt:text-is("External interruptions") + dd')).toHaveText('0')

  // Server truth: no event of any kind exists — nothing was ever clicked,
  // and the default `preferences.visibilityContext` (false) means no
  // `visibility` event either.
  const session = await demo.session(sessionId)
  expect(session.events).toHaveLength(0)
  expect(session.tallies).toEqual(EMPTY_TALLIES)
})

// ---------------------------------------------------------------------------
// (2) Practice hidden/shown three times, no user action
// ---------------------------------------------------------------------------

test('practice hidden and shown three times with no user action creates no event of any kind', async ({ page, demo }) => {
  await installClock(page)
  await demo.load('working-day')

  const sessionId = await startWorkingDayBlock(page)

  for (let cycle = 0; cycle < 3; cycle += 1) {
    await hideTab(page)
    await showTab(page)
  }

  await expect(page.locator('dt:text-is("Off-task") + dd')).toHaveText('0')
  await expect(page.locator('dt:text-is("External interruptions") + dd')).toHaveText('0')
  await expect(page.locator('dt:text-is("Agent checks") + dd')).toHaveText('0')

  const session = await demo.session(sessionId)
  expect(session.events).toHaveLength(0)
  expect(session.tallies).toEqual(EMPTY_TALLIES)
})

// ---------------------------------------------------------------------------
// (3) Visibility opt-in: a `visibility` event exists, tallies stay 0, and
// the review's self-reported switch count stays blank (D31/D39).
// ---------------------------------------------------------------------------

test('visibility opt-in on: a visibility event exists, all tallies stay 0, and the review S field is blank, not 0', async ({
  page,
  demo,
}) => {
  await installClock(page)
  await setVisibilityContext(page, true)
  await demo.load('working-day')

  const sessionId = await startWorkingDayBlock(page)

  await hideTab(page)
  await showTab(page)

  await page.getByRole('button', { name: 'Finish early', exact: true }).click()
  await page.getByRole('button', { name: 'Finish now', exact: true }).click()
  await page.waitForURL(new RegExp(`/review/${sessionId}$`))

  // Every recorded-tally figure on the review screen reads 0 — the
  // `visibility` event is excluded from every tally (D11/D39).
  const tallies = page.getByTestId('recorded-tallies')
  await expect(tallies.locator('dt:text-is("Off-task, recorded") + dd')).toHaveText('0')
  await expect(tallies.locator('dt:text-is("External, recorded") + dd')).toHaveText('0')
  await expect(tallies.locator('dt:text-is("Agent checks, recorded") + dd')).toHaveText('0')

  // D31: a 0 tally leaves the count field BLANK, never prefilled with 0 —
  // CLAUDE.md's "unknown != zero" for the self-reported switch ("S") count.
  await expect(page.getByLabel('How many times did you switch away?')).toHaveValue('')

  // Server truth: a `visibility` event exists (best-effort flushed the
  // moment it was recorded, `useSessionEvents.ts`'s `recordEvent`, and
  // flushed again on this screen's own mount — `PracticeReview.tsx`'s
  // `flush(sessionId, api)` effect — so this may already be true by the
  // time the review has rendered; polled for safety against that race).
  await expect
    .poll(async () => (await demo.session(sessionId)).events.some((event: SessionResponseValue['events'][number]) => event.type === 'visibility'))
    .toBe(true)

  const session = await demo.session(sessionId)
  expect(session.tallies).toEqual(EMPTY_TALLIES)

  // Restore the default so no later spec file sharing this principal
  // inherits the opt-in (see module doc comment; `demo.reset()` never
  // clears this preference on its own).
  await setVisibilityContext(page, false)
})

// ---------------------------------------------------------------------------
// (4) Hide/show triggers no `GET /sessions/active` refetch while a session
// is active (D15's `refetchOnWindowFocus: () => !modeRef.isActive()`).
// ---------------------------------------------------------------------------

test('returning to the tab triggers no refetch: zero GET /sessions/active requests during hide/show', async ({
  page,
  demo,
}) => {
  await installClock(page)
  await demo.load('working-day')

  await startWorkingDayBlock(page)
  await expect(page.getByTestId('timer-digits')).toBeVisible()

  let activeSessionRequestCount = 0
  const onRequest = (request: { url(): string }): void => {
    if (request.url().includes('/sessions/active')) {
      activeSessionRequestCount += 1
    }
  }
  page.on('request', onRequest)

  for (let cycle = 0; cycle < 3; cycle += 1) {
    await hideTab(page)
    await showTab(page)
  }
  // A real (non-fake-clock) wait: gives any refetch this test expects NOT to
  // happen a real chance to actually fire and be observed by the listener
  // above before the assertion below runs.
  await page.waitForTimeout(500)

  page.off('request', onRequest)
  expect(activeSessionRequestCount).toBe(0)
})
