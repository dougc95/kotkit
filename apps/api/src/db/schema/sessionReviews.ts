/**
 * `session_reviews`: one row per session, created at session start (D31) and
 * updated by recall then finalize (benchmark) or finalize alone (practice).
 *
 * `episode_count`, `external_count`, `unplanned_agent_checks`,
 * `mind_wandering_count` and `recall_score` are nullable with NO default —
 * this is the schema-level fix for spec defect #1 (design.md D7.1): a blank
 * count must read back as SQL NULL, never `0`, so "not reported" and
 * "reported as zero" stay distinguishable end to end. `review_note` and
 * `output_note` are likewise plain nullable text with no default.
 *
 * `observed_conditions` is NOT NULL: the row is seeded at session start with
 * the slot's conditions for a benchmark or the empty `ObservedConditions` for
 * practice (D31), so there is always something here to confirm at review,
 * never an absent JSON value.
 */
import { pgTable, pgEnum, uuid, integer, text, boolean, timestamp, jsonb } from 'drizzle-orm/pg-core'
import {
  COUNT_METHODS,
  FIRST_SWITCH_KINDS,
  FIRST_SWITCH_METHODS,
  OUTPUT_QUALITIES,
} from '@attention-lab/shared'
import type {
  ObservedConditionsValue,
  RecallPointScores,
  RecallPoints,
  RecallScoreValue,
} from '@attention-lab/shared'

import { focusSessions } from './focusSessions.js'

export const countMethodEnum = pgEnum('count_method', COUNT_METHODS)
export const firstSwitchKindEnum = pgEnum('first_switch_kind', FIRST_SWITCH_KINDS)
export const firstSwitchMethodEnum = pgEnum('first_switch_method', FIRST_SWITCH_METHODS)
export const outputQualityEnum = pgEnum('output_quality', OUTPUT_QUALITIES)

export const sessionReviews = pgTable('session_reviews', {
  sessionId: uuid('session_id')
    .primaryKey()
    .references(() => focusSessions.id),
  // D7.1 / spec defect #1: nullable, no default — unknown never becomes 0.
  episodeCount: integer('episode_count'),
  countMethod: countMethodEnum('count_method'),
  firstSwitchKind: firstSwitchKindEnum('first_switch_kind'),
  firstSwitchSeconds: integer('first_switch_seconds'),
  firstSwitchMethod: firstSwitchMethodEnum('first_switch_method'),
  externalCount: integer('external_count'),
  unplannedAgentChecks: integer('unplanned_agent_checks'),
  mindWanderingCount: integer('mind_wandering_count'),
  outputQuality: outputQualityEnum('output_quality'),
  // The one-line "what did you finish" answer.
  outputNote: text('output_note'),
  // D31: optional free-text note, separate from outputNote.
  reviewNote: text('review_note'),
  materiallyDisrupted: boolean('materially_disrupted'),
  disruptionNote: text('disruption_note'),
  recallPoints: jsonb('recall_points').$type<RecallPoints>(),
  recallStartedAt: timestamp('recall_started_at', { withTimezone: true }),
  recallLockedAt: timestamp('recall_locked_at', { withTimezone: true }),
  recallDelaySeconds: integer('recall_delay_seconds'),
  recallDurationSeconds: integer('recall_duration_seconds'),
  // No DB-level DEFAULT (3.3.4): see focusSessions.ts's exclusionReasons
  // comment — drizzle-kit 0.31's diff for an empty text[] default never
  // converges, so `$defaultFn` supplies `[]` client-side instead.
  recallFlags: text('recall_flags')
    .array()
    .notNull()
    .$defaultFn(() => []),
  recallScores: jsonb('recall_scores').$type<readonly RecallScoreValue[] | RecallPointScores>(),
  recallScore: integer('recall_score'),
  observedConditions: jsonb('observed_conditions').notNull().$type<ObservedConditionsValue>(),
  finalizedAt: timestamp('finalized_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
})
