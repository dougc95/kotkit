/**
 * Demo scenario fixtures (PRD §6): relative-time rows for the eight named
 * demonstration journeys, plus the pure helpers that turn them into what the
 * domain layer already knows how to consume.
 *
 * D35 governs the shape throughout: every date is a program-day NUMBER
 * (`assignedDay` on a slot, `localDay` on a session, `checkinDay` on a
 * check-in/feed row) and every instant is a number of SECONDS relative to
 * the load instant (`startedAtOffsetSeconds`, `endedAtOffsetSeconds`,
 * `occurredAtOffsetSeconds`, `recallStartedAtOffsetSeconds`,
 * `recallLockedAtOffsetSeconds`, `finalizedAtOffsetSeconds`,
 * `createdAtOffsetSeconds`). Rows reference each other by fixture keys
 * (`slotKey`, `sessionKey`) rather than by database id — the loader (3.5.4)
 * mints fresh UUIDs and turns day numbers and offsets into real dates and
 * instants via `anchorScenario`, so this module never invents a date of its
 * own.
 *
 * D34: every root row (program, session, check-in) carries `realm: 'demo'`,
 * and every session row carries `timeSource: 'demo_clock'` — child rows
 * inherit through their parent in the real schema, so only the roots need
 * the field here.
 *
 * D31: every session row, whatever its lifecycle, has exactly one matching
 * review row — all-null for a running session, `observedConditions` from
 * its slot for a benchmark, the empty `ObservedConditions` for practice.
 *
 * The row shapes below mirror design.md's database model table
 * (`focus_sessions`, `session_reviews`, `session_events`,
 * `session_amendments`, `agent_plans`, `daily_checkins`, `feed_usage`) in
 * camelCase; nothing here is a wire contract (`packages/shared/src/contracts`)
 * or a database schema (`apps/api/src/db/schema`) — both are built from
 * these fixtures by later units, not the other way around.
 *
 * See docs/Attention-Lab-Prototype-PRD.md §6, specs/identity-realm/spec.md
 * ("Load a demonstration scenario"), specs/progress-report/spec.md
 * ("Result state with precedence", "Comparison mathematics", "No complete
 * comparison until two plus two") and specs/benchmark-assessment/spec.md
 * ("Eligibility is derived server-side with explicit reasons").
 */

import { addDays, localDateAt, localDateForProgramDay, type LocalDate } from '../domain/calendar.js'
import type { SlotKey } from '../domain/comparison.js'
import type { EligibilityInput } from '../domain/eligibility.js'
import { fromStoredFirstSwitch } from '../domain/firstSwitch.js'
import {
  DEFAULT_BAND_CEILINGS,
  PROGRESSION_ACCEPTED_REASON,
  type BandCeiling,
} from '../domain/progression.js'
import type { FeedRowInput } from '../domain/feed.js'
import {
  type Accommodation,
  type AttemptSummary,
  type BenchmarkPhase,
  type ClockGapResolution,
  type CountMethod,
  type DemoScenarioName,
  type ExclusionReason,
  type FirstSwitchKind,
  type FirstSwitchMethod,
  type MeasurementScope,
  type ObservedConditions,
  type OutputQuality,
  type ProgramStatus,
  type Realm,
  type RecallFlag,
  type ReportedCount,
  type ResultState,
  type SessionEventType,
  type SessionKind,
  type SessionLifecycle,
  type SlotLabel,
  type TimeSource,
  type TimerQuality,
} from '../domain/types.js'

// ---------------------------------------------------------------------------
// Row shapes (D35: relative-time, fixture-key-referenced).
// ---------------------------------------------------------------------------

/** One `programs` row. `id`, `baselineDate` and `currentRevisionId` are minted by the loader. */
export interface ProgramRow {
  readonly realm: Realm
  readonly status: ProgramStatus
  readonly timezone: string
  readonly leisureAllowanceMinutes: number
  readonly feedEstimateMinutes: ReportedCount
}

/** One `protocol_revisions` row. `revision` 1 is always `{effectiveDay: 0, reason: 'initial plan'}` (D33). */
export interface RevisionRow {
  readonly revision: number
  readonly effectiveDay: number
  readonly practiceTargetSeconds: number
  readonly bandCeilings: readonly BandCeiling[]
  readonly leisureAllowanceMin: number
  readonly reason: string
}

/** One `benchmark_slots` row, keyed by the same `SlotKey` `comparison.ts` already uses. */
export interface SlotRow {
  readonly slotKey: SlotKey
  readonly phase: BenchmarkPhase
  readonly label: SlotLabel
  readonly materialRef: string
  readonly language: string | null
  readonly deviceFormat: string | null
  readonly materialLevel: string | null
  readonly plannedLocalTime: string | null
  /** D35: 0 for baseline, 14 for final in every scenario here (midpoint is never used). */
  readonly assignedDay: 0 | 7 | 14
}

/** One `focus_sessions` row. Benchmark sessions carry `slotKey`; practice sessions never do. */
export interface SessionRow {
  readonly sessionKey: string
  readonly kind: SessionKind
  readonly slotKey?: SlotKey
  readonly lifecycle: SessionLifecycle
  readonly targetSeconds: number
  readonly localDay: number
  readonly startedAtOffsetSeconds: number
  readonly endedAtOffsetSeconds: number | null
  readonly pausedSeconds: number
  readonly intendedOutput: string | null
  readonly realm: Realm
  readonly timeSource: TimeSource
  readonly timerQuality: TimerQuality
  readonly clockGapSeconds: ReportedCount
  readonly completeInterval: boolean | null
  readonly eligible: boolean | null
  readonly exclusionReasons: readonly ExclusionReason[]
  readonly replacementReason: string | null
}

/** The `details` shapes a fixture event may carry — a subset of the two wire `details` schemas. */
export interface EventRowDetails {
  readonly alsoOffTask?: boolean
  readonly reason?: string
  readonly gapSeconds?: number
  readonly resolution?: ClockGapResolution
}

/** One `session_events` row. Omitting `details` means an empty `{}` on the wire, per D9. */
export interface EventRow {
  readonly sessionKey: string
  readonly clientEventId: string
  readonly type: SessionEventType
  readonly elapsedMs: number | null
  readonly occurredAtOffsetSeconds: number
  readonly details?: EventRowDetails
  readonly voided?: boolean
}

/**
 * One `session_reviews` row (D31: exactly one per session, whatever its
 * lifecycle). `first_switch_kind/seconds/method` are split out as they are
 * in the database table; `attemptsOf` recombines them with
 * `fromStoredFirstSwitch` (firstSwitch.ts) rather than duplicating that
 * logic.
 */
