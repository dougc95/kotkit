/**
 * Task 6.2.3 — comparability warnings for the report: wraps 2.4.1's
 * `selectSlotCandidates` and 2.4.3's `comparabilityWarnings` (both
 * `packages/shared/src/domain/comparison.ts`) into the report's own wire
 * shape (`ComparabilityWarningValue`, `packages/shared/src/contracts/
 * report.ts`). This unit owns no comparison logic of its own (D16: one
 * owner, 2.4.3) — every difference check, every "not recorded at baseline/
 * final" wording and the order-insensitive accommodations comparison already
 * live in `comparabilityWarnings`; this file only picks the same slot
 * candidates the comparison itself uses and maps the domain result onto the
 * wire shape.
 *
 * `selectSlotCandidates` (2.4.1) picks the single eligible attempt per slot:
 * an amendment-excluded attempt is already `eligible: false` after 6.2.1's
 * `applyAmendmentExclusion` overlay, so it is never a candidate and is never
 * compared — its eligible replacement (if any) stands in for the slot
 * instead. `comparabilityWarnings` (2.4.3) then compares baseline:A with
 * final:A and baseline:B with final:B only when both candidates exist; a
 * label with no eligible attempt on either side emits no warning (no
 * fallback attempt is ever invented). Neither function reads or writes
 * `eligible`/`exclusionReasons`, and this wrapper never suppresses
 * `comparison` — its return value is purely additive to the report.
 *
 * See design.md's API contracts table (`GET /programs/{id}/report`) and
 * D7.5; specs/progress-report/spec.md ("Comparability warnings") and specs/
 * benchmark-assessment/spec.md ("Observed conditions live on the attempt").
 */
import {
  comparabilityWarnings,
  selectSlotCandidates,
  type Accommodation,
  type AttemptValue,
  type ComparabilityWarningValue,
} from '@attention-lab/shared'

/**
 * The domain's `ComparabilityWarning.baseline`/`.final` are typed with a
 * `readonly Accommodation[]` branch (an attempt's own conditions are never
 * mutated); the wire schema's arrays are plain (mutable) `Accommodation[]`.
 * Copies the array when present so the wire value never aliases the input
 * attempt's own `conditions.accommodations`.
 */
function toWireValue(
  value: string | null | readonly Accommodation[],
): string | null | Accommodation[] {
  if (typeof value === 'string' || value === null) return value
  return [...value]
}

/**
 * The report's `warnings[]`: every comparability difference between the
 * eligible baseline and final candidates of label A and of label B, mapped
 * from `domain/comparison.ts`'s `ComparabilityWarning` to the wire shape.
 */
export function reportWarnings(
  attempts: readonly AttemptValue[],
): ComparabilityWarningValue[] {
  const candidates = selectSlotCandidates(attempts)
  return comparabilityWarnings(candidates).map((warning) => ({
    label: warning.label,
    field: warning.field,
    baseline: toWireValue(warning.baseline),
    final: toWireValue(warning.final),
    message: warning.message,
  }))
}
