/**
 * `user_profiles`: one row per principal. In `local-demo` mode there is
 * exactly one row, id `local-demo` (3.2.3's `ensurePrincipalProfile`); unit
 * tests here use their own id `schema-test-user` so they stay independent of
 * that seeding (design.md 3.3.1 task brief).
 *
 * `id` is `text`, not `uuid`, so a future real-auth adapter (Better Auth /
 * Google OAuth subject ids) can be stored without a migration (design.md
 * Goals: "owner id is a text column").
 */
import { pgTable, text, jsonb, integer, timestamp } from 'drizzle-orm/pg-core'
import type { PreferencesValue } from '@attention-lab/shared'

export const userProfiles = pgTable('user_profiles', {
  id: text('id').primaryKey(),
  timezone: text('timezone').notNull(),
  preferences: jsonb('preferences').notNull().$type<PreferencesValue>(),
  demoClockOffsetSeconds: integer('demo_clock_offset_seconds').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