export interface ReviewRow {
  readonly sessionKey: string
  readonly episodeCount: ReportedCount
  readonly countMethod: CountMethod | null
  readonly firstSwitchKind: FirstSwitchKind | null
  readonly firstSwitchSeconds: number | null
  readonly firstSwitchMethod: FirstSwitchMethod | null
  readonly externalCount: ReportedCount
  readonly unplannedAgentChecks: ReportedCount
  readonly mindWanderingCount: ReportedCount
  readonly outputQuality: OutputQuality | null
  readonly outputNote: string | null
  readonly reviewNote: string | null
  readonly materiallyDisrupted: boolean | null
  readonly disruptionNote: string | null
  readonly recallPoints: readonly [string, string, string, string, string] | null
  readonly recallStartedAtOffsetSeconds: number | null
  readonly recallLockedAtOffsetSeconds: number | null
  readonly recallDelaySeconds: number | null
  readonly recallDurationSeconds: number | null
  readonly recallFlags: readonly RecallFlag[]
  readonly recallScores: readonly (0 | 1)[] | null
  readonly recallScore: ReportedCount
  readonly observedConditions: ObservedConditions
  readonly finalizedAtOffsetSeconds: number | null
}

/** One `session_amendments` row (D32: append-only; never rewrites stored eligibility). */
export interface AmendmentRow {
  readonly sessionKey: string
  readonly reason: string
  readonly excludeFromReport: boolean
  readonly createdAtOffsetSeconds: number
}

/** One `agent_plans` row (practice only). */
export interface AgentPlanRow {
  readonly sessionKey: string
  readonly workstream: string | null
  readonly waitingTask: string | null
  readonly reviewCheckpoint: 'end_of_block' | null
  readonly resumeNote: string | null
}

/** One `daily_checkins` row, keyed by program-day number rather than a date. */
export interface CheckinRow {
  readonly checkinDay: number
  readonly realm: Realm
  readonly sleepMinutes: ReportedCount
  readonly stress: number | null
  readonly mindfulnessMinutes: ReportedCount
  readonly note: string | null
}

/** One `feed_usage` row, tied to its check-in by the same day number. */
export interface FeedRowFixture extends FeedRowInput {
  readonly checkinDay: number
}

export interface DemoScenarioExpected {
  readonly resultState: ResultState | null
  readonly percentageReduction?: number | null
}

/** One full demonstration scenario, entirely in relative time (D35). */
export interface DemoScenario {
  readonly name: DemoScenarioName
  readonly description: string
  /** The program day shown at load — the point from which every offset and day number is read. */
  readonly viewDay: number
  readonly program: ProgramRow | null
  readonly revisions: readonly RevisionRow[]
  readonly slots: readonly SlotRow[]
  readonly sessions: readonly SessionRow[]
  readonly events: readonly EventRow[]
  readonly reviews: readonly ReviewRow[]
  readonly amendments: readonly AmendmentRow[]
  readonly agentPlans: readonly AgentPlanRow[]
  readonly checkins: readonly CheckinRow[]
  readonly feedRows: readonly FeedRowFixture[]
  readonly expected: DemoScenarioExpected
}

// ---------------------------------------------------------------------------
// Anchoring (D35): turning day numbers and offsets into real dates/instants.
// ---------------------------------------------------------------------------

export interface AnchoredSlot {
  readonly slotKey: SlotKey
  readonly phase: BenchmarkPhase
  readonly label: SlotLabel
  readonly materialRef: string
  readonly language: string | null
  readonly deviceFormat: string | null
  readonly materialLevel: string | null
  readonly plannedLocalTime: string | null
  readonly assignedLocalDate: LocalDate
}

export interface AnchoredSession {
  readonly sessionKey: string
  readonly kind: SessionKind
  readonly slotKey?: SlotKey
  readonly lifecycle: SessionLifecycle
  readonly targetSeconds: number
  readonly localDate: LocalDate
  readonly startedAt: string
  readonly endedAt: string | null
  readonly pausedSeconds: number
  readonly intendedOutput: string | null
  readonly realm: Realm
  readonly timeSource: TimeSource
  readonly timerQuality: TimerQuality
  readonly clockGapSeconds: ReportedCount
  readonly completeInterval: boolean | null
  readonly eligible: boolean | null
  readonly exclusionReasons: readonly ExclusionReason[]
  readonly replacementReason: string | null
}

export interface AnchoredEvent {
  readonly sessionKey: string
  readonly clientEventId: string
  readonly type: SessionEventType
  readonly elapsedMs: number | null
  readonly occurredAt: string
  readonly details?: EventRowDetails
  readonly voided?: boolean
}

export interface AnchoredReview {
  readonly sessionKey: string
  readonly episodeCount: ReportedCount
  readonly countMethod: CountMethod | null
  readonly firstSwitchKind: FirstSwitchKind | null
  readonly firstSwitchSeconds: number | null
  readonly firstSwitchMethod: FirstSwitchMethod | null
  readonly externalCount: ReportedCount
  readonly unplannedAgentChecks: ReportedCount
  readonly mindWanderingCount: ReportedCount
  readonly outputQuality: OutputQuality | null
  readonly outputNote: string | null
  readonly reviewNote: string | null
  readonly materiallyDisrupted: boolean | null
  readonly disruptionNote: string | null
  readonly recallPoints: readonly [string, string, string, string, string] | null
  readonly recallStartedAt: string | null
  readonly recallLockedAt: string | null
  readonly recallDelaySeconds: number | null
  readonly recallDurationSeconds: number | null
  readonly recallFlags: readonly RecallFlag[]
  readonly recallScores: readonly (0 | 1)[] | null
  readonly recallScore: ReportedCount
  readonly observedConditions: ObservedConditions
  readonly finalizedAt: string | null
}

export interface AnchoredAmendment {
  readonly sessionKey: string
  readonly reason: string
  readonly excludeFromReport: boolean
  readonly createdAt: string
}

export interface AnchoredCheckin {
  readonly localDate: LocalDate
  readonly realm: Realm
  readonly sleepMinutes: ReportedCount
  readonly stress: number | null
  readonly mindfulnessMinutes: ReportedCount
  readonly note: string | null
}

export interface AnchoredFeedRow extends FeedRowInput {
  readonly localDate: LocalDate
}

