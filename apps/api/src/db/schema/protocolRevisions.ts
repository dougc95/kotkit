/**
 * `protocol_revisions`: immutable settings snapshots for a program.
 * Revision 1 is created inside the same transaction as its `programs` row
 * (design.md D33); later revisions are appended by
 * `POST /programs/{id}/revisions` and never edited. `programs.ts` and this
 * file import each other for the circular `current_revision_id` FK — see
 * the comment on `programs.currentRevisionId`.
 */
import { pgTable, uuid, integer, jsonb, text, timestamp, unique } from 'drizzle-orm/pg-core'
import type { BandCeiling } from '@attention-lab/shared'

import { programs } from './programs.js'

/** The exact shape stored in `protocol_revisions.settings` (design.md Database model). */
export interface ProtocolRevisionSettings {
  readonly practiceTargetSeconds: number
  readonly bandCeilings: readonly BandCeiling[]
  readonly leisureAllowanceMin: number
}

export const protocolRevisions = pgTable(
  'protocol_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    programId: uuid('program_id')
      .notNull()
      .references(() => programs.id),
    revision: integer('revision').notNull(),
    effectiveDay: integer('effective_day').notNull(),
    settings: jsonb('settings').notNull().$type<ProtocolRevisionSettings>(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('protocol_revisions_program_revision_unique').on(t.programId, t.revision)],
)
