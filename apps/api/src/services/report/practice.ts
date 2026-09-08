/**
 * Task 6.2.4 — the report's practice section: every practice block of an
 * owned program, mapped to the wire `PracticeRowValue` shape
 * (`packages/shared/src/contracts/report.ts`'s `PracticeRowSchema` — the
 * base ten fields are 2.7.5's own shape; `lifecycle`, `completedSeconds`,
 * `timerQuality`, `countMethod` and `mindWanderingCount` are added
 * additively by this unit).
 *
 * `mapPracticeRow`/`mapPracticeRows` (pure, no DB) are unit-tested directly
 * (`apps/api/test/unit/report.sections.test.ts`); `loadPracticeRows` is the
 * one DB-touching entry point this task adds — `services/report/index.ts`
 * (`buildReport`) builds on it rather than re-querying `focus_sessions`/
 * `session_reviews` a second way (D16), mirroring `attempts.ts`'s own
 * `loadAttemptSummaries`.
 *
 * Query shape: `focus_sessions` (scoped to the owned program, `kind =
 * 'practice'`) LEFT JOIN `session_reviews` (D31: present from session start,
 * so this join is exact in practice — the LEFT JOIN follows the task
 * brief's own wording rather than `attempts.ts`'s INNER JOIN), ordered by
 * `local_date, started_at`. Every count is a `ReportedCount` — a blank
 * episode/external/agent-check/mind-wandering count stays `null`, never
 * coalesced to 0 (D7.1), and nothing is summed across tallies (D11: the
 * stored off-task tally already includes agent checks marked
 * also-off-task).
 *
 * `completedSeconds` is `ended_at ? ended_at − started_at − paused_seconds :
 * null` (the task brief, verbatim) — a running or abandoned session (no
 * `ended_at`) is listed with its own `lifecycle` and `completedSeconds:
 * null`, never treated as complete (timer expiry never proves completion,
 * D24; D35's recovery scenario loads exactly such a session).
 *
 * See design.md's Database model, D11, D30, D31; specs/practice-sessions/
 * spec.md ("Practice metrics stay separate from benchmarks" / "Practice on
 * Day 14") and specs/progress-report/spec.md ("Practice and daily trends are
 * separate sections" / "Practice growth").
 */
import { and, eq } from 'drizzle-orm'
import {
  assertSameRealm,
  programDayForLocalDate,
  type CountMethod,
  type LocalDate,
  type OutputQuality,
  type PracticeRowValue,
  type Realm,
  type ReportedCount,
  type SessionKind,
  type SessionLifecycle,
  type TimerQuality,
} from '@attention-lab/shared'

import type { AppDatabase } from '../../plugins/db.js'
import { focusSessions } from '../../db/schema/focusSessions.js'
import { sessionReviews } from '../../db/schema/sessionReviews.js'
import type { ProgramRow } from '../program/programService.js'

// ---------------------------------------------------------------------------
// mapPracticeRow / mapPracticeRows — pure, no DB (unit-tested directly)
// ---------------------------------------------------------------------------

/** Everything one loaded (session ⨝ review) row carries into the mapper. */
export interface PracticeQueryRow {
  readonly sessionId: string
  /** Not pre-filtered by the caller — `mapPracticeRows` is the one place this gate is enforced (see below). */
  readonly kind: SessionKind
  readonly localDate: LocalDate
  readonly startedAt: Date
  readonly endedAt: Date | null
  readonly pausedSeconds: number
  readonly targetSeconds: number
  readonly completeInterval: boolean | null
  readonly lifecycle: SessionLifecycle
  readonly timerQuality: TimerQuality
  readonly revisionId: string
  readonly outputQuality: OutputQuality | null
  readonly episodeCount: ReportedCount
  readonly externalCount: ReportedCount
  readonly unplannedAgentChecks: ReportedCount
  readonly mindWanderingCount: ReportedCount
  readonly countMethod: CountMethod | null
}

/**
 * `ended_at ? ended_at − started_at − paused_seconds : null`. A running or
 * abandoned session's `endedAt` is `null`, so `completedSeconds` is `null`
 * too — never estimated from `targetSeconds` or from wall-clock elapsed
 * time.
 */
