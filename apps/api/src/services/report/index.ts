/**
 * Task 6.2.1 — `buildReport`: the report's core (attempts, samples, the
 * baseline/final comparison and the one result state), assembled from
 * `loadAttemptSummaries` (`./attempts.js`) plus the two pieces only this
 * layer can add — today's program day and the comparison/result-state
 * derivation, both of which need `ctx.now` and the program's own stored
 * `baselineDate`/`timezone`.
 *
 * `warnings[]` (6.2.3) is computed here from the same attempts
 * `loadAttemptSummaries` already loaded, via `./warnings.js`'s
 * `reportWarnings`. `practice[]`/`days[]` (6.2.4) are loaded by
 * `./practice.js`'s `loadPracticeRows` and `./days.js`'s `loadDaySummaries`
 * — both take the already-loaded, already-ownership-checked `program` row
 * this function got from `loadAttemptSummaries`, so neither re-queries or
 * re-checks ownership a second way (D16).
 *
 * See design.md's API contracts table (`GET /programs/{id}/report`) and D4
 * ("the API never computes S0/S14 or a percentage itself" — that arithmetic
 * lives entirely in `packages/shared`'s `computeComparison`/
 * `resolveResultState`, never re-derived here).
 */
import {
  computeComparison,
  currentProgramDay,
  resolveResultState,
  type AttemptValue,
  type ComparabilityWarningValue,
  type ComparisonValue,
  type DayRowValue,
  type PracticeRowValue,
  type Realm,
  type ResultState,
  type RevisionResponseValue,
} from '@attention-lab/shared'

import type { AppDatabase } from '../../plugins/db.js'
import type { RequestContext } from '../../plugins/identity.js'
import { finalAttemptsExist, loadAttemptSummaries } from './attempts.js'
import { loadDaySummaries } from './days.js'
import { loadPracticeRows } from './practice.js'
import { reportWarnings } from './warnings.js'

export interface BuildReportResult {
  readonly realm: Realm
  readonly samples: { readonly baselineEligible: 0 | 1 | 2; readonly finalEligible: 0 | 1 | 2 }
  readonly attempts: AttemptValue[]
  readonly comparison?: ComparisonValue
  readonly resultState: ResultState
  readonly warnings: ComparabilityWarningValue[]
  readonly practice: PracticeRowValue[]
  readonly days: DayRowValue[]
  readonly revisions: RevisionResponseValue[]
}

/**
 * `loadAttemptSummaries` (6.2.1) does every ownership/realm check and every
 * attempt-level derivation; this function adds only:
 *  - today's program day, via `currentProgramDay` (2.1.2) from `ctx.now` and
 *    the program's OWN stored `timezone`/`baselineDate` — never the profile
 *    timezone or the caller's clock (program-setup's "Program calendar uses
 *    stored timezone and local dates");
 *  - `comparison = computeComparison(attempts)` (2.4.1) — `null` (omitted on
 *    the wire, `Type.Optional`) unless every one of the four benchmark slots
 *    has an eligible attempt;
 *  - `resultState = resolveResultState(...)` (2.4.2), where `finalAttemptsExist`
 *    is true only when a `final`-phase attempt with lifecycle `finalized`
 *    exists (`./attempts.js`) and `day14Finished = day > 14` (Day 14 itself
 *    counts as not finished).
 *
 * The API never computes S0/S14 or a percentage itself (D4) — every number in
 * `comparison` comes straight from `computeComparison`.
 */
export async function buildReport(
  db: AppDatabase,
  ctx: RequestContext,
  programId: string,
): Promise<BuildReportResult> {
  const { program, realm, attempts, samples, revisions } = await loadAttemptSummaries(db, ctx, programId)

  const { day } = currentProgramDay(
    { baselineDate: program.baselineDate, timezone: program.timezone },
    ctx.now,
  )

  const comparison = computeComparison(attempts)
  const resultState = resolveResultState({
    baselineEligible: samples.baselineEligible,
    finalEligible: samples.finalEligible,
    finalAttemptsExist: finalAttemptsExist(attempts),
    day14Finished: day > 14,
    comparison,
  })
  const warnings = reportWarnings(attempts)
  const practice = await loadPracticeRows(db, program)
  const days = await loadDaySummaries(db, program, day)

  return {
    realm,
    samples,
    attempts,
    ...(comparison !== null ? { comparison } : {}),
    resultState,
    warnings,
    practice,
    days,
    revisions,
  }
}
