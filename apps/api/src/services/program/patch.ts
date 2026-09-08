/**
 * Task 4.4.2 — `PATCH /programs/{id}`: a version-guarded partial update
 * that can move a program to a terminal status (`completed`/`archived`,
 * D33 — the `baseline_ready -> active` transition happens automatically
 * when the second baseline attempt is finalized, 5.8, and is never a PATCH
 * transition), edit the baseline date only while the program is still a
 * draft (rewriting every benchmark slot's assigned local date in the same
 * transaction), and/or edit the leisure allowance goal on any non-terminal
 * program without creating a new `protocol_revisions` row.
 *
 * See design.md D18 (`stale_version`'s `details.current`), D19
 * (`date_locked`, `invalid_status_transition`, `program_terminal`), D33
 * (the status-transition table and "Leisure allowance edits via PATCH
 * change `programs.leisure_allowance_min` only") and specs/program-setup
 * "One program per user at a time" / "Program calendar uses stored
 * timezone and local dates".
 */
import { eq } from 'drizzle-orm'
import type {
  BenchmarkPhase,
  LocalDate,
  PatchProgramBodyValue,
  ProgramResponseValue,
  ProgramStatus,
} from '@attention-lab/shared'

import type { AppDatabase } from '../../plugins/db.js'
import type { RequestContext } from '../../plugins/identity.js'
import { ConflictError, DomainError } from '../../errors.js'
import { programs } from '../../db/schema/programs.js'
import { benchmarkSlots } from '../../db/schema/benchmarkSlots.js'
import { assignedDateFor } from './readiness.js'
import { loadOwnedProgram, toProgramDto } from './programService.js'

// ---------------------------------------------------------------------------
// canTransition (D33)
// ---------------------------------------------------------------------------

/**
 * The only two explicit `PATCH` status transitions the D33 table allows:
 * `completed` from `baseline_ready` or `active`; `archived` from `draft`,
 * `baseline_ready` or `active`. Every other pair — same-status, any move
 * out of a terminal status, and `baseline_ready -> active` (automatic,
 * never a PATCH transition) — is `false`.
 */
const ALLOWED_TRANSITIONS: Record<'completed' | 'archived', readonly ProgramStatus[]> = {
  completed: ['baseline_ready', 'active'],
  archived: ['draft', 'baseline_ready', 'active'],
}

export function canTransition(from: ProgramStatus, to: ProgramStatus): boolean {
  if (to !== 'completed' && to !== 'archived') return false
  return ALLOWED_TRANSITIONS[to].includes(from)
}

// ---------------------------------------------------------------------------
// dateEditAllowed
// ---------------------------------------------------------------------------

/** `baselineDate` is accepted only while the program is still a draft. */
export function dateEditAllowed(status: ProgramStatus): boolean {
  return status === 'draft'
}

// ---------------------------------------------------------------------------
// recomputeAssignedDates
// ---------------------------------------------------------------------------

/** The subset of a `benchmark_slots` row `recomputeAssignedDates` needs. */
export interface AssignedDateSlot {
  readonly id: string
  readonly phase: BenchmarkPhase
}

export interface RecomputedSlotDate {
  readonly id: string
  readonly assignedLocalDate: LocalDate
}

/**
 * Maps every slot to its assigned local date under a NEW `baselineDate`,
 * via `assignedDateFor` (4.3.1): baseline slots move to the new Day 0, the
 * optional midpoint to the new Day 7, final slots to the new Day 14. Pure
 * — the caller writes the returned pairs back to `benchmark_slots`.
 */
export function recomputeAssignedDates(
  slots: readonly AssignedDateSlot[],
  baselineDate: LocalDate,
): readonly RecomputedSlotDate[] {
  return slots.map((slot) => ({
    id: slot.id,
    assignedLocalDate: assignedDateFor(slot.phase, baselineDate),
  }))
}

// ---------------------------------------------------------------------------
// patchProgram
// ---------------------------------------------------------------------------

export interface PatchProgramResult {
  readonly program: ProgramResponseValue
}

/**
 * `PATCH /programs/{id}` (design.md D18, D19, D33; task 4.4.2). One
 * transaction, every check run — and able to throw — before any write
 * (same discipline as `replaceBenchmarkSlots`, 4.3.2, and `createRevision`,
 * 4.4.1): `loadOwnedProgram` with `forUpdate` (404 for another principal's
 * program or a genuinely missing one, locks the row for this principal's
 * own); a stale `expectedVersion` is 409 `stale_version` carrying the
 * CURRENT stored program in `details.current` (D18); a program already
 * `completed`/`archived` is 409 `program_terminal` before any field is
 * even considered; `baselineDate` on a non-draft program is 422
 * `date_locked`; a `status` the D33 table does not allow from the
 * program's current status is 409 `invalid_status_transition`. Only once
 * every check has passed does this write: every slot's
 * `assigned_local_date` when `baselineDate` changed, `leisure_allowance_min`
 * when `leisureAllowanceMinutes` was given (accepted on any non-terminal
 * program, never gated by draft status, and never touching
 * `protocol_revisions`), `status` when given, and `version + 1`
 * unconditionally on every successful patch.
 */
export async function patchProgram(
  db: AppDatabase,
  ctx: RequestContext,
  programId: string,
  body: PatchProgramBodyValue,
): Promise<PatchProgramResult> {
  return db.transaction(async (tx) => {
    const program = await loadOwnedProgram(tx, ctx, programId, { forUpdate: true })

    if (body.expectedVersion !== program.version) {
      throw new ConflictError(
        'stale_version',
        'The program has changed since it was last loaded.',
        { details: { current: toProgramDto(program) } },
      )
    }

    if (program.status === 'completed' || program.status === 'archived') {
      throw new ConflictError('program_terminal', 'This program has ended and can no longer be changed.')
    }

    if (body.baselineDate !== undefined && !dateEditAllowed(program.status)) {
      throw new DomainError(
        'date_locked',
        'The baseline date can only be changed while the program is a draft.',
      )
    }

    if (body.status !== undefined && !canTransition(program.status, body.status)) {
      throw new ConflictError('invalid_status_transition', 'This status change is not allowed.')
    }

    // Every check above has passed -- perform the writes.
    if (body.baselineDate !== undefined) {
      const slotRows = await tx
        .select({ id: benchmarkSlots.id, phase: benchmarkSlots.phase })
        .from(benchmarkSlots)
        .where(eq(benchmarkSlots.programId, programId))
      const recomputed = recomputeAssignedDates(slotRows, body.baselineDate)
      for (const slot of recomputed) {
        await tx
          .update(benchmarkSlots)
          .set({ assignedLocalDate: slot.assignedLocalDate })
          .where(eq(benchmarkSlots.id, slot.id))
      }
    }

    const updates: Partial<typeof programs.$inferInsert> = { version: program.version + 1 }
    if (body.baselineDate !== undefined) updates.baselineDate = body.baselineDate
    if (body.leisureAllowanceMinutes !== undefined) updates.leisureAllowanceMin = body.leisureAllowanceMinutes
    if (body.status !== undefined) updates.status = body.status

    const [updatedProgram] = await tx
      .update(programs)
      .set(updates)
      .where(eq(programs.id, programId))
      .returning()
    if (!updatedProgram) {
      throw new Error(`patchProgram: programs update returned no row for ${programId}`)
    }

    return { program: toProgramDto(updatedProgram) }
  })
}
