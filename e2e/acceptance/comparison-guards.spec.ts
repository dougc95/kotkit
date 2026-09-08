/**
 * Task 9.1.7 — Journey: missing final and zero baseline guards on Progress.
 *
 * Two scenarios, both fixed by `packages/shared/src/fixtures/
 * demoScenarios.ts` (`missingFinalScenario`/`zeroBaselineScenario`), each
 * read directly from that file rather than re-derived here so every
 * hard-coded expectation below (episodeCount, recallScore, exclusion
 * reasons, ...) is traceable to the actual fixture row that produces it:
 *
 *  - `missing-final`: both baseline attempts and final A are eligible;
 *    final B was stopped early with S left blank, so it is ineligible
 *    (`[interval_incomplete, count_unknown]`) — one final slot short of a
 *    comparison. `resolveResultState` (`domain/comparison.ts`, D4) returns
 *    `insufficient_samples` because `computeComparison` returns `null` when
 *    any of the four slots lacks an eligible candidate, and `Progress.tsx`
 *    only ever mounts `ComparisonFigures` when `report.comparison !==
 *    undefined` (`ComparisonSchema` is `Type.Optional`, D22) — so no
 *    percentage ever renders for this state, by construction, not by a
 *    client-side check that hides one.
 *  - `zero-baseline`: every one of the four attempts reports S = 0 (an
 *    explicit zero, never blank — HANDOFF.md "unknown does not equal
 *    zero") with a full, five-point recall, so `computeComparison` DOES
 *    resolve (`s0 = s14 = 0`) and `resolveResultState` returns
 *    `zero_baseline`. `episodeCount === 0` also drives `firstSwitchKind:
 *    'none_capped'` for every attempt in `eligibleAttempt()`
 *    (`demoScenarios.ts`), so T is "20+, capped" everywhere and
 *    `firstSwitchMeanSeconds` is `null` (not all four are `known`) — no
 *    mean-T figure renders.
 *
 * Named tests below mirror `tasks-detail.md`'s own four, in order.
 *
 * Spec refs: progress-report: No complete comparison until two plus two /
 * Missing final · progress-report: Comparison mathematics / Zero baseline
 * fixture · progress-report: Comparison mathematics / Capped first-switch
 * values · progress-report: Sample counts and provenance are always visible
 * / One eligible baseline · progress-report: Export preview and download /
 * Export with a blank count · progress-report: Charts carry exact values /
 * Chart with capped value · benchmark-assessment: First-switch time has
 * three distinct states / No switches · identity-realm: Demo-only controls
 * exist only in demo mode / Load a demonstration scenario.
 *
 * One interpretive note, same spirit as `e2e/progress.spec.ts`'s own header
 * comment: the brief's "chart labels carry 20+, capped" is satisfied by the
 * real app's `AttemptTable` (the progress-report spec's own requirement is
 * "the chart OR table shows '20+, capped'", disjunctive) — CLAUDE.md scopes
 * Recharts to the practice/daily trend sections only, and neither of those
 * charts plots a benchmark attempt's first-switch time, so there is no
 * separate "chart" rendering of T to assert against.
 */
import { EXCLUSION_REASON_COPY, RESULT_STATE_COPY } from '@attention-lab/shared'
import type { AttemptValue, BenchmarkPhase, SlotLabel } from '@attention-lab/shared'

import { expect, test } from '../support/demo.js'

test.beforeEach(async ({ demo }) => {
  await demo.reset()
})

// ---------------------------------------------------------------------------
// CSV parsing helper — mirrors the RFC 4180 section layout `apps/api/src/
// services/export/csv.ts`'s `buildCsv` produces (`# <name>` line, header
// row, data rows, one blank line between sections) without importing that
// server-only module: the wire text `ExportPreview.tsx` renders verbatim IS
// the contract this test verifies, so parsing it here at the same level the
// real UI exposes it keeps this test honest about what a viewer actually
// sees.
// ---------------------------------------------------------------------------

function csvSection(csv: string, sectionName: string): { header: readonly string[]; rows: readonly string[][] } {
  const blocks = csv.split('\n\n')
  const block = blocks.find((candidate) => candidate.startsWith(`# ${sectionName}`))
  if (block === undefined) {
    throw new Error(`comparison-guards.spec: CSV section "${sectionName}" not found in:\n${csv}`)
  }
  const lines = block.split('\n').filter((line) => line.length > 0)
  const [, headerLine, ...dataLines] = lines
  if (headerLine === undefined) {
    throw new Error(`comparison-guards.spec: CSV section "${sectionName}" has no header row`)
  }
  return { header: headerLine.split(','), rows: dataLines.map((line) => line.split(',')) }
}

