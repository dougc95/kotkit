/**
 * Task 6.3.1 — the export's shared model: one flat, exhaustively-typed
 * snapshot of a program's exportable record, built once and handed to
 * `csv.ts` (this task) and, later, `markdown.ts` (6.3.2) so the two formats
 * never derive their rows a second, possibly-inconsistent way (D16).
 *
 * `buildExportModel` reuses `loadAttemptSummaries` (6.2.1) for the program
 * row, the realm-checked attempts and `protocol_revisions`, and
 * `loadDaySummaries` (6.2.4) for the daily section — both already run their
 * own `assertSameRealm` internally, so by the time their results reach this
 * function every attempt and every check-in has already been proven to share
 * the program's own realm (a foreign row throws `RealmMixingError`, mapped to
 * 422 `realm_mismatch` by the 3.2.4 error mapper, before any of it is ever
 * assembled into a row — identity-realm "Realms are never mixed in a
 * result"). The one new query this module adds — per-day feed rows with
 * device/platform/scope/source detail, which `loadDaySummaries`'s own
 * aggregated `DayRowValue` does not carry — re-checks its own loaded
 * `daily_checkins` rows the same way, defense in depth rather than trust
 * through an already-owned program.
 *
 * Deliberately excluded from every section (progress-report's export
 * requirement lists exactly what IS exported; the PRD's free-text fields are
 * never among them): `daily_checkins.note`, `session_reviews.output_note`,
 * `.disruption_note`, `.recall_points`, `.review_note`, `focus_sessions
 * .intended_output`. Practice sessions are never exported — this is the
 * benchmark/day/feed record only (specs/progress-report "Export preview and
 * download").
 */
import { eq } from 'drizzle-orm'
import {
  currentProgramDay,
  type Accommodation,
  type BenchmarkPhase,
  type CheckinStatus,
  type CountMethod,
  type ExclusionReason,
  type FeedDevice,
  type FeedSource,
  type FirstSwitch,
  type FirstSwitchMethod,
  type LocalDate,
  type MeasurementScope,
  type ProgramStatus,
  type Realm,
  type RecallFlag,
  type ReportedCount,
  type SessionLifecycle,
  type SlotLabel,
  type TimeSource,
} from '@attention-lab/shared'

import type { AppDatabase } from '../../plugins/db.js'
import type { RequestContext } from '../../plugins/identity.js'
import type { IdentityMode } from '../../config.js'
import { dailyCheckins } from '../../db/schema/dailyCheckins.js'
import { feedUsage } from '../../db/schema/feedUsage.js'
import { loadAttemptSummaries } from '../report/attempts.js'
import { loadDaySummaries } from '../report/days.js'

// ---------------------------------------------------------------------------
// Section row shapes
// ---------------------------------------------------------------------------

export interface ExportProgramRow {
  readonly programId: string
  readonly realm: Realm
  readonly identityMode: IdentityMode
  readonly baselineDate: LocalDate
  readonly timezone: string
  readonly status: ProgramStatus
  readonly leisureAllowanceMin: number
  readonly feedEstimateMin: number | null
  /** `ctx.now`, ISO — when this export was produced, never the client's own clock. */
  readonly exportedAt: string
}

export interface ExportBandCeiling {
  readonly fromDay: number
  readonly toDay: number
  readonly minutes: number
}

export interface ExportRevisionRow {
  readonly revision: number
  readonly effectiveDay: number
  readonly practiceTargetSeconds: number
  readonly bandCeilings: readonly ExportBandCeiling[]
  readonly leisureAllowanceMin: number
  readonly reason: string
  readonly createdAt: string
}

/**
 * One benchmark attempt, exactly the progress-spec export columns (task
 * 6.3.1's own column list) — `s`/`sMethod` and `firstSwitch`/`firstSwitchMethod`
 * deliberately kept apart from each other (S and T are separate
 * measurements, D7.3) and from `recallScore`/`e`/`m`, matching
 * `AttemptValue`'s own separation. `firstSwitch` is carried RAW (the
 * `FirstSwitch` union, not a pre-rendered string) so every renderer — this
 * task's `csv.ts` and 6.3.2's `markdown.ts` — derives its own `t_state`/
 * `t_seconds` cell text from the same `exportFirstSwitchState`/
 * `exportFirstSwitchSeconds` functions below rather than from a string
 * `csv.ts` already committed to (D16: one owner of the derivation, not of a
 * baked-in rendering).
 */
