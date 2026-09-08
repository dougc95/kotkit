/**
 * Contracts for the `/programs` route group: `POST /programs`,
 * `GET /programs/current`, `PATCH /programs/{id}`,
 * `PUT /programs/{id}/benchmark-slots`, `POST /programs/{id}/revisions`,
 * `GET /programs/{id}/today`.
 *
 * See design.md's API contracts table and D22 (no-program shape, nulls
 * preserved on `today.checkin.values`), D23 (`nextAction` is not day-gated —
 * `final` stays valid on Day 14 and after while a final slot lacks a
 * finalized attempt) and D33 (the only explicit `PATCH` status transitions
 * are to `completed`/`archived`).
 */
import { Type, type Static } from '@sinclair/typebox'

import {
  BenchmarkPhaseSchema,
  BlockStatusSchema,
  CheckinFieldSchema,
  CheckinStatusSchema,
  IsoTimestampSchema,
  LocalDateSchema,
  Obj,
  ProgramStatusSchema,
  RealmSchema,
  ReportedCountSchema,
  SessionLifecycleSchema,
  SlotLabelSchema,
  UuidSchema,
} from './common.js'

/** A nullable free-text field: not-yet-set is `null`, never an empty string. */
const NullableString = Type.Union([Type.String(), Type.Null()])

/** A nullable ISO timestamp, e.g. `frozenAt` before a slot has any attempt. */
const NullableIsoTimestamp = Type.Union([IsoTimestampSchema, Type.Null()])

// ---------------------------------------------------------------------------
// POST /programs
// ---------------------------------------------------------------------------

/** The three initial practice durations Setup offers (5, 10, 15 minutes). */
const InitialPracticeTargetSecondsSchema = Type.Union([
  Type.Literal(300),
  Type.Literal(600),
  Type.Literal(900),
])

export const CreateProgramBody = Obj({
  baselineDate: LocalDateSchema,
  timezone: Type.String({ minLength: 1 }),
  practiceTargetSeconds: InitialPracticeTargetSecondsSchema,
  leisureAllowanceMinutes: Type.Optional(Type.Integer({ minimum: 0 })),
  feedEstimateMinutes: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
})
export type CreateProgramBodyValue = Static<typeof CreateProgramBody>

/** Never a `userId` — see identity-realm's "Client cannot choose the realm". */
export const ProgramResponse = Obj({
  id: UuidSchema,
  realm: RealmSchema,
  status: ProgramStatusSchema,
  baselineDate: LocalDateSchema,
  timezone: Type.String(),
  leisureAllowanceMinutes: Type.Integer({ minimum: 0 }),
  feedEstimateMinutes: ReportedCountSchema,
  currentRevisionId: UuidSchema,
  version: Type.Integer(),
})
export type ProgramResponseValue = Static<typeof ProgramResponse>

/** One protocol_revisions row — the exact value 4.1.1 stores for revision 1. */
export const BandCeilingSchema = Obj({
  fromDay: Type.Integer(),
  toDay: Type.Integer(),
  minutes: Type.Integer(),
})
export type BandCeilingValue = Static<typeof BandCeilingSchema>

export const RevisionResponse = Obj({
  id: UuidSchema,
  revision: Type.Integer({ minimum: 1 }),
  effectiveDay: Type.Integer({ minimum: 0, maximum: 14 }),
  settings: Obj({
    practiceTargetSeconds: Type.Integer({ minimum: 300, maximum: 1500, multipleOf: 300 }),
    bandCeilings: Type.Array(BandCeilingSchema),
    leisureAllowanceMin: Type.Integer({ minimum: 0 }),
  }),
  reason: Type.String({ minLength: 1 }),
  createdAt: IsoTimestampSchema,
})
export type RevisionResponseValue = Static<typeof RevisionResponse>

// ---------------------------------------------------------------------------
// GET /programs/current
// ---------------------------------------------------------------------------

export const SlotAttemptSchema = Obj({
  sessionId: UuidSchema,
  lifecycle: SessionLifecycleSchema,
  eligible: Type.Union([Type.Boolean(), Type.Null()]),
  excludedByAmendment: Type.Boolean(),
})
export type SlotAttemptValue = Static<typeof SlotAttemptSchema>

/** D22: a slot's material and timing fields are `null` until the readiness step sets them. */
export const SlotResponse = Obj({
  id: UuidSchema,
  phase: BenchmarkPhaseSchema,
  label: SlotLabelSchema,
  materialRef: Type.String(),
  language: NullableString,
  deviceFormat: NullableString,
  materialLevel: NullableString,
  plannedLocalTime: NullableString,
  assignedLocalDate: LocalDateSchema,
  frozenAt: NullableIsoTimestamp,
  attempts: Type.Array(SlotAttemptSchema),
})
export type SlotResponseValue = Static<typeof SlotResponse>

const NextActionSetupSchema = Obj({ kind: Type.Literal('setup') })
const NextActionReadinessSchema = Obj({ kind: Type.Literal('readiness') })
/**
 * Carries only the slot id (decomposition note, "4. Programs API": "NextAction
 * benchmark and final results carry only { kind, slotId } (2.7.3); the client
 * reads phase, label, assigned date and planned time from slots[]") — matches
 * `deriveNextAction` (4.2.2), whose own unit test asserts a benchmark/final
 * result has exactly the keys `kind` and `slotId`.
 */
const NextActionBenchmarkSchema = Obj({
  kind: Type.Literal('benchmark'),
  slotId: UuidSchema,
})
const NextActionPracticeSchema = Obj({
  kind: Type.Literal('practice'),
  block: Type.Union([Type.Literal(1), Type.Literal(2)]),
})
/**
 * D23: `final` remains valid on Day 14 and after while a final slot still
 * lacks a finalized attempt — `nextAction` is not day-gated. Carries only the
 * slot id, same reasoning as `NextActionBenchmarkSchema` above.
 */
