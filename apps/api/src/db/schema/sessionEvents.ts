/**
 * `session_events`: the append-only log a session's counts and tallies are
 * derived from. Undo is a void marker (`voided_at`), never a delete (D9) —
 * voided rows stay for the audit trail and are excluded by count logic
 * upstream, not by this schema. No `realm` column: an event's realm is
 * inherited through its `focus_sessions` parent (D34).
 *
 * `session_events_client_event_unique` is the mechanism the client's outbox
 * relies on: `INSERT ... ON CONFLICT (session_id, client_event_id) DO
 * NOTHING` makes a retried batch idempotent (session-recovery: "Events are
 * buffered, deduplicated and acknowledged").
 */
import { pgTable, pgEnum, uuid, integer, timestamp, jsonb, unique, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { SESSION_EVENT_TYPES } from '@attention-lab/shared'
import type { ClockGapDetailsValue, EventDetailsValue } from '@attention-lab/shared'

import { focusSessions } from './focusSessions.js'

export const eventTypeEnum = pgEnum('event_type', SESSION_EVENT_TYPES)

export const sessionEvents = pgTable(
  'session_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => focusSessions.id),
    clientEventId: uuid('client_event_id').notNull(),
    type: eventTypeEnum('type').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    elapsedMs: integer('elapsed_ms'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    details: jsonb('details')
      .notNull()
      .default(sql`'{}'::jsonb`)
      .$type<EventDetailsValue | ClockGapDetailsValue>(),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
  },
  (t) => [
    unique('session_events_client_event_unique').on(t.sessionId, t.clientEventId),
    index('session_events_session_elapsed_idx').on(t.sessionId, t.elapsedMs),
  ],
)
