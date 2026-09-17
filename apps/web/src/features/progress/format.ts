/**
 * Pure display-string helpers for the Progress report (task 8.8.1).
 *
 * Every function here is a presentation-only mapping from a domain value to
 * the exact copy the PRD/CLAUDE.md invariants require — no function computes
 * or infers a value the server did not already send (D4: no derived scores
 * computed client-side). In particular:
 *
 *  - a `null` `ReportedCount` (S/E/M/recall) always renders 'Not reported',
 *    NEVER '0' (an explicit `0` is a real measurement and renders as '0');
 *  - `FirstSwitch`'s three states stay textually distinct: 'Unknown' is
 *    never rendered as '20+, capped', and vice versa;
 *  - the realm and time-source words a user sees are always the mapped
 *    copy below, never the raw wire value ('demo'/'pilot', 'demo_clock').
 */
import type {
  BenchmarkPhase,
  CountMethod,
  ExclusionReason,
  FirstSwitch,
  ObservedConditions,
  Realm,
  ReportedCount,
  SessionLifecycle,
  TimeSource,
} from '@attention-lab/shared'
import { EXCLUSION_REASON_COPY } from '@attention-lab/shared'

/** Copy shown in every "not applicable because this attempt is not finalized yet" cell. */
export const NOT_FINALIZED = 'Not finalized'

const NOT_REPORTED = 'Not reported'

/** `370` -> `'6:10'`. Never used for the "20+, capped"/"Unknown" first-switch states. */
export function formatMmSs(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** S with its capture method — '6 (events)' / '4 (retrospective)' / 'Not reported'. Never '0' for null. */
export function formatEpisodeCount(count: ReportedCount, method: CountMethod | null): string {
  if (count === null) {
    return NOT_REPORTED
  }
  const methodLabel = method === 'event' ? 'events' : 'retrospective'
  return `${count} (${methodLabel})`
}

/** E / M / recall score — the plain 'not zero unless explicit' rule, no method suffix. */
export function formatReportedCount(count: ReportedCount): string {
  return count === null ? NOT_REPORTED : String(count)
}

/**
 * T from the three-state `FirstSwitch` union. `null` (S itself was never
 * reported) reads 'Not reported', same as the S cell it accompanies —
 * never coerced into 'Unknown' or '20+, capped'.
 */
export function formatFirstSwitch(firstSwitch: FirstSwitch | null): string {
  if (firstSwitch === null) {
    return NOT_REPORTED
  }
  switch (firstSwitch.kind) {
    case 'none_capped':
      return '20+, capped'
    case 'known':
      return formatMmSs(firstSwitch.seconds)
    case 'unknown':
      return 'Unknown'
  }
}

/** The disruption self-attestation — 'Yes' / 'No' / 'Not reported'. */
export function formatDisruption(materiallyDisrupted: boolean | null): string {
  if (materiallyDisrupted === null) {
    return NOT_REPORTED
  }
  return materiallyDisrupted ? 'Yes' : 'No'
}

/**
 * The comparison's absolute-change wording — pluralised, and phrased as a
 * measurement outcome rather than a judgement. Moved here from
 * `ComparisonFigures.tsx`'s own inline `switchWord`/if-chain (the rework spec §9,
 * defect 5: "ComparisonFigures builds its change ... text inline").
 */
export function formatSwitchChange(absoluteChange: number): string {
  if (absoluteChange > 0) {
    const word = absoluteChange === 1 ? 'switch' : 'switches'
    return `${absoluteChange} fewer ${word}`
  }
  if (absoluteChange < 0) {
    const more = Math.abs(absoluteChange)
    const word = more === 1 ? 'switch' : 'switches'
    return `${more} more ${word}`
  }
  return 'No change in switches'
}

/**
 * `null` (guaranteed exactly when `s0 === 0`) -> 'Percentage: not
 * applicable' — one of the taxonomy's own named absent-tier strings
 * (the rework spec §5) — never 'Infinity', 'NaN' or '100%'. Otherwise the signed
 * reduction/increase wording; the sign only ever changes the WORD, never the
 * server-computed number under `Math.abs`. Moved here from
 * `ComparisonFigures.tsx` (the rework spec §9, defect 5).
 */
export function formatPercentageChange(percentageReduction: number | null): string {
  if (percentageReduction === null) {
    return 'Percentage: not applicable'
  }
  if (percentageReduction >= 0) {
    return `${percentageReduction}% reduction`
  }
  return `${Math.abs(percentageReduction)}% increase`
}

/** `4` -> '4', `4.5` -> '4.5' — never a trailing '.0' for a whole-number mean. Moved here from `ComparisonFigures.tsx`'s file-local `formatMean` (the rework spec §9, defect 5). */
export function formatRecallMean(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

const TIME_SOURCE_LABEL: Record<TimeSource, string> = {
  measured: 'Measured',
  demo_clock: 'Demo clock',
  attested: 'Attested',
}

export function formatTimeSource(timeSource: TimeSource): string {
  return TIME_SOURCE_LABEL[timeSource]
}

const LIFECYCLE_LABEL: Record<SessionLifecycle, string> = {
  running: 'Running',
  paused: 'Paused',
  awaiting_review: 'Awaiting review',
  finalized: 'Finalized',
  abandoned: 'Abandoned',
}

export function formatLifecycle(lifecycle: SessionLifecycle): string {
  return LIFECYCLE_LABEL[lifecycle]
}

const PHASE_LABEL: Record<BenchmarkPhase, string> = {
  baseline: 'Baseline',
  midpoint: 'Midpoint',
  final: 'Final',
}

export function formatPhase(phase: BenchmarkPhase): string {
  return PHASE_LABEL[phase]
}

/** Never the raw 'demo'/'pilot' wire value (identity-realm: realm is never a user-facing label). */
const REALM_LABEL: Record<Realm, string> = {
  demo: 'Demonstration data',
  pilot: 'Personal data',
}

export function formatRealm(realm: Realm): string {
  return REALM_LABEL[realm]
}

/**
 * A short human summary of one attempt's observed conditions, joined with
 * ', ' — never a middle dot (the rework spec §4: "meta strings joined with
 * middle dots" is a prohibited typographic treatment). Unlike
 * `FeedTotals.tsx`'s equivalent string, this one is not asserted by any
 * test, so there is no fixture to keep in sync.
 */
export function formatConditions(conditions: ObservedConditions): string {
  const parts = [conditions.deviceFormat, conditions.language, conditions.materialLevel].filter(
    (part): part is string => part !== null,
  )
  if (conditions.accommodations.length > 0) {
    parts.push(conditions.accommodations.join(', '))
  }
  return parts.length > 0 ? parts.join(', ') : NOT_REPORTED
}

/** Every exclusion reason's PRD copy, joined — '—' when the attempt carries none. */
export function formatExclusionReasons(reasons: readonly ExclusionReason[]): string {
  if (reasons.length === 0) {
    return '—'
  }
  return reasons.map((reason) => EXCLUSION_REASON_COPY[reason]).join(' ')
}
