/**
 * Task 9.1.4 — Journey: Day 0 baseline A and B with events, recall, scoring,
 * Progress (design.md D4, D5, D7.1-D7.3, D9, D10, D20-D22, D24-D27, D30,
 * D31; specs/benchmark-assessment throughout; specs/progress-report:
 * "Sample counts and provenance are always visible", "Result state with
 * precedence", "Export preview and download"; specs/practice-sessions:
 * "Practice metrics stay separate from benchmarks"). Drives the real Ready
 * (8.3.1) -> Running (8.3.3) -> Recall (8.4.1) -> Scoring/CountFields/
 * Disruption/Conditions/Finalize (8.4.2-8.4.5) -> Progress (8.8.1-8.8.4)
 * screens against a program built fresh by `demo.readyProgram()` (clock
 * pinned to 09:00 on Day 0) rather than a pre-baked fixture, since this
 * task's own brief needs precise control over WHEN each event lands
 * (07:42/462 s, 12:00/720 s, 15:00/900 s) to pin exact `elapsedMs`/
 * first-switch values.
 *
 * `e2e/support/benchmark.ts`'s own `runBenchmark()` (this task's SUPPORT
 * file) drives the full Start-to-Finalize sequence for tests 3-5; tests 1, 2
 * and 6 drive the screens directly, either because they need to observe an
 * IN-PROGRESS state `runBenchmark` deliberately does not expose (live tally
 * text between individual Record clicks, test 2) or because they never
 * start a benchmark at all (tests 1, 6).
 *
 * CLAUDE.md invariants this file's assertions specifically protect: unknown
 * != zero (a blank S/E/recall count reads "Not reported", never "0" —
 * covered indirectly here since every count this file drives IS reported;
 * 9.1.7's own missing-final/zero-baseline guards cover the blank/explicit-
 * zero distinction directly); the three-state first-switch rule (`known`
 * with real seconds vs. `Unknown` vs. `20+, capped` — test 4 asserts
 * "Unknown" is rendered and "20+, capped" is NOT, for a retrospective count
 * with no time estimate); one departure-and-return is one episode however
 * many Record clicks happen at the same instant, with Undo removing exactly
 * one (test 2, D9); no invented attention score or percentage (test 5 scans
 * the whole rendered page for a stray "%" while only two of four baseline
 * samples exist — `final_pending`'s own message names no number at all).
 */
import type { Locator, Page } from '@playwright/test'
import type { SlotResponseValue } from '@attention-lab/shared'

import { runBenchmark } from '../support/benchmark.js'
import { advance, installClock } from '../support/clock.js'
import { expectNoPunitiveCopy } from '../support/copy.js'
import { expect, test } from '../support/demo.js'

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function findBaselineSlot(slots: readonly SlotResponseValue[], label: 'A' | 'B'): SlotResponseValue {
  const slot = slots.find((candidate) => candidate.phase === 'baseline' && candidate.label === label)
  if (slot === undefined) {
    throw new Error(`baseline-day.spec: no baseline ${label} slot found`)
  }
  return slot
}

/** `Tallies.tsx`'s own dt/dd pair — the exact selector `working-day.spec.ts` (9.1.5) already proved against the real Running/Focus screens. */
function tallyValue(page: Page, label: 'Off-task' | 'External interruptions'): Locator {
  return page.locator(`dt:text-is("${label}") + dd`)
}

