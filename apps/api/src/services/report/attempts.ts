/**
 * Task 6.2.1 — the report's attempt loader: every benchmark attempt of an
 * owned program, mapped to the widened attempt shape the report and export
 * both need, plus the eligible-sample counts and every stored protocol
 * revision.
 *
 * `mapAttemptRow` (pure, no DB) and `finalAttemptsExist` (pure, no DB) are
 * unit-tested directly (`apps/api/test/unit/report.attempts.test.ts`);
 * `loadAttemptSummaries` is the one DB-touching entry point this task adds —
 * `services/report/index.ts` (`buildReport`), `services/report.ts` (5.9.3)
 * and 6.2.3/6.2.4's later units all build on it rather than re-querying
 * `benchmark_slots`/`focus_sessions`/`session_reviews` a second way (D16).
 *
 * Query shape: `focus_sessions` (`kind = 'benchmark'`, scoped to the owned
 * program) INNER JOIN `benchmark_slots` (a benchmark session always carries a
 * `slot_id` — the `focus_sessions_benchmark_has_slot` CHECK constraint
 * guarantees the match) INNER JOIN `session_reviews` (D31: always present,
 * created at session start) LEFT JOIN a `session_amendments` subquery (a
 * session may have zero amendments). Starting from `focus_sessions` rather
 * than `benchmark_slots` means every joined table is guaranteed to match —
 * no row of this query is ever "a slot with no attempt" (such a slot simply
 * never appears; the report's `attempts[]` only ever lists real attempts) —
 * so every selected column keeps its own schema-level nullability with no
 * left-join widening to reason about.
 *
 * Rows are loaded by ownership only (the `WHERE program_id = ...` scoped by
 * an already-ownership-checked program row) and are NEVER pre-filtered by
 * realm: `assertSameRealm` (packages/shared) runs over the program's own
 * realm plus every loaded attempt's realm in one pass, so a foreign-realm row
 * throws `RealmMixingError` (422 `realm_mismatch` via the 3.2.4 mapper)
 * rather than being silently dropped from the report (identity-realm "Realms
 * are never mixed in a result").
 *
 * See design.md's Database model, D7.1/D7.3/D7.5, D32; specs/
 * benchmark-assessment/spec.md ("Eligibility is derived server-side with
 * explicit reasons", "Finalized attempts are immutable; amendments are
 * append-only") and specs/identity-realm/spec.md ("Realms are never mixed in
 * a result").
 */
import { and, eq, sql } from 'drizzle-orm'
import {
  applyAmendmentExclusion,
  assertSameRealm,
  fromStoredFirstSwitch,
  sampleCounts,
  selectSlotCandidates,
  type AmendmentExclusionInput,
  type AttemptValue,
  type BenchmarkPhase,
  type CountMethod,
  type ExclusionReason,
  type FirstSwitch,
  type FirstSwitchKind,
  type FirstSwitchMethod,
  type ObservedConditions,
  type Realm,
  type RecallFlag,
  type ReportedCount,
  type RevisionResponseValue,
  type SessionLifecycle,
  type SlotLabel,
  type TimeSource,
  type TimerQuality,
} from '@attention-lab/shared'

import type { AppDatabase } from '../../plugins/db.js'
import type { RequestContext } from '../../plugins/identity.js'
import { benchmarkSlots } from '../../db/schema/benchmarkSlots.js'
import { focusSessions } from '../../db/schema/focusSessions.js'
import { sessionReviews } from '../../db/schema/sessionReviews.js'
import { sessionAmendments } from '../../db/schema/sessionAmendments.js'
import { protocolRevisions } from '../../db/schema/protocolRevisions.js'
import { loadOwnedProgram, toRevisionDto, type ProgramRow } from '../program/programService.js'

// ---------------------------------------------------------------------------
// mapAttemptRow — pure, no DB (unit-tested directly)
// ---------------------------------------------------------------------------

/**
 * Everything one loaded (session ⨝ slot ⨝ review ⨝ amendment) row carries
 * into the mapper. Field names mirror the stored column they come from —
 * `storedEligible`/`storedExclusionReasons` are `focus_sessions.eligible` /
 * `.exclusion_reasons` verbatim, never pre-adjusted for finalization state
 * (the mapper itself does that).
 */
