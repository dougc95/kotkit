/**
 * Task 8.3.4 (design.md D5, D9, D11, D15, D24; benchmark-assessment: "Fixed
 * interval with no valid pause" / "Tab hidden during benchmark", "Interruption
 * recording during the benchmark" / "Undo accidental duplicate" and "Record
 * after returning"). Drives the real `Ready` (8.3.1) -> `Running` (8.3.3)
 * screens through a full baseline A benchmark start against the dev-server
 * pair, then proves two invariants CLAUDE.md and D15/D11 exist to protect:
 *
 *  - "App visibility is not attention" (D15): hiding the tab for 15 real
 *    (fake-clock) minutes creates NOTHING server-side — no `visibility`
 *    event (the default demo profile's `preferences.visibilityContext` is
 *    `false`, `apps/api/src/preferences.ts`'s `DEFAULT_PREFERENCES`, so
 *    `useSessionEvents` never even attaches a `visibilitychange` listener)
 *    and, since nothing was ever clicked, no `off_task` episode either — the
 *    remaining countdown still derives purely from server-truth fields (D5)
 *    and reads 5:00 once the tab is shown again, exactly as if it had never
 *    been hidden.
 *  - Undo removes a genuine duplicate (D9): two "Record off-task episode"
 *    clicks in quick succession followed by one Undo leaves exactly one
 *    non-voided `off_task` event server-side and a tally of 1 — both
 *    on-screen and in `GET /sessions/{id}`.
 *
 * Also asserts Running's own DOM (scoped to `main#main`, the region
 * `SessionLayout` — 7.1.4 — wraps every session route's content in) offers
 * no Pause control (benchmarks have no pause, D24/8.3.3's own brief) and no
 * Abandon control of its own: Abandon is `AbandonSession` (8.10.7), mounted
 * once by `SessionLayout` as a sibling of `<main>`, not inside it — scoping
 * to `main#main` is what lets this assertion tell "Running renders no
 * Abandon" apart from "the page as a whole has no Abandon control at all"
 * (the latter would be false: `SessionLayout` mounts one for every
 * running/paused/awaiting_review session, this one included).
 *
 * `startBaselineA` ("setup + start": `completeSetup` (8.1.4) through the real
 * `PlanForm`/`ReadinessForm` screens, then Today's "Start with your
 * baseline" link and Ready's "Start" button, resolving once `Running` has
 * actually mounted) lives in `helpers/session.ts`, not this file — a
 * `.spec.ts` file may not import another `.spec.ts` file (Playwright's own
 * full-suite discovery rejects it), and 8.4.6/8.5.6/8.9.4/8.10.8 all need to
 * import it.
 */
import type { Page } from '@playwright/test'

import { expect, test } from './support/demo.js'
import { advance, hideTab, installClock, showTab } from './support/clock.js'
import { startBaselineA } from './helpers/session.js'

// ---------------------------------------------------------------------------
// Helpers local to this spec.
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

test.beforeEach(async ({ demo }) => {
  await demo.reset()
})

test('hidden tab creates no episode and Undo removes a duplicate', async ({ page, demo }) => {
  // Must install before completeSetup's first page.goto (clock.ts's own
  // documented requirement) — startBaselineA does that navigation itself.
  await installClock(page)

  const { sessionId } = await startBaselineA(page, demo)

  // Running itself (scoped to SessionLayout's `<main id="main">`, which
  // excludes AbandonSession — a sibling of `<main>`, not a child) offers no
  // Pause control (benchmarks never pause, D24) and no Abandon control of
  // its own (Abandon lives in SessionLayout, 8.10.7).
  const main = page.locator('main#main')
  await expect(main.getByRole('button', { name: /pause/i })).toHaveCount(0)
  await expect(main.getByRole('button', { name: /abandon/i })).toHaveCount(0)

  // --- Tab hidden during benchmark: no episode is ever created (D15) -----
  await hideTab(page)
  await advance(page, demo, 15 * 60)
  await showTab(page)

  // Remaining still derives purely from server-truth fields (D5): 20 min
  // target minus 15 min elapsed = 5:00, regardless of the tab having been
  // hidden for that whole stretch.
  await expect
    .poll(async () => Math.abs((await readRemainingSeconds(page)) - 5 * 60))
    .toBeLessThanOrEqual(2)

  const afterHidden = await demo.session(sessionId)
  expect(afterHidden.events).toHaveLength(0)

  // --- Undo removes a duplicate (D9) --------------------------------------
  const recordOffTask = page.getByRole('button', { name: 'Record off-task episode' })
  await recordOffTask.click()
  await recordOffTask.click()
  await page.getByRole('button', { name: 'Undo' }).click()

  // On-screen tally updates optimistically, synchronously with the Undo
  // click's dispatch (useSessionEvents.ts's `undo()` dispatches `voided`
  // before awaiting the void request) — no poll needed here.
  await expect(page.locator('dt:text-is("Off-task") + dd')).toHaveText('1')

  // Server-side: exactly one non-voided off_task event and a tally of 1.
  // Polled — the second click's void request (D9: a sent event is voided
  // via POST .../void, never deleted) is fire-and-forget from the button
  // click's perspective.
  await expect
    .poll(async () => (await demo.session(sessionId)).tallies.offTask)
    .toBe(1)

  const afterUndo = await demo.session(sessionId)
  const nonVoidedOffTask = afterUndo.events.filter(
    (event) => event.type === 'off_task' && event.voidedAt === null,
  )
  expect(nonVoidedOffTask).toHaveLength(1)
})
