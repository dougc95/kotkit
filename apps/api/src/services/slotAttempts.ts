/**
 * Task 5.1.2 — the pure slot-attempt rules for `POST /sessions` benchmark
 * starts: whether a start is allowed on `todayLocalDate` given a slot's
 * `slotAssignedLocalDate` and its existing attempts. D23: a benchmark may
 * start on or after its assigned date, never before; a first attempt needs
 * no reason however late. One replacement per slot is allowed, and needs a
 * reason, unless the first attempt is already `eligible: true` and carries
 * no excluding amendment (D32 — the overlay is read here from the
 * caller-supplied `excludedByAmendment`, never a rewrite of the stored row).
 * A third attempt is always refused, even with a reason.
 *
 * `checkSlotStart`'s four failure `reason` strings ARE the D19 422 wire
 * codes verbatim — `services/session.ts`'s benchmark branch wraps a
 * `{ ok: false }` result directly as `new DomainError(reason, message)`,
 * with no separate translation table.
 *
 * `defaultConditionsFromSlot` is the D31 default: a benchmark session's
 * review row is seeded with the slot's own device/language/material fields
 * (never a caller-invented value) and an empty `accommodations` list, unless
 * the request body supplies a whole `conditions` object to replace it.
 *
 * Both functions are pure — no database import — so `slotAttempts.test.ts`
 * exercises them directly; `services/session.ts` is the only caller.
 */
import type { ObservedConditionsValue, SessionLifecycle } from '@attention-lab/shared'

// ---------------------------------------------------------------------------
// checkSlotStart
// ---------------------------------------------------------------------------

/** The subset of one existing `focus_sessions` attempt `checkSlotStart` needs — matches D22's `SlotAttemptValue` minus `sessionId`. */
export interface SlotStartAttempt {
  readonly eligible: boolean | null
  readonly lifecycle: SessionLifecycle
  readonly excludedByAmendment: boolean
}

export interface CheckSlotStartInput {
  readonly todayLocalDate: string
  readonly slotAssignedLocalDate: string
  readonly attempts: readonly SlotStartAttempt[]
  readonly replacementReason: string | undefined
}

/** The four D19 422 wire codes this check can fail with — verbatim, never translated. */
export type SlotStartFailureReason =
  | 'before_slot_date'
  | 'slot_full'
  | 'replacement_reason_required'
  | 'eligible_attempt_not_retaken'

export type CheckSlotStartResult =
  | { readonly ok: true; readonly isReplacement: boolean }
  | { readonly ok: false; readonly reason: SlotStartFailureReason }

/**
 * `todayLocalDate`/`slotAssignedLocalDate` are `YYYY-MM-DD` strings
 * (`domain/calendar.ts`'s `LocalDate`), which compare correctly with plain
 * `<` — fixed-width and zero-padded, so lexicographic order matches calendar
 * order.
 *
 * Order (fixed, matches design.md's task-decomposition text and the
 * `active_session_exists`-before-any-slot-rule integration case, which is
 * enforced by the CALLER running this only after that check):
 *  1. today before the assigned date -> `before_slot_date`, regardless of
 *     how many attempts already exist.
 *  2. two or more existing attempts -> `slot_full`, even with a reason.
 *  3. no existing attempts -> `ok`, not a replacement; a `replacementReason`
 *     supplied anyway is accepted, not an error (the caller decides whether
 *     to store it — 5.1.2's does not, for a first attempt).
 *  4. exactly one existing attempt (this would be the slot's one permitted
 *     replacement): a blank `replacementReason` -> `replacement_reason_required`;
 *     otherwise, when that one attempt is already `eligible: true` and not
 *     excluded by an amendment -> `eligible_attempt_not_retaken`; otherwise
 *     `ok`, a replacement.
 */
export function checkSlotStart(input: CheckSlotStartInput): CheckSlotStartResult {
  const { todayLocalDate, slotAssignedLocalDate, attempts, replacementReason } = input

  if (todayLocalDate < slotAssignedLocalDate) {
    return { ok: false, reason: 'before_slot_date' }
  }

  if (attempts.length >= 2) {
    return { ok: false, reason: 'slot_full' }
  }

  if (attempts.length === 0) {
    return { ok: true, isReplacement: false }
  }

  const reasonIsBlank = replacementReason === undefined || replacementReason.trim() === ''
  if (reasonIsBlank) {
    return { ok: false, reason: 'replacement_reason_required' }
  }

  const [firstAttempt] = attempts
  if (firstAttempt !== undefined && firstAttempt.eligible === true && !firstAttempt.excludedByAmendment) {
    return { ok: false, reason: 'eligible_attempt_not_retaken' }
  }

  return { ok: true, isReplacement: true }
}

// ---------------------------------------------------------------------------
// defaultConditionsFromSlot
// ---------------------------------------------------------------------------

/** The subset of a `benchmark_slots` row `defaultConditionsFromSlot` reads. */
export interface SlotConditionsSource {
  readonly deviceFormat: string | null
  readonly language: string | null
  readonly materialLevel: string | null
}

/**
 * D31: a benchmark session's default `ObservedConditions`, copied from its
 * slot's own fields, with an empty `accommodations` list (a slot never
 * records planned accommodations — only an attempt does). The caller
 * (`services/session.ts`) uses this only when the request body carries no
 * `conditions` object at all; a supplied `conditions` object replaces the
 * default as a whole, never merges with it.
 */
export function defaultConditionsFromSlot(slot: SlotConditionsSource): ObservedConditionsValue {
  return {
    deviceFormat: slot.deviceFormat,
    language: slot.language,
    materialLevel: slot.materialLevel,
    accommodations: [],
  }
}
