/**
 * Task 9.1.6 — Journey: comparable change and mixed result on Progress with
 * export. Drives the real Progress screen (8.8.1–8.8.4) against the
 * `comparable-change` and `mixed-result` demo fixtures
 * (`packages/shared/src/fixtures/demoScenarios.ts`), reading their expected
 * figures from what those fixtures actually encode rather than an
 * independently-guessed number:
 *
 *  - `comparable-change`: baseline S 6, 4 (mean 5) → final S 3, 3 (mean 3),
 *    a 40% reduction (`percentageReduction`); recall 4, 4 → 4, 4 (mean
 *    unchanged) — `resultState: 'improvement_maintained_recall'`
 *    (`RESULT_STATE_COPY`'s headline "Fewer reported switches", D38).
 *  - `mixed-result`: the identical S numbers (5 → 3, 40%), but recall
 *    4, 4 → 2, 2 (mean 4 → 2) — `resultState: 'fewer_switches_lower_recall'`,
 *    which has no headline and no success framing (app-shell: "Copy never
 *    punishes or gamifies").
 *
 * D4 throughout: no figure here is ever recomputed client-side or test-side
 * — every assertion reads a value the server/report already computed
 * (`ResultState.tsx`/`ComparisonFigures.tsx`'s own header comments) or a
 * constant re-exported from `@attention-lab/shared` (`RESULT_STATE_COPY`,
 * `CAUSE_NOTE`) — never a re-worded copy of the PRD text.
 *
 * One interpretive note, reached by reading the real `demo.ts` (already
 * built by 9.1.1/9.1.2) rather than guessing: this task's own brief names
 * `demo.exportText(id, 'csv')` for the `Cache-Control: no-store` header
 * check. `DemoClient` (`e2e/support/demo.ts`, which this task may only
 * import, never edit — D16) exposes no such method; its whole surface is
 * `reset/load/setClock/offset/me/current/today/active/session/report/
 * readyProgram/completePracticeBlock/setDay`, nothing export-shaped. D37's
 * single-origin topology makes the real substitute straightforward and
 * exactly as authoritative: `page.request` is scoped to the same
 * `ACCEPTANCE_ORIGIN` `page.goto` uses (`playwright.config.ts`'s
 * `acceptance` project sets both `baseURL` and `apiBaseURL` to it), so a
 * direct `page.request.get('/api/v1/programs/{id}/export?format=csv')`
 * reaches the identical route `ExportPreview`'s own fetch does and reads its
 * real response headers — `apps/api/src/routes/export.ts`'s own header
 * comment confirms `Cache-Control: no-store` is applied to this route (and
 * every private `/api/v1/*` response) by the global `noStore` plugin (3.2.2),
 * so this is the real, verified behavior, not an approximation of it.
 */
import { readFileSync } from 'node:fs'

import { CAUSE_NOTE, RESULT_STATE_COPY } from '@attention-lab/shared'
import type { ScenarioLoadResponseValue } from '@attention-lab/shared'

import { expectNoPunitiveCopy } from '../support/copy.js'
import { expect, test } from '../support/demo.js'

/** The literal first line of every demo-realm export (`EXPORT_DEMO_LABEL`, `apps/api/src/services/export/csv.ts` — reused unchanged by `markdown.ts`). */
const EXPORT_DEMO_LABEL_LINE = '# Demonstration data — synthetic local-demo records, not a real measurement'

/** Forbidden framings named by this task's own brief (invented-score/statistics wording CLAUDE.md's "No invented attention score" invariant rules out). */
const FORBIDDEN_FRAMING_PATTERN = /attention \+|attention score|improved by|confidence interval|significan|p\s*[<=]/i

function requireProgramId(result: ScenarioLoadResponseValue, scenario: string): string {
  if (result.programId === null) {
    throw new Error(`comparison-outcomes.spec: scenario "${scenario}" loaded with no program`)
  }
  return result.programId
}

test.beforeEach(async ({ demo }) => {
  await demo.reset()
})