export interface AttemptQueryRow {
  readonly attemptId: string
  readonly phase: BenchmarkPhase
  readonly label: SlotLabel
  readonly realm: Realm
  readonly timeSource: TimeSource
  readonly lifecycle: SessionLifecycle
  readonly localDate: string
  readonly timerQuality: TimerQuality
  readonly revisionId: string
  readonly replacementReason: string | null
  /** `focus_sessions.eligible` verbatim: `null` for a session finalize has never touched. */
  readonly storedEligible: boolean | null
  /** `focus_sessions.exclusion_reasons` verbatim. */
  readonly storedExclusionReasons: readonly ExclusionReason[]
  readonly episodeCount: ReportedCount
  readonly recallScore: ReportedCount
  readonly countMethod: CountMethod | null
  readonly firstSwitchKind: FirstSwitchKind | null
  readonly firstSwitchSeconds: number | null
  readonly firstSwitchMethod: FirstSwitchMethod | null
  readonly externalCount: ReportedCount
  readonly unplannedAgentChecks: ReportedCount
  readonly mindWanderingCount: ReportedCount
  readonly materiallyDisrupted: boolean | null
  readonly recallFlags: readonly RecallFlag[]
  readonly conditions: ObservedConditions
  /** `true` when at least one `session_amendments` row for this session has `exclude_from_report = true`. */
  readonly excludedByAmendment: boolean
}

/**
 * Maps one loaded row to the report's widened attempt shape (2.7.1, 2.7.5).
 *
 * Finalization gate (timer expiry never proves completion, D24): a session
 * `finalize` has never touched carries `storedEligible === null` — this is
 * reported as `eligible: false, exclusionReasons: []`, never `null` and never
 * an invented reason, so "not yet finalized" and "finalized ineligible" both
 * read as `eligible: false` while staying distinguishable via `lifecycle`.
 *
 * Amendment overlay (D32): `applyAmendmentExclusion` (packages/shared) is the
 * single place that folds an excluding amendment into the *displayed*
 * eligibility — `excludedByAmendment: true` forces `eligible: false` and
 * appends `'excluded_by_amendment'` (once) after whatever reasons were
 * already present; every other field (`episodeCount`, `recallScore`,
 * `firstSwitch`, ...) passes through untouched, since amendments never
 * rewrite a stored measurement.
 *
 * First-switch (2.2.2): `fromStoredFirstSwitch` reconstructs the three-state
 * `FirstSwitch` union from the stored trio; a `null` kind (S was never
 * reported) stays `null`, never coerced to `none_capped`.
 */
export function mapAttemptRow(row: AttemptQueryRow): AttemptValue {
  const preOverlay =
    row.storedEligible === null
      ? { eligible: false, exclusionReasons: [] as ExclusionReason[] }
      : { eligible: row.storedEligible, exclusionReasons: [...row.storedExclusionReasons] }

  const amendments: AmendmentExclusionInput[] = row.excludedByAmendment
    ? [{ excludeFromReport: true }]
    : []
  const overlaid = applyAmendmentExclusion(preOverlay, amendments)

  const derivedFirstSwitch = fromStoredFirstSwitch({
    first_switch_kind: row.firstSwitchKind,
    first_switch_seconds: row.firstSwitchSeconds,
    first_switch_method: row.firstSwitchMethod,
  })
  const firstSwitch: FirstSwitch | null = derivedFirstSwitch === null ? null : derivedFirstSwitch.firstSwitch
  // Task 6.3.1 (export's `t_method` column): carried straight through from
  // the stored trio, never re-derived — `fromStoredFirstSwitch` already
  // rejects a corrupt `known` row with a null seconds value, so `method`
  // here is exactly what `session_reviews.first_switch_method` holds.
  const firstSwitchMethod = derivedFirstSwitch === null ? null : derivedFirstSwitch.method

  return {
    attemptId: row.attemptId,
    phase: row.phase,
    label: row.label,
    realm: row.realm,
    timeSource: row.timeSource,
    // `preOverlay.eligible` is always a real boolean (never null) for a
    // benchmark row — the only kind this module ever loads — so
    // `applyAmendmentExclusion`'s null-preserving branch (a practice
    // session's eligibility, which this query never touches) never fires
    // here; the `=== null` fallback is defense in depth, not a live path.
    eligible: overlaid.eligible === null ? false : overlaid.eligible,
    exclusionReasons: overlaid.exclusionReasons,
    episodeCount: row.episodeCount,
    recallScore: row.recallScore,
    firstSwitch,
    firstSwitchMethod,
    externalCount: row.externalCount,
    unplannedAgentChecks: row.unplannedAgentChecks,
    countMethod: row.countMethod,
    conditions: { ...row.conditions, accommodations: [...row.conditions.accommodations] },
    localDate: row.localDate,
    lifecycle: row.lifecycle,
    replacementReason: row.replacementReason,
    recallFlags: [...row.recallFlags],
    revisionId: row.revisionId,
    mindWanderingCount: row.mindWanderingCount,
    materiallyDisrupted: row.materiallyDisrupted,
    timerQuality: row.timerQuality,
    excludedByAmendment: row.excludedByAmendment,
  }
}

