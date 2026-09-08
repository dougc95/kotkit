/**
 * Task 4.4.1 — `POST /programs/{id}/revisions`: an append-only, immutable
 * settings snapshot with a required reason and an effective day gated
 * against the program's own current day (design.md D33; specs/program-setup
 * "Protocol settings are immutable revisions").
 *
 * `bandCeilings` is always the server-owned `DEFAULT_BAND_CEILINGS` (2.5.1)
 * — never accepted from the request body, which is why `CreateRevisionBody`
 * (contracts/programs.ts, `additionalProperties: false`) has no
 * `bandCeilings` or benchmark-duration field at all: submitting either is
 * already a 400 before this module ever runs.
 *
 * This is also the accept path for a progression suggestion (D33, 8.2.4):
 * the client posts `reason: PROGRESSION_ACCEPTED_REASON` with the suggested
 * `practiceTargetSeconds` and `effectiveDay` equal to the current day — no
 * special-casing is needed here, since that is simply a normal revision.
 */
import { eq } from 'drizzle-orm'
import { currentProgramDay, DEFAULT_BAND_CEILINGS } from '@attention-lab/shared'
import type { CreateRevisionBodyValue, ProgramResponseValue, RevisionResponseValue } from '@attention-lab/shared'

import type { AppDatabase } from '../../plugins/db.js'
import type { RequestContext } from '../../plugins/identity.js'
import { ConflictError, DomainError, MalformedError } from '../../errors.js'
import { programs } from '../../db/schema/programs.js'
import { protocolRevisions, type ProtocolRevisionSettings } from '../../db/schema/protocolRevisions.js'
import { loadOwnedProgram, toProgramDto, toRevisionDto } from './programService.js'

// ---------------------------------------------------------------------------
// nextRevisionNumber
// ---------------------------------------------------------------------------

/**
 * The next `protocol_revisions.revision` number for a program: one past the
 * highest existing revision number, or `1` when `existing` is empty (a
 * program always has at least revision 1 by the time this route can ever run
 * — `existing` is only empty in the unit test, never in practice).
 */
export function nextRevisionNumber(existing: readonly number[]): number {
  if (existing.length === 0) return 1
  return Math.max(...existing) + 1
}

// ---------------------------------------------------------------------------
// normalizeReason
// ---------------------------------------------------------------------------

/**
 * Trims `reason` and rejects a blank (empty or whitespace-only) result with
 * `MalformedError` (400 `malformed_request`, `fieldErrors: { reason: 'is
 * required' }`) — the contract's own `minLength: 1` only rejects a literal
 * empty string, never `'   '`, so this is the check that actually enforces
 * "Revision without reason" for a whitespace-only submission.
 */
export function normalizeReason(reason: string): string {
  const trimmed = reason.trim()
  if (trimmed === '') {
    throw new MalformedError('A reason is required.', { reason: 'is required' })
  }
  return trimmed
}

// ---------------------------------------------------------------------------
// effectiveDayAllowed
// ---------------------------------------------------------------------------

/**
 * `effectiveDay` is accepted only from the program's current day onward
 * (never in the past) and never past Day 14. `currentDay` is clamped at 0
 * first, so a program not yet at Day 0 (a negative day) still accepts an
 * `effectiveDay` of 0 rather than rejecting every value.
 */
export function effectiveDayAllowed(effectiveDay: number, currentDay: number): boolean {
  return effectiveDay >= Math.max(currentDay, 0) && effectiveDay <= 14
}

// ---------------------------------------------------------------------------
// composeSettings
// ---------------------------------------------------------------------------

/** The subset of a `programs` row `composeSettings` needs. */
export interface ComposeSettingsProgram {
  readonly leisureAllowanceMin: number
}

/**
 * Assembles a new revision's `settings` (design.md Database model): the
 * body's own `practiceTargetSeconds`; `bandCeilings` always the server-owned
 * `DEFAULT_BAND_CEILINGS`, never the client's (a client value can never even
 * reach here — the contract's `additionalProperties: false` already 400s
 * it); `leisureAllowanceMin` from the body when given, else the program's
 * own stored `leisure_allowance_min` (a revision without an explicit
 * leisure-allowance change keeps the current one, never resets it).
 */
export function composeSettings(
  bodySettings: CreateRevisionBodyValue['settings'],
  program: ComposeSettingsProgram,
): ProtocolRevisionSettings {
  return {
    practiceTargetSeconds: bodySettings.practiceTargetSeconds,
    bandCeilings: DEFAULT_BAND_CEILINGS,
    leisureAllowanceMin: bodySettings.leisureAllowanceMin ?? program.leisureAllowanceMin,
  }
}

// ---------------------------------------------------------------------------
// createRevision
// ---------------------------------------------------------------------------

export interface CreateRevisionResult {
  readonly revision: RevisionResponseValue
  readonly program: ProgramResponseValue
}

/**
 * `POST /programs/{id}/revisions` (design.md D33; task 4.4.1). One
 * transaction: `loadOwnedProgram` (404 for another principal's program, 422
 * `realm_mismatch` for a foreign-realm row of the caller's own — see its own
 * doc comment); a terminal program (`completed` | `archived`) is 409
 * `program_terminal`; a blank reason is 400 before anything is written; an
 * `effectiveDay` before the program's own current day (derived from
 * `ctx.now` and the program's stored timezone, never the profile's) is 422
 * `effective_day_in_past`; otherwise a new revision is appended —
 * `programs.current_revision_id` is repointed at it (D33: "`current_
 * revision_id` is the newest revision") and `version` incremented — and
 * `focus_sessions` is never touched: every session already stamped its own
 * `revision_id` at start, and `governingRevisionFor` (4.1.1) is what decides
 * which revision governs a given day going forward.
 */
export async function createRevision(
  db: AppDatabase,
  ctx: RequestContext,
  programId: string,
  body: CreateRevisionBodyValue,
): Promise<CreateRevisionResult> {
  return db.transaction(async (tx) => {
    const program = await loadOwnedProgram(tx, ctx, programId, { forUpdate: true })

    if (program.status === 'completed' || program.status === 'archived') {
      throw new ConflictError('program_terminal', 'This program has ended and can no longer be changed.')
    }

    const reason = normalizeReason(body.reason)

    const { day } = currentProgramDay(
      { baselineDate: program.baselineDate, timezone: program.timezone },
      ctx.now,
    )
    if (!effectiveDayAllowed(body.effectiveDay, day)) {
      throw new DomainError('effective_day_in_past', 'The effective day has already passed.')
    }

    const existingRevisions = await tx
      .select({ revision: protocolRevisions.revision })
      .from(protocolRevisions)
      .where(eq(protocolRevisions.programId, programId))

    const revision = nextRevisionNumber(existingRevisions.map((row) => row.revision))
    const settings = composeSettings(body.settings, { leisureAllowanceMin: program.leisureAllowanceMin })

    const [revisionRow] = await tx
      .insert(protocolRevisions)
      .values({ programId, revision, effectiveDay: body.effectiveDay, settings, reason })
      .returning()
    if (!revisionRow) {
      throw new Error(`createRevision: protocol_revisions insert returned no row for program ${programId}`)
    }

    const [updatedProgram] = await tx
      .update(programs)
      .set({ currentRevisionId: revisionRow.id, version: program.version + 1 })
      .where(eq(programs.id, programId))
      .returning()
    if (!updatedProgram) {
      throw new Error(`createRevision: programs update returned no row for ${programId}`)
    }

    return { revision: toRevisionDto(revisionRow), program: toProgramDto(updatedProgram) }
  })
}
