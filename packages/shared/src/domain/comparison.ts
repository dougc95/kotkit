/**
 * The baseline/final comparison: which attempt stands for each benchmark
 * slot, the S0/S14 arithmetic, the result-state precedence that chooses one
 * headline for the report, and the comparability warnings that flag a
 * changed condition without ever touching eligibility.
 *
 * Three rules live here, all pure and all corruption-averse:
 *
 *  - `selectSlotCandidates` / `sampleCounts` / `computeComparison` (2.4.1):
 *    a slot's candidate is its one eligible attempt — the system never picks
 *    the "better" of two eligible attempts, it throws, because that
 *    ambiguity should never exist (see `benchmark-assessment`'s "One
 *    replacement per slot with a reason"). `computeComparison` throws rather
 *    than coalescing when an eligible attempt is missing a field it must
 *    always carry — that is corrupt input, not an unreported value.
 *  - `resolveResultState` / `RESULT_STATE_COPY` (2.4.2): one result state,
 *    chosen by evaluating D7.4's fixed precedence in order and taking the
 *    first that applies (mirrored exactly by `RESULT_STATES`'s declaration
 *    order in types.ts). Copy is verbatim from the PRD §5 table; no state
 *    ever names a percentage, a significance test, a confidence interval or
 *    an "attention score" (see `progress-report`'s "No invented scores").
 *  - `comparabilityWarnings` (2.4.3, D7.5): baseline and final attempts of
 *    the same label are compared on their *observed* conditions only; a
 *    difference is always a warning, never an exclusion, and the function
 *    never reads or writes `eligible`/`exclusionReasons`.
 *
 * See docs/Attention-Lab-Prototype-PRD.md §5, specs/progress-report/spec.md
 * and specs/benchmark-assessment/spec.md ("Observed conditions live on the
 * attempt").
 */

import { assertSameRealm, isReported } from './types.js'
import type {
  Accommodation,
  AttemptSummary,
  CountMethod,
  FirstSwitch,
  ObservedConditions,
  ResultState,
  SlotLabel,
} from './types.js'
import { SLOT_LABELS } from './types.js'

// ---------------------------------------------------------------------------
// 2.4.1 — Slot candidates, sample counts and comparison math
// ---------------------------------------------------------------------------

/** The four benchmark slots a comparison ever draws from. Midpoint is never one of these. */
export type SlotKey = 'baseline:A' | 'baseline:B' | 'final:A' | 'final:B'

/**
 * Picks, for each of the four benchmark slots, the single eligible attempt
 * that stands for it — or `null` when the slot has none. `midpoint` attempts
 * are always ignored (there is no midpoint slot key). An ineligible attempt
 * is simply not a candidate; it is never an error for a slot to hold an
 * ineligible attempt alongside its eligible replacement (see "Replacement
 * after disruption"). Two *eligible* attempts in the same slot is corrupt
 * data — `benchmark-assessment`'s "One replacement per slot with a reason"
 * says the system MUST NOT select the better of two, so this throws instead
 * of guessing.
 */
export function selectSlotCandidates(
  attempts: readonly AttemptSummary[],
): Record<SlotKey, AttemptSummary | null> {
  const candidates: Record<SlotKey, AttemptSummary | null> = {
    'baseline:A': null,
    'baseline:B': null,
    'final:A': null,
    'final:B': null,
  }
  for (const attempt of attempts) {
    if (attempt.phase === 'midpoint') continue
    if (!attempt.eligible) continue
    const key: SlotKey = `${attempt.phase}:${attempt.label}`
    if (candidates[key] !== null) {
      throw new Error(
        `selectSlotCandidates: slot ${key} has more than one eligible attempt ` +
          `(${candidates[key]!.attemptId} and ${attempt.attemptId}) — the system never ` +
          'selects the better of two eligible attempts; this indicates corrupt input.',
      )
    }
    candidates[key] = attempt
  }
  return candidates
}

