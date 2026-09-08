/**
 * Task 4.3.1 — the readiness validator for a program's benchmark slot set.
 * Pure: no database import, no route registration. `assignedDateFor` maps a
 * slot's phase to its calendar-fixed local date (Day 0 for baseline, Day 7
 * for the optional midpoint, Day 14 for final) and `normalizeSlotSet` turns
 * one `PUT /programs/{id}/benchmark-slots` body into the rows 4.3.2 upserts
 * plus the `missing`/`complete` readiness state the route (and the
 * Readiness screen) reads directly.
 *
 * See design.md's Database model (`benchmark_slots`), API contracts table
 * (`PUT /programs/{id}/benchmark-slots`) and D19 (error-code vocabulary),
 * and specs/program-setup/spec.md "Readiness step assigns materials and
 * benchmark times" (its "Readiness incomplete" and "Baseline times too
 * close" scenarios) and "Program calendar uses stored timezone and local
 * dates" (its "Daylight-saving transition" scenario, exercised here through
 * `assignedDateFor`).
 */
import { localDateForProgramDay, type BenchmarkPhase, type LocalDate, type PutSlotsBodyValue, type SlotLabel } from '@attention-lab/shared'

import { DomainError, MalformedError } from '../../errors.js'

// ---------------------------------------------------------------------------
// assignedDateFor
// ---------------------------------------------------------------------------

/** Program-day offset for each phase's assigned local date — baseline is Day 0, the optional midpoint is Day 7, final is Day 14. */
const ASSIGNED_PROGRAM_DAY: Record<BenchmarkPhase, number> = {
  baseline: 0,
  midpoint: 7,
  final: 14,
}

/**
 * The local calendar date a slot of `phase` is assigned to, given the
 * program's `baselineDate`. This is pure calendar-field arithmetic in the
 * program's own local calendar (`localDateForProgramDay`, 2.1.1) — no
 * timezone argument is needed, and it never observes a DST transition (a
 * baseline of 2026-10-28 assigns Day 14 to 2026-11-11 across the US DST
 * boundary without skipping or duplicating a day).
 */
export function assignedDateFor(phase: BenchmarkPhase, baselineDate: LocalDate): LocalDate {
  return localDateForProgramDay(baselineDate, ASSIGNED_PROGRAM_DAY[phase])
}

// ---------------------------------------------------------------------------
// normalizeSlotSet
// ---------------------------------------------------------------------------

/** One incoming slot from `PUT /programs/{id}/benchmark-slots` (contract 2.7.3). */
export type SlotInput = PutSlotsBodyValue['slots'][number]

/** The program fields `normalizeSlotSet` needs — just the baseline date, since assignment is a pure calendar offset from it. */
export interface NormalizeSlotSetProgram {
  readonly baselineDate: LocalDate
}

/**
 * One slot after normalization: the exact fields 4.3.2 upserts into
 * `benchmark_slots` (`materialRef`/`language`/`deviceFormat`/`materialLevel`/
 * `plannedLocalTime` are the frozen-comparison fields; `assignedLocalDate`
 * is server-computed and never trusted from the wire). `language`,
 * `deviceFormat`, `materialLevel` and `plannedLocalTime` are `null` when the
 * caller omitted them — omitted and explicit-null are not distinguished on
 * this optional metadata (unlike a `ReportedCount`).
 */
export interface NormalizedSlot {
  readonly phase: BenchmarkPhase
  readonly label: SlotLabel
  readonly materialRef: string
  readonly language: string | null
  readonly deviceFormat: string | null
  readonly materialLevel: string | null
  readonly plannedLocalTime: string | null
  readonly assignedLocalDate: LocalDate
}

/** A required (phase, label) combination still missing a material reference and/or (baseline only) a planned time. */
export interface MissingSlot {
  readonly phase: BenchmarkPhase
  readonly label: SlotLabel
  readonly fields: readonly ('materialRef' | 'plannedLocalTime')[]
}

