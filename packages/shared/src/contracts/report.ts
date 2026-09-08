/**
 * `GET /programs/{id}/report` and `GET /programs/{id}/export`.
 *
 * `AttemptSchema` mirrors the widened `AttemptSummary` (`domain/types.ts`,
 * 2.7.1: `firstSwitch` and `countMethod` are `null` only when S was never
 * reported) plus the review fields the report needs but the comparison math
 * does not. `ComparisonSchema` mirrors `ComparisonResult` (2.4.1,
 * `domain/comparison.ts`) structurally — this file does not import that
 * module, since a contract only needs to describe the wire shape, and
 * `domain/comparison.ts` is a sibling unit's responsibility.
 *
 * `FirstSwitchSchema` and `ObservedConditionsSchema` below are deliberately
 * NOT exported: `contracts/sessions.ts` (2.7.4) owns the exported schemas of
 * those names, and re-exporting two different schemas under the same name
 * from `contracts/index.ts` (2.7.6) would collide. Every report-only shape
 * here (samples, practice rows, day rows, revisions, comparability
 * warnings) IS exported, since no other route group defines it.
 *
 * See design.md's API contracts table and D7.4/D7.5 (result-state
 * precedence, comparability warnings) plus the progress-report spec.
 */
import { Type, type Static } from '@sinclair/typebox'

import {
  AccommodationSchema,
  BenchmarkPhaseSchema,
  CheckinStatusSchema,
  CountMethodSchema,
  ExclusionReasonSchema,
  FirstSwitchMethodSchema,
  IsoTimestampSchema,
  Lit,
  LocalDateSchema,
  Obj,
  OutputQualitySchema,
  RealmSchema,
  RecallFlagSchema,
  ReportedCountSchema,
  ResultStateSchema,
  SessionLifecycleSchema,
  SlotLabelSchema,
  TimeSourceSchema,
  TimerQualitySchema,
  UuidSchema,
} from './common.js'

// ---------------------------------------------------------------------------
// Shapes shared only within this file (see the file header on why these two
// are not exported: 2.7.4 exports schemas of the same name for the same
// domain shapes).
// ---------------------------------------------------------------------------

/** Mirrors `domain/types.ts`'s `FirstSwitch` union exactly. */
const FirstSwitchSchema = Type.Union([
  Obj({ kind: Type.Literal('none_capped') }),
  Obj({ kind: Type.Literal('known'), seconds: Type.Integer({ minimum: 0 }) }),
  Obj({ kind: Type.Literal('unknown') }),
])

/** Mirrors `domain/types.ts`'s `ObservedConditions` interface exactly. */
const ObservedConditionsSchema = Obj({
  deviceFormat: Type.Union([Type.String(), Type.Null()]),
  language: Type.Union([Type.String(), Type.Null()]),
  materialLevel: Type.Union([Type.String(), Type.Null()]),
  accommodations: Type.Array(AccommodationSchema),
})

// ---------------------------------------------------------------------------
// Attempts
// ---------------------------------------------------------------------------

/**
 * Mirrors the widened `AttemptSummary` (`firstSwitch` and `countMethod`
 * nullable — null only when S was never reported, per 2.7.1) plus the
 * review-only fields the report adds: `lifecycle`, `replacementReason`,
 * `recallFlags`, `revisionId`, `mindWanderingCount`, `materiallyDisrupted`,
 * `timerQuality` and `excludedByAmendment` (6.2.1: `true` when at least one
 * `session_amendments` row for the attempt has `excludeFromReport: true` —
 * the overlay `applyAmendmentExclusion` already folded into `eligible`/
 * `exclusionReasons`, surfaced here as its own flag so a client can render
 * "excluded, with a reason" distinctly from any other exclusion).
 *
 * `firstSwitchMethod` (task 6.3.1: the export's `t_method` column) is added
 * additively, `Type.Optional`, for the same reason `lifecycle` etc. were in
 * 6.2.1/6.2.4 — the pre-existing `days-report.test.ts` fixture predates it
 * and never supplies it. `null` only when `firstSwitch` itself is `null` or
 * `none_capped` (no method applies); `'event'` or `'estimate'` alongside a
 * `known` first switch, mirroring `firstSwitch.ts`'s `DerivedFirstSwitch`.
 */
