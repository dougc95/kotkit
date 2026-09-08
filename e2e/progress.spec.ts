/**
 * Task 8.8.5 (design.md D4, D22, D35; progress-report spec: "Result state
 * with precedence", "No invented scores", "Sample counts and provenance are
 * always visible", "Comparison mathematics" / "Comparable change fixture"
 * and "Zero baseline fixture", "Export preview and download" / "Demo
 * export"; identity-realm: "Demo-only controls exist only in demo mode" /
 * "Load a demonstration scenario"). Drives the real Progress screen (8.8.1
 * -> 8.8.4) against every scenario `packages/shared/src/fixtures/
 * demoScenarios.ts` exports, reading each one's own `expected.resultState`
 * (D35) rather than hard-coding a parallel list that could drift from the
 * fixture module, plus two download cases against the `comparable-change`
 * scenario the task brief names for the export check.
 *
 * `RESULT_STATE_COPY` and `CAUSE_NOTE` are imported from `@attention-lab/
 * shared` (2.4.2) rather than retyped here — the same "one owner" reasoning
 * `ResultState.tsx`/`ComparisonFigures.tsx` themselves follow (D4: no score,
 * copy or figure is ever re-derived client-side, and this spec extends that
 * to "never re-derived test-side" either).
 *
 * One interpretive note, reached by reading the real fixture and the real
 * built app rather than guessing: the task brief additionally asks this file
 * to "assert the timing_deviation reason copy appears in the attempt table"
 * for the `timing-deviation` scenario. That is not achievable against what
 * is actually on disk. `timingDeviationScenario()` (`demoScenarios.ts`)
 * carries exactly one session — baseline A, lifecycle `'running'` — and no
 * OTHER session at all (baseline B was never attempted, no final attempt
 * exists). `evaluateEligibility`'s `timing_deviation` reason
 * (`packages/shared/src/domain/eligibility.ts`) is only ever computed at
 * finalize; the report's own attempts mapper
 * (`apps/api/src/services/report/attempts.ts`) overlays every NON-finalized
 * row with `{ eligible: false, exclusionReasons: [] }` regardless of what
 * the session's live timing looks like (confirmed directly against that
 * file, not inferred) — and `AttemptTable.tsx` renders that empty array via
 * `formatExclusionReasons([])`, which is the literal `'—'`, never exclusion
 * copy. No scenario in the whole `DEMO_SCENARIOS` registry ever produces a
 * FINALIZED attempt whose `sessionLocalDate` differs from its slot's
 * `assignedLocalDate` (every `eligibleAttempt(...)` call in the fixture file
 * uses the same day number for both), so this exact assertion cannot pass
 * against any real scenario today, not only this one. The `timing-deviation`
 * case below asserts the real, verified behavior instead: a single row,
 * still `Running`, with `NOT_FINALIZED` ('Not finalized') in its scored
 * columns — the same "in-progress attempt is never mistaken for a finalized
 * one with unreported counts" guarantee 8.8.1's own header comment names.
 */
import { readFileSync } from 'node:fs'

import { CAUSE_NOTE, DEMO_SCENARIO_NAMES, DEMO_SCENARIOS, RESULT_STATE_COPY } from '@attention-lab/shared'
import type { DemoScenarioName } from '@attention-lab/shared'

import { expect, test } from './support/demo.js'
import { expectNoPunitiveCopy } from './support/copy.js'

test.afterEach(async ({ demo }) => {
  await demo.reset()
})

/** The task brief's own no-invented-score guard, asserted verbatim against `body.innerText()`. */
const NO_SCORE_PATTERN = /attention \+|attention score|confidence interval|significan|p\s*[<=]/i

/** The literal first line of every demo-realm export (verified against `ExportPreview.test.tsx`'s own fixture and `apps/api/src/services/export/csv.ts`'s `EXPORT_DEMO_LABEL`, which `markdown.ts` reuses unchanged). */
const EXPORT_DEMO_LABEL_LINE = '# Demonstration data — synthetic local-demo records, not a real measurement'

// ---------------------------------------------------------------------------
// 8 scenario cases: RESULT_STATE_COPY, samples line, no-score guard, plus
// each scenario's own extra per-fixture assertions.
// ---------------------------------------------------------------------------

