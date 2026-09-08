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
  /**
   * `firstSwitch` and `countMethod` are `null` only when S (`episodeCount`)
   * was not reported; such an attempt is never eligible (`count_unknown`).
   */
  readonly firstSwitch: FirstSwitch | null
  readonly externalCount: ReportedCount
  readonly unplannedAgentChecks: ReportedCount
  readonly countMethod: CountMethod | null
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
 *
 * Accepts any readonly list of rows that carry a `realm` field — not only
 * `AttemptSummary` — so programs, practice blocks and check-ins can share
 * this one guard instead of each writing their own (2.5.2, 6.2.x).
 */
export function assertSameRealm(rows: readonly { readonly realm: Realm }[]): Realm | null {
  if (rows.length === 0) return null
  const first = rows[0]!.realm
  for (const row of rows) {
    if (row.realm !== first) {
      throw new RealmMixingError(
        `Refusing to compare a '${first}' record with a '${row.realm}' record. ` +
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

// ---------------------------------------------------------------------------
// Literal unions and const arrays shared by domain modules and contracts.
//
// Every literal set below has exactly ONE source of truth. For a union that
// already existed above, that source is the `as const` array added here,
// checked with `satisfies readonly <Type>[]`. For a union introduced here,
// the array comes first and the type is derived from it. Either way,
// `packages/shared/src/contracts/*` (TypeBox `Lit()`, see contracts/
// common.ts) reads these same arrays so a literal can never drift between
// the domain and the wire contract.
// ---------------------------------------------------------------------------

/** Arrays for unions that already existed above, added so contracts can share them. */
export const REALMS = ['demo', 'pilot'] as const satisfies readonly Realm[]
export const TIME_SOURCES = [
  'measured',
  'demo_clock',
  'attested',
] as const satisfies readonly TimeSource[]
export const COUNT_METHODS = ['event', 'retrospective'] as const satisfies readonly CountMethod[]
export const BENCHMARK_PHASES = [
  'baseline',
  'midpoint',
  'final',
] as const satisfies readonly BenchmarkPhase[]
export const SLOT_LABELS = ['A', 'B'] as const satisfies readonly SlotLabel[]
export const OUTPUT_QUALITIES = ['yes', 'partly', 'no'] as const satisfies readonly OutputQuality[]
export const TIMER_QUALITIES = ['ok', 'uncertain'] as const satisfies readonly TimerQuality[]

export const EXCLUSION_REASONS = [
  'interval_incomplete',
  'recall_missing',
  'scoring_incomplete',
  'count_unknown',
  'materially_disrupted',
  'timer_uncertain',
  'timing_deviation',
  'excluded_by_amendment',
  'simulated_time',
] as const satisfies readonly ExclusionReason[]

/**
 * Type-level guard: `EXCLUSION_REASONS` must be exactly the key set of
 * `EXCLUSION_REASON_COPY`, in both directions — this line fails to typecheck
 * the moment either list gains or loses a member the other does not have.
 */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
const _exclusionReasonsMatchCopyKeys: Equal<
  (typeof EXCLUSION_REASONS)[number],
  keyof typeof EXCLUSION_REASON_COPY
> = true
// Referenced only for the type-level check above; no runtime behavior.
void _exclusionReasonsMatchCopyKeys

/** New shared literal unions. */

export const SESSION_EVENT_TYPES = [
  'off_task',
  'external',
  'agent_check',
  'pause',
  'resume',
  'clock_gap',
  'visibility',
] as const
export type SessionEventType = (typeof SESSION_EVENT_TYPES)[number]

export const SESSION_KINDS = ['practice', 'benchmark'] as const
export type SessionKind = (typeof SESSION_KINDS)[number]

export const SESSION_LIFECYCLES = [
  'running',
  'paused',
  'awaiting_review',
  'finalized',
  'abandoned',
] as const
export type SessionLifecycle = (typeof SESSION_LIFECYCLES)[number]

export const PROGRAM_STATUSES = [
  'draft',
  'baseline_ready',
  'active',
  'completed',
  'archived',
] as const
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number]

export const RECALL_FLAGS = ['recall_delayed', 'recall_overrun'] as const
export type RecallFlag = (typeof RECALL_FLAGS)[number]

export const FEED_DEVICES = ['phone', 'desktop', 'tablet', 'unspecified'] as const
export type FeedDevice = (typeof FEED_DEVICES)[number]

/** D36: the device-level feed row marker (`platform: 'all'`, scope `feed`, source `estimate`). */
export const FEED_PLATFORM_ALL = 'all'

export const MEASUREMENT_SCOPES = ['feed', 'app_total'] as const
export type MeasurementScope = (typeof MEASUREMENT_SCOPES)[number]

export const FEED_SOURCES = ['estimate', 'device_report'] as const
export type FeedSource = (typeof FEED_SOURCES)[number]

export const CHECKIN_STATUSES = ['complete', 'incomplete', 'not_reported'] as const
export type CheckinStatus = (typeof CHECKIN_STATUSES)[number]

export const CHECKIN_FIELDS = ['sleep', 'feed'] as const
export type CheckinField = (typeof CHECKIN_FIELDS)[number]

/**
 * Result states in their D7.4 evaluation/precedence order: the first state
 * whose condition applies wins. `resolveResultState` (2.4.2) evaluates them
 * in exactly this order, and `RESULT_STATE_COPY` (2.4.2) is keyed by it.
 */
export const RESULT_STATES = [
  'baseline_pending',
  'final_pending',
  'insufficient_samples',
  'zero_baseline',
  'more_switches',
  'unchanged',
  'fewer_switches_lower_recall',
  'improvement_maintained_recall',
] as const
export type ResultState = (typeof RESULT_STATES)[number]

export const IDENTITY_MODES = ['local-demo', 'real'] as const
export type IdentityMode = (typeof IDENTITY_MODES)[number]

export const TRANSITION_TYPES = ['pause', 'resume', 'end', 'abandon'] as const
export type TransitionType = (typeof TRANSITION_TYPES)[number]

export const CLOCK_GAP_RESOLUTIONS = ['continued', 'uncertain', 'save_incomplete'] as const
export type ClockGapResolution = (typeof CLOCK_GAP_RESOLUTIONS)[number]

/** The discriminant of `FirstSwitch`, pulled out as its own named union. */
export type FirstSwitchKind = FirstSwitch['kind']
export const FIRST_SWITCH_KINDS = [
  'none_capped',
  'known',
  'unknown',
] as const satisfies readonly FirstSwitchKind[]

export const FIRST_SWITCH_METHODS = ['event', 'estimate'] as const
export type FirstSwitchMethod = (typeof FIRST_SWITCH_METHODS)[number]

export const BLOCK_STATUSES = ['not_started', 'in_progress', 'completed', 'partial'] as const
export type BlockStatus = (typeof BLOCK_STATUSES)[number]

export const NEXT_ACTION_KINDS = [
  'setup',
  'readiness',
  'benchmark',
  'practice',
  'final',
  'progress',
] as const
export type NextActionKind = (typeof NEXT_ACTION_KINDS)[number]

/** PRD §6 demo scenario names, in the order they are offered in Settings/demo controls. */
export const DEMO_SCENARIO_NAMES = [
  'new-user',
  'working-day',
  'comparable-change',
  'mixed-result',
  'missing-final',
  'zero-baseline',
  'recovery',
  'timing-deviation',
] as const
export type DemoScenarioName = (typeof DEMO_SCENARIO_NAMES)[number]