export interface NormalizeSlotSetResult {
  readonly slots: readonly NormalizedSlot[]
  readonly missing: readonly MissingSlot[]
  /** `true` exactly when `missing` is empty — the midpoint slot is optional and never affects this. */
  readonly complete: boolean
}

/** The four (phase, label) combinations readiness requires; the midpoint slot is optional and never appears here. */
const REQUIRED_SLOTS: readonly { readonly phase: 'baseline' | 'final'; readonly label: SlotLabel }[] = [
  { phase: 'baseline', label: 'A' },
  { phase: 'baseline', label: 'B' },
  { phase: 'final', label: 'A' },
  { phase: 'final', label: 'B' },
]

/** `HH:MM` (contract-enforced format, 2.7.3) to minutes since local midnight. */
function minutesOfDay(time: string): number {
  const [hoursStr, minutesStr] = time.split(':') as [string, string]
  return Number(hoursStr) * 60 + Number(minutesStr)
}

/**
 * Same-local-date semantics: a literal difference of wall-clock minutes,
 * never the shorter distance around midnight — 23:30 and 00:15 are 23h15m
 * apart (not 45 minutes), because both times are read as clock times on
 * their own local date, not as points on a 24-hour circle.
 */
function atLeastOneHourApart(timeA: string, timeB: string): boolean {
  return Math.abs(minutesOfDay(timeA) - minutesOfDay(timeB)) >= 60
}

/**
 * A final slot with no `plannedLocalTime` of its own inherits the
 * same-label baseline slot's time (final A <- baseline A, final B <-
 * baseline B) from elsewhere in this same request body; baseline and
 * midpoint slots never inherit. When the same-label baseline slot is also
 * absent, or itself has no time, the final slot's time stays `null` — never
 * synthesized from a different label.
 */
function resolvePlannedLocalTime(
  slot: SlotInput,
  baselineTimeByLabel: ReadonlyMap<SlotLabel, string | null>,
): string | null {
  if (slot.plannedLocalTime !== undefined) return slot.plannedLocalTime
  if (slot.phase !== 'final') return null
  return baselineTimeByLabel.get(slot.label) ?? null
}

/**
 * Validates and normalizes one `PUT /programs/{id}/benchmark-slots` body
 * into the rows 4.3.2 upserts, the `missing` readiness gaps, and whether the
 * set is `complete`. Throws the 3.2.4 error classes rather than returning an
 * error shape, so a route handler's own try/catch (via `plugins/errors.ts`)
 * is the only place these ever turn into an HTTP response:
 *
 *  - a duplicate `(phase, label)` in `slots` is `MalformedError` (400
 *    `malformed_request`, D19) with `fieldErrors: { 'slots[i]': 'duplicate
 *    slot' }`, keyed by the SECOND occurrence's index;
 *  - when both baseline A and B carry a `plannedLocalTime`, they must be at
 *    least one hour apart or this throws `DomainError('baseline_times_too_
 *    close', ...)` (422) whose message states the one-hour minimum.
 *
 * Never touches the database and never sees a slot's `frozen_at` or attempt
 * history — freezing is 4.3.2's concern, checked against the DB rows this
 * function's output is about to replace.
 */