function completedSecondsOf(
  row: Pick<PracticeQueryRow, 'startedAt' | 'endedAt' | 'pausedSeconds'>,
): ReportedCount {
  if (row.endedAt === null) return null
  const elapsedSeconds = Math.floor((row.endedAt.getTime() - row.startedAt.getTime()) / 1000)
  return elapsedSeconds - row.pausedSeconds
}

/** Maps one loaded practice row to the report's `PracticeRowValue`. */
export function mapPracticeRow(row: PracticeQueryRow, baselineDate: LocalDate): PracticeRowValue {
  return {
    sessionId: row.sessionId,
    localDate: row.localDate,
    day: programDayForLocalDate(baselineDate, row.localDate),
    targetSeconds: row.targetSeconds,
    completeInterval: row.completeInterval,
    outputQuality: row.outputQuality,
    episodeCount: row.episodeCount,
    externalCount: row.externalCount,
    unplannedAgentChecks: row.unplannedAgentChecks,
    revisionId: row.revisionId,
    lifecycle: row.lifecycle,
    completedSeconds: completedSecondsOf(row),
    timerQuality: row.timerQuality,
    countMethod: row.countMethod,
    mindWanderingCount: row.mindWanderingCount,
  }
}

/**
 * `rows` filtered to `kind === 'practice'` and mapped in order — benchmarks
 * never populate the practice section (practice-sessions: "Practice metrics
 * stay separate from benchmarks"). `loadPracticeRows` below already scopes
 * its own query to `kind = 'practice'` in SQL; this pure filter expresses
 * the same rule once more so it is directly unit-testable without a
 * database, and so a caller that ever widens the query cannot silently leak
 * a benchmark row into this section.
 */
export function mapPracticeRows(
  rows: readonly PracticeQueryRow[],
  baselineDate: LocalDate,
): PracticeRowValue[] {
  return rows.filter((row) => row.kind === 'practice').map((row) => mapPracticeRow(row, baselineDate))
}

// ---------------------------------------------------------------------------
// loadPracticeRows — the one DB-touching entry point
// ---------------------------------------------------------------------------

/**
 * Every practice block of `program`, ordered by `local_date, started_at`.
 * Rows are loaded by ownership only (the caller already resolved and
 * ownership-checked `program`, e.g. via `loadAttemptSummaries`'s
 * `loadOwnedProgram`) and are never pre-filtered by realm: `assertSameRealm`
 * runs over the program's own realm plus every loaded row's realm in one
 * pass, so a foreign-realm practice row throws `RealmMixingError` (422
 * `realm_mismatch`) rather than being silently dropped (identity-realm
 * "Realms are never mixed in a result") — the same projection
 * `attempts.ts`'s `loadAttemptSummaries` already applies to `attempts[]`.
 */
export async function loadPracticeRows(
  db: AppDatabase,
  program: Pick<ProgramRow, 'id' | 'realm' | 'baselineDate'>,
): Promise<PracticeRowValue[]> {
  const rows = await db
    .select({
      sessionId: focusSessions.id,
      kind: focusSessions.kind,
      realm: focusSessions.realm,
      localDate: focusSessions.localDate,
      startedAt: focusSessions.startedAt,
      endedAt: focusSessions.endedAt,
      pausedSeconds: focusSessions.pausedSeconds,
      targetSeconds: focusSessions.targetSeconds,
      completeInterval: focusSessions.completeInterval,
      lifecycle: focusSessions.lifecycle,
      timerQuality: focusSessions.timerQuality,
      revisionId: focusSessions.revisionId,
      outputQuality: sessionReviews.outputQuality,
      episodeCount: sessionReviews.episodeCount,
      externalCount: sessionReviews.externalCount,
      unplannedAgentChecks: sessionReviews.unplannedAgentChecks,
      mindWanderingCount: sessionReviews.mindWanderingCount,
      countMethod: sessionReviews.countMethod,
    })
    .from(focusSessions)
    .leftJoin(sessionReviews, eq(sessionReviews.sessionId, focusSessions.id))
    .where(and(eq(focusSessions.programId, program.id), eq(focusSessions.kind, 'practice')))
    .orderBy(focusSessions.localDate, focusSessions.startedAt)

  assertSameRealm([
    { realm: program.realm },
    ...rows.map((row): { realm: Realm } => ({ realm: row.realm })),
  ])

  return mapPracticeRows(rows, program.baselineDate)
}