/** `DemoScenario`, with every day number turned into a `LocalDate` and every offset into an ISO instant. */
export interface AnchoredScenario {
  readonly name: DemoScenarioName
  readonly baselineDate: LocalDate
  readonly program: ProgramRow | null
  readonly revisions: readonly RevisionRow[]
  readonly slots: readonly AnchoredSlot[]
  readonly sessions: readonly AnchoredSession[]
  readonly events: readonly AnchoredEvent[]
  readonly reviews: readonly AnchoredReview[]
  readonly amendments: readonly AnchoredAmendment[]
  readonly agentPlans: readonly AgentPlanRow[]
  readonly checkins: readonly AnchoredCheckin[]
  readonly feedRows: readonly AnchoredFeedRow[]
  readonly expected: DemoScenarioExpected
}

/** The program timezone every scenario in this file uses. */
export const DEMO_SCENARIO_TIMEZONE = 'Europe/Madrid'

function isoAt(loadInstant: Date, offsetSeconds: number | null): string | null {
  if (offsetSeconds === null) return null
  return new Date(loadInstant.getTime() + offsetSeconds * 1000).toISOString()
}

/**
 * Turns a `DemoScenario`'s relative day numbers and offsets into real dates
 * and instants around `loadInstant` (D35): `baselineDate` is today's local
 * date (in the program's timezone) minus `viewDay` calendar days, so loading
 * the scenario always shows program day `viewDay` "today". This makes the
 * loader (3.5.4) a thin insert — it reads real dates and instants straight
 * off the result rather than computing any of its own.
 */
export function anchorScenario(scenario: DemoScenario, loadInstant: Date): AnchoredScenario {
  const timezone = scenario.program?.timezone ?? DEMO_SCENARIO_TIMEZONE
  const todayLocalDate = localDateAt(loadInstant, timezone)
  const baselineDate = addDays(todayLocalDate, -scenario.viewDay)

  const slots: AnchoredSlot[] = scenario.slots.map((slot) => ({
    slotKey: slot.slotKey,
    phase: slot.phase,
    label: slot.label,
    materialRef: slot.materialRef,
    language: slot.language,
    deviceFormat: slot.deviceFormat,
    materialLevel: slot.materialLevel,
    plannedLocalTime: slot.plannedLocalTime,
    assignedLocalDate: localDateForProgramDay(baselineDate, slot.assignedDay),
  }))

  const sessions: AnchoredSession[] = scenario.sessions.map((session) => {
    const anchored: AnchoredSession = {
      sessionKey: session.sessionKey,
      kind: session.kind,
      ...(session.slotKey !== undefined ? { slotKey: session.slotKey } : {}),
      lifecycle: session.lifecycle,
      targetSeconds: session.targetSeconds,
      localDate: localDateForProgramDay(baselineDate, session.localDay),
      startedAt: isoAt(loadInstant, session.startedAtOffsetSeconds)!,
      endedAt: isoAt(loadInstant, session.endedAtOffsetSeconds),
      pausedSeconds: session.pausedSeconds,
      intendedOutput: session.intendedOutput,
      realm: session.realm,
      timeSource: session.timeSource,
      timerQuality: session.timerQuality,
      clockGapSeconds: session.clockGapSeconds,
      completeInterval: session.completeInterval,
      eligible: session.eligible,
      exclusionReasons: session.exclusionReasons,
      replacementReason: session.replacementReason,
    }
    return anchored
  })

  const events: AnchoredEvent[] = scenario.events.map((event) => ({
    sessionKey: event.sessionKey,
    clientEventId: event.clientEventId,
    type: event.type,
    elapsedMs: event.elapsedMs,
    occurredAt: isoAt(loadInstant, event.occurredAtOffsetSeconds)!,
    ...(event.details !== undefined ? { details: event.details } : {}),
    ...(event.voided !== undefined ? { voided: event.voided } : {}),
  }))

  const reviews: AnchoredReview[] = scenario.reviews.map((review) => ({
    sessionKey: review.sessionKey,
    episodeCount: review.episodeCount,
    countMethod: review.countMethod,
    firstSwitchKind: review.firstSwitchKind,
    firstSwitchSeconds: review.firstSwitchSeconds,
    firstSwitchMethod: review.firstSwitchMethod,
    externalCount: review.externalCount,
    unplannedAgentChecks: review.unplannedAgentChecks,
    mindWanderingCount: review.mindWanderingCount,
    outputQuality: review.outputQuality,
    outputNote: review.outputNote,
    reviewNote: review.reviewNote,
    materiallyDisrupted: review.materiallyDisrupted,
    disruptionNote: review.disruptionNote,
    recallPoints: review.recallPoints,
    recallStartedAt: isoAt(loadInstant, review.recallStartedAtOffsetSeconds),
    recallLockedAt: isoAt(loadInstant, review.recallLockedAtOffsetSeconds),
    recallDelaySeconds: review.recallDelaySeconds,
    recallDurationSeconds: review.recallDurationSeconds,
    recallFlags: review.recallFlags,
    recallScores: review.recallScores,
    recallScore: review.recallScore,
    observedConditions: review.observedConditions,
    finalizedAt: isoAt(loadInstant, review.finalizedAtOffsetSeconds),
  }))

  const amendments: AnchoredAmendment[] = scenario.amendments.map((amendment) => ({
    sessionKey: amendment.sessionKey,
    reason: amendment.reason,
    excludeFromReport: amendment.excludeFromReport,
    createdAt: isoAt(loadInstant, amendment.createdAtOffsetSeconds)!,
  }))

  const checkins: AnchoredCheckin[] = scenario.checkins.map((checkin) => ({
    localDate: localDateForProgramDay(baselineDate, checkin.checkinDay),
    realm: checkin.realm,
    sleepMinutes: checkin.sleepMinutes,
    stress: checkin.stress,
    mindfulnessMinutes: checkin.mindfulnessMinutes,
    note: checkin.note,
  }))

  const feedRows: AnchoredFeedRow[] = scenario.feedRows.map((row) => ({
    device: row.device,
    platform: row.platform,
    minutes: row.minutes,
    shortVideoMinutes: row.shortVideoMinutes,
    measurementScope: row.measurementScope,
    source: row.source,
    plannedWindow: row.plannedWindow,
    localDate: localDateForProgramDay(baselineDate, row.checkinDay),
  }))

  return {
    name: scenario.name,
    baselineDate,
    program: scenario.program,
    revisions: scenario.revisions,
    slots,
    sessions,
    events,
    reviews,
    amendments,
    agentPlans: scenario.agentPlans,
    checkins,
    feedRows,
    expected: scenario.expected,
  }
}

// ---------------------------------------------------------------------------
// attemptsOf / toEligibilityInput: the widened `AttemptSummary` mapping and
// the `EligibilityInput` a finalized benchmark attempt's stored fields
// produce — the same shape 5.8.4 builds from real columns.
// ---------------------------------------------------------------------------