/** How many of the two baseline, and the two final, slots currently have an eligible candidate. */
export function sampleCounts(candidates: Record<SlotKey, AttemptSummary | null>): {
  baselineEligible: 0 | 1 | 2
  finalEligible: 0 | 1 | 2
} {
  const baselineEligible = (candidates['baseline:A'] !== null ? 1 : 0) +
    (candidates['baseline:B'] !== null ? 1 : 0)
  const finalEligible = (candidates['final:A'] !== null ? 1 : 0) +
    (candidates['final:B'] !== null ? 1 : 0)
  return {
    baselineEligible: baselineEligible as 0 | 1 | 2,
    finalEligible: finalEligible as 0 | 1 | 2,
  }
}

/** The full baseline/final comparison, once all four candidates exist. */
export interface ComparisonResult {
  readonly s0: number
  readonly s14: number
  readonly absoluteChange: number
  /** `null` only when `s0` is 0 — a percentage of zero has no meaning, never `100` or `NaN`. */
  readonly percentageReduction: number | null
  /** `s0 < 3`: the report leads with absolute counts and a low-baseline note. */
  readonly lowBaseline: boolean
  readonly recallBaselineMean: number
  readonly recallFinalMean: number
  readonly firstSwitches: Record<SlotKey, FirstSwitch>
  /** A mean is meaningful only when all four attempts' T is `known`; otherwise `null`, never a partial average. */
  readonly firstSwitchMeanSeconds: number | null
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** An eligible attempt narrowed to the fields a comparison must read as numbers, not `null`. */
type ComparableAttempt = AttemptSummary & {
  readonly episodeCount: number
  readonly recallScore: number
  readonly firstSwitch: FirstSwitch
  readonly countMethod: CountMethod
}

/**
 * An eligible attempt always carries `episodeCount`, `recallScore`,
 * `firstSwitch` and `countMethod` — `evaluateEligibility` (2.3.1) requires S,
 * recall and scoring to be complete before an attempt can be eligible at
 * all. A `null` here despite `eligible: true` is corrupt input, never an
 * unreported value to coalesce, so this throws rather than defaulting.
 */
function assertComparable(attempt: AttemptSummary): asserts attempt is ComparableAttempt {
  if (
    !isReported(attempt.episodeCount) ||
    !isReported(attempt.recallScore) ||
    attempt.firstSwitch === null ||
    attempt.countMethod === null
  ) {
    throw new Error(
      `computeComparison: eligible attempt ${attempt.attemptId} (${attempt.phase}:${attempt.label}) ` +
        'is missing episodeCount, recallScore, firstSwitch or countMethod. An eligible attempt must ' +
        'always report these — this is corrupt input, not an unreported value.',
    )
  }
}

/**
 * The baseline/final comparison over a realm-consistent set of attempts, or
 * `null` when any of the four slots lacks an eligible candidate
 * (`progress-report`'s "No complete comparison until two plus two").
 * Verifies every input shares one realm before anything else
 * (`identity-realm`'s "Realms are never mixed in a result") — a mixed-realm
 * input throws `RealmMixingError` and returns no partial result.
 */
export function computeComparison(attempts: readonly AttemptSummary[]): ComparisonResult | null {
  assertSameRealm(attempts)

  const candidates = selectSlotCandidates(attempts)
  const baselineA = candidates['baseline:A']
  const baselineB = candidates['baseline:B']
  const finalA = candidates['final:A']
  const finalB = candidates['final:B']
  if (baselineA === null || baselineB === null || finalA === null || finalB === null) {
    return null
  }

  assertComparable(baselineA)
  assertComparable(baselineB)
  assertComparable(finalA)
  assertComparable(finalB)

  const s0 = (baselineA.episodeCount + baselineB.episodeCount) / 2
  const s14 = (finalA.episodeCount + finalB.episodeCount) / 2
  const recallBaselineMean = (baselineA.recallScore + baselineB.recallScore) / 2
  const recallFinalMean = (finalA.recallScore + finalB.recallScore) / 2

  const firstSwitches: Record<SlotKey, FirstSwitch> = {
    'baseline:A': baselineA.firstSwitch,
    'baseline:B': baselineB.firstSwitch,
    'final:A': finalA.firstSwitch,
    'final:B': finalB.firstSwitch,
  }

  const knownSeconds: number[] = []
  let allKnown = true
  for (const fs of [baselineA.firstSwitch, baselineB.firstSwitch, finalA.firstSwitch, finalB.firstSwitch]) {
    if (fs.kind === 'known') {
      knownSeconds.push(fs.seconds)
    } else {
      allKnown = false
    }
  }
  const firstSwitchMeanSeconds = allKnown
    ? knownSeconds.reduce((sum, seconds) => sum + seconds, 0) / knownSeconds.length
    : null

  return {
    s0,
    s14,
    absoluteChange: s0 - s14,
    percentageReduction: s0 > 0 ? round1((100 * (s0 - s14)) / s0) : null,
    lowBaseline: s0 < 3,
    recallBaselineMean,
    recallFinalMean,
    firstSwitches,
    firstSwitchMeanSeconds,
  }
}

// ---------------------------------------------------------------------------
// 2.4.2 — Result-state precedence and PRD copy
// ---------------------------------------------------------------------------

/**
 * Verbatim PRD §5 copy for every `ResultState`. `headline` is shown above the
 * PRD message only for `improvement_maintained_recall` (D38); every other
 * state has no headline. No entry ever names a percentage, an "attention"
 * score, a significance test or a confidence interval — see
 * `progress-report`'s "No invented scores".
 */
export const RESULT_STATE_COPY: Record<
  ResultState,
  { readonly headline: string | null; readonly message: string; readonly action: string }
> = {
  baseline_pending: {
    headline: null,
    message: 'Complete two baseline sessions to establish your starting point.',
    action: 'Go to next slot',
  },
  final_pending: {
    headline: null,
    message: 'Your final comparison is available after the Day 14 assessments.',
    action: 'View baseline / continue practice',
  },
  insufficient_samples: {
    headline: null,
    message: 'There is not enough comparable data for the full comparison.',
    action: 'View attempts and missing slots',
  },
  zero_baseline: {
    headline: null,
    message: 'No switches were reported at baseline; a percentage reduction does not apply.',
    action: 'Compare recall and absolute counts',
  },
  more_switches: {
    headline: null,
    message: 'More switches were reported in the final sessions.',
    action: 'Inspect context',
  },
  unchanged: {
    headline: null,
    message: 'The reported switch count did not change.',
    action: 'Inspect context',
  },
  fewer_switches_lower_recall: {
    headline: null,
    message: 'Switches decreased, but recall was lower. These results are mixed.',
    action: 'Review material and conditions',
  },
  improvement_maintained_recall: {
    headline: 'Fewer reported switches',
    message: 'You reported fewer switches; recall was maintained.',
    action: 'Inspect conditions / export',
  },
}

/** Shown alongside any state that reports a change: an observed change never establishes cause. */
export const CAUSE_NOTE = 'Observed change does not establish cause.'

export interface ResolveResultStateInput {
  readonly baselineEligible: 0 | 1 | 2
  readonly finalEligible: 0 | 1 | 2
  /** Whether any final-slot attempt exists at all, eligible or not. */
  readonly finalAttemptsExist: boolean
  /** `currentDay > 14`. */
  readonly day14Finished: boolean
  readonly comparison: ComparisonResult | null
}

/**
 * The one result state the report shows, chosen by evaluating D7.4's eight
 * rules in exactly this fixed order and returning the first that applies.
 * This order is identical to `RESULT_STATES`'s declaration order in
 * types.ts (checked by a unit test, not re-declared here) — see
 * `progress-report`'s "Result state with precedence".
 */
export function resolveResultState(input: ResolveResultStateInput): ResultState {
  const { baselineEligible, finalAttemptsExist, day14Finished, comparison } = input

  if (baselineEligible < 2 && !day14Finished) return 'baseline_pending'
  if (baselineEligible === 2 && !finalAttemptsExist && !day14Finished) return 'final_pending'
  if (comparison === null) return 'insufficient_samples'
  if (comparison.s0 === 0) return 'zero_baseline'
  if (comparison.s14 > comparison.s0) return 'more_switches'
  if (comparison.s14 === comparison.s0) return 'unchanged'
  if (comparison.recallFinalMean < comparison.recallBaselineMean) return 'fewer_switches_lower_recall'
  return 'improvement_maintained_recall'
}

// ---------------------------------------------------------------------------
// 2.4.3 — Comparability warnings between same-label attempts
// ---------------------------------------------------------------------------

/** One difference in observed conditions between a baseline and a final attempt of the same label. */
export interface ComparabilityWarning {
  readonly label: SlotLabel
  readonly field: 'deviceFormat' | 'language' | 'materialLevel' | 'accommodations'
  readonly baseline: string | null | readonly Accommodation[]
  readonly final: string | null | readonly Accommodation[]
  readonly message: string
}

const FIELD_LABELS: Record<'deviceFormat' | 'language' | 'materialLevel' | 'accommodations', string> = {
  deviceFormat: 'Device format',
  language: 'Language',
  materialLevel: 'Material level',
  accommodations: 'Accommodations',
}

function describeStringValue(value: string | null, whenNull: string): string {
  return value === null ? whenNull : value
}

function stringFieldWarning(
  label: SlotLabel,
  field: 'deviceFormat' | 'language' | 'materialLevel',
  baseline: string | null,
  final: string | null,
): ComparabilityWarning | null {
  if (baseline === final) return null
  const baselineDesc = describeStringValue(baseline, 'not recorded at baseline')
  const finalDesc = describeStringValue(final, 'not recorded at final')
  return {
    label,
    field,
    baseline,
    final,
    message:
      `${FIELD_LABELS[field]} differs between baseline ${label} (${baselineDesc}) ` +
      `and final ${label} (${finalDesc}).`,
  }
}

function accommodationSetsEqual(
  a: readonly Accommodation[],
  b: readonly Accommodation[],
): boolean {
  const setA = new Set(a)
  const setB = new Set(b)
  if (setA.size !== setB.size) return false
  for (const item of setA) {
    if (!setB.has(item)) return false
  }
  return true
}

function describeAccommodations(values: readonly Accommodation[]): string {
  return values.length === 0 ? 'none' : [...values].sort().join(', ')
}

function accommodationsWarning(
  label: SlotLabel,
  baseline: readonly Accommodation[],
  final: readonly Accommodation[],
): ComparabilityWarning | null {
  if (accommodationSetsEqual(baseline, final)) return null
  return {
    label,
    field: 'accommodations',
    baseline,
    final,
    message:
      `Accommodations differ between baseline ${label} (${describeAccommodations(baseline)}) ` +
      `and final ${label} (${describeAccommodations(final)}).`,
  }
}

/**
 * Compares baseline:A with final:A, and baseline:B with final:B, on their
 * *observed* conditions only — never on `eligible` or `exclusionReasons`,
 * which this function does not read. A warning fires whenever the two
 * differ, order-insensitively for `accommodations`; `null` vs. a value is
 * always a difference, worded as "not recorded at baseline/final" rather
 * than implying equivalence. Comparison for a label is skipped entirely
 * when either its baseline or its final candidate is missing.
 */
export function comparabilityWarnings(
  candidates: Record<SlotKey, AttemptSummary | null>,
): ComparabilityWarning[] {
  const warnings: ComparabilityWarning[] = []
  for (const label of SLOT_LABELS) {
    const baseline = candidates[`baseline:${label}`]
    const final = candidates[`final:${label}`]
    if (baseline === null || final === null) continue

    const baselineConditions: ObservedConditions = baseline.conditions
    const finalConditions: ObservedConditions = final.conditions

    const deviceFormat = stringFieldWarning(
      label,
      'deviceFormat',
      baselineConditions.deviceFormat,
      finalConditions.deviceFormat,
    )
    if (deviceFormat) warnings.push(deviceFormat)

    const language = stringFieldWarning(
      label,
      'language',
      baselineConditions.language,
      finalConditions.language,
    )
    if (language) warnings.push(language)

    const materialLevel = stringFieldWarning(
      label,
      'materialLevel',
      baselineConditions.materialLevel,
      finalConditions.materialLevel,
    )
    if (materialLevel) warnings.push(materialLevel)

    const accommodations = accommodationsWarning(
      label,
      baselineConditions.accommodations,
      finalConditions.accommodations,
    )
    if (accommodations) warnings.push(accommodations)
  }
  return warnings
}
