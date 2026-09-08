/**
 * Task 9.1.9 — Journey: timing deviation — clock-gap reopened on load, its
 * three resolutions, and date deviation (design.md D23, D25, D26, D35;
 * specs/session-recovery: "Clock gaps are detected and resolved by the
 * user" / "Laptop slept during a benchmark", "Abandon and save-incomplete
 * are always available" / "Save incomplete after uncertainty";
 * specs/benchmark-assessment: "Eligibility is derived server-side with
 * explicit reasons" (All conditions met / Multiple failing conditions /
 * Attempt outside its date), "Final benchmarks on Day 14" / "Final
 * completed on Day 15", "Counts are confirmed at review and blank means
 * unknown" (Blank count / Explicit zero), "Recall is a separate, timed,
 * then locked step" / "Recall started after a long break", "Self-scoring
 * is unavailable until recall is locked"; specs/progress-report: "Sample
 * counts and provenance are always visible"; specs/identity-realm:
 * "Demo-only controls exist only in demo mode" / "Load a demonstration
 * scenario").
 *
 * `demo.load('timing-deviation')` (`packages/shared/src/fixtures/
 * demoScenarios.ts`) leaves baseline A `running`, started 18 minutes
 * before load (elapsed ~1080 s of the fixed 1200 s interval, ~120 s
 * remaining), with an unresolved 300 s `clock_gap` event recorded
 * server-side and NO `resolution` — D26's reload check
 * (`useClockGap.ts`'s `findUnresolvedClockGap`) re-opens `ClockGapPrompt`
 * (mounted once by `SessionLayout` for every session route, task-detail's
 * own citation) the moment the running session is on screen, seeded
 * synchronously during render rather than after an effect, so no
 * `advance`/`sleep` of any kind is needed to see it (test 1).
 *
 * Tests 2-4 each resolve that SAME reopened prompt one way, then carry the
 * SAME already-running session through the remaining interval, recall,
 * scoring and finalize — `finishRunningBenchmark` below plays that tail
 * (never `e2e/support/benchmark.ts`'s own `runBenchmark()`: that helper's
 * first two actions are `page.goto` then clicking "Start", which only
 * exists on `Ready` (8.3.1); a slot with an already-running session
 * renders `Running` (8.3.3) instead, `BenchmarkRoute.tsx`'s own routing,
 * so there is no "Start" control at all to click). Test 5 (date deviation)
 * DOES start a session fresh — a Day 15 attempt against `readyProgram()`'s
 * own final A slot, never touched before — so it reuses `runBenchmark()`
 * exactly as 9.1.4's own brief intends.
 *
 * Every recall in this file uses five intentionally BLANK points: D31
 * scores a blank point 0 with no Accurate/Not-accurate radio rendered at
 * all (`Scoring.tsx`'s `PointRow`), so `scoringComplete` reads `true` the
 * instant the (empty) points are saved — none of these tests need to
 * exercise the per-point radio the way 9.1.4's own baseline-day journey
 * already does.
 */
import type { Page } from '@playwright/test'
import type { SlotResponseValue } from '@attention-lab/shared'

import { runBenchmark } from '../support/benchmark.js'
import { advance, installClock } from '../support/clock.js'
import { expect, test, type DemoClient } from '../support/demo.js'

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function findSlot(
  slots: readonly SlotResponseValue[],
  phase: 'baseline' | 'final',
  label: 'A' | 'B',
): SlotResponseValue {
  const slot = slots.find((candidate) => candidate.phase === phase && candidate.label === label)
  if (slot === undefined) {
    throw new Error(`timing-deviation.spec: no ${phase} ${label} slot found`)
  }
  return slot
}

/** Five blank recall points — see this file's own header comment on why every recall here uses these. */
const BLANK_POINTS: readonly [string, string, string, string, string] = ['', '', '', '', '']

interface ClockGapEventDetails {
  readonly gapSeconds?: number
  readonly resolution?: string
}

/**
 * Drives an ALREADY-RUNNING benchmark — this file's own `demo.load
 * ('timing-deviation')` scenario, after its reopened clock-gap prompt has
 * just been resolved one way or another — from wherever the interval
 * currently stands through Finalize: reads the session's own
 * `timing.remainingSeconds` (never a locally-tracked elapsed counter, since
 * this session did not start from THIS test's own `advance` calls) and
 * advances past it, "I'm ready for recall", an optional recall delay, the
 * five blank points, an optional recall-save delay, an optional explicit S
 * value (S is left exactly as the fixture prefilled it — blank, since the
 * fixture recorded no off_task/external event — when omitted), the
 * observed-conditions confirmation and the required disruption
 * attestation. See this file's own header comment for why this is not
 * `runBenchmark()` itself.
 */