/**
 * Builds the `EligibilityInput` `evaluateEligibility` (eligibility.ts) would
 * be given for one stored benchmark attempt, straight from its fixture rows.
 * `sessionLocalDate`/`slotAssignedLocalDate` compare the raw day numbers
 * (equal day numbers ⇔ equal dates once anchored, so this needs no
 * `anchorScenario` call) rather than real `LocalDate` strings — a fixture
 * concern, not a domain one.
 */
export function toEligibilityInput(
  session: SessionRow,
  review: ReviewRow,
  slot: SlotRow,
  excludedByAmendment: boolean,
): EligibilityInput {
  return {
    completeInterval: session.completeInterval,
    recallLockedAt: review.recallLockedAtOffsetSeconds === null ? null : String(review.recallLockedAtOffsetSeconds),
    recallScores: review.recallScores,
    episodeCount: review.episodeCount,
    materiallyDisrupted: review.materiallyDisrupted === true,
    timerQuality: session.timerQuality,
    sessionLocalDate: String(session.localDay),
    slotAssignedLocalDate: String(slot.assignedDay),
    excludedByAmendment,
    realm: session.realm,
    timeSource: session.timeSource,
  }
}

/**
 * Maps a scenario's benchmark sessions (+ their review rows) to the widened
 * `AttemptSummary` shape `comparison.ts` consumes. Practice sessions are
 * skipped entirely — the comparison never reads them. A finalized session's
 * `eligible`/`exclusionReasons` are read straight from its stored fields (as
 * the API would have written them at finalize); an unfinalized session
 * always maps `eligible: false, exclusionReasons: []` with every count left
 * as stored (nulls preserved, never coalesced) — see benchmark-assessment's
 * "Eligibility is derived server-side with explicit reasons".
 */
export function attemptsOf(scenario: DemoScenario): AttemptSummary[] {
  const reviewsByKey = new Map(scenario.reviews.map((review) => [review.sessionKey, review]))
  const slotsByKey = new Map(scenario.slots.map((slot) => [slot.slotKey, slot]))

  const attempts: AttemptSummary[] = []
  for (const session of scenario.sessions) {
    if (session.kind !== 'benchmark') continue
    if (session.slotKey === undefined) {
      throw new Error(`attemptsOf: benchmark session "${session.sessionKey}" has no slotKey`)
    }
    const slot = slotsByKey.get(session.slotKey)
    if (!slot) {
      throw new Error(`attemptsOf: no slot "${session.slotKey}" for session "${session.sessionKey}"`)
    }
    const review = reviewsByKey.get(session.sessionKey)
    if (!review) {
      throw new Error(`attemptsOf: no review row for session "${session.sessionKey}"`)
    }

    const derivedFirstSwitch = fromStoredFirstSwitch({
      first_switch_kind: review.firstSwitchKind,
      first_switch_seconds: review.firstSwitchSeconds,
      first_switch_method: review.firstSwitchMethod,
    })
    const firstSwitch = derivedFirstSwitch === null ? null : derivedFirstSwitch.firstSwitch

    const isFinalized = session.lifecycle === 'finalized'
    attempts.push({
      attemptId: session.sessionKey,
      phase: slot.phase,
      label: slot.label,
      realm: session.realm,
      timeSource: session.timeSource,
      eligible: isFinalized ? session.eligible === true : false,
      exclusionReasons: isFinalized ? [...session.exclusionReasons] : [],
      episodeCount: review.episodeCount,
      recallScore: review.recallScore,
      firstSwitch,
      externalCount: review.externalCount,
      unplannedAgentChecks: review.unplannedAgentChecks,
      countMethod: review.countMethod,
      conditions: review.observedConditions,
      localDate: String(session.localDay),
    })
  }
  return attempts
}

// ---------------------------------------------------------------------------
// Shared fixture building blocks.
// ---------------------------------------------------------------------------

const EMPTY_CONDITIONS: ObservedConditions = {
  deviceFormat: null,
  language: null,
  materialLevel: null,
  accommodations: [] as readonly Accommodation[],
}

function conditionsFromSlot(slot: SlotRow): ObservedConditions {
  return {
    deviceFormat: slot.deviceFormat,
    language: slot.language,
    materialLevel: slot.materialLevel,
    accommodations: [],
  }
}

/** An all-null review row (D31: what every session gets at start, before anything is reported). */
function emptyReview(sessionKey: string, conditions: ObservedConditions): ReviewRow {
  return {
    sessionKey,
    episodeCount: null,
    countMethod: null,
    firstSwitchKind: null,
    firstSwitchSeconds: null,
    firstSwitchMethod: null,
    externalCount: null,
    unplannedAgentChecks: null,
    mindWanderingCount: null,
    outputQuality: null,
    outputNote: null,
    reviewNote: null,
    materiallyDisrupted: null,
    disruptionNote: null,
    recallPoints: null,
    recallStartedAtOffsetSeconds: null,
    recallLockedAtOffsetSeconds: null,
    recallDelaySeconds: null,
    recallDurationSeconds: null,
    recallFlags: [],
    recallScores: null,
    recallScore: null,
    observedConditions: conditions,
    finalizedAtOffsetSeconds: null,
  }
}

/** Five recall self-scores summing to `ones` (the first `ones` entries are 1, the rest 0). */
function fiveScores(ones: number): readonly (0 | 1)[] {
  return Array.from({ length: 5 }, (_, index) => (index < ones ? 1 : 0)) as readonly (0 | 1)[]
}

const RECALL_POINTS: readonly [string, string, string, string, string] = [
  'The article opened with a story about air-traffic controllers.',
  'It cited a two-week study on blocking mobile internet.',
  'It distinguished sustained attention from working memory.',
  'It recommended a fixed daily block rather than an open-ended one.',
  'It closed with a caution against over-claiming causation.',
]

/** The four benchmark slots every scenario in this file shares (baseline A/B Day 0, final A/B Day 14). */
const BASE_SLOTS: readonly SlotRow[] = [
  {
    slotKey: 'baseline:A',
    phase: 'baseline',
    label: 'A',
    materialRef: 'Article: The Deep Work Habit',
    language: 'en',
    deviceFormat: 'laptop',
    materialLevel: 'intermediate',
    plannedLocalTime: '09:00',
    assignedDay: 0,
  },
  {
    slotKey: 'baseline:B',
    phase: 'baseline',
    label: 'B',
    materialRef: 'Article: Attention Restoration Theory',
    language: 'en',
    deviceFormat: 'laptop',
    materialLevel: 'intermediate',
    plannedLocalTime: '19:00',
    assignedDay: 0,
  },
  {
    slotKey: 'final:A',
    phase: 'final',
    label: 'A',
    materialRef: 'Article: The Deep Work Habit',
    language: 'en',
    deviceFormat: 'laptop',
    materialLevel: 'intermediate',
    plannedLocalTime: '09:00',
    assignedDay: 14,
  },
  {
    slotKey: 'final:B',
    phase: 'final',
    label: 'B',
    materialRef: 'Article: Attention Restoration Theory',
    language: 'en',
    deviceFormat: 'laptop',
    materialLevel: 'intermediate',
    plannedLocalTime: '19:00',
    assignedDay: 14,
  },
]

