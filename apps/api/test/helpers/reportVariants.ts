/**
 * Task 6.2.2 — the four extra result-state row sets `report.scenarios.test.ts`
 * needs that have no PRD §6 demo-scenario fixture of their own
 * (`more_switches`, `unchanged`, and two more `zero_baseline`/low-baseline
 * shapes of `computeComparison`'s own math): derived from an already-loaded
 * `comparable-change` scenario by updating `session_reviews.episode_count`
 * and `.recall_score` directly through Drizzle for the program's four
 * benchmark attempts (baseline A/B, final A/B).
 *
 * `comparable-change` is used as the base (rather than seeding a fresh
 * program by hand) because it already has four *eligible, finalized*
 * benchmark attempts with a real S/recall/firstSwitch/countMethod on every
 * one of them (D16: one owner — nothing here re-implements what
 * `loadScenario`/`comparableChangeScenario` already build). Only the two
 * `ReportedCount` columns the D7.4 precedence table actually branches on are
 * touched; `focus_sessions.eligible`/`exclusion_reasons` and every other
 * `session_reviews` column (including `first_switch_*`, which stays
 * `'known'` from the base fixture) are left exactly as `comparable-change`
 * loaded them — the attempts stay eligible, so `computeComparison` still
 * finds a full 2+2 to compare.
 *
 * See design.md's task-detail 6.2.2 and `domain/comparison.ts`'s
 * `resolveResultState` (2.4.2).
 */
import { and, eq } from 'drizzle-orm'

import type { AppDatabase } from '../../src/plugins/db.js'
import { benchmarkSlots } from '../../src/db/schema/benchmarkSlots.js'
import { focusSessions } from '../../src/db/schema/focusSessions.js'
import { sessionReviews } from '../../src/db/schema/sessionReviews.js'

/**
 * The four row sets 6.2.2's own brief names, each keyed by what it exercises
 * in `resolveResultState`'s fixed precedence order (`domain/comparison.ts`):
 *  - `more-switches`: `s14 > s0` (3,3 → 5,5).
 *  - `unchanged`: `s14 === s0` (3,3 → 3,3).
 *  - `low-baseline`: `s0 < 3` while still `s14 < s0` (2,2 → 1,1) — exercises
 *    `comparison.lowBaseline` without changing the precedence outcome.
 *  - `zero-beats-direction`: `s0 === 0` while `s14 > s0` (0,0 → 1,1) —
 *    proves the `zero_baseline` check (evaluated before `more_switches`)
 *    wins even though the raw direction would otherwise read as "more".
 */
export type ReportVariantName = 'more-switches' | 'unchanged' | 'low-baseline' | 'zero-beats-direction'

interface VariantCounts {
  readonly baselineEpisodeCount: number
  readonly finalEpisodeCount: number
  /** Recall stays constant across baseline and final in every variant here — only S varies. */
  readonly recallScore: number
}

const REPORT_VARIANTS: Record<ReportVariantName, VariantCounts> = {
  'more-switches': { baselineEpisodeCount: 3, finalEpisodeCount: 5, recallScore: 4 },
  unchanged: { baselineEpisodeCount: 3, finalEpisodeCount: 3, recallScore: 4 },
  'low-baseline': { baselineEpisodeCount: 2, finalEpisodeCount: 1, recallScore: 4 },
  'zero-beats-direction': { baselineEpisodeCount: 0, finalEpisodeCount: 1, recallScore: 4 },
}

/**
 * Rewrites `session_reviews.episode_count`/`.recall_score` for the four
 * benchmark attempts (baseline A/B, final A/B) of `programId` — the program
 * id returned by loading the `comparable-change` demo scenario — to one
 * named variant's counts. Baseline A and B always receive the same count,
 * as do final A and B (matching how every named variant is described).
 * Throws if `programId` does not carry exactly four benchmark attempts, so a
 * caller that forgets to load `comparable-change` first fails loudly rather
 * than silently updating zero rows.
 */
export async function applyReportVariant(
  db: AppDatabase,
  programId: string,
  variant: ReportVariantName,
): Promise<void> {
  const counts = REPORT_VARIANTS[variant]

  const rows = await db
    .select({ sessionId: focusSessions.id, phase: benchmarkSlots.phase })
    .from(focusSessions)
    .innerJoin(benchmarkSlots, eq(benchmarkSlots.id, focusSessions.slotId))
    .where(and(eq(focusSessions.programId, programId), eq(focusSessions.kind, 'benchmark')))

  if (rows.length !== 4) {
    throw new Error(
      `applyReportVariant: expected exactly 4 benchmark attempts for program ${programId} ` +
        `(load "comparable-change" first) — found ${rows.length}`,
    )
  }

  for (const row of rows) {
    const episodeCount = row.phase === 'baseline' ? counts.baselineEpisodeCount : counts.finalEpisodeCount
    await db
      .update(sessionReviews)
      .set({ episodeCount, recallScore: counts.recallScore })
      .where(eq(sessionReviews.sessionId, row.sessionId))
  }
}
