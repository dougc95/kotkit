/**
 * `feed_usage`: one row per (check-in, device, platform, measurement scope)
 * recreational-feed report (design.md Database model, D36). No `realm`
 * column — inherited through its `daily_checkins` parent (D34); no
 * `ON DELETE` action on the `checkin_id` FK, deletion order is explicit in
 * `deletePrincipalData` (3.5.3).
 *
 * The headline phone/desktop inputs on Today are rows with
 * `platform = 'all'`, `measurement_scope = 'feed'`, `source = 'estimate'`
 * (D36); a device carries either its `all` row or platform-specific rows,
 * never both — that exclusivity is enforced in the service layer
 * (`validateFeedRows`, 6.1.2, 422 `feed_platform_conflict`), not by a schema
 * constraint, because it spans multiple rows of the same device.
 * `feed_usage_short_video_subset` is the one cross-column rule a single row
 * can enforce on its own: `short_video_minutes` can never exceed `minutes`.
 */
import { pgTable, pgEnum, uuid, text, integer, boolean, unique, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { FEED_DEVICES, MEASUREMENT_SCOPES, FEED_SOURCES } from '@attention-lab/shared'

import { dailyCheckins } from './dailyCheckins.js'

export const deviceEnum = pgEnum('device', FEED_DEVICES)
export const measurementScopeEnum = pgEnum('measurement_scope', MEASUREMENT_SCOPES)
export const feedSourceEnum = pgEnum('feed_source', FEED_SOURCES)

export const feedUsage = pgTable(
  'feed_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    checkinId: uuid('checkin_id')
      .notNull()
      .references(() => dailyCheckins.id),
    device: deviceEnum('device').notNull(),
    platform: text('platform').notNull(),
    minutes: integer('minutes').notNull(),
    shortVideoMinutes: integer('short_video_minutes'),
    measurementScope: measurementScopeEnum('measurement_scope').notNull(),
    source: feedSourceEnum('source').notNull(),
    plannedWindow: boolean('planned_window'),
  },
  (t) => [
    unique('feed_usage_checkin_device_platform_scope_unique').on(
      t.checkinId,
      t.device,
      t.platform,
      t.measurementScope,
    ),
    check(
      'feed_usage_short_video_subset',
      sql`${t.shortVideoMinutes} is null or ${t.shortVideoMinutes} <= ${t.minutes}`,
    ),
  ],
)