const NextActionFinalSchema = Obj({
  kind: Type.Literal('final'),
  slotId: UuidSchema,
})
const NextActionProgressSchema = Obj({ kind: Type.Literal('progress') })

export const NextActionSchema = Type.Union([
  NextActionSetupSchema,
  NextActionReadinessSchema,
  NextActionBenchmarkSchema,
  NextActionPracticeSchema,
  NextActionFinalSchema,
  NextActionProgressSchema,
])
export type NextActionValue = Static<typeof NextActionSchema>

/** D22 no-program shape: `program: null, revision: null, slots: [], day: null, nextAction: {kind:'setup'}`. */
export const CurrentProgramResponse = Obj({
  program: Type.Union([ProgramResponse, Type.Null()]),
  revision: Type.Union([RevisionResponse, Type.Null()]),
  slots: Type.Array(SlotResponse),
  day: Type.Union([Type.Integer(), Type.Null()]),
  nextAction: NextActionSchema,
})
export type CurrentProgramResponseValue = Static<typeof CurrentProgramResponse>

export const ProgramIdParams = Obj({ id: UuidSchema })
export type ProgramIdParamsValue = Static<typeof ProgramIdParams>

// ---------------------------------------------------------------------------
// PATCH /programs/{id}
// ---------------------------------------------------------------------------

/** D33: the only explicit status transitions via PATCH; `active` is reached automatically. */
export const PatchProgramBody = Obj({
  expectedVersion: Type.Integer({ minimum: 1 }),
  status: Type.Optional(Type.Union([Type.Literal('completed'), Type.Literal('archived')])),
  baselineDate: Type.Optional(LocalDateSchema),
  leisureAllowanceMinutes: Type.Optional(Type.Integer({ minimum: 0 })),
})
export type PatchProgramBodyValue = Static<typeof PatchProgramBody>

// ---------------------------------------------------------------------------
// PUT /programs/{id}/benchmark-slots
// ---------------------------------------------------------------------------

const PutSlotItemSchema = Obj({
  phase: BenchmarkPhaseSchema,
  label: SlotLabelSchema,
  materialRef: Type.String({ minLength: 1, maxLength: 500 }),
  language: Type.Optional(Type.String()),
  deviceFormat: Type.Optional(Type.String()),
  materialLevel: Type.Optional(Type.String()),
  plannedLocalTime: Type.Optional(Type.String({ pattern: '^\\d{2}:\\d{2}$' })),
})

export const PutSlotsBody = Obj({
  expectedVersion: Type.Integer({ minimum: 1 }),
  slots: Type.Array(PutSlotItemSchema, { minItems: 1, maxItems: 5 }),
})
export type PutSlotsBodyValue = Static<typeof PutSlotsBody>

const MissingSlotFieldsSchema = Obj({
  phase: BenchmarkPhaseSchema,
  label: SlotLabelSchema,
  fields: Type.Array(Type.String()),
})

/** D22: atomic PUT — the response always carries the resulting program, slots and any gaps. */
export const PutSlotsResponse = Obj({
  program: ProgramResponse,
  slots: Type.Array(SlotResponse),
  missing: Type.Array(MissingSlotFieldsSchema),
})
export type PutSlotsResponseValue = Static<typeof PutSlotsResponse>

// ---------------------------------------------------------------------------
// POST /programs/{id}/revisions
// ---------------------------------------------------------------------------

export const CreateRevisionBody = Obj({
  effectiveDay: Type.Integer({ minimum: 0, maximum: 14 }),
  settings: Obj({
    practiceTargetSeconds: Type.Integer({ minimum: 300, maximum: 1500, multipleOf: 300 }),
    leisureAllowanceMin: Type.Optional(Type.Integer({ minimum: 0 })),
  }),
  reason: Type.String({ minLength: 1 }),
})
export type CreateRevisionBodyValue = Static<typeof CreateRevisionBody>

// ---------------------------------------------------------------------------
// GET /programs/{id}/today
// ---------------------------------------------------------------------------

/**
 * A Today block: `sessionId` is always present, `null` when the block has
 * no session (task 4.2.1's `deriveBlocks` — never omitted, so a consumer
 * can never mistake "no session" for "field not sent yet").
 */
export const TodayBlockSchema = Obj({
  index: Type.Union([Type.Literal(1), Type.Literal(2)]),
  status: BlockStatusSchema,
  targetSeconds: Type.Integer(),
  sessionId: Type.Union([UuidSchema, Type.Null()]),
})
export type TodayBlockValue = Static<typeof TodayBlockSchema>

/** D22: nulls preserved — a blank check-in value is never coalesced to 0. */
const TodayCheckinSchema = Obj({
  status: CheckinStatusSchema,
  missing: Type.Array(CheckinFieldSchema),
  values: Obj({
    sleepMinutes: ReportedCountSchema,
    phoneFeedMinutes: ReportedCountSchema,
    desktopFeedMinutes: ReportedCountSchema,
  }),
})

const TodaySuggestionSchema = Obj({
  suggestedTargetSeconds: Type.Integer(),
  qualifiedOn: Type.Tuple([LocalDateSchema, LocalDateSchema]),
})

export const TodayResponse = Obj({
  day: Type.Integer(),
  localDate: LocalDateSchema,
  blocks: Type.Array(TodayBlockSchema, { minItems: 2, maxItems: 2 }),
  checkin: TodayCheckinSchema,
  suggestion: Type.Optional(TodaySuggestionSchema),
  nextAction: NextActionSchema,
})
export type TodayResponseValue = Static<typeof TodayResponse>