const STANDARD_REVISION: RevisionRow = {
  revision: 1,
  effectiveDay: 0,
  practiceTargetSeconds: 600,
  bandCeilings: DEFAULT_BAND_CEILINGS,
  leisureAllowanceMin: 20,
  reason: 'initial plan',
}

/** `startedAtOffsetSeconds` for a session on program day `day`, `secondsIntoDay` after local midnight, given the scenario is being viewed on `viewDay`. */
function dayOffsetSeconds(viewDay: number, day: number, secondsIntoDay: number): number {
  return -(viewDay - day) * 86400 + secondsIntoDay
}

const MORNING_SLOT_SECONDS = 9 * 3600
const EVENING_SLOT_SECONDS = 19 * 3600

/**
 * One eligible, finalized benchmark attempt: a complete 1200-second
 * interval, a locked and fully scored recall with no flags, no disruption,
 * no timing deviation — every condition `evaluateEligibility` checks holds,
 * so `exclusionReasons` is empty and `eligible` is `true`.
 */
function eligibleAttempt(
  prefix: string,
  slotKey: SlotKey,
  day: number,
  startedAtOffsetSeconds: number,
  episodeCount: number,
  recallOnes: number,
  firstSwitchSeconds: number,
): { readonly session: SessionRow; readonly review: ReviewRow } {
  const slot = BASE_SLOTS.find((candidate) => candidate.slotKey === slotKey)
  if (!slot) throw new Error(`eligibleAttempt: unknown slot "${slotKey}"`)
  const sessionKey = `${prefix}:${slotKey}`
  const firstSwitchKind: FirstSwitchKind = episodeCount === 0 ? 'none_capped' : 'known'

  const session: SessionRow = {
    sessionKey,
    kind: 'benchmark',
    slotKey,
    lifecycle: 'finalized',
    targetSeconds: 1200,
    localDay: day,
    startedAtOffsetSeconds,
    endedAtOffsetSeconds: startedAtOffsetSeconds + 1200,
    pausedSeconds: 0,
    intendedOutput: null,
    realm: 'demo',
    timeSource: 'demo_clock',
    timerQuality: 'ok',
    clockGapSeconds: null,
    completeInterval: true,
    eligible: true,
    exclusionReasons: [],
    replacementReason: null,
  }

  const review: ReviewRow = {
    sessionKey,
    episodeCount,
    countMethod: 'event',
    firstSwitchKind,
    firstSwitchSeconds: firstSwitchKind === 'known' ? firstSwitchSeconds : null,
    firstSwitchMethod: firstSwitchKind === 'known' ? 'event' : null,
    externalCount: 1,
    unplannedAgentChecks: 0,
    mindWanderingCount: 1,
    outputQuality: null,
    outputNote: null,
    reviewNote: null,
    materiallyDisrupted: false,
    disruptionNote: null,
    recallPoints: RECALL_POINTS,
    recallStartedAtOffsetSeconds: startedAtOffsetSeconds + 1210,
    recallLockedAtOffsetSeconds: startedAtOffsetSeconds + 1330,
    recallDelaySeconds: 10,
    recallDurationSeconds: 120,
    recallFlags: [],
    recallScores: fiveScores(recallOnes),
    recallScore: recallOnes,
    observedConditions: conditionsFromSlot(slot),
    finalizedAtOffsetSeconds: startedAtOffsetSeconds + 1400,
  }

  return { session, review }
}

// ---------------------------------------------------------------------------
// 2.8.1 content: the four comparison scenarios (D7.4 fixtures).
// ---------------------------------------------------------------------------

const COMPARISON_VIEW_DAY = 15

function comparableChangeScenario(): DemoScenario {
  const baselineA = eligibleAttempt(
    'cc',
    'baseline:A',
    0,
    dayOffsetSeconds(COMPARISON_VIEW_DAY, 0, MORNING_SLOT_SECONDS),
    6,
    4,
    620,
  )
  const baselineB = eligibleAttempt(
    'cc',
    'baseline:B',
    0,
    dayOffsetSeconds(COMPARISON_VIEW_DAY, 0, EVENING_SLOT_SECONDS),
    4,
    4,
    540,
  )
  const finalA = eligibleAttempt(
    'cc',
    'final:A',
    14,
    dayOffsetSeconds(COMPARISON_VIEW_DAY, 14, MORNING_SLOT_SECONDS),
    3,
    4,
    900,
  )
  const finalB = eligibleAttempt(
    'cc',
    'final:B',
    14,
    dayOffsetSeconds(COMPARISON_VIEW_DAY, 14, EVENING_SLOT_SECONDS),
    3,
    4,
    840,
  )

  return {
    name: 'comparable-change',
    description:
      'Baseline averaged five reported switches (6, 4); the Day 14 average dropped to three (3, 3) with recall unchanged at four throughout — the PRD\'s comparable-change fixture.',
    viewDay: COMPARISON_VIEW_DAY,
    program: {
      realm: 'demo',
      status: 'active',
      timezone: DEMO_SCENARIO_TIMEZONE,
      leisureAllowanceMinutes: 20,
      feedEstimateMinutes: null,
    },
    revisions: [STANDARD_REVISION],
    slots: BASE_SLOTS,
    sessions: [baselineA.session, baselineB.session, finalA.session, finalB.session],
    events: [],
    reviews: [baselineA.review, baselineB.review, finalA.review, finalB.review],
    amendments: [],
    agentPlans: [],
    checkins: [],
    feedRows: [],
    expected: { resultState: 'improvement_maintained_recall', percentageReduction: 40 },
  }
}

