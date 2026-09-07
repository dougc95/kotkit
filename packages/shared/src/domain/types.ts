/**
 * Core measurement types.
 *
 * The single most important rule in this file — and in the product — is that
 * an unreported value is NOT zero. Every count that a user may leave blank is
 * modelled as `ReportedCount` (`number | null`), and `null` is never coalesced
 * to 0 anywhere in the domain. See docs/Attention-Lab-Prototype-PRD.md §5
 * ("A user explicitly enters zero; a blank is unknown") and HANDOFF.md
 * ("Unknown does not equal zero").
 */

/** A self-reported count. `null` means "not reported"; it never means zero. */
export type ReportedCount = number | null

/** Was a value measured by the app, advanced by a demo clock, or attested afterwards? */
export type TimeSource = 'measured' | 'demo_clock' | 'attested'

/**
 * Simulation is a property of the record, not of the chrome. Demo rows can
 * never be joined into a pilot report; see `assertSameRealm`.
 */
export type Realm = 'demo' | 'pilot'

/** How a switch count reached the review. The two are alternatives, never summed. */
export type CountMethod = 'event' | 'retrospective'

export type BenchmarkPhase = 'baseline' | 'midpoint' | 'final'
export type SlotLabel = 'A' | 'B'
export type OutputQuality = 'yes' | 'partly' | 'no'
export type TimerQuality = 'ok' | 'uncertain'

/**
 * Time to first voluntary switch.
 *
 * These three cases are genuinely distinct and the distinction must survive
 * into the report and the export:
 *   - `none_capped`: no switch occurred, so T is reported as the cap "20+".
 *   - `known`: a switch occurred at a recorded elapsed time.
 *   - `unknown`: a switch occurred but its time was never recorded. The PRD is
 *     explicit that this must render as "Unknown", NOT as "20+".
 */
export type FirstSwitch =
  | { readonly kind: 'none_capped' }
  | { readonly kind: 'known'; readonly seconds: number }
  | { readonly kind: 'unknown' }

export const FIRST_SWITCH_CAP_SECONDS = 20 * 60

/** Accommodations that change benchmark conditions and must match across a comparison. */
export const ACCOMMODATIONS = [
  'screen_reader',
  'magnification',
  'increased_font_size',
  'high_contrast',
  'reduced_motion',
  'extra_lighting',
  'other',
] as const
export type Accommodation = (typeof ACCOMMODATIONS)[number]

/**
 * Conditions as they actually were for one attempt.
 *
 * These live on the ATTEMPT, not only on the planned slot. A slot is frozen
 * once it has an attempt and is shared with its permitted replacement, so slot
 * values alone cannot describe what really happened on Day 14.
 */
export interface ObservedConditions {
  readonly deviceFormat: string | null
  readonly language: string | null
  readonly materialLevel: string | null
  readonly accommodations: readonly Accommodation[]
}

export type ExclusionReason =
  | 'interval_incomplete'
  | 'recall_missing'
  | 'scoring_incomplete'
  | 'count_unknown'
  | 'materially_disrupted'
  | 'timer_uncertain'
  | 'timing_deviation'
  | 'excluded_by_amendment'
  | 'simulated_time'

export const EXCLUSION_REASON_COPY: Record<ExclusionReason, string> = {
  interval_incomplete: 'The full 20-minute interval was not completed.',
  recall_missing: 'The recall step was not saved.',
  scoring_incomplete: 'Self-scoring was not finished.',
  count_unknown: 'The off-task count was not reported.',
  materially_disrupted: 'You reported that this session was materially disrupted.',
  timer_uncertain: 'Timing could not be confirmed for this session.',
  timing_deviation: 'This session ran outside its assigned date.',
  excluded_by_amendment: 'You excluded this attempt, with a recorded reason.',
  simulated_time: 'This session used simulated time and cannot enter a real comparison.',
}

/** One benchmark attempt, reduced to what the comparison needs. */
export interface AttemptSummary {
  readonly attemptId: string
  readonly phase: BenchmarkPhase
  readonly label: SlotLabel
  readonly realm: Realm
  readonly timeSource: TimeSource
  readonly eligible: boolean
  readonly exclusionReasons: readonly ExclusionReason[]
  /** The primary metric S. `null` when the user did not report it. */
  readonly episodeCount: ReportedCount
  /** Recall 0–5. `null` when the recall step was never completed. */
  readonly recallScore: ReportedCount
  readonly firstSwitch: FirstSwitch
  readonly externalCount: ReportedCount
  readonly unplannedAgentChecks: ReportedCount
  readonly countMethod: CountMethod
  readonly conditions: ObservedConditions
  readonly localDate: string
}

/** Thrown when demo and pilot records would be mixed into one result. */
export class RealmMixingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RealmMixingError'
  }
}

/**
 * Guards the boundary the PRD insists on: a simulated record must never be
 * mistakable for a real measurement. Rather than filtering silently, this
 * throws — a report that quietly dropped half its samples would be its own
 * kind of dishonesty.
 */
export function assertSameRealm(attempts: readonly AttemptSummary[]): Realm | null {
  if (attempts.length === 0) return null
  const first = attempts[0]!.realm
  for (const a of attempts) {
    if (a.realm !== first) {
      throw new RealmMixingError(
        `Refusing to compare a '${first}' record with a '${a.realm}' record. ` +
          'Simulated and real results are never combined.',
      )
    }
  }
  return first
}

export function isReported(value: ReportedCount): value is number {
  return value !== null
}

/**
 * Deliberately absent: any `countOrZero(...)` helper. Defaulting an unknown
 * count to zero is the single failure mode this domain exists to prevent, so
 * the codebase offers no convenient way to do it.
 */
