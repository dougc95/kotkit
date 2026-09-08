/**
 * `session_amendments`: append-only notes attached to a finalized session
 * (D32). Stored `eligible`/`exclusion_reasons` on `focus_sessions` are never
 * rewritten by an amendment; the report and the replacement rule apply this
 * overlay at read time instead (`applyAmendmentExclusion`, group 2). No
 * `realm` column — inherited through the session (D34).
 */
import { pgTable, uuid, text, boolean, timestamp } from 'drizzle-orm/pg-core'

import { focusSessions } from './focusSessions.js'

export const sessionAmendments = pgTable('session_amendments', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => focusSessions.id),
  userId: text('user_id').notNull(),
  reason: text('reason').notNull(),
  excludeFromReport: boolean('exclude_from_report').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