export const AttemptSchema = Obj({
  attemptId: UuidSchema,
  phase: BenchmarkPhaseSchema,
  label: SlotLabelSchema,
  realm: RealmSchema,
  timeSource: TimeSourceSchema,
  eligible: Type.Boolean(),
  exclusionReasons: Type.Array(ExclusionReasonSchema),
  episodeCount: ReportedCountSchema,
  recallScore: ReportedCountSchema,
  firstSwitch: Type.Union([FirstSwitchSchema, Type.Null()]),
  firstSwitchMethod: Type.Optional(Type.Union([FirstSwitchMethodSchema, Type.Null()])),
  externalCount: ReportedCountSchema,
  unplannedAgentChecks: ReportedCountSchema,
  countMethod: Type.Union([CountMethodSchema, Type.Null()]),
  conditions: ObservedConditionsSchema,
  localDate: LocalDateSchema,
  lifecycle: SessionLifecycleSchema,
  replacementReason: Type.Union([Type.String(), Type.Null()]),
  recallFlags: Type.Array(RecallFlagSchema),
  revisionId: UuidSchema,
  mindWanderingCount: ReportedCountSchema,
  materiallyDisrupted: Type.Union([Type.Boolean(), Type.Null()]),
  timerQuality: TimerQualitySchema,
  excludedByAmendment: Type.Boolean(),
})
export type AttemptValue = Static<typeof AttemptSchema>

// ---------------------------------------------------------------------------
// Comparison (mirrors domain/comparison.ts's ComparisonResult, 2.4.1)
// ---------------------------------------------------------------------------

const SLOT_KEYS = ['baseline:A', 'baseline:B', 'final:A', 'final:B'] as const

export const ComparisonSchema = Obj({
  s0: Type.Number(),
  s14: Type.Number(),
  absoluteChange: Type.Number(),
  percentageReduction: Type.Union([Type.Number(), Type.Null()]),
  lowBaseline: Type.Boolean(),
  recallBaselineMean: Type.Number(),
  recallFinalMean: Type.Number(),
  firstSwitches: Obj({
    'baseline:A': FirstSwitchSchema,
    'baseline:B': FirstSwitchSchema,
    'final:A': FirstSwitchSchema,
    'final:B': FirstSwitchSchema,
  }),
  firstSwitchMeanSeconds: Type.Union([Type.Number(), Type.Null()]),
})
export type ComparisonValue = Static<typeof ComparisonSchema>

/** `SlotKey`'s wire form, exported for callers that need to iterate the four keys. */
export const SlotKeySchema = Lit(SLOT_KEYS)

// ---------------------------------------------------------------------------
// Comparability warnings (mirrors domain/comparison.ts's ComparabilityWarning, 2.4.3)
// ---------------------------------------------------------------------------

const COMPARABILITY_FIELDS = [
  'deviceFormat',
  'language',
  'materialLevel',
  'accommodations',
] as const

export const ComparabilityWarningSchema = Obj({
  label: SlotLabelSchema,
  field: Lit(COMPARABILITY_FIELDS),
  baseline: Type.Union([Type.String(), Type.Null(), Type.Array(AccommodationSchema)]),
  final: Type.Union([Type.String(), Type.Null(), Type.Array(AccommodationSchema)]),
  message: Type.String(),
})
export type ComparabilityWarningValue = Static<typeof ComparabilityWarningSchema>

// ---------------------------------------------------------------------------
// The report itself
// ---------------------------------------------------------------------------

const SampleCountSchema = Type.Union([Type.Literal(0), Type.Literal(1), Type.Literal(2)])