export interface ExportAttemptRow {
  readonly attemptId: string
  readonly phase: BenchmarkPhase
  readonly label: SlotLabel
  readonly localDate: LocalDate
  readonly realm: Realm
  readonly timeSource: TimeSource
  readonly s: ReportedCount
  readonly sMethod: CountMethod | null
  readonly firstSwitch: FirstSwitch | null
  readonly firstSwitchMethod: FirstSwitchMethod | null
  readonly recallScore: ReportedCount
  readonly e: ReportedCount
  readonly m: ReportedCount
  readonly disruption: boolean | null
  readonly deviceFormat: string | null
  readonly language: string | null
  readonly materialLevel: string | null
  readonly accommodations: readonly Accommodation[]
  readonly eligible: boolean
  readonly exclusionReasons: readonly ExclusionReason[]
  /** The attempt's governing revision NUMBER (never the UUID `revisionId`) — resolved via `revisions[]`. */
  readonly protocolRevision: number
  readonly recallFlags: readonly RecallFlag[]
  readonly replacementReason: string | null
  readonly lifecycle: SessionLifecycle
}

export interface ExportDayRow {
  readonly programDay: number
  readonly localDate: LocalDate
  readonly sleepMinutes: ReportedCount
  readonly stress: number | null
  readonly mindfulnessMinutes: ReportedCount
  readonly status: CheckinStatus
}

export interface ExportFeedRow {
  readonly localDate: LocalDate
  readonly device: FeedDevice
  readonly platform: string
  readonly minutes: number
  readonly shortVideoMinutes: ReportedCount
  readonly measurementScope: MeasurementScope
  readonly source: FeedSource
  readonly plannedWindow: boolean | null
}

export interface ExportModel {
  readonly program: ExportProgramRow
  readonly revisions: readonly ExportRevisionRow[]
  readonly attempts: readonly ExportAttemptRow[]
  readonly days: readonly ExportDayRow[]
  readonly feedRows: readonly ExportFeedRow[]
}

// ---------------------------------------------------------------------------
// t_state / t_seconds — pure, no DB
// ---------------------------------------------------------------------------

/**
 * `firstSwitch.kind` mapped to the export's own three-state-plus-blank `t_state`
 * cell: `none_capped` -> the PRD cap label, `known` -> the literal word
 * `'known'` (the number itself is a separate `t_seconds` column, never
 * folded into this one the way the UI's `formatFirstSwitch` — mm:ss — does),
 * `unknown` -> `'Unknown'` (never the cap label), no `firstSwitch` at all ->
 * `''` (S itself was never reported).
 */
export function exportFirstSwitchState(firstSwitch: FirstSwitch | null): string {
  if (firstSwitch === null) return ''
  switch (firstSwitch.kind) {
    case 'none_capped':
      return '20+, capped'
    case 'known':
      return 'known'
    case 'unknown':
      return 'Unknown'
  }
}

/** `t_seconds`: the raw elapsed seconds for a `known` first switch, blank otherwise. */
export function exportFirstSwitchSeconds(firstSwitch: FirstSwitch | null): number | null {
  if (firstSwitch === null || firstSwitch.kind !== 'known') return null
  return firstSwitch.seconds
}

// ---------------------------------------------------------------------------
// buildExportModel — the one DB-touching entry point
// ---------------------------------------------------------------------------

/** One raw `feed_usage` row joined to its check-in's `local_date`, for `feed_rows`. */
interface RawFeedExportRow {
  readonly localDate: LocalDate
  readonly device: FeedDevice
  readonly platform: string
  readonly minutes: number
  readonly shortVideoMinutes: number | null
  readonly measurementScope: MeasurementScope
  readonly source: FeedSource
  readonly plannedWindow: boolean | null
}

/**
 * The `feed_rows` section: raw per-row feed detail (device, platform, scope,
 * source, planned window) that `loadDaySummaries`'s own aggregated
 * `DayRowValue` never carries — a query this task adds, scoped to
 * `program.id` and ordered by local date for a deterministic export.
 */
async function loadFeedExportRows(
  db: AppDatabase,
  program: { readonly id: string; readonly realm: Realm },
): Promise<RawFeedExportRow[]> {
  const rows = await db
    .select({
      localDate: dailyCheckins.localDate,
      realm: dailyCheckins.realm,
      device: feedUsage.device,
      platform: feedUsage.platform,
      minutes: feedUsage.minutes,
      shortVideoMinutes: feedUsage.shortVideoMinutes,
      measurementScope: feedUsage.measurementScope,
      source: feedUsage.source,
      plannedWindow: feedUsage.plannedWindow,
    })
    .from(feedUsage)
    .innerJoin(dailyCheckins, eq(dailyCheckins.id, feedUsage.checkinId))
    .where(eq(dailyCheckins.programId, program.id))
    .orderBy(dailyCheckins.localDate)

  // `feed_usage` carries no `realm` column of its own (D34: inherited
  // through its `daily_checkins` parent) — checked here the same way every
  // other module re-checks its own loaded rows, even though `program.id`
  // scoping alone already excludes another principal's data.
  for (const row of rows) {
    if (row.realm !== program.realm) {
      throw new Error(
        `loadFeedExportRows: daily_checkins row for program ${program.id} carries realm ` +
          `'${row.realm}', expected '${program.realm}' (a foreign-realm row reachable only by ` +
          'directly mutating the database).',
      )
    }
  }

  return rows.map((row) => ({
    localDate: row.localDate,
    device: row.device,
    platform: row.platform,
    minutes: row.minutes,
    shortVideoMinutes: row.shortVideoMinutes,
    measurementScope: row.measurementScope,
    source: row.source,
    plannedWindow: row.plannedWindow,
  }))
}

