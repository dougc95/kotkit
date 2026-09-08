/**
 * Pure display-string and derived-order helpers for the Progress report's
 * trend sections (task 8.8.3: `PracticeTrend`/`DailyTrend`/`ExactValuesTable`).
 *
 * Every function here is presentation-only over values `PracticeTrend`/
 * `DailyTrend` already receive from `report.practice`/`report.days` (8.8.1) —
 * nothing here computes a score or infers a value the server did not send
 * (D4), and every blank count renders 'Not reported', never '0' (CLAUDE.md:
 * unknown != zero — an explicit 0 is a real measurement and stays '0').
 *
 * `blockOrdinals` is the one exception to "nothing is derived": it is a
 * purely presentational 1-based position within each row's own program day,
 * computed from array order alone (never from a server field, since neither
 * `PracticeRowValue` nor any other wire shape carries a block number) —
 * `services/report/practice.ts` (6.2.4) already orders `practice[]` by
 * `local_date, started_at`, so this labels "which block of the day" a row is
 * without re-deriving or reordering anything the server sent.
 */
import type {
  CheckinStatus,
  CountMethod,
  FeedDevice,
  FeedSource,
  OutputQuality,
  PracticeRowValue,
  ReportedCount,
  TimerQuality,
} from '@attention-lab/shared'

export const NOT_REPORTED = 'Not reported'

/** Whole seconds -> whole minutes, e.g. `600` -> `10`. For fields that are always present (never a `ReportedCount`). */
export function secondsToWholeMinutes(seconds: number): number {
  return Math.round(seconds / 60)
}

/** A `ReportedCount` of seconds -> whole minutes, or 'Not reported' for `null`/`undefined`. Never '0' unless the value truly is 0. */
export function formatMinutes(seconds: ReportedCount | undefined): string {
  if (seconds === null || seconds === undefined) {
    return NOT_REPORTED
  }
  return String(secondsToWholeMinutes(seconds))
}

const OUTPUT_QUALITY_LABEL: Record<OutputQuality, string> = {
  yes: 'Yes',
  partly: 'Partly',
  no: 'No',
}

export function formatOutputQuality(quality: OutputQuality | null): string {
  return quality === null ? NOT_REPORTED : OUTPUT_QUALITY_LABEL[quality]
}

const TIMER_FLAG_LABEL: Record<TimerQuality, string> = {
  ok: 'OK',
  uncertain: 'Timing uncertain',
}

/** `timerQuality` is `Type.Optional` on `PracticeRowValue` (a pre-existing fixture predates it, 6.2.4) — `undefined` reads the same as `null`. */
export function formatTimerFlag(quality: TimerQuality | undefined): string {
  return quality === undefined ? NOT_REPORTED : TIMER_FLAG_LABEL[quality]
}

const COUNT_METHOD_LABEL: Record<CountMethod, string> = {
  event: 'Event-timed',
  retrospective: 'Retrospective',
}

/**
 * The practice row's S capture method — the ExactValuesTable's own 'Time
 * source' column. `countMethod` is `Type.Optional` on `PracticeRowValue` (a
 * pre-existing fixture predates it, 6.2.4), so `undefined` reads the same as
 * `null`. Never guesses either way.
 */
export function formatCountMethod(method: CountMethod | null | undefined): string {
  return method === null || method === undefined ? NOT_REPORTED : COUNT_METHOD_LABEL[method]
}

const FEED_DEVICE_LABEL: Record<FeedDevice, string> = {
  phone: 'Phone',
  desktop: 'Desktop',
  tablet: 'Tablet',
  unspecified: 'Unspecified device',
}

export function formatFeedDevice(device: FeedDevice): string {
  return FEED_DEVICE_LABEL[device]
}

/**
 * `FeedSource`'s two wire values -> the copy `daily-checkin`'s "Feed rows
 * carry device, platform, scope and source" scenario names. Exported (rather
 * than kept private) so `DailyTrend`'s general provenance note and any test
 * asserting on it use the exact same two strings.
 */
export const FEED_SOURCE_LABEL: Record<FeedSource, string> = {
  estimate: 'Estimate',
  device_report: 'From device report',
}

export function formatFeedSource(source: FeedSource): string {
  return FEED_SOURCE_LABEL[source]
}

const CHECKIN_STATUS_LABEL: Record<CheckinStatus, string> = {
  complete: 'Complete',
  incomplete: 'Incomplete',
  not_reported: NOT_REPORTED,
}

export function formatCheckinStatus(status: CheckinStatus): string {
  return CHECKIN_STATUS_LABEL[status]
}

/**
 * 1-based position of each row within its own program day, in array order,
 * keyed by `sessionId` (a `Map`, not a parallel array, so callers never hit
 * `noUncheckedIndexedAccess`'s `| undefined` on a same-length-array lookup).
 * Purely a display ordinal computed from row order (see the file header) —
 * it never renumbers days or reorders the input.
 */
export function blockOrdinals(practice: readonly PracticeRowValue[]): ReadonlyMap<string, number> {
  const seenPerDay = new Map<number, number>()
  const ordinalBySessionId = new Map<string, number>()
  for (const row of practice) {
    const next = (seenPerDay.get(row.day) ?? 0) + 1
    seenPerDay.set(row.day, next)
    ordinalBySessionId.set(row.sessionId, next)
  }
  return ordinalBySessionId
}