function csvCell(row: readonly string[], header: readonly string[], column: string): string {
  const index = header.indexOf(column)
  if (index === -1) {
    throw new Error(`comparison-guards.spec: CSV column "${column}" not found in header [${header.join(', ')}]`)
  }
  const value = row[index]
  if (value === undefined) {
    throw new Error(
      `comparison-guards.spec: CSV row missing column "${column}" (index ${index}): [${row.join(', ')}]`,
    )
  }
  return value
}

/**
 * A `ReportedCount` (or any nullable number) as `csv.ts`'s own `numberCell`
 * renders it: `null` -> `''`, otherwise the plain digits (`0` stays `'0'`,
 * never blank — HANDOFF.md "unknown does not equal zero").
 */
function expectedNumberCell(value: number | null): string {
  return value === null ? '' : String(value)
}

function findAttempt(
  attempts: readonly AttemptValue[],
  phase: BenchmarkPhase,
  label: SlotLabel,
): AttemptValue {
  const attempt = attempts.find((candidate) => candidate.phase === phase && candidate.label === label)
  if (attempt === undefined) {
    throw new Error(`comparison-guards.spec: no ${phase}:${label} attempt in report.attempts`)
  }
  return attempt
}

// ---------------------------------------------------------------------------
// missing-final
// ---------------------------------------------------------------------------

test('missing final: insufficient copy, no percentage in the comparison card, 1 of 2 final samples, the ineligible final listed with its reason', async ({
  page,
  demo,
}) => {
  const { programId } = await demo.load('missing-final')
  if (programId === null) {
    throw new Error('comparison-guards.spec: missing-final scenario returned no programId')
  }

  const report = await demo.report(programId)
  expect(report.resultState).toBe('insufficient_samples')
  expect(report.comparison).toBeUndefined()
  expect(report.samples).toEqual({ baselineEligible: 2, finalEligible: 1 })

  const finalB = findAttempt(report.attempts, 'final', 'B')
  expect(finalB.eligible).toBe(false)
  expect(finalB.exclusionReasons).toEqual(['interval_incomplete', 'count_unknown'])

  await page.goto('/progress')

  await expect(page.getByTestId('result-state-message')).toHaveText(RESULT_STATE_COPY.insufficient_samples.message)
  // `insufficient_samples` carries no headline (D38 reserves the one
  // headline for `improvement_maintained_recall`).
  await expect(page.getByTestId('result-state-headline')).toHaveCount(0)
  // `Progress.tsx` never mounts `ComparisonFigures` (the percentage figure's
  // only home) unless `report.comparison !== undefined` — this state has no
  // comparison at all, so there is no percentage anywhere on the card.
  await expect(page.getByTestId('comparison-figures')).toHaveCount(0)

  const resultStateText = await page.getByTestId('result-state').innerText()
  expect(resultStateText).not.toContain('%')

  await expect(page.getByText('2 of 2 baseline samples eligible · 1 of 2 final samples eligible')).toBeVisible()

  const finalBRow = page.locator('tr').filter({ has: page.getByTestId(`eligibility-${finalB.attemptId}`) })
  await expect(finalBRow).toContainText('Not eligible')
  await expect(finalBRow).toContainText(EXCLUSION_REASON_COPY.interval_incomplete)
  await expect(finalBRow).toContainText(EXCLUSION_REASON_COPY.count_unknown)
})

test('missing final: CSV lists the ineligible attempt with eligibility false and its exclusion reason; every value the report returns as null is an empty cell, never 0', async ({
  page,
  demo,
}) => {
  const { programId } = await demo.load('missing-final')
  if (programId === null) {
    throw new Error('comparison-guards.spec: missing-final scenario returned no programId')
  }

  const report = await demo.report(programId)
  expect(report.attempts.length).toBe(4)

  await page.goto('/progress')
  // CSV is the default format — explicit anyway so this test does not
  // silently depend on FormatToggle's initial state staying 'csv' (same
  // convention as `e2e/progress.spec.ts`'s own export tests).
  await page.getByRole('radio', { name: 'CSV', exact: true }).check()
  const csv = await page.getByTestId('export-preview-text').innerText()

  const { header, rows } = csvSection(csv, 'attempts')
  expect(rows.length).toBe(4)

  // Cross-check every attempt row's S / recall score / E: wherever the
  // report returns `null`, the CSV cell must be exactly `''` — never `'0'`
  // — and wherever it returns a real number (including an explicit `0`,
  // not present in this scenario but the rule the fixture proves either
  // way), the CSV cell carries the plain digits.
  for (const attempt of report.attempts) {
    const row = rows.find((candidate) => csvCell(candidate, header, 'attempt_id') === attempt.attemptId)
    if (row === undefined) {
      throw new Error(`comparison-guards.spec: no CSV row for attempt ${attempt.attemptId} (${attempt.phase}:${attempt.label})`)
    }
    expect(csvCell(row, header, 's'), `s cell for ${attempt.phase}:${attempt.label}`).toBe(
      expectedNumberCell(attempt.episodeCount),
    )
    expect(csvCell(row, header, 'recall_score'), `recall_score cell for ${attempt.phase}:${attempt.label}`).toBe(
      expectedNumberCell(attempt.recallScore),
    )
    expect(csvCell(row, header, 'e'), `e cell for ${attempt.phase}:${attempt.label}`).toBe(
      expectedNumberCell(attempt.externalCount),
    )
  }

  const finalB = findAttempt(report.attempts, 'final', 'B')
  const finalBRow = rows.find((candidate) => csvCell(candidate, header, 'attempt_id') === finalB.attemptId)
  if (finalBRow === undefined) {
    throw new Error('comparison-guards.spec: no CSV row for the ineligible final:B attempt')
  }
  expect(csvCell(finalBRow, header, 'eligible')).toBe('false')
  expect(csvCell(finalBRow, header, 's')).toBe('')
  expect(csvCell(finalBRow, header, 's_method')).toBe('')
  const exclusionCell = csvCell(finalBRow, header, 'exclusion_reasons')
  expect(exclusionCell).toContain('interval_incomplete')
  expect(exclusionCell).toContain('count_unknown')
})