/**
 * Assembles the full `ExportModel` for `programId`, owned by `ctx.principalId`
 * (404 otherwise, via `loadAttemptSummaries`'s own `loadOwnedProgram`).
 * `assertSameRealm` is satisfied at entry through `loadAttemptSummaries`
 * (program + every attempt) and `loadDaySummaries` (program + every
 * check-in) — both throw `RealmMixingError` (422 `realm_mismatch`) before
 * this function ever builds a row, so a mixed-realm program never produces a
 * partial export.
 */
export async function buildExportModel(
  db: AppDatabase,
  ctx: RequestContext,
  programId: string,
): Promise<ExportModel> {
  const { program, attempts, revisions } = await loadAttemptSummaries(db, ctx, programId)

  const { day } = currentProgramDay(
    { baselineDate: program.baselineDate, timezone: program.timezone },
    ctx.now,
  )
  const days = await loadDaySummaries(db, program, day)
  const feedRows = await loadFeedExportRows(db, program)

  const revisionNumberById = new Map<string, number>(revisions.map((r) => [r.id, r.revision]))

  const exportAttempts: ExportAttemptRow[] = attempts.map((attempt) => {
    const protocolRevision = revisionNumberById.get(attempt.revisionId)
    if (protocolRevision === undefined) {
      throw new Error(
        `buildExportModel: attempt ${attempt.attemptId} references revision ${attempt.revisionId}, ` +
          `which is not among program ${programId}'s loaded protocol_revisions`,
      )
    }
    return {
      attemptId: attempt.attemptId,
      phase: attempt.phase,
      label: attempt.label,
      localDate: attempt.localDate,
      realm: attempt.realm,
      timeSource: attempt.timeSource,
      s: attempt.episodeCount,
      sMethod: attempt.countMethod,
      firstSwitch: attempt.firstSwitch,
      firstSwitchMethod: attempt.firstSwitchMethod ?? null,
      recallScore: attempt.recallScore,
      e: attempt.externalCount,
      m: attempt.mindWanderingCount,
      disruption: attempt.materiallyDisrupted,
      deviceFormat: attempt.conditions.deviceFormat,
      language: attempt.conditions.language,
      materialLevel: attempt.conditions.materialLevel,
      accommodations: attempt.conditions.accommodations,
      eligible: attempt.eligible,
      exclusionReasons: attempt.exclusionReasons,
      protocolRevision,
      recallFlags: attempt.recallFlags,
      replacementReason: attempt.replacementReason,
      lifecycle: attempt.lifecycle,
    }
  })

  const exportDays: ExportDayRow[] = days.map((row) => ({
    programDay: row.day,
    localDate: row.localDate,
    sleepMinutes: row.sleepMinutes,
    stress: row.stress,
    mindfulnessMinutes: row.mindfulnessMinutes,
    status: row.status,
  }))

  const exportFeedRows: ExportFeedRow[] = feedRows.map((row) => ({
    localDate: row.localDate,
    device: row.device,
    platform: row.platform,
    minutes: row.minutes,
    shortVideoMinutes: row.shortVideoMinutes,
    measurementScope: row.measurementScope,
    source: row.source,
    plannedWindow: row.plannedWindow,
  }))

  return {
    program: {
      programId: program.id,
      realm: program.realm,
      identityMode: ctx.identityMode,
      baselineDate: program.baselineDate,
      timezone: program.timezone,
      status: program.status,
      leisureAllowanceMin: program.leisureAllowanceMin,
      feedEstimateMin: program.feedEstimateMin,
      exportedAt: ctx.now.toISOString(),
    },
    revisions: revisions.map((r) => ({
      revision: r.revision,
      effectiveDay: r.effectiveDay,
      practiceTargetSeconds: r.settings.practiceTargetSeconds,
      bandCeilings: r.settings.bandCeilings,
      leisureAllowanceMin: r.settings.leisureAllowanceMin,
      reason: r.reason,
      createdAt: r.createdAt,
    })),
    attempts: exportAttempts,
    days: exportDays,
    feedRows: exportFeedRows,
  }
}