export function normalizeSlotSet(
  slots: readonly SlotInput[],
  program: NormalizeSlotSetProgram,
): NormalizeSlotSetResult {
  const seenAt = new Map<string, number>()
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!
    const key = `${slot.phase}:${slot.label}`
    if (seenAt.has(key)) {
      throw new MalformedError('Duplicate benchmark slot in request body.', {
        [`slots[${i}]`]: 'duplicate slot',
      })
    }
    seenAt.set(key, i)
  }

  const baselineTimeByLabel = new Map<SlotLabel, string | null>()
  for (const slot of slots) {
    if (slot.phase === 'baseline') {
      baselineTimeByLabel.set(slot.label, slot.plannedLocalTime ?? null)
    }
  }

  const baselineA = baselineTimeByLabel.get('A')
  const baselineB = baselineTimeByLabel.get('B')
  if (baselineA !== undefined && baselineA !== null && baselineB !== undefined && baselineB !== null) {
    if (!atLeastOneHourApart(baselineA, baselineB)) {
      throw new DomainError(
        'baseline_times_too_close',
        'Baseline A and B must be planned at least one hour apart.',
      )
    }
  }

  const normalized: NormalizedSlot[] = slots.map((slot) => ({
    phase: slot.phase,
    label: slot.label,
    materialRef: slot.materialRef,
    language: slot.language ?? null,
    deviceFormat: slot.deviceFormat ?? null,
    materialLevel: slot.materialLevel ?? null,
    plannedLocalTime: resolvePlannedLocalTime(slot, baselineTimeByLabel),
    assignedLocalDate: assignedDateFor(slot.phase, program.baselineDate),
  }))

  const missing: MissingSlot[] = []
  for (const required of REQUIRED_SLOTS) {
    const row = normalized.find((s) => s.phase === required.phase && s.label === required.label)
    const fields: ('materialRef' | 'plannedLocalTime')[] = []
    if (row === undefined || row.materialRef.trim() === '') {
      fields.push('materialRef')
    }
    if (required.phase === 'baseline' && (row === undefined || row.plannedLocalTime === null)) {
      fields.push('plannedLocalTime')
    }
    if (fields.length > 0) {
      missing.push({ phase: required.phase, label: required.label, fields })
    }
  }

  return { slots: normalized, missing, complete: missing.length === 0 }
}

// ---------------------------------------------------------------------------
// isFrozen / frozenFieldsUnchanged (task 4.3.2)
// ---------------------------------------------------------------------------

/** The one stored field `isFrozen` itself reads — everything else about "is there an attempt" is the caller's `attemptCount`. */
export interface FrozenSlotRow {
  readonly frozenAt: Date | null
}

/**
 * A slot is frozen once it has an attempt: either `frozen_at` is already set
 * (5.1.2 sets it at the first `focus_sessions` insert referencing the slot),
 * or — the backstop this function itself provides, for callers that read the
 * slot before 5.1.2 exists, or if a `frozen_at` write were ever missed —
 * `attemptCount` (the number of `focus_sessions` rows whose `slot_id`
 * references this row, any lifecycle) is greater than zero. Never the other
 * way around: an old `frozen_at` with zero current attempts is still frozen
 * (an attempt was abandoned or its row otherwise no longer references the
 * slot does not un-freeze it).
 */
export function isFrozen(row: FrozenSlotRow, attemptCount: number): boolean {
  return row.frozenAt !== null || attemptCount > 0
}

/** The five comparability fields a frozen slot must keep unchanged (design.md Database model / D19 `slot_frozen`). */
export interface FrozenComparableFields {
  readonly materialRef: string
  readonly plannedLocalTime: string | null | undefined
  readonly language: string | null | undefined
  readonly deviceFormat: string | null | undefined
  readonly materialLevel: string | null | undefined
}

/**
 * `true` when none of the five frozen-comparison fields differ between
 * `existing` (the stored row) and `incoming` (this request's normalized
 * slot) — `materialRef` is compared exactly (it is never optional either
 * side); the other four treat an absent/`undefined` value the same as an
 * explicit `null`, since this metadata (unlike a `ReportedCount`) makes no
 * distinction between "omitted" and "not set".
 */
export function frozenFieldsUnchanged(
  existing: FrozenComparableFields,
  incoming: FrozenComparableFields,
): boolean {
  return (
    existing.materialRef === incoming.materialRef &&
    (existing.plannedLocalTime ?? null) === (incoming.plannedLocalTime ?? null) &&
    (existing.language ?? null) === (incoming.language ?? null) &&
    (existing.deviceFormat ?? null) === (incoming.deviceFormat ?? null) &&
    (existing.materialLevel ?? null) === (incoming.materialLevel ?? null)
  )
}
