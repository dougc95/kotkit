/**
 * `GET`/`PUT /programs/{id}/days/{date}` — one day's check-in plus its feed
 * rows, the derived completeness status and the D36 feed aggregates.
 *
 * The subset rule (`shortVideoMinutes <= minutes`) and the D36 platform rule
 * (a device carries either an `'all'` row or platform-specific rows, never
 * both) are deliberately NOT encoded here: `domain/feed.ts`'s
 * `validateFeedRows` owns them, and `6.1.2` maps its `feed_subset_violation`
 * / `feed_platform_conflict` / `duplicate_feed_row` codes to a 422. A schema
 * that duplicated those rules would drift from the one place that enforces
 * them — see `daily-checkin`'s "Feed rows carry device, platform, scope and
 * source" and D36.
 *
 * See design.md's API contracts table (`GET/PUT /programs/{id}/days/{date}`)
 * and D22 ("Other response shapes") for the no-row response shape.
 */
import { Type, type Static } from '@sinclair/typebox'

import {
  CheckinFieldSchema,
  CheckinStatusSchema,
  FeedDeviceSchema,
  FeedSourceSchema,
  LocalDateSchema,
  MeasurementScopeSchema,
  Obj,
  ReportedCountSchema,
  UuidSchema,
} from './common.js'

/**
 * One feed row, on the wire. `platform: 'all'` (`FEED_PLATFORM_ALL` in
 * `domain/types.ts`) is the device-level headline row (D36); any other
 * string is a platform-specific row. `shortVideoMinutes` and `plannedWindow`
 * are optional on write and always present (possibly `null`) on a stored
 * row, so one schema serves both directions.
 */
export const FeedRowSchema = Obj({
  device: FeedDeviceSchema,
  platform: Type.String({ minLength: 1, maxLength: 100 }),
  minutes: Type.Integer({ minimum: 0 }),
  shortVideoMinutes: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
  measurementScope: MeasurementScopeSchema,
  source: FeedSourceSchema,
  plannedWindow: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
})
export type FeedRowValue = Static<typeof FeedRowSchema>

export const DayParams = Obj({
  id: UuidSchema,
  date: LocalDateSchema,
})
export type DayParamsValue = Static<typeof DayParams>

/**
 * `expectedVersion: 0` is not a placeholder — it is what the first write of
 * a given date sends (D22: a day with no row is version 0). `feed` is
 * required but may be an empty array (saving sleep alone is valid — see
 * daily-checkin's "Minimal check-in" and "Incomplete saves and completeness
 * status").
 */
export const PutDayBody = Obj({
  expectedVersion: Type.Integer({ minimum: 0 }),
  sleepMinutes: Type.Optional(ReportedCountSchema),
  stress: Type.Optional(Type.Union([Type.Integer({ minimum: 0, maximum: 10 }), Type.Null()])),
  mindfulnessMinutes: Type.Optional(ReportedCountSchema),
  note: Type.Optional(Type.String({ maxLength: 2000 })),
  feed: Type.Array(FeedRowSchema),
})
export type PutDayBodyValue = Static<typeof PutDayBody>

/** Mirrors `domain/feed.ts`'s `FeedAggregates` (2.6.1) exactly, field for field. */
export const FeedAggregatesSchema = Obj({
  unitLabel: Type.Literal('device-minutes'),
  feedDeviceMinutes: ReportedCountSchema,
  feedByDevice: Obj({
    phone: ReportedCountSchema,
    desktop: ReportedCountSchema,
    tablet: ReportedCountSchema,
    unspecified: ReportedCountSchema,
  }),
  partial: Type.Boolean(),
  shortVideoDeviceMinutes: ReportedCountSchema,
  appTotals: Type.Array(FeedRowSchema),
})
export type FeedAggregatesValue = Static<typeof FeedAggregatesSchema>

/**
 * The D22 no-row form: `checkin` carries the requested `localDate` with
 * every other field `null`, `feed` is `[]`, `status` is `not_reported` with
 * `missing: ['sleep', 'feed']`, `aggregates` is `feedAggregates([])` and
 * `version` is 0 — the value the first `PUT` must send as
 * `expectedVersion`.
 */
export const DayResponse = Obj({
  checkin: Obj({
    localDate: LocalDateSchema,
    sleepMinutes: ReportedCountSchema,
    stress: Type.Union([Type.Integer({ minimum: 0, maximum: 10 }), Type.Null()]),
    mindfulnessMinutes: ReportedCountSchema,
    note: Type.Union([Type.String(), Type.Null()]),
  }),
  feed: Type.Array(FeedRowSchema),
  status: Obj({
    status: CheckinStatusSchema,
    missing: Type.Array(CheckinFieldSchema),
  }),
  aggregates: FeedAggregatesSchema,
  version: Type.Integer({ minimum: 0 }),
})
export type DayResponseValue = Static<typeof DayResponse>
