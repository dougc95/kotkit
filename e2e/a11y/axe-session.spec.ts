/**
 * Task 9.3.2 (design.md's non-functional table: "WCAG 2.2 AA on core flow";
 * specs/app-shell: "Accessibility baseline"; specs/identity-realm: "Demo
 * mode is permanently and unmistakably labeled" / "Banner on every screen";
 * specs/benchmark-assessment: "Benchmarks are visually distinct from
 * practice" / "Benchmark ready screen"; specs/app-shell: "One dominant
 * action per screen" / "Focus screen actions"). Runs axe (`a11y.ts`'s
 * `expectNoSeriousViolations`, WCAG 2.0 A/AA + 2.1 AA + 2.2 AA, failing only
 * on a `serious`/`critical` finding — a `moderate`/`minor` finding is still
 * attached to the report, never failing the spec) against every real
 * session-mode screen this app has: Benchmark ready/running (timer visible
 * and hidden), Recall, the combined Scoring/Review page, Focus (agent panel
 * closed/open, the clock-gap prompt open), and Practice review. A tenth test
 * proves the demonstration-data banner (`SessionLayout.tsx` mounts
 * `<DemoBanner/>` for every one of those routes) stays fully in the
 * viewport, unscrolled, on each of the six distinct ROUTES the nine screen
 * tests above visit (the timer-hidden/agent-panel-open/clock-gap variants
 * share a route with an earlier test, so are not revisited a second time —
 * the banner's own position never depends on that in-page toggle state).
 *
 * Ten tests total (this task's own brief), each independently reaching its
 * screen from `demo.reset()` (`test.beforeEach` below) through the real
 * screens — no shortcut through a raw API call for the navigation itself,
 * since an axe check is only meaningful against what an actual click-through
 * renders. The local helpers below each build on the one before it, the same
 * incremental-screen shape `e2e/support/benchmark.ts`'s own `runBenchmark`
 * (task 9.1.4) documents for the identical Ready -> Running -> Recall ->
 * Scoring climb — not reused directly here because that helper drives all
 * the way to Finalize in one call, with no stop in between for an axe check
 * at Recall or at Scoring the moment recall is saved (this task's own named
 * stops). Kept local per `new-user.spec.ts`'s own precedent (D16: the shared
 * `e2e/support/*` modules are owned by 9.1.1/9.1.2/9.1.4, not grown by every
 * journey spec that touches the same screens).
 */
import type { Page } from '@playwright/test'
import type { SlotResponseValue } from '@attention-lab/shared'

import { expect, test, type DemoClient } from '../support/demo.js'
import { advance, installClock, sleep } from '../support/clock.js'
import { expectDemoBanner } from '../support/copy.js'
import { expectNoSeriousViolations } from '../support/a11y.js'

/** D30: the server always stores 1200 s for a benchmark's fixed interval — never a client-chosen value. */
const BENCHMARK_TARGET_SECONDS = 1200

test.beforeEach(async ({ demo }) => {
  await demo.reset()
})

// ---------------------------------------------------------------------------
// Screen-reaching helpers
// ---------------------------------------------------------------------------

function findSlot(slots: readonly SlotResponseValue[], phase: SlotResponseValue['phase'], label: 'A' | 'B'): SlotResponseValue {
  const slot = slots.find((candidate) => candidate.phase === phase && candidate.label === label)
  if (slot === undefined) {
    throw new Error(`axe-session.spec.ts: no ${phase} ${label} slot in readyProgram()'s own slots[]`)
  }
  return slot
}

/**
 * `demo.readyProgram()` (7.1.5/9.1.1) then `/benchmark/:slotId` — baseline A,
 * with no prior attempts, so "Start" is offered with no replacement-reason
 * field (`Ready.tsx`'s own `priorAttemptState`). No fake clock is required
 * to reach or observe this screen — callers that go on to `advance`/`sleep`
 * must `installClock(page)` themselves, BEFORE this function's own first
 * `page.goto` (`clock.ts`'s documented contract).
 */
async function reachBenchmarkReady(page: Page, demo: DemoClient): Promise<{ readonly slotId: string }> {
  const { slots } = await demo.readyProgram()
  const slotA = findSlot(slots, 'baseline', 'A')
  await page.goto(`/benchmark/${slotA.id}`)
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible()
  return { slotId: slotA.id }
}

/**
 * Clicks Start — `BenchmarkRoute.tsx` renders `Running` on the SAME route
 * once the active-session query resolves (no navigation of its own).
 */