test('comparable change: 5 -> 3, 2 fewer switches, 40% reduction, recall 4 -> 4, 2 of 2 baseline and 2 of 2 final samples', async ({
  page,
  demo,
}) => {
  const loaded = await demo.load('comparable-change')
  const id = requireProgramId(loaded, 'comparable-change')
  await page.goto('/progress')

  const copy = RESULT_STATE_COPY.improvement_maintained_recall
  if (copy.headline === null) {
    throw new Error('improvement_maintained_recall unexpectedly has no headline (D38)')
  }
  await expect(page.getByTestId('result-state-headline')).toHaveText(copy.headline)
  await expect(page.getByTestId('result-state-message')).toHaveText(copy.message)
  await expect(page.getByTestId('cause-note')).toHaveText(CAUSE_NOTE)
  expect(CAUSE_NOTE).toMatch(/does not establish cause/i)

  // "the cause note is present" and "self-reported labels the counts".
  await expect(page.getByText('All counts are self-reported').first()).toBeVisible()

  await expect(page.getByTestId('s0-s14-figure')).toHaveText('5 → 3')
  await expect(page.getByTestId('change-figure')).toHaveText('2 fewer switches')
  await expect(page.getByTestId('percentage-figure')).toHaveText('40% reduction')
  await expect(page.getByTestId('recall-means-figure')).toHaveText('recall 4 → 4')

  await expect(page.getByText(/2 of 2 baseline samples eligible/)).toBeVisible()
  await expect(page.getByText(/2 of 2 final samples eligible/)).toBeVisible()

  const report = await demo.report(id)
  expect(report.resultState).toBe('improvement_maintained_recall')
  expect(report.samples).toEqual({ baselineEligible: 2, finalEligible: 2 })
  if (report.comparison === undefined) {
    throw new Error('comparable-change: report.comparison is unexpectedly absent')
  }
  expect(report.comparison.percentageReduction).toBe(40)
})

test('comparable change: forbidden framings absent', async ({ page, demo }) => {
  const loaded = await demo.load('comparable-change')
  const id = requireProgramId(loaded, 'comparable-change')
  await page.goto('/progress')

  const bodyText = await page.locator('body').innerText()
  expect(bodyText).not.toMatch(FORBIDDEN_FRAMING_PATTERN)
  await expectNoPunitiveCopy(page)

  const report = await demo.report(id)
  expect(report.resultState).toBe('improvement_maintained_recall')
  if (report.comparison === undefined) {
    throw new Error('comparable-change: report.comparison is unexpectedly absent')
  }
  expect(report.comparison.percentageReduction).toBe(40)
})

test('mixed result: same switch numbers, recall 4 -> 2, "Switches decreased, but recall was lower. These results are mixed.", no success banner', async ({
  page,
  demo,
}) => {
  const loaded = await demo.load('mixed-result')
  const id = requireProgramId(loaded, 'mixed-result')
  await page.goto('/progress')

  const copy = RESULT_STATE_COPY.fewer_switches_lower_recall
  expect(copy.headline).toBeNull()
  await expect(page.getByTestId('result-state-headline')).toHaveCount(0)
  await expect(page.getByTestId('result-state-message')).toHaveText(
    'Switches decreased, but recall was lower. These results are mixed.',
  )
  expect(copy.message).toBe('Switches decreased, but recall was lower. These results are mixed.')

  // The switch numbers themselves are identical to comparable-change — only
  // recall differs (5 → 3 still present here).
  await expect(page.getByTestId('s0-s14-figure')).toHaveText('5 → 3')
  await expect(page.getByTestId('change-figure')).toHaveText('2 fewer switches')
  await expect(page.getByTestId('percentage-figure')).toHaveText('40% reduction')
  await expect(page.getByTestId('recall-means-figure')).toHaveText('recall 4 → 2')

  const bodyText = await page.locator('body').innerText()
  expect(bodyText).not.toMatch(/recall was maintained/i)
  expect(bodyText).not.toMatch(/congratulations|well done|success/i)
  await expectNoPunitiveCopy(page)

  const report = await demo.report(id)
  expect(report.resultState).toBe('fewer_switches_lower_recall')
})

