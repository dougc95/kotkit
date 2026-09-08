/**
 * `daily_checkins`: one row per program per local date (design.md Database
 * model, D34, D36). `realm` is a realm root like `programs` and
 * `focus_sessions` — NOT NULL with no default, stamped explicitly by the
 * identity plugin, never inferred (D34).
 *
 * There is no `status` column: completeness (`complete` / `incomplete` /
 * `not_reported`, D12/D36) is derived on read by `checkinStatus` in
 * `packages/shared/src/domain/feed.ts` (D16, D22) from `sleep_minutes` and
 * the row's `feed_usage` children — storing it here would let it drift out
 * of sync with the rows it summarizes.
 *
 * `stress`, `sleep_minutes` and `mindfulness_minutes` are nullable with no
 * default, same reasoning as the `session_reviews` counts (D7.1): a blank
 * input is "not reported", never `0`. `daily_checkins_stress_range` is the
 * schema-level guard on the 0-10 self-report scale.
 */
import { pgTable, uuid, date, integer, text, unique, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

import { programs, realmEnum } from './programs.js'

export const dailyCheckins = pgTable(
  'daily_checkins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    programId: uuid('program_id')
      .notNull()
      .references(() => programs.id),
    realm: realmEnum('realm').notNull(),
    localDate: date('local_date').notNull(),
    sleepMinutes: integer('sleep_minutes'),
    stress: integer('stress'),
    mindfulnessMinutes: integer('mindfulness_minutes'),
    note: text('note'),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    unique('daily_checkins_program_local_date_unique').on(t.programId, t.localDate),
    check('daily_checkins_stress_range', sql`${t.stress} is null or ${t.stress} between 0 and 10`),
  ],
)