async function finishRunningBenchmark(
  page: Page,
  demo: DemoClient,
  sessionId: string,
  options: {
    readonly recallDelaySeconds: number
    readonly recallDurationSeconds: number
    readonly episodeCount?: number
    readonly disruption: 'yes' | 'no'
  },
): Promise<void> {
  const current = await demo.session(sessionId)
  const remaining = current.timing.remainingSeconds
  if (remaining > 0) {
    // A generous buffer over the server-read remaining time: this session's
    // own elapsed clock started ticking on a REAL wall clock before this
    // test ever touched it (the fixture's own `startedAtOffsetSeconds`), so
    // a little real-world latency between this read and the `advance` call
    // below is expected and harmless — the deadline only needs to be
    // reached, never hit exactly.
    await advance(page, demo, remaining + 20)
  }
  // `role="status"` is a live-region role whose accessible NAME comes from
  // aria-label, not its own text content — matched by text, not role+name.
  await expect(page.getByText('Close your reading material', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: "I'm ready for recall", exact: true }).click()
  await page.waitForURL(`**/benchmark/${sessionId}/recall`)

  await expect(page.getByRole('button', { name: 'Start recall', exact: true })).toBeVisible()
  if (options.recallDelaySeconds > 0) {
    await advance(page, demo, options.recallDelaySeconds)
  }
  await page.getByRole('button', { name: 'Start recall', exact: true }).click()

  await expect(page.getByLabel('Point 1')).toBeVisible()
  if (options.recallDurationSeconds > 0) {
    await advance(page, demo, options.recallDurationSeconds)
  }
  await page.getByRole('button', { name: 'Save recall', exact: true }).click()
  await page.waitForURL(`**/benchmark/${sessionId}/scoring`)
  await expect(page.getByText('Scored 0 because blank')).toHaveCount(5)

  if (options.episodeCount !== undefined) {
    await page.getByLabel('Off-task episodes (S)').fill(String(options.episodeCount))
  }

  await page.getByRole('checkbox', { name: 'These conditions are correct' }).check()
  await page.getByRole('radio', { name: options.disruption === 'yes' ? 'Yes' : 'No', exact: true }).click()

  await page.getByRole('button', { name: 'Finalize', exact: true }).click()
  await expect(page.getByTestId('eligibility-summary')).toBeVisible()
}

test.beforeEach(async ({ demo }) => {
  await demo.reset()
})

// ---------------------------------------------------------------------------
// 1. The reopened prompt (D26) and the stored unresolved clock-gap event.
// ---------------------------------------------------------------------------

