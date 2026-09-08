/**
 * Task 9.2.5 — Invariant: Day 8 revision via Accept leaves earlier sessions
 * unchanged (design.md D4, D16, D22, D30, D33; specs/program-setup:
 * "Protocol settings are immutable revisions" / "Target changed on Day 8";
 * specs/practice-sessions: "Progression suggestion follows the protocol
 * rule" / "Suggestion accepted", "Today shows one next action and two
 * blocks", "Practice metrics stay separate from benchmarks";
 * specs/progress-report: "Practice and daily trends are separate sections" /
 * "Practice growth" and "Missing check-in day").
 *
 * Drives the real `working-day` scenario (Day 4: both baselines eligible,
 * six qualifying 10-min blocks across Days 1-3, one 15-min block on Day 4
 * already governed by revision 2's own accepted progression — see
 * `packages/shared/src/fixtures/demoScenarios.ts`'s `workingDayScenario`)
 * forward through two more qualifying days (Days 5 and 6, both blocks each,
 * `demo.completePracticeBlock`) to Day 8 — the first day the Days 8-10 band
 * ceiling (20 min, `DEFAULT_BAND_CEILINGS`) permits another +5 minute
 * suggestion on top of the already-accepted 15-min target.
 *
 * REVISION NUMBERING is deliberately never hardcoded to a literal number
 * here — this is load-bearing, not stylistic. `working-day` ships with
 * revision 1 (initial plan, day 0) AND revision 2 (progression accepted, day
 * 4) already persisted (`workingDayScenario`'s own `revision1`/`revision2`
 * fixture rows). `nextRevisionNumber` (`apps/api/src/services/program/
 * revisions.ts`) always assigns one past the highest existing revision —
 * confirmed by `apps/api/test/programs/revisions.test.ts`'s own two-revision
 * case, where a FRESH program's first accepted revision is numbered 2 and
 * its second is numbered 3. Accepting the Day 8 suggestion here therefore
 * creates revision **3** (one past `working-day`'s own pre-existing
 * revision 2), not revision 2 — so every assertion below reads the pre-accept
 * and post-accept revision straight from the server and compares them to
 * EACH OTHER (`acceptedRevision.revision === pendingRevision.revision + 1`),
 * never to an assumed literal.
 *
 * Accepting is driven through the real Today screen (`SuggestionBanner.tsx`'s
 * own Accept button, `POST /programs/{id}/revisions` underneath) rather than
 * a raw API call — `demo.ts` (D16: not edited here) exposes no
 * revision-creation method, and the "Suggestion accepted" scenario is itself
 * framed as a user action ("WHEN the user accepts a suggestion").
 */
import {
  PROGRESSION_ACCEPTED_REASON,
  RESULT_STATE_COPY,
  type ReportResponseValue,
  type RevisionResponseValue,
} from '@attention-lab/shared'
import type { Page } from '@playwright/test'

import { expect, test, type DemoClient } from '../support/demo.js'

// ---------------------------------------------------------------------------
// Shared state, rebuilt fresh by beforeEach for every test in this file —
// each test gets its own `demo.reset()` + rebuild, so these module-scoped
// `let`s never leak state between tests even though they are assigned inside
// a different function (`beforeEach`) than the one that reads them.
// ---------------------------------------------------------------------------

let programId: string
/** The governing revision at Day 8, BEFORE any Accept — `working-day`'s own revision 2 (900 s/15 min, effective day 4). */
let pendingRevision: RevisionResponseValue
/** `demo.report(programId)` snapshotted right after `setDay(8)`, before any Accept. */
let preReport: ReportResponseValue
/** The five practice session ids from Days 4-6 (Day 4 block 1 from the fixture, plus the four this file's own beforeEach builds for Days 5-6). */
let daysFourToSixSessionIds: string[]