function mixedResultScenario(): DemoScenario {
  const baselineA = eligibleAttempt(
    'mr',
    'baseline:A',
    0,
    dayOffsetSeconds(COMPARISON_VIEW_DAY, 0, MORNING_SLOT_SECONDS),
    6,
    4,
    620,
  )
  const baselineB = eligibleAttempt(
    'mr',
    'baseline:B',
    0,
    dayOffsetSeconds(COMPARISON_VIEW_DAY, 0, EVENING_SLOT_SECONDS),
    4,
    4,
    540,
  )
  const finalA = eligibleAttempt(
    'mr',
    'final:A',
    14,
    dayOffsetSeconds(COMPARISON_VIEW_DAY, 14, MORNING_SLOT_SECONDS),
    3,
    2,
    900,
  )
  const finalB = eligibleAttempt(
    'mr',
    'final:B',
    14,
    dayOffsetSeconds(COMPARISON_VIEW_DAY, 14, EVENING_SLOT_SECONDS),
    3,
    2,
    840,
  )

  return {
    name: 'mixed-result',
    description:
      'The same switch counts as comparable-change (6, 4 → 3, 3), but recall dropped from four to two — the PRD\'s "Mixed result" fixture (D7.4): fewer switches, lower recall.',
    viewDay: COMPARISON_VIEW_DAY,
    program: {
      realm: 'demo',
      status: 'active',
      timezone: DEMO_SCENARIO_TIMEZONE,
      leisureAllowanceMinutes: 20,
      feedEstimateMinutes: null,
    },
    revisions: [STANDARD_REVISION],
    slots: BASE_SLOTS,
    sessions: [baselineA.session, baselineB.session, finalA.session, finalB.session],
    events: [],
    reviews: [baselineA.review, baselineB.review, finalA.review, finalB.review],
    amendments: [],
    agentPlans: [],
    checkins: [],
    feedRows: [],
    expected: { resultState: 'fewer_switches_lower_recall', percentageReduction: 40 },
  }
}

function missingFinalScenario(): DemoScenario {
  const baselineA = eligibleAttempt(
    'mf',
    'baseline:A',
    0,
    dayOffsetSeconds(COMPARISON_VIEW_DAY, 0, MORNING_SLOT_SECONDS),
    5,
    4,
    600,
  )
  const baselineB = eligibleAttempt(
    'mf',
    'baseline:B',
    0,
    dayOffsetSeconds(COMPARISON_VIEW_DAY, 0, EVENING_SLOT_SECONDS),
    5,
    4,
    600,
  )
  const finalA = eligibleAttempt(
    'mf',
    'final:A',
    14,
    dayOffsetSeconds(COMPARISON_VIEW_DAY, 14, MORNING_SLOT_SECONDS),
    4,
    3,
    700,
  )

  const finalBSlot = BASE_SLOTS.find((slot) => slot.slotKey === 'final:B')!
  const finalBStart = dayOffsetSeconds(COMPARISON_VIEW_DAY, 14, EVENING_SLOT_SECONDS)
  const finalBSessionKey = 'mf:final:B'
  const finalBSession: SessionRow = {
    sessionKey: finalBSessionKey,
    kind: 'benchmark',
    slotKey: 'final:B',
    lifecycle: 'finalized',
    targetSeconds: 1200,
    localDay: 14,
    startedAtOffsetSeconds: finalBStart,
    // Stopped early: only 600 of the 1200 seconds were completed.
    endedAtOffsetSeconds: finalBStart + 600,
    pausedSeconds: 0,
    intendedOutput: null,
    realm: 'demo',
    timeSource: 'demo_clock',
    timerQuality: 'ok',
    clockGapSeconds: null,
    completeInterval: false,
    eligible: false,
    exclusionReasons: ['interval_incomplete', 'count_unknown'],
    replacementReason: null,
  }
  const finalBReview: ReviewRow = {
    sessionKey: finalBSessionKey,
    // S was never reported — blank, not zero (HANDOFF.md's "unknown ≠ zero").
    episodeCount: null,
    countMethod: null,
    firstSwitchKind: null,
    firstSwitchSeconds: null,
    firstSwitchMethod: null,
    externalCount: null,
    unplannedAgentChecks: null,
    mindWanderingCount: null,
    outputQuality: null,
    outputNote: null,
    reviewNote: null,
    materiallyDisrupted: false,
    disruptionNote: null,
    // Recall WAS completed even though the interval and S were not (D25:
    // recall is offered but may be skipped after an early stop — here it
    // wasn't), so neither recall_missing nor scoring_incomplete applies.
    recallPoints: RECALL_POINTS,
    recallStartedAtOffsetSeconds: finalBStart + 610,
    recallLockedAtOffsetSeconds: finalBStart + 700,
    recallDelaySeconds: 10,
    recallDurationSeconds: 90,
    recallFlags: [],
    recallScores: fiveScores(3),
    recallScore: 3,
    observedConditions: conditionsFromSlot(finalBSlot),
    finalizedAtOffsetSeconds: finalBStart + 750,
  }

  return {
    name: 'missing-final',
    description:
      'Both baseline attempts and final A are eligible; final B was stopped early with S left blank, so it is ineligible ([interval_incomplete, count_unknown]) — one final slot short of a comparison.',
    viewDay: COMPARISON_VIEW_DAY,
    program: {
      realm: 'demo',
      status: 'active',
      timezone: DEMO_SCENARIO_TIMEZONE,
      leisureAllowanceMinutes: 20,
      feedEstimateMinutes: null,
    },
    revisions: [STANDARD_REVISION],
    slots: BASE_SLOTS,
    sessions: [baselineA.session, baselineB.session, finalA.session, finalBSession],
    events: [],
    reviews: [baselineA.review, baselineB.review, finalA.review, finalBReview],
    amendments: [],
    agentPlans: [],
    checkins: [],
    feedRows: [],
    expected: { resultState: 'insufficient_samples', percentageReduction: null },
  }
}

function zeroBaselineScenario(): DemoScenario {
  const baselineA = eligibleAttempt(
    'zb',
    'baseline:A',
    0,
    dayOffsetSeconds(COMPARISON_VIEW_DAY, 0, MORNING_SLOT_SECONDS),
    0,
    5,
    0,
  )
  const baselineB = eligibleAttempt(
    'zb',
    'baseline:B',
    0,
    dayOffsetSeconds(COMPARISON_VIEW_DAY, 0, EVENING_SLOT_SECONDS),
    0,
    5,
    0,
  )
  const finalA = eligibleAttempt(
    'zb',
    'final:A',
    14,
    dayOffsetSeconds(COMPARISON_VIEW_DAY, 14, MORNING_SLOT_SECONDS),
    0,
    5,
    0,
  )
  const finalB = eligibleAttempt(
    'zb',
    'final:B',
    14,
    dayOffsetSeconds(COMPARISON_VIEW_DAY, 14, EVENING_SLOT_SECONDS),
    0,
    5,
    0,
  )

  return {
    name: 'zero-baseline',
    description:
      'Zero switches were reported at every attempt, baseline and final alike — a percentage reduction has no meaning against a zero baseline (progress-report\'s "Comparison mathematics").',
    viewDay: COMPARISON_VIEW_DAY,
    program: {
      realm: 'demo',
      status: 'active',
      timezone: DEMO_SCENARIO_TIMEZONE,
      leisureAllowanceMinutes: 20,
      feedEstimateMinutes: null,
    },
    revisions: [STANDARD_REVISION],
    slots: BASE_SLOTS,
    sessions: [baselineA.session, baselineB.session, finalA.session, finalB.session],
    events: [],
    reviews: [baselineA.review, baselineB.review, finalA.review, finalB.review],
    amendments: [],
    agentPlans: [],
    checkins: [],
    feedRows: [],
    expected: { resultState: 'zero_baseline', percentageReduction: null },
  }
}