async function reachBenchmarkRunning(page: Page, demo: DemoClient): Promise<{ readonly sessionId: string }> {
  await reachBenchmarkReady(page, demo)
  await page.getByRole('button', { name: 'Start', exact: true }).click()

  const eventsGroup = page.getByRole('group', { name: 'Session events' })
  await expect(eventsGroup).toBeVisible()

  const active = await demo.active()
  if (active === null) {
    throw new Error('axe-session.spec.ts: GET /sessions/active returned null right after Start')
  }
  return { sessionId: active.id }
}

/**
 * Runs the fixed interval out and confirms the deadline (D24: only the
 * `end` transition, never elapsed time on its own, ends the interval) —
 * lands on `/benchmark/:id/recall`'s confirm phase with "Start recall"
 * offered (a COMPLETE interval takes no "Skip recall" branch, `Recall.tsx`).
 * Requires `installClock(page)` already called by the caller.
 */
async function reachRecallConfirm(page: Page, demo: DemoClient): Promise<{ readonly sessionId: string }> {
  const { sessionId } = await reachBenchmarkRunning(page, demo)
  await advance(page, demo, BENCHMARK_TARGET_SECONDS)
  // `role="status"` is a live-region role whose accessible NAME comes from
  // aria-label, not its own text content (confirmed empirically against the
  // real app) — matched by text, not role+name.
  await expect(page.getByText('Close your reading material', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: "I'm ready for recall", exact: true }).click()
  await page.waitForURL(`**/benchmark/${sessionId}/recall`)
  await expect(page.getByRole('button', { name: 'Start recall', exact: true })).toBeVisible()
  return { sessionId }
}

/**
 * Starts recall, fills three of the five points (blank is a legitimate value
 * for the other two, D31 — the same proven mix `benchmark-review.spec.ts`
 * already uses), then saves — lands on `/benchmark/:id/scoring` with recall
 * locked (`review.recallLockedAt !== null`), the state this task's own
 * "after Save recall" test name names. Requires `installClock(page)` already
 * called by the caller.
 */
async function reachScoringAfterSaveRecall(page: Page, demo: DemoClient): Promise<{ readonly sessionId: string }> {
  const { sessionId } = await reachRecallConfirm(page, demo)
  await page.getByRole('button', { name: 'Start recall', exact: true }).click()
  await page.getByLabel('Point 1').fill('The introduction argued for a single thesis.')
  await page.getByLabel('Point 2').fill('Section two walked through a worked example.')
  await page.getByLabel('Point 3').fill('The conclusion named one open question.')
  await page.getByRole('button', { name: 'Save recall', exact: true }).click()
  await page.waitForURL(`**/benchmark/${sessionId}/scoring`)
  await expect(page.getByText(/Recall score \(self-reported, preview\)/)).toBeVisible()
  return { sessionId }
}

/**
 * `demo.load('working-day')` (Day 4, one 15-min practice block left,
 * `nextAction` 'practice' — `helpers.spec.ts`'s own proven pattern for
 * reaching the real "What will you produce?" `BlockCard` form) then Start —
 * lands on `/focus/:id`. No fake clock is required to reach or observe this
 * screen on its own; callers that go on to `advance`/`sleep` must
 * `installClock(page)` themselves, BEFORE this function's own first
 * `page.goto`.
 */
async function reachFocusRunning(page: Page, demo: DemoClient): Promise<{ readonly sessionId: string }> {
  await demo.load('working-day')
  await page.goto('/today')
  await page.getByLabel('What will you produce?').fill('Axe check: draft the session notes')
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await page.waitForURL(/\/focus\/[0-9a-f-]{36}$/i)
  const sessionId = page.url().split('/focus/')[1]!
  await expect(page.getByTestId('timer-digits')).toBeVisible()
  return { sessionId }
}

/**
 * Runs the practice target out and ends the block (D24) — lands on
 * `/review/:id`. Requires `installClock(page)` already called by the caller.
 */