test.beforeEach(async ({ demo }) => {
  await demo.reset()

  const loaded = await demo.load('working-day')
  if (loaded.programId === null) {
    throw new Error('day8-revision: working-day scenario loaded with no program')
  }
  programId = loaded.programId

  const atLoad = await demo.current()
  if (atLoad.revision === null) {
    throw new Error('day8-revision: working-day scenario loaded with no governing revision')
  }
  const targetSeconds = atLoad.revision.settings.practiceTargetSeconds

  await demo.setDay(5)
  await demo.completePracticeBlock(programId, targetSeconds, { outputQuality: 'yes', episodeCount: 0 })
  await demo.completePracticeBlock(programId, targetSeconds, { outputQuality: 'yes', episodeCount: 0 })

  await demo.setDay(6)
  await demo.completePracticeBlock(programId, targetSeconds, { outputQuality: 'yes', episodeCount: 0 })
  await demo.completePracticeBlock(programId, targetSeconds, { outputQuality: 'yes', episodeCount: 0 })

  // Day 7 is deliberately left untouched (no sessions) — a missed day AFTER
  // an already-qualifying pair (Days 5-6) holds the suggestion rather than
  // clearing it (practice-sessions: "Progression suggestion follows the
  // protocol rule" / domain/progression.ts's own suggestProgression doc
  // comment).
  await demo.setDay(8)

  preReport = await demo.report(programId)
  daysFourToSixSessionIds = preReport.practice.filter((row) => row.day >= 4 && row.day <= 6).map((row) => row.sessionId)

  const beforeAccept = await demo.current()
  if (beforeAccept.revision === null) {
    throw new Error('day8-revision: no governing revision at Day 8, before accepting anything')
  }
  pendingRevision = beforeAccept.revision
})

// ---------------------------------------------------------------------------
// Helper: drives the real Today screen's SuggestionBanner Accept button, then
// waits for the server-truth governing revision to actually change (never a
// client-optimistic read) before returning it.
// ---------------------------------------------------------------------------

async function acceptDay8Suggestion(page: Page, demo: DemoClient, priorRevisionId: string): Promise<RevisionResponseValue> {
  await page.goto('/today')

  const banner = page.getByTestId('suggestion-banner')
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('Ready for +5 minutes? (to 20 min)')

  await page.getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(banner).toHaveCount(0)

  await expect.poll(async () => (await demo.current()).revision?.id).not.toBe(priorRevisionId)

  const after = await demo.current()
  if (after.revision === null) {
    throw new Error('day8-revision: no governing revision after accepting the Day 8 suggestion')
  }
  return after.revision
}

// ---------------------------------------------------------------------------
// 1. Accept creates a new revision effective Day 8, reason "progression
//    accepted", target 1200 s (20 min) — and Today reflects it immediately.
// ---------------------------------------------------------------------------

test('Day 8: Today offers +5 minutes; Accept creates a new revision effective Day 8 with reason "progression accepted" and Today shows a 20-minute target', async ({
  page,
  demo,
}) => {
  const acceptedRevision = await acceptDay8Suggestion(page, demo, pendingRevision.id)

  expect(acceptedRevision.revision).toBe(pendingRevision.revision + 1)
  expect(acceptedRevision.effectiveDay).toBe(8)
  expect(acceptedRevision.reason).toBe(PROGRESSION_ACCEPTED_REASON)
  expect(acceptedRevision.settings.practiceTargetSeconds).toBe(1200)

  const today = await demo.today(programId)
  const block1 = today.blocks.find((block) => block.index === 1)
  const block2 = today.blocks.find((block) => block.index === 2)
  expect(block1?.targetSeconds).toBe(1200)
  expect(block2?.targetSeconds).toBe(1200)

  await expect(page.locator('[data-block-index="1"]')).toContainText('20 min')
  await expect(page.locator('[data-block-index="2"]')).toContainText('20 min')
})

// ---------------------------------------------------------------------------
// 2. Days 4-6 sessions keep referencing the pre-Day8 revision and their
//    original 900 s target — an Accept on Day 8 never rewrites history.
// ---------------------------------------------------------------------------

test('sessions from Days 4-6 still reference the pre-Day8 revision with their original 900 s target', async ({
  page,
  demo,
}) => {
  expect(daysFourToSixSessionIds).toHaveLength(5)

  await acceptDay8Suggestion(page, demo, pendingRevision.id)

  for (const sessionId of daysFourToSixSessionIds) {
    const session = await demo.session(sessionId)
    expect(session.revisionId).toBe(pendingRevision.id)
    expect(session.targetSeconds).toBe(900)
  }
})

// ---------------------------------------------------------------------------
// 3. A Day 8 session started from Today references the NEW revision and
//    starts at the new 1200 s target.
// ---------------------------------------------------------------------------

test('a Day 8 session started from Today references the accepted revision and starts at 1200 s', async ({
  page,
  demo,
}) => {
  const acceptedRevision = await acceptDay8Suggestion(page, demo, pendingRevision.id)

  await page.getByLabel('What will you produce?').fill('Verify a Day 8 session starts at the new target')
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await page.waitForURL(/\/focus\/[0-9a-f-]{36}$/i)

  const active = await demo.active()
  if (active === null) {
    throw new Error('day8-revision: GET /sessions/active returned null right after starting a Day 8 block')
  }
  expect(active.revisionId).toBe(acceptedRevision.id)
  expect(active.targetSeconds).toBe(1200)
})