for (const name of DEMO_SCENARIO_NAMES) {
  test(`${name}: renders its result state with no invented score`, async ({ page, demo }) => {
    await demo.load(name)
    await page.goto('/progress')

    const scenario = DEMO_SCENARIOS[name]
    const expectedState = scenario.expected.resultState

    if (expectedState === null) {
      // new-user: the neutral empty state, no numeric cards of any kind.
      await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible()
      await expect(
        page.getByText('There is nothing to report yet. Set up your program to start your baseline.'),
      ).toBeVisible()
      await expect(page.getByRole('link', { name: 'Go to setup' })).toBeVisible()

      await expect(page.getByTestId('result-state')).toHaveCount(0)
      await expect(page.getByTestId('comparison-figures')).toHaveCount(0)
      await expect(page.getByText(/of 2 baseline samples eligible/)).toHaveCount(0)
      await expect(page.locator('table')).toHaveCount(0)
      return
    }

    const copy = RESULT_STATE_COPY[expectedState]
    await expect(page.getByTestId('result-state-message')).toHaveText(copy.message)
    if (copy.headline === null) {
      await expect(page.getByTestId('result-state-headline')).toHaveCount(0)
    } else {
      await expect(page.getByTestId('result-state-headline')).toHaveText(copy.headline)
    }

    await expect(page.getByText(/of 2 baseline samples eligible/)).toBeVisible()
    await expect(page.getByText('All counts are self-reported').first()).toBeVisible()

    const bodyText = await page.locator('body').innerText()
    expect(bodyText).not.toMatch(NO_SCORE_PATTERN)
    await expectNoPunitiveCopy(page)

    if (name === 'comparable-change') {
      await expect(page.getByTestId('s0-s14-figure')).toHaveText('5 → 3')
      await expect(page.getByTestId('change-figure')).toHaveText('2 fewer switches')
      await expect(page.getByTestId('percentage-figure')).toHaveText('40% reduction')
      await expect(page.getByTestId('cause-note')).toHaveText(CAUSE_NOTE)
    }

    if (name === 'zero-baseline') {
      await expect(page.getByTestId('percentage-figure')).toHaveText('Percentage: not applicable')
      expect(bodyText).not.toMatch(/Infinity|NaN|100%/)
    }

    if (name === 'timing-deviation') {
      // See the file header: no scenario ever produces a finalized attempt
      // with a `timing_deviation` exclusion reason, so this checks the real,
      // verified substitute — a single still-running row that never shows a
      // finalized-only value as though it were reported. Scoped to the
      // attempts table specifically (its sr-only <caption> is its accessible
      // name) — the Daily check-ins table below it has its own <tbody><tr>
      // for "not yet reported" Day 0, which a bare 'tbody tr' locator would
      // also match.
      const rows = page.getByRole('table', { name: 'Benchmark attempts' }).locator('tbody tr')
      await expect(rows).toHaveCount(1)
      await expect(rows.first()).toContainText('Running')
      await expect(rows.first()).toContainText('Not finalized')
    }
  })
}

// ---------------------------------------------------------------------------
// 2 export cases: CSV and Markdown downloads against `comparable-change`.
// ---------------------------------------------------------------------------

test('export download: CSV begins with the demonstration label and lists phase,label in the attempts header', async ({
  page,
  demo,
}) => {
  await demo.load('comparable-change')
  await page.goto('/progress')

  // CSV is the default format — explicit anyway so this test does not
  // silently depend on FormatToggle's initial state staying 'csv'.
  await page.getByRole('radio', { name: 'CSV' }).check()
  await expect(page.getByTestId('export-preview-text')).toContainText('# program')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download' }).click()
  const download = await downloadPromise

  const filePath = await download.path()
  if (filePath === null) {
    throw new Error('progress.spec: CSV download produced no local file path')
  }
  const content = readFileSync(filePath, 'utf-8')
  const firstLine = content.split('\n')[0]
  expect(firstLine).toBe(EXPORT_DEMO_LABEL_LINE)
  expect(content).toMatch(/attempt_id,phase,label,local_date,/)
})

test('export download: Markdown begins with the demonstration label and lists phase,label in the attempts header', async ({
  page,
  demo,
}) => {
  await demo.load('comparable-change')
  await page.goto('/progress')

  await page.getByRole('radio', { name: 'Markdown' }).check()
  await expect(page.getByTestId('export-preview-text')).toContainText('# Attention Lab program record')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download' }).click()
  const download = await downloadPromise

  const filePath = await download.path()
  if (filePath === null) {
    throw new Error('progress.spec: Markdown download produced no local file path')
  }
  const content = readFileSync(filePath, 'utf-8')
  const firstLine = content.split('\n')[0]
  expect(firstLine).toBe(EXPORT_DEMO_LABEL_LINE)
  expect(content).toMatch(/\|\s*attempt_id\s*\|\s*phase\s*\|\s*label\s*\|\s*local_date\s*\|/)
})
