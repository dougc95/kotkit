/**
 * `focus_sessions`: one row per practice block or benchmark attempt.
 *
 * Two structural rules protect the measurement contract at the schema level
 * rather than only in application code (design.md Database model, D34):
 *  - `focus_sessions_benchmark_has_slot` — a `benchmark` session always
 *    carries a `slot_id`; a `practice` session never does. Benchmark and
 *    practice can never be confused structurally.
 *  - `focus_sessions_one_active_per_user` — a partial unique index on
 *    `user_id` covering the three "unfinished" lifecycles means a second
 *    session cannot be started while one is `running`, `paused` or
 *    `awaiting_review` (session-recovery: "Starting a session requires the
 *    server").
 *
 * `realm` reuses `programs.ts`'s `realmEnum` — it is a realm root (D34) and
 * carries no default, same reasoning as `programs.realm`. `clock_gap_seconds`
 * accumulates with an explicit NULL branch at the service layer, never
 * `?? 0` (D26) — the column itself is simply nullable.
 */
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  date,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import {
  SESSION_KINDS,
  SESSION_LIFECYCLES,
  TIME_SOURCES,
  TIMER_QUALITIES,
} from '@attention-lab/shared'

import { userProfiles } from './userProfiles.js'
import { programs, realmEnum } from './programs.js'
import { protocolRevisions } from './protocolRevisions.js'
import { benchmarkSlots } from './benchmarkSlots.js'

export const sessionKindEnum = pgEnum('session_kind', SESSION_KINDS)
export const lifecycleEnum = pgEnum('lifecycle', SESSION_LIFECYCLES)
export const timeSourceEnum = pgEnum('time_source', TIME_SOURCES)
export const timerQualityEnum = pgEnum('timer_quality', TIMER_QUALITIES)

export const focusSessions = pgTable(
  'focus_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => userProfiles.id),
    programId: uuid('program_id')
      .notNull()
      .references(() => programs.id),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => protocolRevisions.id),
    slotId: uuid('slot_id').references(() => benchmarkSlots.id),
    realm: realmEnum('realm').notNull(),
    kind: sessionKindEnum('kind').notNull(),
    lifecycle: lifecycleEnum('lifecycle').notNull(),
    targetSeconds: integer('target_seconds').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    pausedSeconds: integer('paused_seconds').notNull().default(0),
    currentPauseStartedAt: timestamp('current_pause_started_at', { withTimezone: true }),
    localDate: date('local_date').notNull(),
    intendedOutput: text('intended_output'),
    timeSource: timeSourceEnum('time_source').notNull(),
    timerQuality: timerQualityEnum('timer_quality').notNull().default('ok'),
    // D26: accumulates with an explicit NULL branch at the service layer,
    // never `?? 0` — the column itself stays nullable.
    clockGapSeconds: integer('clock_gap_seconds'),
    completeInterval: boolean('complete_interval'),
    eligible: boolean('eligible'),
    // No DB-level DEFAULT (3.3.4): drizzle-kit 0.31's push/introspect diff for
    // an empty text[] default never converges (it round-trips `'{}'::text[]`
    // through a comma-split that always yields one bogus `""` element), so
    // `npm run db:push` would re-apply the same ALTER on every run forever.
    // `$defaultFn` supplies `[]` client-side on every drizzle-orm insert
    // (the only way this codebase writes these tables) without a stored
    // column default for drizzle-kit to misdiff.
    exclusionReasons: text('exclusion_reasons')
      .array()
      .notNull()
      .$defaultFn(() => []),
    replacementReason: text('replacement_reason'),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    check(
      'focus_sessions_benchmark_has_slot',
      sql`(${t.kind} = 'benchmark') = (${t.slotId} is not null)`,
    ),
    uniqueIndex('focus_sessions_one_active_per_user')
      .on(t.userId)
      .where(sql`${t.lifecycle} in ('running', 'paused', 'awaiting_review')`),
    index('focus_sessions_program_kind_local_date_idx').on(t.programId, t.kind, t.localDate),
  ],
)
