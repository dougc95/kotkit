/**
 * `GET`/`PUT /programs/{id}/days/{date}` — the pure builder that assembles
 * the D22 / 2.7.5 `DayResponse` shape from a `daily_checkins` row (or none)
 * plus its `feed_usage` children. Computes nothing itself: completeness
 * comes from `checkinStatus` and the D36 aggregates from `feedAggregates`
 * (both `packages/shared/src/domain/feed.ts`, D16 — the only completeness /
 * aggregate implementation, `4.5.2`'s local module is not used here). Used
 * by `6.1.1`'s `GET` route and reused as-is by `6.1.2`'s `PUT` response and
 * its `stale_version` conflict `details.current`.
 *
 * No row → `{ checkin: { localDate, sleepMinutes: null, stress: null,
 * mindfulnessMinutes: null, note: null }, feed: [], status: { status:
 * 'not_reported', missing: ['sleep','feed'] }, aggregates:
 * feedAggregates([]), version: 0 }` (design.md D22). Stored nulls pass
 * through as JSON null; `feedRows` is never reordered, filtered, mutated or
 * summed here — `checkinStatus`/`feedAggregates` own that entirely (2.9.1
 * guard: no `?? 0` / `|| 0` / `COALESCE(...,0)` anywhere in this file).
 */
import { checkinStatus, feedAggregates } from '@attention-lab/shared'
import type {
  DayResponseValue,
  FeedRowInput,
  FeedRowValue,
  LocalDate,
  ReportedCount,
} from '@attention-lab/shared'

/**
 * The subset of a `daily_checkins` row `buildCheckinView` needs. `id` and
 * `realm` are consumed by the caller (the route loads and realm-checks the
 * row via `assertOwnRealm` before this function ever sees it) — this shape
 * carries only the fields that end up on the wire.
 */
export interface CheckinRowInput {
  readonly sleepMinutes: ReportedCount
  readonly stress: number | null
  readonly mindfulnessMinutes: ReportedCount
  readonly note: string | null
  readonly version: number
}

/**
 * A stored `feed_usage` row keeps every wire field, nulls included — never
 * omitted, never coalesced.
 */
function toFeedRowValue(row: FeedRowInput): FeedRowValue {
  return {
    device: row.device,
    platform: row.platform,
    minutes: row.minutes,
    shortVideoMinutes: row.shortVideoMinutes,
    measurementScope: row.measurementScope,
    source: row.source,
    plannedWindow: row.plannedWindow,
  }
}

/**
 * `row === null` is a program-local date with no `daily_checkins` row at
 * all — the D22 empty shell. Otherwise every stored field is passed through
 * as-is; `localDate` always comes from the caller (the requested date),
 * never inferred from the row.
 */
export function buildCheckinView(
  row: CheckinRowInput | null,
  feedRows: readonly FeedRowInput[],
  localDate: LocalDate,
): DayResponseValue {
  const sleep = row === null ? null : { sleepMinutes: row.sleepMinutes }
  const { status, missing } = checkinStatus(sleep, feedRows)
  const aggregates = feedAggregates(feedRows)

  return {
    checkin: {
      localDate,
      sleepMinutes: row === null ? null : row.sleepMinutes,
      stress: row === null ? null : row.stress,
      mindfulnessMinutes: row === null ? null : row.mindfulnessMinutes,
      note: row === null ? null : row.note,
    },
    feed: feedRows.map(toFeedRowValue),
    status: { status, missing: [...missing] },
    aggregates: {
      unitLabel: aggregates.unitLabel,
      feedDeviceMinutes: aggregates.feedDeviceMinutes,
      feedByDevice: { ...aggregates.feedByDevice },
      partial: aggregates.partial,
      shortVideoDeviceMinutes: aggregates.shortVideoDeviceMinutes,
      appTotals: aggregates.appTotals.map(toFeedRowValue),
    },
    version: row === null ? 0 : row.version,
  }
}
