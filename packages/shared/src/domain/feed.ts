/**
 * Cross-device recreational feed use and daily check-in completeness.
 *
 * Two rules anchor this module (see D36 and the daily-checkin spec):
 *  - a device reports EITHER one `platform: 'all'` row (an estimate for the
 *    whole device) OR any number of platform-specific rows, never both — the
 *    UI enforces this by disabling the headline input once detail rows exist,
 *    and `validateFeedRows` enforces it server-side as `feed_platform_conflict`;
 *  - completeness ("sleep reported AND at least one feed-scope row") is
 *    computed from field VALUES, never from whether a check-in row merely
 *    exists — a day with no check-in is a gap, not a zero, and MUST render as
 *    `not_reported`, distinct from an incomplete check-in that was started.
 *
 * See docs/Attention-Lab-Prototype-PRD.md §5, HANDOFF.md ("Unknown does not
 * equal zero") and specs/daily-checkin/spec.md.
 */

import {
  CHECKIN_FIELDS,
  FEED_DEVICES,
  FEED_PLATFORM_ALL,
  type CheckinField,
  type CheckinStatus,
  type FeedDevice,
  type FeedSource,
  type MeasurementScope,
  type ReportedCount,
} from './types.js'

/** One recorded feed row, as captured by the check-in form (2.6.1). */
export interface FeedRowInput {
  readonly device: FeedDevice
  readonly platform: string
  readonly minutes: number
  /** A subset of `minutes`; `null` means not reported, never "no short video". */
  readonly shortVideoMinutes: number | null
  readonly measurementScope: MeasurementScope
  readonly source: FeedSource
  readonly plannedWindow: boolean | null
}

/** The D19 error codes `validateFeedRows` produces, mapped one-to-one by 6.1.2. */
export type FeedValidationErrorCode =
  | 'feed_subset_violation'
  | 'duplicate_feed_row'
  | 'feed_platform_conflict'

export interface FeedValidationError {
  readonly index: number
  readonly code: FeedValidationErrorCode
  readonly message: string
}

export type FeedValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly FeedValidationError[] }

/**
 * Validates one day's feed rows as a set. Three rules only — deliberately no
 * allowance/limit rule: overruns above a planned allowance always save (see
 * "Overruns and missed days never block").
 *
 *  - `feed_subset_violation`: `shortVideoMinutes` exceeds `minutes` on a row.
 *  - `duplicate_feed_row`: the same (device, platform, measurementScope)
 *    appears more than once; every repeat beyond the first is flagged.
 *  - `feed_platform_conflict` (D36): a device carries both a `platform: 'all'`
 *    row and a platform-specific scope-`feed` row, OR an `'all'` row is not
 *    `{ measurementScope: 'feed', source: 'estimate' }`. A scope-`app_total`
 *    row never counts as a conflicting "platform-specific row" — it is a
 *    different measurement, not a feed-scope report for the device.
 */
export function validateFeedRows(rows: readonly FeedRowInput[]): FeedValidationResult {
  const errors: FeedValidationError[] = []

  rows.forEach((row, index) => {
    if (row.shortVideoMinutes !== null && row.shortVideoMinutes > row.minutes) {
      errors.push({
        index,
        code: 'feed_subset_violation',
        message:
          `Row ${index}: short-video minutes (${row.shortVideoMinutes}) exceed total feed ` +
          `minutes (${row.minutes}); short-video time is a subset of feed time and cannot exceed it.`,
      })
    }
  })

  const seen = new Set<string>()
  rows.forEach((row, index) => {
    const key = `${row.device}\0${row.platform}\0${row.measurementScope}`
    if (seen.has(key)) {
      errors.push({
        index,
        code: 'duplicate_feed_row',
        message:
          `Row ${index}: device "${row.device}", platform "${row.platform}", scope ` +
          `"${row.measurementScope}" was already reported for this day.`,
      })
    } else {
      seen.add(key)
    }
  })

  // D36 (refined by task 6.1.2, which found this restriction stated but not
  // yet enforced): the "either an `all` row or platform-specific rows, never
  // both" exclusivity applies to scope-`feed` rows only. A scope-`app_total`
  // row for the same device is a wholly different measurement (surfaced
  // separately as `appTotals`, never summed into the feed total — see
  // `feedAggregates` below) and never conflicts with an `all` row, however
  // many platforms it names.
  const devicesWithAllRow = new Set<FeedDevice>()
  const devicesWithSpecificFeedRow = new Set<FeedDevice>()
  for (const row of rows) {
    if (row.platform === FEED_PLATFORM_ALL) {
      devicesWithAllRow.add(row.device)
    } else if (row.measurementScope === 'feed') {
      devicesWithSpecificFeedRow.add(row.device)
    }
  }

  rows.forEach((row, index) => {
    if (row.platform === FEED_PLATFORM_ALL) {
      if (row.measurementScope !== 'feed' || row.source !== 'estimate') {
        errors.push({
          index,
          code: 'feed_platform_conflict',
          message:
            `Row ${index}: an "all" row for device "${row.device}" must be scope "feed" ` +
            `with source "estimate".`,
        })
      }
      if (devicesWithSpecificFeedRow.has(row.device)) {
        errors.push({
          index,
          code: 'feed_platform_conflict',
          message:
            `Row ${index}: device "${row.device}" has both an "all" row and platform-specific ` +
            `rows; a device reports one or the other, never both.`,
        })
      }
    } else if (row.measurementScope === 'feed' && devicesWithAllRow.has(row.device)) {
      errors.push({
        index,
        code: 'feed_platform_conflict',
        message:
          `Row ${index}: device "${row.device}" has both an "all" row and platform-specific ` +
          `rows; a device reports one or the other, never both.`,
      })
    }
  })

  if (errors.length === 0) return { ok: true }
  return { ok: false, errors }
}

