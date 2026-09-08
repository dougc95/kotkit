/**
 * `programs`: one open (non-terminal) program per user, enforced by the
 * partial unique index below (design.md Database model, D33). `realm` has
 * no default — the identity plugin's `ownerStamp` always supplies it
 * explicitly for every realm root (D34); a missing value is a bug, not a
 * default worth guessing.
 *
 * `currentRevisionId` points at `protocol_revisions`, which itself points
 * back at `programs` via `program_id`. Drizzle resolves this with a lazy
 * `references()` callback (`AnyPgColumn`, per the task brief) so neither
 * file needs the other's table object to exist yet at import time — only
 * when the callback is actually invoked (schema introspection / migration
 * generation), by which point both modules have finished evaluating. The
 * column stays nullable only because of this circularity: the API sets it
 * inside the same transaction that inserts revision 1, right after that row
 * exists.
 */
import { pgTable, pgEnum, uuid, text, date, integer, uniqueIndex, type AnyPgColumn } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { REALMS, PROGRAM_STATUSES } from '@attention-lab/shared'

import { userProfiles } from './userProfiles.js'
import { protocolRevisions } from './protocolRevisions.js'

export const realmEnum = pgEnum('realm_enum', REALMS)
export const programStatusEnum = pgEnum('program_status_enum', PROGRAM_STATUSES)

export const programs = pgTable(
  'programs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => userProfiles.id),
    realm: realmEnum('realm').notNull(),
    baselineDate: date('baseline_date').notNull(),
    timezone: text('timezone').notNull(),
    status: programStatusEnum('status').notNull(),
    leisureAllowanceMin: integer('leisure_allowance_min').notNull(),
    feedEstimateMin: integer('feed_estimate_min'),
    currentRevisionId: uuid('current_revision_id').references(
      (): AnyPgColumn => protocolRevisions.id,
    ),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    uniqueIndex('programs_one_open_per_user')
      .on(t.userId)
      .where(sql`status in ('draft', 'baseline_ready', 'active')`),
  ],
)
