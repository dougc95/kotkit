/**
 * Task 6.2.4 — the report's daily section: one entry per program day, Day 0
 * through `min(today's program day, 14)`, built from `daily_checkins` LEFT
 * JOIN `feed_usage` and reduced through `buildCheckinView` (6.1.1) /
 * `checkinStatus`/`feedAggregates` (`packages/shared/src/domain/feed.ts`,
 * D16) — this file computes no completeness or aggregate rule of its own,
 * only flattens the days-route's nested envelope onto the report's own
 * `DayRowValue` shape (2.7.5).
 *
 * `mapDayRow` and `reportDayRange` (both pure, no DB) are unit-tested
 * directly (`apps/api/test/unit/report.sections.test.ts`); `loadDaySummaries`
 * is the one DB-touching entry point this task adds — `services/report/
 * index.ts` (`buildReport`) builds on it exactly as it builds on
 * `attempts.ts`'s `loadAttemptSummaries` and `practice.ts`'s
 * `loadPracticeRows` (D16).
 *
 * A program day with no `daily_checkins` row at all maps through
 * `buildCheckinView(null, [], localDate)`: every measurement stays `null`
 * and `status` is `'not_reported'` — a gap, never a zero record
 * (daily-checkin: "Overruns and missed days never block" / "Skipped day";
 * progress-report: "Practice and daily trends are separate sections" /
 * "Missing check-in day"). A day that has not happened yet (after today's
 * program day) is not listed at all — `reportDayRange` never returns it.
 *
 * See design.md's Database model, D12, D34, D36; specs/progress-report/
 * spec.md and specs/daily-checkin/spec.md ("Overruns and missed days never
 * block" / "Skipped day").
 */
import { eq, inArray } from 'drizzle-orm'
import {
  assertSameRealm,
  localDateForProgramDay,
  PROGRAM_LENGTH_DAYS,
  type DayRowValue,
  type FeedRowInput,
  type LocalDate,
  type Realm,
} from '@attention-lab/shared'

import type { AppDatabase } from '../../plugins/db.js'
import { dailyCheckins } from '../../db/schema/dailyCheckins.js'
import { feedUsage } from '../../db/schema/feedUsage.js'
import type { ProgramRow } from '../program/programService.js'
import { buildCheckinView, type CheckinRowInput } from '../checkinView.js'

// ---------------------------------------------------------------------------
// reportDayRange — pure, no DB, no clock (unit-tested directly)
// ---------------------------------------------------------------------------

/**
 * The program days this report's `days[]` section lists: `0` through
 * `min(todayProgramDay, 14)` inclusive. A day that has not happened yet is
 * not a gap — it is simply absent from the list. `todayProgramDay` before
 * Day 0 (never actually reachable once a program exists, since
 * `baselineDate` IS Day 0, but guarded here rather than assumed) yields an
 * empty list rather than a negative range.
 */
export function reportDayRange(todayProgramDay: number): readonly number[] {
  const maxDay = Math.min(todayProgramDay, PROGRAM_LENGTH_DAYS)
  const days: number[] = []
  for (let day = 0; day <= maxDay; day++) days.push(day)
  return days
}

// ---------------------------------------------------------------------------
// mapDayRow — pure, no DB (unit-tested directly)
// ---------------------------------------------------------------------------

/**
 * One program day's report row. `row` is the day's `daily_checkins` fields
 * (or `null` for no row at all) and `feedRows` its `feed_usage` children —
 * reduced through the same `buildCheckinView` (6.1.1) the days route itself
 * uses, then flattened onto the report's own `DayRowValue` (2.7.5's
 * flattened shape — `status`/`sleepMinutes`/... sit alongside `localDate`/
 * `day`, unlike the days-route's nested `checkin`/`aggregates` envelope).
 */
