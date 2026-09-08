/**
 * `benchmark_slots`: the four planned baseline/final material assignments
 * (plus an allowed but unused midpoint) for a program. A slot freezes once
 * it has an attempt (checked in the service transaction, not here) and is
 * shared with its one permitted replacement (design.md Database model,
 * D23).
 */
import { pgTable, pgEnum, uuid, text, date, time, timestamp, unique } from 'drizzle-orm/pg-core'
import { BENCHMARK_PHASES, SLOT_LABELS } from '@attention-lab/shared'

import { programs } from './programs.js'

export const benchmarkPhaseEnum = pgEnum('benchmark_phase_enum', BENCHMARK_PHASES)
export const slotLabelEnum = pgEnum('slot_label_enum', SLOT_LABELS)

export const benchmarkSlots = pgTable(
  'benchmark_slots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    programId: uuid('program_id')
      .notNull()
      .references(() => programs.id),
    phase: benchmarkPhaseEnum('phase').notNull(),
    label: slotLabelEnum('label').notNull(),
    materialRef: text('material_ref').notNull(),
    language: text('language'),
    deviceFormat: text('device_format'),
    materialLevel: text('material_level'),
    plannedLocalTime: time('planned_local_time'),
    assignedLocalDate: date('assigned_local_date').notNull(),
    frozenAt: timestamp('frozen_at', { withTimezone: true }),
  },
  (t) => [unique('benchmark_slots_program_phase_label_unique').on(t.programId, t.phase, t.label)],
)