// ---------------------------------------------------------------------------
// 2.8.2 content: the four journey scenarios.
// ---------------------------------------------------------------------------

/**
 * One finalized practice block. Practice never carries a `slotKey`, never
 * sets `materiallyDisrupted` (a benchmark-only field) and its review always
 * carries the empty `ObservedConditions` (D31) — a practice block has no
 * slot to default conditions from.
 */
function practiceAttempt(
  sessionKey: string,
  day: number,
  targetSeconds: number,
  startedAtOffsetSeconds: number,
  episodeCount: number,
): { readonly session: SessionRow; readonly review: ReviewRow } {
  const session: SessionRow = {
    sessionKey,
    kind: 'practice',
    lifecycle: 'finalized',
    targetSeconds,
    localDay: day,
    startedAtOffsetSeconds,
    endedAtOffsetSeconds: startedAtOffsetSeconds + targetSeconds,
    pausedSeconds: 0,
    intendedOutput: "Draft tomorrow's status update",
    realm: 'demo',
    timeSource: 'demo_clock',
    timerQuality: 'ok',
    clockGapSeconds: null,
    completeInterval: true,
    // Eligibility is a benchmark-only concept; practice sessions are never scored by it.
    eligible: null,
    exclusionReasons: [],
    replacementReason: null,
  }
  const review: ReviewRow = {
    sessionKey,
    episodeCount,
    countMethod: 'event',
    firstSwitchKind: null,
    firstSwitchSeconds: null,
    firstSwitchMethod: null,
    externalCount: 0,
    unplannedAgentChecks: 0,
    mindWanderingCount: 0,
    outputQuality: 'yes',
    outputNote: 'Finished the draft.',
    reviewNote: null,
    materiallyDisrupted: null,
    disruptionNote: null,
    recallPoints: null,
    recallStartedAtOffsetSeconds: null,
    recallLockedAtOffsetSeconds: null,
    recallDelaySeconds: null,
    recallDurationSeconds: null,
    recallFlags: [],
    recallScores: null,
    recallScore: null,
    observedConditions: EMPTY_CONDITIONS,
    finalizedAtOffsetSeconds: startedAtOffsetSeconds + targetSeconds + 60,
  }
  return { session, review }
}

function newUserScenario(): DemoScenario {
  return {
    name: 'new-user',
    description: 'A freshly loaded account before Setup has ever been completed: no program, no rows at all.',
    viewDay: 0,
    program: null,
    revisions: [],
    slots: [],
    sessions: [],
    events: [],
    reviews: [],
    amendments: [],
    agentPlans: [],
    checkins: [],
    feedRows: [],
    expected: { resultState: null },
  }
}

const WORKING_DAY_VIEW_DAY = 4
const MORNING_PRACTICE_SECONDS = 10 * 3600
const EVENING_PRACTICE_SECONDS = 17 * 3600

/**
 * Day 4 of a program going well: two baseline attempts eligible, six
 * qualifying practice blocks at 600s across Days 1–3, one 900s block on Day
 * 4 after the progression suggestion was accepted (revision 2), and complete
 * check-ins for Days 1–3. No final attempts exist yet, so the comparison is
 * `final_pending` — see practice-sessions's "Today shows one next action and
 * two blocks" and "Progression suggestion follows the protocol rule".
 */
function workingDayScenario(): DemoScenario {
  const revision1: RevisionRow = {
    revision: 1,
    effectiveDay: 0,
    practiceTargetSeconds: 600,
    bandCeilings: DEFAULT_BAND_CEILINGS,
    leisureAllowanceMin: 20,
    reason: 'initial plan',
  }
  const revision2: RevisionRow = {
    revision: 2,
    effectiveDay: 4,
    practiceTargetSeconds: 900,
    bandCeilings: DEFAULT_BAND_CEILINGS,
    leisureAllowanceMin: 20,
    reason: PROGRESSION_ACCEPTED_REASON,
  }

  const baselineA = eligibleAttempt(
    'wd',
    'baseline:A',
    0,
    dayOffsetSeconds(WORKING_DAY_VIEW_DAY, 0, MORNING_SLOT_SECONDS),
    5,
    4,
    600,
  )
  const baselineB = eligibleAttempt(
    'wd',
    'baseline:B',
    0,
    dayOffsetSeconds(WORKING_DAY_VIEW_DAY, 0, EVENING_SLOT_SECONDS),
    4,
    4,
    540,
  )

  const earlyDays = [1, 2, 3].flatMap((day) => [
    practiceAttempt(
      `wd:practice:${day}:1`,
      day,
      600,
      dayOffsetSeconds(WORKING_DAY_VIEW_DAY, day, MORNING_PRACTICE_SECONDS),
      1,
    ),
    practiceAttempt(
      `wd:practice:${day}:2`,
      day,
      600,
      dayOffsetSeconds(WORKING_DAY_VIEW_DAY, day, EVENING_PRACTICE_SECONDS),
      1,
    ),
  ])
  const day4Block1 = practiceAttempt(
    'wd:practice:4:1',
    4,
    900,
    dayOffsetSeconds(WORKING_DAY_VIEW_DAY, 4, MORNING_PRACTICE_SECONDS),
    1,
  )

  const checkins: CheckinRow[] = [1, 2, 3].map((day) => ({
    checkinDay: day,
    realm: 'demo',
    sleepMinutes: 420,
    stress: 4,
    mindfulnessMinutes: 10,
    note: null,
  }))
  const feedRows: FeedRowFixture[] = [1, 2, 3].flatMap((day) => [
    {
      checkinDay: day,
      device: 'phone',
      platform: 'all',
      minutes: 30,
      shortVideoMinutes: null,
      measurementScope: 'feed' as MeasurementScope,
      source: 'estimate',
      plannedWindow: null,
    },
    {
      checkinDay: day,
      device: 'desktop',
      platform: 'all',
      minutes: 15,
      shortVideoMinutes: null,
      measurementScope: 'feed' as MeasurementScope,
      source: 'estimate',
      plannedWindow: null,
    },
  ])

  return {
    name: 'working-day',
    description:
      'Day 4: both baseline attempts are eligible, six practice blocks qualified at 10 minutes across Days 1–3, and the accepted progression suggestion put Day 4\'s block at 15 minutes. No final attempt exists yet.',
    viewDay: WORKING_DAY_VIEW_DAY,
    program: {
      realm: 'demo',
      status: 'active',
      timezone: DEMO_SCENARIO_TIMEZONE,
      leisureAllowanceMinutes: 20,
      feedEstimateMinutes: null,
    },
    revisions: [revision1, revision2],
    slots: BASE_SLOTS,
    sessions: [baselineA.session, baselineB.session, ...earlyDays.map((p) => p.session), day4Block1.session],
    events: [],
    reviews: [baselineA.review, baselineB.review, ...earlyDays.map((p) => p.review), day4Block1.review],
    amendments: [],
    agentPlans: [],
    checkins,
    feedRows,
    expected: { resultState: 'final_pending' },
  }
}