export function mapDayRow(
  row: CheckinRowInput | null,
  feedRows: readonly FeedRowInput[],
  localDate: LocalDate,
  day: number,
): DayRowValue {
  const view = buildCheckinView(row, feedRows, localDate)
  return {
    localDate: view.checkin.localDate,
    day,
    status: view.status.status,
    sleepMinutes: view.checkin.sleepMinutes,
    stress: view.checkin.stress,
    mindfulnessMinutes: view.checkin.mindfulnessMinutes,
    feedDeviceMinutes: view.aggregates.feedDeviceMinutes,
    partial: view.aggregates.partial,
    feedByDevice: { ...view.aggregates.feedByDevice },
  }
}

// ---------------------------------------------------------------------------
// loadDaySummaries — the one DB-touching entry point
// ---------------------------------------------------------------------------

interface DailyCheckinQueryRow extends CheckinRowInput {
  readonly id: string
  readonly realm: Realm
  readonly localDate: LocalDate
}

/**
 * Every `days[]` entry for `program`, Day 0 through `min(todayProgramDay,
 * 14)`. Loads every `daily_checkins` row for the program by ownership only
 * (never pre-filtered by realm) and asserts `assertSameRealm` over the
 * program's own realm plus every loaded row's realm in one pass, so a
 * foreign-realm check-in throws `RealmMixingError` (422 `realm_mismatch`)
 * rather than being silently dropped — the same projection `attempts.ts`
 * and `practice.ts` already apply to their own sections (identity-realm
 * "Realms are never mixed in a result").
 */
export async function loadDaySummaries(
  db: AppDatabase,
  program: Pick<ProgramRow, 'id' | 'realm' | 'baselineDate'>,
  todayProgramDay: number,
): Promise<DayRowValue[]> {
  const range = reportDayRange(todayProgramDay)
  if (range.length === 0) return []

  const checkinRows: DailyCheckinQueryRow[] = await db
    .select({
      id: dailyCheckins.id,
      realm: dailyCheckins.realm,
      localDate: dailyCheckins.localDate,
      sleepMinutes: dailyCheckins.sleepMinutes,
      stress: dailyCheckins.stress,
      mindfulnessMinutes: dailyCheckins.mindfulnessMinutes,
      note: dailyCheckins.note,
      version: dailyCheckins.version,
    })
    .from(dailyCheckins)
    .where(eq(dailyCheckins.programId, program.id))

  assertSameRealm([
    { realm: program.realm },
    ...checkinRows.map((row): { realm: Realm } => ({ realm: row.realm })),
  ])

  const checkinIds = checkinRows.map((row) => row.id)
  const feedRows =
    checkinIds.length === 0
      ? []
      : await db
          .select({
            checkinId: feedUsage.checkinId,
            device: feedUsage.device,
            platform: feedUsage.platform,
            minutes: feedUsage.minutes,
            shortVideoMinutes: feedUsage.shortVideoMinutes,
            measurementScope: feedUsage.measurementScope,
            source: feedUsage.source,
            plannedWindow: feedUsage.plannedWindow,
          })
          .from(feedUsage)
          .where(inArray(feedUsage.checkinId, checkinIds))

  const checkinByDate = new Map<LocalDate, DailyCheckinQueryRow>()
  for (const row of checkinRows) checkinByDate.set(row.localDate, row)

  const feedRowsByCheckinId = new Map<string, FeedRowInput[]>()
  for (const row of feedRows) {
    const existing = feedRowsByCheckinId.get(row.checkinId)
    if (existing === undefined) {
      feedRowsByCheckinId.set(row.checkinId, [row])
    } else {
      existing.push(row)
    }
  }

  return range.map((day) => {
    const localDate = localDateForProgramDay(program.baselineDate, day)
    const checkinRow = checkinByDate.get(localDate) ?? null
    const dayFeedRows = checkinRow === null ? [] : (feedRowsByCheckinId.get(checkinRow.id) ?? [])
    return mapDayRow(checkinRow, dayFeedRows, localDate, day)
  })
}