// ---------------------------------------------------------------------------
// finalAttemptsExist — pure, no DB (unit-tested directly)
// ---------------------------------------------------------------------------

export interface FinalAttemptsExistRow {
  readonly phase: BenchmarkPhase
  readonly lifecycle: SessionLifecycle
}

/**
 * Whether any final-phase attempt exists at all, eligible or not — the input
 * `resolveResultState` (2.4.2, `services/report/index.ts`) needs to
 * distinguish "no final attempt has ever been made" (`final_pending`) from
 * "a final attempt exists but is not eligible" (`insufficient_samples`). Only
 * a `finalized` lifecycle counts: an abandoned or still-running final attempt
 * is not "a final attempt" for this purpose (D4 — the API never guesses at a
 * result state from an in-progress session).
 */
export function finalAttemptsExist(attempts: readonly FinalAttemptsExistRow[]): boolean {
  return attempts.some((attempt) => attempt.phase === 'final' && attempt.lifecycle === 'finalized')
}

// ---------------------------------------------------------------------------
// loadAttemptSummaries — the one DB-touching entry point
// ---------------------------------------------------------------------------

export interface LoadAttemptSummariesResult {
  /** The owned `programs` row, loaded once (404 if not owned) and reused by `services/report/index.ts` for `currentProgramDay`. */
  readonly program: ProgramRow
  readonly realm: Realm
  readonly attempts: AttemptValue[]
  readonly samples: { readonly baselineEligible: 0 | 1 | 2; readonly finalEligible: 0 | 1 | 2 }
  readonly revisions: RevisionResponseValue[]
}

/**
 * `loadOwnedProgram` (4.1.1) first — 404 `not_found` when `programId` is not
 * owned by `ctx.principalId`, before any attempt is ever queried.
 *
 * `samples = sampleCounts(selectSlotCandidates(attempts))` (2.4.1): a
 * `midpoint`-phase attempt is listed in `attempts` (it is a real attempt) but
 * `selectSlotCandidates` has no midpoint slot key, so it is never counted —
 * "midpoint attempts are listed but never counted".
 */