export interface FeedAggregates {
  readonly unitLabel: 'device-minutes'
  /** Sum of every scope-`feed` row's minutes. `null` when there are none — never 0. */
  readonly feedDeviceMinutes: number | null
  /**
   * Per device: an `'all'` row is that device's total as-is; otherwise the sum
   * of its scope-`feed` platform rows. `null` when the device has no
   * scope-`feed` row at all (unknown, never 0).
   */
  readonly feedByDevice: Record<FeedDevice, ReportedCount>
  /** D36: true when phone or desktop lacks a scope-`feed` row. */
  readonly partial: boolean
  /** Subset of `feedDeviceMinutes`; summed only over rows that reported it. */
  readonly shortVideoDeviceMinutes: number | null
  /** Scope-`app_total` rows, shown separately and never summed into the feed total. */
  readonly appTotals: readonly FeedRowInput[]
}

/**
 * Reduces one day's feed rows to display aggregates. Pure and read-only: it
 * never validates (`validateFeedRows` is the gate before rows are stored) and
 * never mutates or reorders the input rows.
 */
export function feedAggregates(rows: readonly FeedRowInput[]): FeedAggregates {
  const feedRows = rows.filter((row) => row.measurementScope === 'feed')
  const appTotals = rows.filter((row) => row.measurementScope === 'app_total')

  const feedDeviceMinutes =
    feedRows.length === 0 ? null : feedRows.reduce((sum, row) => sum + row.minutes, 0)

  const feedByDevice = Object.fromEntries(
    FEED_DEVICES.map((device): [FeedDevice, ReportedCount] => {
      const deviceFeedRows = feedRows.filter((row) => row.device === device)
      if (deviceFeedRows.length === 0) return [device, null]
      return [device, deviceFeedRows.reduce((sum, row) => sum + row.minutes, 0)]
    }),
  ) as Record<FeedDevice, ReportedCount>

  const partial = feedByDevice.phone === null || feedByDevice.desktop === null

  // A type-predicate filter (rather than a bare boolean one) so the checked
  // type of `shortVideoMinutes` is narrowed to `number` below — no coalesce
  // needed, and the no-coalesce guard (2.9.1) has nothing to flag here.
  const shortVideoRows = feedRows.filter(
    (row): row is FeedRowInput & { readonly shortVideoMinutes: number } =>
      row.shortVideoMinutes !== null,
  )
  const shortVideoDeviceMinutes =
    shortVideoRows.length === 0
      ? null
      : shortVideoRows.reduce((sum, row) => sum + row.shortVideoMinutes, 0)

  return {
    unitLabel: 'device-minutes',
    feedDeviceMinutes,
    feedByDevice,
    partial,
    shortVideoDeviceMinutes,
    appTotals,
  }
}

/** The sleep-only slice of a check-in row that completeness needs. */
export interface CheckinSleep {
  readonly sleepMinutes: ReportedCount
}

export interface CheckinCompleteness {
  readonly status: CheckinStatus
  readonly missing: readonly CheckinField[]
}

/**
 * THE single completeness implementation (D16): called by both `GET
 * /programs/{id}/today` (4.5.3) and the days routes (6.1.1, 6.1.2), never
 * reimplemented at either call site.
 *
 * `checkin === null` is a day with no row at all — a gap, never a zero — and
 * is always `not_reported`, distinct from a saved-but-incomplete row.
 * `'complete'` requires sleep reported AND at least one scope-`feed` row (an
 * explicit-zero `'all'` row counts; an `app_total`-only day does not
 * complete — D36). Status comes only from field values; `partial` (2.6.1) is
 * a display concern, not part of status.
 */
export function checkinStatus(
  checkin: CheckinSleep | null,
  rows: readonly FeedRowInput[],
): CheckinCompleteness {
  if (checkin === null) {
    return { status: 'not_reported', missing: [...CHECKIN_FIELDS] }
  }

  const missing: CheckinField[] = []
  if (checkin.sleepMinutes === null) missing.push('sleep')
  const hasFeedRow = rows.some((row) => row.measurementScope === 'feed')
  if (!hasFeedRow) missing.push('feed')

  return { status: missing.length === 0 ? 'complete' : 'incomplete', missing }
}

/** The D22 `today.checkin.values` shape: nulls preserved throughout. */
export interface CheckinValues {
  readonly sleepMinutes: ReportedCount
  readonly phoneFeedMinutes: ReportedCount
  readonly desktopFeedMinutes: ReportedCount
}

/** Sleep plus the phone/desktop headline aggregates, for the Today card and days routes. */
export function checkinValues(
  checkin: CheckinSleep | null,
  rows: readonly FeedRowInput[],
): CheckinValues {
  const aggregates = feedAggregates(rows)
  return {
    sleepMinutes: checkin === null ? null : checkin.sleepMinutes,
    phoneFeedMinutes: aggregates.feedByDevice.phone,
    desktopFeedMinutes: aggregates.feedByDevice.desktop,
  }
}
