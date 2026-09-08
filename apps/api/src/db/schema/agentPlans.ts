/**
 * `agent_plans`: the collapsed agent-waiting panel state for a practice
 * session (PUT /sessions/{id}/agent-plan is practice-only; see D22/D30's
 * practice-vs-benchmark split). One row per session, created lazily by the
 * first PUT rather than at session start (unlike `session_reviews`, D31).
 * No `realm` column — inherited through the session (D34).
 */
import { pgTable, uuid, text, integer, timestamp } from 'drizzle-orm/pg-core'

import { focusSessions } from './focusSessions.js'

export const agentPlans = pgTable('agent_plans', {
  sessionId: uuid('session_id')
    .primaryKey()
    .references(() => focusSessions.id),
  workstream: text('workstream'),
  waitingTask: text('waiting_task'),
  resumeNote: text('resume_note'),
  reviewCheckpoint: text('review_checkpoint').notNull().default('end_of_block'),
  reviewAt: timestamp('review_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
})