// ---------------------------------------------------------------------------
// zero-baseline
// ---------------------------------------------------------------------------

test('zero baseline: "No switches were reported at baseline; a percentage reduction does not apply.", not applicable, absolute 0 -> 0 visible, recall means shown, and none of Infinity / NaN / 100% / -% / undefined anywhere', async ({
  page,
  demo,
}) => {
  const { programId } = await demo.load('zero-baseline')
  if (programId === null) {
    throw new Error('comparison-guards.spec: zero-baseline scenario returned no programId')
  }

  const report = await demo.report(programId)
  expect(report.resultState).toBe('zero_baseline')
  if (report.comparison === undefined) {
    throw new Error('comparison-guards.spec: zero-baseline scenario produced no comparison')
  }
  // s0 = 0 (an explicit, reported zero at every baseline attempt — never a
  // blank coalesced to 0) is exactly what makes `percentageReduction` null
  // and `resolveResultState` choose `zero_baseline` (`domain/comparison.ts`).
  expect(report.comparison.s0).toBe(0)
  expect(report.comparison.s14).toBe(0)
  expect(report.comparison.percentageReduction).toBeNull()
  expect(report.comparison.recallBaselineMean).toBe(5)
  expect(report.comparison.recallFinalMean).toBe(5)

  await page.goto('/progress')

  await expect(page.getByTestId('result-state-message')).toHaveText(RESULT_STATE_COPY.zero_baseline.message)
  await expect(page.getByTestId('result-state-headline')).toHaveCount(0)

  // Absolute counts stay visible even at zero — "0 → 0" is rendered, never
  // suppressed the way a falsy-check bug would hide it.
  await expect(page.getByTestId('s0-s14-figure')).toHaveText('0 → 0')
  await expect(page.getByTestId('percentage-figure')).toHaveText('Percentage: not applicable')
  await expect(page.getByTestId('recall-means-figure')).toHaveText('recall 5 → 5')

  const bodyText = await page.locator('body').innerText()
  expect(bodyText).not.toMatch(/Infinity|NaN|100%|-%|undefined/)
})

test('zero baseline: every attempt shows T as 20+, capped, never Unknown, and no mean T is displayed', async ({
  page,
  demo,
}) => {
  const { programId } = await demo.load('zero-baseline')
  if (programId === null) {
    throw new Error('comparison-guards.spec: zero-baseline scenario returned no programId')
  }

  const report = await demo.report(programId)
  expect(report.attempts.length).toBe(4)
  for (const attempt of report.attempts) {
    expect(attempt.firstSwitch?.kind, `${attempt.phase}:${attempt.label} firstSwitch.kind`).toBe('none_capped')
  }
  if (report.comparison === undefined) {
    throw new Error('comparison-guards.spec: zero-baseline scenario produced no comparison')
  }
  // Not all four are `known` (all four are `none_capped`), so the server
  // never computes a partial mean — `firstSwitchMeanSeconds` stays `null`
  // and `ComparisonFigures` renders no `mean-first-switch-figure` at all.
  expect(report.comparison.firstSwitchMeanSeconds).toBeNull()

  await page.goto('/progress')

  await expect(page.getByTestId('mean-first-switch-figure')).toHaveCount(0)

  for (const attempt of report.attempts) {
    const cell = page.getByTestId(`t-${attempt.attemptId}`)
    await expect(cell).toHaveText('20+, capped')
    await expect(cell).not.toContainText('Unknown')
  }
})