test('export preview and both downloads begin with the demo label and carry the per-attempt fields', async ({
  page,
  demo,
}) => {
  const loaded = await demo.load('comparable-change')
  const id = requireProgramId(loaded, 'comparable-change')
  await page.goto('/progress')

  // --- CSV: preview label, download, header columns, S cells, realm cells ---
  await page.getByRole('radio', { name: 'CSV' }).check()
  await expect(page.getByTestId('export-preview-text')).toContainText('# program')
  await expect(page.getByTestId('export-label-line')).toHaveText(EXPORT_DEMO_LABEL_LINE)

  const csvDownloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download' }).click()
  const csvDownload = await csvDownloadPromise
  const csvPath = await csvDownload.path()
  if (csvPath === null) {
    throw new Error('comparison-outcomes.spec: CSV download produced no local file path')
  }
  const csvContent = readFileSync(csvPath, 'utf-8')
  const csvLines = csvContent.split('\n')
  expect(csvLines[0]).toBe(EXPORT_DEMO_LABEL_LINE)

  const attemptsHeaderLine = csvLines.find((line) => line.startsWith('attempt_id,'))
  if (attemptsHeaderLine === undefined) {
    throw new Error('comparison-outcomes.spec: CSV has no attempts header row')
  }
  const attemptsHeaderIndex = csvLines.indexOf(attemptsHeaderLine)
  const columns = attemptsHeaderLine.split(',')
  for (const column of [
    'phase',
    'label',
    'local_date',
    'realm',
    'time_source',
    's',
    's_method',
    't_state',
    'recall_score',
    'e',
    'm',
    'disruption',
    'device_format',
    'eligible',
    'exclusion_reasons',
    'protocol_revision',
  ]) {
    expect(columns, `attempts header missing column "${column}": ${attemptsHeaderLine}`).toContain(column)
  }

  const sIndex = columns.indexOf('s')
  const realmIndex = columns.indexOf('realm')
  // Fixed order (`loadAttemptSummaries`'s `orderBy(phase, label, startedAt)`):
  // baseline:A, baseline:B, final:A, final:B — matching the fixture's own
  // 6, 4, 3, 3 episode counts (`comparableChangeScenario()`).
  const attemptRows = csvLines
    .slice(attemptsHeaderIndex + 1, attemptsHeaderIndex + 5)
    .map((row) => row.split(','))
  expect(attemptRows).toHaveLength(4)
  expect(attemptRows.map((cells) => cells[sIndex])).toEqual(['6', '4', '3', '3'])
  for (const cells of attemptRows) {
    expect(cells[realmIndex]).toBe('demo')
  }

  const report = await demo.report(id)
  expect(report.realm).toBe('demo')

  // --- Markdown: preview label, download ---
  await page.getByRole('radio', { name: 'Markdown' }).check()
  await expect(page.getByTestId('export-preview-text')).toContainText('# Attention Lab program record')
  await expect(page.getByTestId('export-label-line')).toHaveText(EXPORT_DEMO_LABEL_LINE)

  const mdDownloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download' }).click()
  const mdDownload = await mdDownloadPromise
  const mdPath = await mdDownload.path()
  if (mdPath === null) {
    throw new Error('comparison-outcomes.spec: Markdown download produced no local file path')
  }
  const mdContent = readFileSync(mdPath, 'utf-8')
  expect(mdContent.split('\n')[0]).toBe(EXPORT_DEMO_LABEL_LINE)

  // --- no-store on the real export route (see the file header's interpretive note) ---
  const csvResponse = await page.request.get(`/api/v1/programs/${id}/export?format=csv`)
  expect(csvResponse.status()).toBe(200)
  expect(csvResponse.headers()['cache-control']).toContain('no-store')
})

test('a practice block completed on Day 14 (setDay 14, completePracticeBlock) appears in the practice section and leaves report.comparison and the comparison card text unchanged', async ({
  page,
  demo,
}) => {
  const loaded = await demo.load('comparable-change')
  const id = requireProgramId(loaded, 'comparable-change')

  const before = await demo.report(id)
  expect(before.practice).toHaveLength(0)
  if (before.comparison === undefined) {
    throw new Error('comparable-change: report.comparison is unexpectedly absent before the Day 14 practice block')
  }

  await page.goto('/progress')
  await expect(page.getByTestId('s0-s14-figure')).toHaveText('5 → 3')
  await expect(page.getByTestId('percentage-figure')).toHaveText('40% reduction')
  await expect(page.getByTestId('result-state-message')).toHaveText(
    RESULT_STATE_COPY.improvement_maintained_recall.message,
  )

  const current = await demo.current()
  if (current.revision === null) {
    throw new Error('comparable-change: no governing revision to read practiceTargetSeconds from')
  }

  await demo.setDay(14)
  await demo.completePracticeBlock(id, current.revision.settings.practiceTargetSeconds)

  const after = await demo.report(id)
  expect(after.practice).toHaveLength(1)
  expect(after.practice[0]?.day).toBe(14)
  expect(after.resultState).toBe(before.resultState)
  expect(after.comparison).toEqual(before.comparison)

  await page.reload()
  await expect(page.getByTestId('s0-s14-figure')).toHaveText('5 → 3')
  await expect(page.getByTestId('change-figure')).toHaveText('2 fewer switches')
  await expect(page.getByTestId('percentage-figure')).toHaveText('40% reduction')
  await expect(page.getByTestId('recall-means-figure')).toHaveText('recall 4 → 4')
  await expect(page.getByTestId('result-state-message')).toHaveText(
    RESULT_STATE_COPY.improvement_maintained_recall.message,
  )

  const practiceTable = page.getByRole('table', { name: 'Practice blocks' })
  await expect(practiceTable).toBeVisible()
  await expect(practiceTable.locator('tbody tr')).toHaveCount(1)
  await expect(practiceTable).toContainText('14')
})