async function reachPracticeReview(page: Page, demo: DemoClient): Promise<{ readonly sessionId: string }> {
  const { sessionId } = await reachFocusRunning(page, demo)
  const current = await demo.current()
  if (current.revision === null) {
    throw new Error('axe-session.spec.ts: working-day scenario has no governing revision')
  }
  await advance(page, demo, current.revision.settings.practiceTargetSeconds)
  // Same role="status"-has-no-accessible-name-from-text quirk as above.
  await expect(page.getByText('Block time reached — save your review to record it', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await page.waitForURL(`**/review/${sessionId}`)
  await expect(page.getByRole('heading', { name: 'Practice review' })).toBeVisible()
  return { sessionId }
}

// ---------------------------------------------------------------------------
// Axe checks
// ---------------------------------------------------------------------------

test('Benchmark ready has no serious/critical violations', async ({ page, demo }) => {
  await reachBenchmarkReady(page, demo)
  await expectNoSeriousViolations(page, 'benchmark-ready')
})

test('Benchmark running (timer visible)', async ({ page, demo }) => {
  await installClock(page)
  await reachBenchmarkRunning(page, demo)
  await expect(page.getByTestId('timer-digits')).toBeVisible()
  await expectNoSeriousViolations(page, 'benchmark-running-timer-visible')
})

test('Benchmark running (timer hidden)', async ({ page, demo }) => {
  await installClock(page)
  await reachBenchmarkRunning(page, demo)
  await page.getByRole('button', { name: 'Hide timer', exact: true }).click()
  await expect(page.getByTestId('timer-hidden-text')).toBeVisible()
  await expectNoSeriousViolations(page, 'benchmark-running-timer-hidden')
})

test('Recall (after the deadline and ready for recall)', async ({ page, demo }) => {
  test.setTimeout(45_000)
  await installClock(page)
  await reachRecallConfirm(page, demo)
  await expectNoSeriousViolations(page, 'benchmark-recall-ready')
})

test('Scoring/Review (after Save recall)', async ({ page, demo }) => {
  // A full Ready -> Running -> deadline -> Recall -> Save recall climb, one
  // real attempt end to end — `benchmark-review.spec.ts`'s own header
  // comment notes TWO such attempts run close to Playwright's default 30 s
  // per-test timeout; this is one, but with real navigation and network
  // round trips at every step, not a hang.
  test.setTimeout(60_000)
  await installClock(page)
  await reachScoringAfterSaveRecall(page, demo)
  await expectNoSeriousViolations(page, 'benchmark-scoring-review')
})

test('Focus (timer visible, agent panel closed)', async ({ page, demo }) => {
  await installClock(page)
  await reachFocusRunning(page, demo)
  await expect(page.getByRole('button', { name: 'Waiting on an agent?' })).toBeVisible()
  await expectNoSeriousViolations(page, 'focus-timer-visible-panel-closed')
})

test('Focus (agent panel open)', async ({ page, demo }) => {
  await installClock(page)
  await reachFocusRunning(page, demo)
  await page.getByRole('button', { name: 'Waiting on an agent?' }).click()
  await expect(page.getByLabel('Workstream')).toBeVisible()
  await expectNoSeriousViolations(page, 'focus-agent-panel-open')
})

test('Focus (clock-gap prompt open, via sleep(300))', async ({ page, demo }) => {
  await installClock(page)
  await reachFocusRunning(page, demo)
  await sleep(page, demo, 300)
  await expect(page.getByRole('alertdialog', { name: 'Did the interval continue uninterrupted?' })).toBeVisible()
  await expectNoSeriousViolations(page, 'focus-clock-gap-prompt-open')
})

test('Practice review', async ({ page, demo }) => {
  test.setTimeout(45_000)
  await installClock(page)
  await reachPracticeReview(page, demo)
  await expectNoSeriousViolations(page, 'practice-review')
})

test('demo banner is inside the viewport at scrollY 0 on every session screen above', async ({ page, demo }) => {
  // Six distinct routes (Benchmark ready, Benchmark running, Recall, Scoring/
  // Review, Focus, Practice review) rebuilt one at a time, each preceded by
  // its own `demo.reset()` — `readyProgram()`/`load()` both start from an
  // empty program, and a second `readyProgram()` on top of an already-created
  // program 409s (`program_exists`), matching `benchmark-review.spec.ts`'s own
  // documented reason for never skipping a reset between two climbs. This is
  // the heaviest single test in the file (all six climbs, one after another),
  // hence the generous timeout. The timer-hidden, agent-panel-open and
  // clock-gap-prompt-open variants above share a route with an earlier stop
  // here and are not revisited a second time — the banner's own position
  // never depends on that in-page toggle state, only on the route.
  test.setTimeout(180_000)

  await installClock(page)

  await reachBenchmarkReady(page, demo)
  await expectDemoBanner(page)
  await expectNoSeriousViolations(page, 'demo-banner-benchmark-ready')

  await demo.reset()
  await reachBenchmarkRunning(page, demo)
  await expectDemoBanner(page)
  await expectNoSeriousViolations(page, 'demo-banner-benchmark-running')

  await demo.reset()
  await reachRecallConfirm(page, demo)
  await expectDemoBanner(page)
  await expectNoSeriousViolations(page, 'demo-banner-recall')

  await demo.reset()
  await reachScoringAfterSaveRecall(page, demo)
  await expectDemoBanner(page)
  await expectNoSeriousViolations(page, 'demo-banner-scoring-review')

  await demo.reset()
  await reachFocusRunning(page, demo)
  await expectDemoBanner(page)
  await expectNoSeriousViolations(page, 'demo-banner-focus')

  await demo.reset()
  await reachPracticeReview(page, demo)
  await expectDemoBanner(page)
  await expectNoSeriousViolations(page, 'demo-banner-practice-review')
})