/** Mirrors `apps/web/src/features/progress/format.ts`'s own `formatMmSs` — never used for the "20+, capped"/"Unknown" states. */
function formatMmSs(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/**
 * Parses one `# <name>` section (header row + data rows) out of the export
 * text `ExportPreview.tsx` renders verbatim from `GET /programs/{id}/export`
 * — the same RFC 4180 layout `apps/api/src/services/export/csv.ts`'s
 * `buildCsv` produces (sections joined by one blank line). No quoted-comma
 * handling: none of this file's own fixture values ever contain a comma.
 */
function csvSection(csv: string, sectionName: string): { header: readonly string[]; rows: readonly string[][] } {
  const blocks = csv.split('\n\n')
  const block = blocks.find((candidate) => candidate.startsWith(`# ${sectionName}`))
  if (block === undefined) {
    throw new Error(`baseline-day.spec: CSV section "${sectionName}" not found in:\n${csv}`)
  }
  const lines = block.split('\n').filter((line) => line.length > 0)
  const [, headerLine, ...dataLines] = lines
  if (headerLine === undefined) {
    throw new Error(`baseline-day.spec: CSV section "${sectionName}" has no header row`)
  }
  return { header: headerLine.split(','), rows: dataLines.map((line) => line.split(',')) }
}

const POINTS_THREE_ANSWERED: readonly [string, string, string, string, string] = [
  'The article opened with a story about air-traffic controllers.',
  'It cited a two-week study on blocking mobile internet.',
  'It distinguished sustained attention from working memory.',
  '',
  '',
]

const POINTS_FIVE_ANSWERED: readonly [string, string, string, string, string] = [
  'It recommended a fixed daily block rather than an open-ended one.',
  'It closed with a caution against over-claiming causation.',
  'It described a control condition using an unrelated task.',
  'It reported effect sizes as modest rather than dramatic.',
  'It suggested measuring the outcome across multiple days.',
]

test.beforeEach(async ({ demo }) => {
  await demo.reset()
})

// ---------------------------------------------------------------------------
// 1. Ready screen labeling + 204 until Start
// ---------------------------------------------------------------------------

test('Day 0: Today next action is baseline A; the ready screen is labeled a fixed 20-minute assessment, shows the material reference and planned time, carries the leaving this page to read does not count note, and GET /sessions/active is 204 until Start', async ({
  page,
  demo,
}) => {
  const { slots } = await demo.readyProgram()
  const baselineA = findBaselineSlot(slots, 'A')

  const current = await demo.current()
  expect(current.nextAction.kind).toBe('benchmark')
  if (current.nextAction.kind === 'benchmark') {
    expect(current.nextAction.slotId).toBe(baselineA.id)
  }

  expect(await demo.active()).toBeNull()

  await page.goto(`/benchmark/${baselineA.id}`)
  await expect(page.getByRole('heading', { name: 'Fixed 20-minute assessment — Baseline A' })).toBeVisible()
  await expect(page.getByText(baselineA.materialRef)).toBeVisible()
  await expect(page.getByText('Planned time: 09:00')).toBeVisible()
  await expect(page.getByText('Leaving this page to read does not count as distraction.')).toBeVisible()

  expect(await demo.active()).toBeNull()

  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(page.getByRole('group', { name: 'Session events' })).toBeVisible()

  const active = await demo.active()
  if (active === null) {
    throw new Error('baseline-day.spec: GET /sessions/active returned null right after Start')
  }
  expect(active.kind).toBe('benchmark')
  expect(active.slotId).toBe(baselineA.id)
})

// ---------------------------------------------------------------------------
// 2. Events: Record, External, Record twice + Undo (D9) — driven directly
// (not via runBenchmark) so the live Running-screen tally can be checked
// between individual clicks.
// ---------------------------------------------------------------------------

test('baseline A events: Record at 07:42 stores one off_task with elapsedMs 462000 +/-1000 and tally 1; External at 12:00 stores one external; Record twice at 15:00 then Undo leaves two non-voided off_task events and one with voided_at set (D9); tally reads 2', async ({
  page,
  demo,
}) => {
  await installClock(page)
  const { slots } = await demo.readyProgram()
  const baselineA = findBaselineSlot(slots, 'A')

  await page.goto(`/benchmark/${baselineA.id}`)
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  const eventsGroup = page.getByRole('group', { name: 'Session events' })
  await expect(eventsGroup).toBeVisible()

  const active = await demo.active()
  if (active === null) {
    throw new Error('baseline-day.spec: GET /sessions/active returned null right after Start')
  }
  const sessionId = active.id

  await advance(page, demo, 462)
  await eventsGroup.getByRole('button', { name: 'Record off-task episode', exact: true }).click()
  await expect(tallyValue(page, 'Off-task')).toHaveText('1')

  const afterFirst = await demo.session(sessionId)
  const firstOffTask = afterFirst.events.filter((event) => event.type === 'off_task')
  expect(firstOffTask).toHaveLength(1)
  const firstElapsedMs = firstOffTask[0]?.elapsedMs ?? null
  if (firstElapsedMs === null) {
    throw new Error('baseline-day.spec: expected the first off_task event to carry a known elapsedMs')
  }
  expect(firstElapsedMs).toBeGreaterThanOrEqual(462_000 - 1000)
  expect(firstElapsedMs).toBeLessThanOrEqual(462_000 + 1000)

  await advance(page, demo, 720 - 462)
  await eventsGroup.getByRole('button', { name: 'External interruption', exact: true }).click()
  await expect(tallyValue(page, 'External interruptions')).toHaveText('1')

  const afterSecond = await demo.session(sessionId)
  expect(afterSecond.events.filter((event) => event.type === 'external')).toHaveLength(1)

  await advance(page, demo, 900 - 720)
  await eventsGroup.getByRole('button', { name: 'Record off-task episode', exact: true }).click()
  await expect(tallyValue(page, 'Off-task')).toHaveText('2')
  await eventsGroup.getByRole('button', { name: 'Record off-task episode', exact: true }).click()
  await expect(tallyValue(page, 'Off-task')).toHaveText('3')

  await eventsGroup.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(tallyValue(page, 'Off-task')).toHaveText('2')

  const finalSession = await demo.session(sessionId)
  const offTaskEvents = finalSession.events.filter((event) => event.type === 'off_task')
  expect(offTaskEvents).toHaveLength(3)
  expect(offTaskEvents.filter((event) => event.voidedAt === null)).toHaveLength(2)
  expect(offTaskEvents.filter((event) => event.voidedAt !== null)).toHaveLength(1)
})

// ---------------------------------------------------------------------------
// 3. Baseline A review: recall delay, locked/read-only points, blanks scored
// 0, S/E prefilled from events, eligible with a known first switch.
// ---------------------------------------------------------------------------

test('baseline A review: ready for recall 40 s after the deadline -> review.recallDelaySeconds in 38..42 and recallFlags []; Save recall locks the five points and the scoring screen shows them read-only with no editable input; Accurate x3 with points 4-5 blank -> recallScore 3 and the blanks read scored 0 because blank; S prefilled 2 method event, E prefilled 1; disruption No -> Finalize returns eligible true, exclusionReasons [], firstSwitch {kind: known, seconds: 462}; the summary labels counts self-reported', async ({
  page,
  demo,
}) => {
  await installClock(page)
  const { slots } = await demo.readyProgram()
  const baselineA = findBaselineSlot(slots, 'A')

  const sessionId = await runBenchmark(page, demo, {
    slotId: baselineA.id,
    events: [
      { atSeconds: 462, type: 'off_task' },
      { atSeconds: 720, type: 'external' },
      { atSeconds: 900, type: 'off_task' },
      { atSeconds: 900, type: 'off_task' },
    ],
    undoAt: 900,
    recallDelaySeconds: 40,
    recallPoints: POINTS_THREE_ANSWERED,
    recallDurationSeconds: 30,
    accurate: [true, true, true],
    disruption: 'no',
  })

  // D10: the five points are read-only text at Scoring — no editable input
  // for any of them remains, and each blank one reads "Scored 0 because
  // blank" rather than being silently skipped.
  await expect(page.getByLabel('Point 1')).toHaveCount(0)
  await expect(page.getByText('Scored 0 because blank')).toHaveCount(2)
  await expect(page.getByText(/\(self-reported\)/)).toBeVisible()

  const session = await demo.session(sessionId)

  const delay = session.review.recallDelaySeconds
  if (delay === null) {
    throw new Error('baseline-day.spec: expected review.recallDelaySeconds to be reported')
  }
  expect(delay).toBeGreaterThanOrEqual(38)
  expect(delay).toBeLessThanOrEqual(42)
  expect(session.review.recallFlags).toEqual([])

  expect(session.review.recallScore).toBe(3)
  expect(session.review.episodeCount).toBe(2)
  expect(session.review.countMethod).toBe('event')
  expect(session.review.externalCount).toBe(1)

  expect(session.eligible).toBe(true)
  expect(session.exclusionReasons).toEqual([])

  const firstSwitch = session.review.firstSwitch
  if (firstSwitch === null || firstSwitch.kind !== 'known') {
    throw new Error(`baseline-day.spec: expected a known first switch, got ${JSON.stringify(firstSwitch)}`)
  }
  expect(firstSwitch.seconds).toBeGreaterThanOrEqual(455)
  expect(firstSwitch.seconds).toBeLessThanOrEqual(469)
})

// ---------------------------------------------------------------------------
// 4. Baseline B: no events, S entered retrospectively, Unknown (never 20+,
// capped), recall_overrun flag, still eligible.
// ---------------------------------------------------------------------------

test('baseline B after advance(3600): no events; S entered 4 -> countMethod retrospective and T renders Unknown, never 20+; Save recall after 240 s -> recallFlags [recall_overrun] visible in review; eligible true', async ({
  page,
  demo,
}) => {
  await installClock(page)
  const { slots } = await demo.readyProgram()
  const baselineB = findBaselineSlot(slots, 'B')

  await advance(page, demo, 3600)

  const sessionId = await runBenchmark(page, demo, {
    slotId: baselineB.id,
    events: [],
    recallDelaySeconds: 5,
    recallPoints: POINTS_FIVE_ANSWERED,
    recallDurationSeconds: 240,
    accurate: [true, true, true, true, true],
    episodeCountOverride: 4,
    disruption: 'no',
  })

  // CountFields (above FinalizeSection's own success swap) stays mounted and
  // visible after Finalize — the never-20+ check reads the SAME screen the
  // "Unknown" text does.
  await expect(page.getByText('First switch, preview: Unknown')).toBeVisible()
  await expect(page.getByText(/20\+, capped/)).toHaveCount(0)
  await expect(page.getByText('Recall ran more than 30 s over 3:00 (noted, not excluding)')).toBeVisible()

  const session = await demo.session(sessionId)
  expect(session.review.episodeCount).toBe(4)
  expect(session.review.countMethod).toBe('retrospective')
  expect(session.review.firstSwitch).toEqual({ kind: 'unknown' })
  expect(session.review.recallFlags).toContain('recall_overrun')
  expect(session.eligible).toBe(true)
})

// ---------------------------------------------------------------------------
// 5. Progress after both baselines: samples, final-pending copy, no percent
// sign, attempts table T/S cells, CSV rows.
// ---------------------------------------------------------------------------

test('Progress after both baselines: 2 of 2 baseline samples eligible, final-pending copy Your final comparison is available after the Day 14 assessments., no percent sign, attempts table lists A with T of 462 s rendered as minutes and seconds (method event) and B with T Unknown, every count labeled self-reported; CSV rows carry S 2 and 4, methods event and retrospective, T states known and unknown', async ({
  page,
  demo,
}) => {
  await installClock(page)
  const { programId, slots } = await demo.readyProgram()
  const baselineA = findBaselineSlot(slots, 'A')
  const baselineB = findBaselineSlot(slots, 'B')

  // Same event pattern test 3 drives against baseline A (record, external,
  // record twice + undo) — this test's own brief expects the SAME S=2/T
  // known-462s outcome to show up on Progress, not a different one.
  const sessionIdA = await runBenchmark(page, demo, {
    slotId: baselineA.id,
    events: [
      { atSeconds: 462, type: 'off_task' },
      { atSeconds: 720, type: 'external' },
      { atSeconds: 900, type: 'off_task' },
      { atSeconds: 900, type: 'off_task' },
    ],
    undoAt: 900,
    recallDelaySeconds: 10,
    recallPoints: POINTS_THREE_ANSWERED,
    recallDurationSeconds: 20,
    accurate: [true, true, true],
    disruption: 'no',
  })

  await advance(page, demo, 3600)

  const sessionIdB = await runBenchmark(page, demo, {
    slotId: baselineB.id,
    events: [],
    recallDelaySeconds: 5,
    recallPoints: POINTS_FIVE_ANSWERED,
    recallDurationSeconds: 20,
    accurate: [true, true, true, true, true],
    episodeCountOverride: 4,
    disruption: 'no',
  })

  const report = await demo.report(programId)
  expect(report.samples).toEqual({ baselineEligible: 2, finalEligible: 0 })
  expect(report.resultState).toBe('final_pending')
  expect(report.comparison).toBeUndefined()

  const sessionA = await demo.session(sessionIdA)
  const firstSwitchA = sessionA.review.firstSwitch
  if (firstSwitchA === null || firstSwitchA.kind !== 'known') {
    throw new Error(`baseline-day.spec: expected baseline A to have a known first switch, got ${JSON.stringify(firstSwitchA)}`)
  }
  expect(firstSwitchA.seconds).toBeGreaterThanOrEqual(455)
  expect(firstSwitchA.seconds).toBeLessThanOrEqual(469)
  const expectedTTextA = formatMmSs(firstSwitchA.seconds)

  await page.goto('/progress')

  await expect(page.getByTestId('result-state-message')).toHaveText(
    'Your final comparison is available after the Day 14 assessments.',
  )
  await expect(page.getByText(/2 of 2 baseline samples eligible/)).toBeVisible()
  await expect(page.getByText(/0 of 2 final samples eligible/)).toBeVisible()
  await expect(page.getByText('All counts are self-reported')).toBeVisible()

  await expect(page.getByTestId(`s-${sessionIdA}`)).toHaveText('2 (events)')
  await expect(page.getByTestId(`t-${sessionIdA}`)).toHaveText(expectedTTextA)
  await expect(page.getByTestId(`s-${sessionIdB}`)).toHaveText('4 (retrospective)')
  await expect(page.getByTestId(`t-${sessionIdB}`)).toHaveText('Unknown')

  await expect(page.getByTestId('export-preview-text')).toBeVisible()

  const bodyText = await page.locator('body').innerText()
  expect(bodyText).not.toContain('%')

  await expectNoPunitiveCopy(page)

  const csvText = await page.getByTestId('export-preview-text').innerText()
  const { header, rows } = csvSection(csvText, 'attempts')
  const phaseIndex = header.indexOf('phase')
  const labelIndex = header.indexOf('label')
  const sIndex = header.indexOf('s')
  const sMethodIndex = header.indexOf('s_method')
  const tStateIndex = header.indexOf('t_state')

  const rowA = rows.find((row) => row[phaseIndex] === 'baseline' && row[labelIndex] === 'A')
  const rowB = rows.find((row) => row[phaseIndex] === 'baseline' && row[labelIndex] === 'B')
  if (rowA === undefined || rowB === undefined) {
    throw new Error('baseline-day.spec: expected both baseline A and B rows in the attempts CSV section')
  }
  expect(rowA[sIndex]).toBe('2')
  expect(rowA[sMethodIndex]).toBe('event')
  expect(rowA[tStateIndex]).toBe('known')
  expect(rowB[sIndex]).toBe('4')
  expect(rowB[sMethodIndex]).toBe('retrospective')
  expect(rowB[tStateIndex]).toBe('Unknown')
})

// ---------------------------------------------------------------------------
// 6. A practice block on Day 0 never counts as a baseline sample.
// ---------------------------------------------------------------------------

test('a practice block completed on Day 0 via completePracticeBlock stays practice: samples remain 0 of 2, the attempts table stays empty and Today still offers baseline A', async ({
  page,
  demo,
}) => {
  const { programId, revision } = await demo.readyProgram()

  await demo.completePracticeBlock(programId, revision.settings.practiceTargetSeconds)

  const report = await demo.report(programId)
  expect(report.samples).toEqual({ baselineEligible: 0, finalEligible: 0 })
  expect(report.attempts).toHaveLength(0)
  expect(report.practice).toHaveLength(1)

  const current = await demo.current()
  expect(current.nextAction.kind).toBe('benchmark')

  await page.goto('/progress')
  await expect(page.getByText(/0 of 2 baseline samples eligible/)).toBeVisible()
  await expect(page.getByText('No benchmark attempts yet.')).toBeVisible()

  await page.goto('/today')
  await expect(page.getByRole('link', { name: 'Start with your baseline' })).toBeVisible()
})