test('opening the loaded session re-opens the interval prompt immediately (D26): the reopened dialog and the stored unresolved clock-gap event, with no advance or sleep needed', async ({
  page,
  demo,
}) => {
  await installClock(page)
  await demo.load('timing-deviation')

  const active = await demo.active()
  if (active === null) {
    throw new Error('timing-deviation.spec: demo.active() returned null after loading the scenario')
  }
  if (active.slotId === null) {
    throw new Error('timing-deviation.spec: the loaded running benchmark carries no slotId')
  }
  const sessionId = active.id

  // Navigating straight to the running benchmark's own route is the ONLY
  // action before the assertions below — no `advance`/`sleep` of any kind.
  await page.goto(`/benchmark/${active.slotId}`)

  await expect(page.getByText('Did the interval continue uninterrupted?')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Yes, it continued', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'No', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Not sure', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save as incomplete', exact: true })).toBeVisible()

  const session = await demo.session(sessionId)
  expect(session.lifecycle).toBe('running')

  const gapEvent = session.events.find((event) => event.type === 'clock_gap')
  if (gapEvent === undefined) {
    throw new Error('timing-deviation.spec: expected an unresolved clock_gap event on the loaded session')
  }
  const gapDetails = gapEvent.details as ClockGapEventDetails
  expect(gapDetails.gapSeconds).toBeGreaterThanOrEqual(295)
  expect(gapDetails.gapSeconds).toBeLessThanOrEqual(305)
  expect(gapDetails.resolution).toBeUndefined()

  expect(session.events.filter((event) => event.type === 'off_task' || event.type === 'external')).toHaveLength(0)
})

// ---------------------------------------------------------------------------
// 2. "Not sure" -> uncertain: ineligible with timer_uncertain, Progress copy.
// ---------------------------------------------------------------------------

test('"Not sure" resolves to uncertain (D26): after the remaining interval, recall, scoring and disruption No, finalize returns ineligible with timer_uncertain and Progress shows the timing-uncertain copy', async ({
  page,
  demo,
}) => {
  await installClock(page)
  await demo.load('timing-deviation')

  const active = await demo.active()
  if (active === null || active.slotId === null) {
    throw new Error('timing-deviation.spec: expected a running benchmark with a slotId')
  }
  const sessionId = active.id

  await page.goto(`/benchmark/${active.slotId}`)
  await expect(page.getByText('Did the interval continue uninterrupted?')).toBeVisible()
  await page.getByRole('button', { name: 'Not sure', exact: true }).click()
  await expect(page.getByText('Did the interval continue uninterrupted?')).not.toBeVisible()

  await finishRunningBenchmark(page, demo, sessionId, {
    recallDelaySeconds: 0,
    recallDurationSeconds: 0,
    episodeCount: 0,
    disruption: 'no',
  })

  const session = await demo.session(sessionId)
  expect(session.timerQuality).toBe('uncertain')
  expect(session.completeInterval).toBe(true)
  expect(session.eligible).toBe(false)
  expect(session.exclusionReasons).toEqual(['timer_uncertain'])

  await page.goto('/progress')
  await expect(page.getByText('Timing could not be confirmed for this session.')).toBeVisible()
})

// ---------------------------------------------------------------------------
// 3. "Yes, it continued" -> timer stays ok, ~300 s gap recorded, not
// excluding; a 25-minute recall delay flags recall_delayed without
// excluding either.
// ---------------------------------------------------------------------------

test('"Yes, it continued" keeps timer quality ok and records the ~300 s gap without excluding the attempt; a subsequent 25-minute recall delay is flagged (recall_delayed), not excluded, and eligible stays true', async ({
  page,
  demo,
}) => {
  await installClock(page)
  await demo.load('timing-deviation')

  const active = await demo.active()
  if (active === null || active.slotId === null) {
    throw new Error('timing-deviation.spec: expected a running benchmark with a slotId')
  }
  const sessionId = active.id

  await page.goto(`/benchmark/${active.slotId}`)
  await expect(page.getByText('Did the interval continue uninterrupted?')).toBeVisible()
  await page.getByRole('button', { name: 'Yes, it continued', exact: true }).click()
  await expect(page.getByText('Did the interval continue uninterrupted?')).not.toBeVisible()

  const resolved = await demo.session(sessionId)
  expect(resolved.timerQuality).toBe('ok')

  await finishRunningBenchmark(page, demo, sessionId, {
    // > 600 s (D7.3) -> recall_delayed, flagged and never excluding.
    recallDelaySeconds: 1500,
    recallDurationSeconds: 0,
    episodeCount: 0,
    disruption: 'no',
  })

  const session = await demo.session(sessionId)
  expect(session.timerQuality).toBe('ok')

  const clockGapSeconds = session.clockGapSeconds
  if (clockGapSeconds === null) {
    throw new Error('timing-deviation.spec: expected clockGapSeconds to be reported after a resolved gap')
  }
  expect(clockGapSeconds).toBeGreaterThanOrEqual(295)
  expect(clockGapSeconds).toBeLessThanOrEqual(305)

  expect(session.review.recallFlags).toContain('recall_delayed')
  expect(session.eligible).toBe(true)
  expect(session.exclusionReasons).toEqual([])
})

// ---------------------------------------------------------------------------
// 4. "Save as incomplete" -> ends the interval, opens the incomplete
// review, recall skipped, S left blank -> four exclusion reasons together.
// ---------------------------------------------------------------------------

test('"Save as incomplete" from the re-opened prompt ends the interval (completeInterval false, timerQuality uncertain) and opens the incomplete review, where recall is offered but may be skipped (D25); skipping recall, leaving S blank, and Finalize with disruption No yields interval_incomplete, timer_uncertain, recall_missing and scoring_incomplete together, review.episodeCount null, and Progress shows those reason copies with no 0 for S and no misleading "completed" status', async ({
  page,
  demo,
}) => {
  await installClock(page)
  await demo.load('timing-deviation')

  const active = await demo.active()
  if (active === null || active.slotId === null) {
    throw new Error('timing-deviation.spec: expected a running benchmark with a slotId')
  }
  const sessionId = active.id

  await page.goto(`/benchmark/${active.slotId}`)
  await expect(page.getByText('Did the interval continue uninterrupted?')).toBeVisible()
  await page.getByRole('button', { name: 'Save as incomplete', exact: true }).click()
  await page.waitForURL(`**/benchmark/${sessionId}/recall`)

  await expect(page.getByText('Incomplete attempt')).toBeVisible()
  await page.getByRole('button', { name: 'Skip recall', exact: true }).click()
  await page.waitForURL(`**/benchmark/${sessionId}/scoring`)
  await expect(
    page.getByText('Recall not saved — this attempt will be recorded with recall missing'),
  ).toBeVisible()

  // S is never touched — it stays exactly as blank as the fixture (which
  // recorded no off_task/external event) left it.
  await page.getByRole('checkbox', { name: 'These conditions are correct' }).check()
  await page.getByRole('radio', { name: 'No', exact: true }).click()
  await page.getByRole('button', { name: 'Finalize', exact: true }).click()
  await expect(page.getByTestId('eligibility-summary')).toBeVisible()

  const session = await demo.session(sessionId)
  expect(session.completeInterval).toBe(false)
  expect(session.timerQuality).toBe('uncertain')
  expect(session.eligible).toBe(false)
  expect(session.review.episodeCount).toBeNull()
  expect(session.exclusionReasons).toEqual(
    expect.arrayContaining(['interval_incomplete', 'timer_uncertain', 'recall_missing', 'scoring_incomplete']),
  )

  await page.goto('/progress')
  await expect(page.getByText('The full 20-minute interval was not completed.')).toBeVisible()
  await expect(page.getByText('The recall step was not saved.')).toBeVisible()
  await expect(page.getByText('Self-scoring was not finished.')).toBeVisible()
  await expect(page.getByText('Timing could not be confirmed for this session.')).toBeVisible()

  // Unknown != zero (CLAUDE.md): S never renders '0' for a blank report.
  await expect(page.getByTestId(`s-${sessionId}`)).toHaveText('Not reported')

  // Timer expiry/uncertainty never becomes a "completed" claim (CLAUDE.md).
  const statusText = await page.getByTestId(`status-${sessionId}`).innerText()
  expect(statusText).not.toMatch(/\bcompleted?\b/i)
})

// ---------------------------------------------------------------------------
// 5. Date deviation: a fresh Day 15 attempt against a never-touched final A
// slot — the one case in this file that DOES reuse runBenchmark().
// ---------------------------------------------------------------------------

test('date deviation: after readyProgram() and setDay(15) the final A ready screen still offers Start with the timing-deviation notice (D23); a clean run finalizes with eligible false and exclusionReasons [timing_deviation]; Progress lists it with the timing-deviation copy and its raw label; baseline slots, program status and revision are unchanged from the pre-run snapshot', async ({
  page,
  demo,
}) => {
  await installClock(page)
  await demo.readyProgram()
  await demo.setDay(15)

  const before = await demo.current()
  const finalASlot = findSlot(before.slots, 'final', 'A')
  const beforeBaselineA = findSlot(before.slots, 'baseline', 'A')
  const beforeBaselineB = findSlot(before.slots, 'baseline', 'B')
  expect(beforeBaselineA.attempts).toEqual([])
  expect(beforeBaselineB.attempts).toEqual([])

  await page.goto(`/benchmark/${finalASlot.id}`)
  // `role="status"` is a live-region role whose accessible NAME comes from
  // aria-label, not its own text content — matched by text, not role+name.
  await expect(
    page.getByText(
      `This slot was assigned to ${finalASlot.assignedLocalDate}. An attempt today will be labeled a timing deviation.`,
      { exact: true },
    ),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled()

  const sessionId = await runBenchmark(page, demo, {
    slotId: finalASlot.id,
    events: [],
    recallDelaySeconds: 5,
    recallPoints: BLANK_POINTS,
    recallDurationSeconds: 5,
    accurate: [],
    episodeCountOverride: 0,
    disruption: 'no',
  })

  const session = await demo.session(sessionId)
  expect(session.localDate).not.toBe(finalASlot.assignedLocalDate)
  expect(session.eligible).toBe(false)
  expect(session.exclusionReasons).toEqual(['timing_deviation'])

  await page.goto('/progress')
  await expect(page.getByText('This session ran outside its assigned date.')).toBeVisible()
  await expect(page.getByTestId(`eligibility-${sessionId}`)).toHaveText('Not eligible')

  // The CSV export's own `exclusion_reasons` cell carries the raw label
  // (`apps/api/src/services/export/csv.ts`'s `joinedCell`), not just the
  // human-readable sentence checked above.
  await expect(page.getByTestId('export-preview-text')).toBeVisible()
  const csvText = await page.getByTestId('export-preview-text').innerText()
  expect(csvText).toContain('timing_deviation')

  const after = await demo.current()
  expect(after.program?.status).toBe(before.program?.status)
  expect(after.revision?.id).toBe(before.revision?.id)
  const afterBaselineA = findSlot(after.slots, 'baseline', 'A')
  const afterBaselineB = findSlot(after.slots, 'baseline', 'B')
  expect(afterBaselineA.attempts).toEqual([])
  expect(afterBaselineB.attempts).toEqual([])
})