// ---------------------------------------------------------------------------
// 4. Progress lists both the pre-Day8 and the Day-8 revisions; the practice
//    section shows 15- and 20-minute blocks with the durations-vary note;
//    the result state (working-day has no final attempts yet, so there is
//    no comparison card at all — final_pending) is unchanged from the
//    pre-revision snapshot.
// ---------------------------------------------------------------------------

test('Progress lists both revisions, the practice section shows 15- and 20-minute blocks, and the result state is unchanged', async ({
  page,
  demo,
}) => {
  const acceptedRevision = await acceptDay8Suggestion(page, demo, pendingRevision.id)
  await demo.completePracticeBlock(programId, 1200, { outputQuality: 'yes', episodeCount: 0 })

  const postReport = await demo.report(programId)
  expect(postReport.resultState).toBe(preReport.resultState)
  expect(postReport.comparison).toBeUndefined()
  expect(preReport.comparison).toBeUndefined()

  const acceptedRevisionRow = postReport.revisions.find((revision) => revision.id === acceptedRevision.id)
  expect(acceptedRevisionRow?.effectiveDay).toBe(8)
  expect(acceptedRevisionRow?.reason).toBe(PROGRESSION_ACCEPTED_REASON)
  expect(acceptedRevisionRow?.settings.practiceTargetSeconds).toBe(1200)
  const pendingRevisionRow = postReport.revisions.find((revision) => revision.id === pendingRevision.id)
  expect(pendingRevisionRow?.effectiveDay).toBe(4)
  expect(pendingRevisionRow?.reason).toBe(PROGRESSION_ACCEPTED_REASON)

  await page.goto('/progress')
  await expect(page.getByTestId('result-state-message')).toHaveText(RESULT_STATE_COPY[preReport.resultState].message)

  // The Export section (progress-report: "Export preview and download" —
  // "program metadata including ... revisions") is where Progress actually
  // lists the revisions table; CSV is the default preview format
  // (`ExportPreview.tsx`), and a `# revisions` CSV row starts
  // `revision,effective_day,practice_target_seconds,` — matching on the
  // first three fields is exact and independent of the quoted
  // `band_ceilings`/`reason`/`created_at` fields that follow.
  const exportTextLocator = page.getByTestId('export-preview-text')
  await expect(exportTextLocator).toBeVisible()
  const exportText = await exportTextLocator.innerText()
  expect(exportText).toContain(`\n${pendingRevision.revision},4,900,"`)
  expect(exportText).toContain(`\n${acceptedRevision.revision},8,1200,"`)

  const practiceSection = page.getByRole('region', { name: 'Practice' })
  await expect(practiceSection).toContainText('Durations vary by design')

  const practiceTable = page.getByRole('table', { name: 'Practice blocks' })
  await expect(practiceTable).toBeVisible()
  const practiceRows = await practiceTable.locator('tbody tr').all()
  const practiceCells = await Promise.all(practiceRows.map((row) => row.locator('td').allTextContents()))
  const twentyMinuteRow = practiceCells.find((cells) => cells[0] === '8')
  expect(twentyMinuteRow?.[3]).toBe('20')
  expect(practiceCells.some((cells) => cells[3] === '15')).toBe(true)
})

// ---------------------------------------------------------------------------
// 5. Daily section: every day without a check-in reads "Not reported" and
//    never "0" (CLAUDE.md: unknown != zero).
// ---------------------------------------------------------------------------

test('daily section: every day without a check-in reads "Not reported" and contains no 0 min', async ({ page }) => {
  const noCheckinDays = preReport.days.filter((day) => day.status === 'not_reported')
  expect(noCheckinDays.length).toBeGreaterThan(0)

  await page.goto('/progress')
  const dailyTable = page.getByRole('table', { name: 'Daily check-ins' })
  await expect(dailyTable).toBeVisible()

  const rows = await dailyTable.locator('tbody tr').all()
  const rowsByDay = new Map<string, string[]>()
  for (const row of rows) {
    const cells = await row.locator('td').allTextContents()
    const dayCell = cells[0]
    if (dayCell !== undefined) {
      rowsByDay.set(dayCell, cells)
    }
  }

  for (const day of noCheckinDays) {
    const cells = rowsByDay.get(String(day.day))
    if (cells === undefined) {
      throw new Error(`day8-revision: no daily-trend table row rendered for Day ${day.day}`)
    }
    // Status, Sleep, Mindfulness, Stress, Phone, Desktop, Tablet, Unspecified, Feed total.
    for (const cell of cells.slice(2)) {
      expect(cell).not.toBe('0')
      expect(cell).toBe('Not reported')
    }
  }
})