const RECOVERY_VIEW_DAY = 5

/**
 * A practice block still `running` at load time — session-recovery's
 * "Session state is restored from the server after reload": the fixture
 * carries no events (the unsynced batch is created client-side by the
 * journey, 9.1.8), matching what the server actually has on disk before the
 * outbox replay ever runs.
 */
function recoveryScenario(): DemoScenario {
  const baselineA = eligibleAttempt(
    'rec',
    'baseline:A',
    0,
    dayOffsetSeconds(RECOVERY_VIEW_DAY, 0, MORNING_SLOT_SECONDS),
    5,
    4,
    600,
  )
  const baselineB = eligibleAttempt(
    'rec',
    'baseline:B',
    0,
    dayOffsetSeconds(RECOVERY_VIEW_DAY, 0, EVENING_SLOT_SECONDS),
    4,
    4,
    540,
  )

  const sessionKey = 'rec:practice:running'
  const session: SessionRow = {
    sessionKey,
    kind: 'practice',
    lifecycle: 'running',
    targetSeconds: 600,
    localDay: RECOVERY_VIEW_DAY,
    startedAtOffsetSeconds: -420,
    endedAtOffsetSeconds: null,
    pausedSeconds: 0,
    intendedOutput: 'Reply to the outstanding review comments',
    realm: 'demo',
    timeSource: 'demo_clock',
    timerQuality: 'ok',
    clockGapSeconds: null,
    completeInterval: null,
    eligible: null,
    exclusionReasons: [],
    replacementReason: null,
  }
  const review = emptyReview(sessionKey, EMPTY_CONDITIONS)
  const agentPlan: AgentPlanRow = {
    sessionKey,
    workstream: 'Waiting on code review for the auth handler',
    waitingTask: 'Ping the reviewer once notes land',
    reviewCheckpoint: 'end_of_block',
    resumeNote: 'Pick back up on the auth handler once notes land.',
  }

  return {
    name: 'recovery',
    description:
      'A practice block is still running when the page loads — refresh/recovery exercises restoring session state from the server rather than from a simulated interruption.',
    viewDay: RECOVERY_VIEW_DAY,
    program: {
      realm: 'demo',
      status: 'active',
      timezone: DEMO_SCENARIO_TIMEZONE,
      leisureAllowanceMinutes: 20,
      feedEstimateMinutes: null,
    },
    revisions: [STANDARD_REVISION],
    slots: BASE_SLOTS,
    sessions: [baselineA.session, baselineB.session, session],
    events: [],
    reviews: [baselineA.review, baselineB.review, review],
    amendments: [],
    agentPlans: [agentPlan],
    checkins: [],
    feedRows: [],
    expected: { resultState: 'final_pending' },
  }
}

/**
 * Baseline A is `running`, started 18 minutes before load, with an
 * unresolved 300-second `clock_gap` event (the laptop slept) — the prompt
 * re-opens on load per D26 because the event carries no `resolution` at all.
 * Baseline B was never attempted. See session-recovery's "Clock gaps are
 * detected and resolved explicitly" / "Laptop slept during a benchmark".
 */
function timingDeviationScenario(): DemoScenario {
  const slot = BASE_SLOTS.find((candidate) => candidate.slotKey === 'baseline:A')!
  const sessionKey = 'td:baseline:A'
  const session: SessionRow = {
    sessionKey,
    kind: 'benchmark',
    slotKey: 'baseline:A',
    lifecycle: 'running',
    targetSeconds: 1200,
    localDay: 0,
    startedAtOffsetSeconds: -1080,
    endedAtOffsetSeconds: null,
    pausedSeconds: 0,
    intendedOutput: null,
    realm: 'demo',
    timeSource: 'demo_clock',
    timerQuality: 'ok',
    clockGapSeconds: null,
    completeInterval: null,
    eligible: null,
    exclusionReasons: [],
    replacementReason: null,
  }
  const review = emptyReview(sessionKey, conditionsFromSlot(slot))
  const event: EventRow = {
    sessionKey,
    clientEventId: 'td-clock-gap-1',
    type: 'clock_gap',
    elapsedMs: 600_000,
    occurredAtOffsetSeconds: -480,
    details: { gapSeconds: 300 },
  }

  return {
    name: 'timing-deviation',
    description:
      'Baseline A is running, started 18 minutes before load, with an unresolved clock-gap event; baseline B has not been attempted.',
    viewDay: 0,
    program: {
      realm: 'demo',
      status: 'baseline_ready',
      timezone: DEMO_SCENARIO_TIMEZONE,
      leisureAllowanceMinutes: 20,
      feedEstimateMinutes: null,
    },
    revisions: [STANDARD_REVISION],
    slots: BASE_SLOTS,
    sessions: [session],
    events: [event],
    reviews: [review],
    amendments: [],
    agentPlans: [],
    checkins: [],
    feedRows: [],
    expected: { resultState: 'baseline_pending' },
  }
}

/** The demo scenario registry (PRD §6): every `DemoScenarioName`, no more and no fewer. */
export const DEMO_SCENARIOS: Record<DemoScenarioName, DemoScenario> = {
  'new-user': newUserScenario(),
  'working-day': workingDayScenario(),
  'comparable-change': comparableChangeScenario(),
  'mixed-result': mixedResultScenario(),
  'missing-final': missingFinalScenario(),
  'zero-baseline': zeroBaselineScenario(),
  recovery: recoveryScenario(),
  'timing-deviation': timingDeviationScenario(),
}