/**
 * The base ten fields are 2.7.5's own shape. `lifecycle`, `completedSeconds`,
 * `timerQuality`, `countMethod` and `mindWanderingCount` are added
 * additively by task 6.2.4 — `Type.Optional` so the pre-existing 2.7.5
 * fixture (`test/contracts/days-report.test.ts`, written before this unit)
 * keeps validating a `practice[]` example that predates these five; every
 * row the report actually returns supplies all of them (`services/report/
 * practice.ts`'s `mapPracticeRow`).
 */
export const PracticeRowSchema = Obj({
  sessionId: UuidSchema,
  localDate: LocalDateSchema,
  day: Type.Integer({ minimum: 0 }),
  targetSeconds: Type.Integer({ minimum: 300, maximum: 1500, multipleOf: 300 }),
  completeInterval: Type.Union([Type.Boolean(), Type.Null()]),
  outputQuality: Type.Union([OutputQualitySchema, Type.Null()]),
  episodeCount: ReportedCountSchema,
  externalCount: ReportedCountSchema,
  unplannedAgentChecks: ReportedCountSchema,
  revisionId: UuidSchema,
  lifecycle: Type.Optional(SessionLifecycleSchema),
  completedSeconds: Type.Optional(ReportedCountSchema),
  timerQuality: Type.Optional(TimerQualitySchema),
  countMethod: Type.Optional(Type.Union([CountMethodSchema, Type.Null()])),
  mindWanderingCount: Type.Optional(ReportedCountSchema),
})
export type PracticeRowValue = Static<typeof PracticeRowSchema>

export const FeedByDeviceSchema = Obj({
  phone: ReportedCountSchema,
  desktop: ReportedCountSchema,
  tablet: ReportedCountSchema,
  unspecified: ReportedCountSchema,
})

/** `status` allows `not_reported` (a day gap, per D22/daily-checkin — never a zero). */
export const DayRowSchema = Obj({
  localDate: LocalDateSchema,
  day: Type.Integer({ minimum: 0 }),
  status: CheckinStatusSchema,
  sleepMinutes: ReportedCountSchema,
  stress: Type.Union([Type.Integer({ minimum: 0, maximum: 10 }), Type.Null()]),
  mindfulnessMinutes: ReportedCountSchema,
  feedDeviceMinutes: ReportedCountSchema,
  partial: Type.Boolean(),
  feedByDevice: FeedByDeviceSchema,
})
export type DayRowValue = Static<typeof DayRowSchema>

const RevisionRowSchema = Obj({
  id: UuidSchema,
  revision: Type.Integer({ minimum: 1 }),
  effectiveDay: Type.Integer({ minimum: 0, maximum: 14 }),
  settings: Obj({
    practiceTargetSeconds: Type.Integer({ minimum: 300, maximum: 1500, multipleOf: 300 }),
    bandCeilings: Type.Array(
      Obj({
        fromDay: Type.Integer({ minimum: 0 }),
        toDay: Type.Integer({ minimum: 0 }),
        minutes: Type.Integer({ minimum: 0 }),
      }),
    ),
    leisureAllowanceMin: Type.Integer({ minimum: 0 }),
  }),
  reason: Type.String({ minLength: 1 }),
  createdAt: IsoTimestampSchema,
})

export const ReportResponse = Obj({
  realm: RealmSchema,
  samples: Obj({
    baselineEligible: SampleCountSchema,
    finalEligible: SampleCountSchema,
  }),
  attempts: Type.Array(AttemptSchema),
  comparison: Type.Optional(ComparisonSchema),
  resultState: ResultStateSchema,
  warnings: Type.Array(ComparabilityWarningSchema),
  practice: Type.Array(PracticeRowSchema),
  days: Type.Array(DayRowSchema),
  revisions: Type.Array(RevisionRowSchema),
})
export type ReportResponseValue = Static<typeof ReportResponse>

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const ExportQuery = Obj({
  format: Lit(['csv', 'markdown'] as const),
})
export type ExportQueryValue = Static<typeof ExportQuery>