export async function loadAttemptSummaries(
  db: AppDatabase,
  ctx: RequestContext,
  programId: string,
): Promise<LoadAttemptSummariesResult> {
  const program = await loadOwnedProgram(db, ctx, programId)

  // D32: a session may carry more than one amendment; `selectDistinct` plus
  // the pre-filter to `exclude_from_report = true` means the later
  // `leftJoin` below adds at most one row per session, never fanning the
  // result out — the same technique `slotAttempts` (4.3.2) already uses for
  // exactly this reason (D16, one owner per shared technique).
  const amendedSessions = db
    .selectDistinct({ sessionId: sessionAmendments.sessionId })
    .from(sessionAmendments)
    .where(eq(sessionAmendments.excludeFromReport, true))
    .as('amended_sessions')

  const rows = await db
    .select({
      attemptId: focusSessions.id,
      phase: benchmarkSlots.phase,
      label: benchmarkSlots.label,
      realm: focusSessions.realm,
      timeSource: focusSessions.timeSource,
      lifecycle: focusSessions.lifecycle,
      localDate: focusSessions.localDate,
      timerQuality: focusSessions.timerQuality,
      revisionId: focusSessions.revisionId,
      replacementReason: focusSessions.replacementReason,
      storedEligible: focusSessions.eligible,
      storedExclusionReasons: focusSessions.exclusionReasons,
      episodeCount: sessionReviews.episodeCount,
      recallScore: sessionReviews.recallScore,
      countMethod: sessionReviews.countMethod,
      firstSwitchKind: sessionReviews.firstSwitchKind,
      firstSwitchSeconds: sessionReviews.firstSwitchSeconds,
      firstSwitchMethod: sessionReviews.firstSwitchMethod,
      externalCount: sessionReviews.externalCount,
      unplannedAgentChecks: sessionReviews.unplannedAgentChecks,
      mindWanderingCount: sessionReviews.mindWanderingCount,
      materiallyDisrupted: sessionReviews.materiallyDisrupted,
      recallFlags: sessionReviews.recallFlags,
      conditions: sessionReviews.observedConditions,
      excludedByAmendment: sql<boolean>`${amendedSessions.sessionId} is not null`,
    })
    .from(focusSessions)
    // A benchmark session always carries a slot_id (the
    // `focus_sessions_benchmark_has_slot` CHECK constraint) — an inner join
    // is exact, never dropping a row this query wants.
    .innerJoin(benchmarkSlots, eq(benchmarkSlots.id, focusSessions.slotId))
    // D31: session_reviews is created at session start and always present —
    // an inner join here is exact for the same reason, and keeps every
    // selected review column at its own schema-level nullability (no
    // left-join widening to reason about).
    .innerJoin(sessionReviews, eq(sessionReviews.sessionId, focusSessions.id))
    .leftJoin(amendedSessions, eq(amendedSessions.sessionId, focusSessions.id))
    .where(and(eq(focusSessions.programId, programId), eq(focusSessions.kind, 'benchmark')))
    .orderBy(benchmarkSlots.phase, benchmarkSlots.label, focusSessions.startedAt)

  // Loaded by ownership only, never pre-filtered by realm: every attempt's
  // own realm is checked against the program's, in one pass, before any of
  // it is mapped or returned. A mixed realm throws `RealmMixingError` (422
  // `realm_mismatch` via the 3.2.4 mapper, fixed message, no partial body) —
  // the foreign row is never silently dropped.
  assertSameRealm([{ realm: program.realm }, ...rows.map((row) => ({ realm: row.realm }))])

  const attempts: AttemptValue[] = rows.map((row) =>
    mapAttemptRow({
      attemptId: row.attemptId,
      phase: row.phase,
      label: row.label,
      realm: row.realm,
      timeSource: row.timeSource,
      lifecycle: row.lifecycle,
      localDate: row.localDate,
      timerQuality: row.timerQuality,
      revisionId: row.revisionId,
      replacementReason: row.replacementReason,
      storedEligible: row.storedEligible,
      // Plain (untyped) text[] column at the schema level — its only writer
      // (finalize, group 5) ever stores `ExclusionReason` members (same
      // convention as `sessionSerializer.ts`'s own cast of this column).
      storedExclusionReasons: row.storedExclusionReasons as readonly ExclusionReason[],
      episodeCount: row.episodeCount,
      recallScore: row.recallScore,
      countMethod: row.countMethod,
      firstSwitchKind: row.firstSwitchKind,
      firstSwitchSeconds: row.firstSwitchSeconds,
      firstSwitchMethod: row.firstSwitchMethod,
      externalCount: row.externalCount,
      unplannedAgentChecks: row.unplannedAgentChecks,
      mindWanderingCount: row.mindWanderingCount,
      materiallyDisrupted: row.materiallyDisrupted,
      // Plain (untyped) text[] column, same reasoning as exclusionReasons
      // above — its only writer (recall lock, `deriveRecallFlags`) ever
      // stores `RecallFlag` members.
      recallFlags: row.recallFlags as readonly RecallFlag[],
      conditions: row.conditions,
      excludedByAmendment: row.excludedByAmendment,
    }),
  )

  const samples = sampleCounts(selectSlotCandidates(attempts))

  const revisionRows = await db
    .select()
    .from(protocolRevisions)
    .where(eq(protocolRevisions.programId, programId))
  const revisions = revisionRows.map(toRevisionDto)

  return { program, realm: program.realm, attempts, samples, revisions }
}
