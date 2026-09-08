/**
 * `/sessions/*` route contracts: starting a session, the append-only event
 * batch and void, transitions, clock-gap resolution, the agent-waiting plan,
 * the two-write benchmark review (recall then finalize), the one-write
 * practice review (finalize only), amendments, and the single `SessionResponse`
 * shape (D20) that every session-mutating route and the two GETs return.
 *
 * Three rules carried over from `contracts/common.ts` apply throughout:
 *  - every request/response object is built with `Obj(...)`, so an
 *    unrecognized key is 400 `malformed_request`, never silently dropped;
 *  - every field that mirrors a `ReportedCount` column is the wire form
 *    `ReportedCountSchema` (`integer >= 0 | null`) — a blank is `null`, never
 *    coalesced to `0` (HANDOFF.md, D7.1);
 *  - every literal union reads its members from the one `domain/types.ts`
 *    source of truth via `Lit(...)`/the `*Schema` constants in `common.ts`.
 *
 * See design.md's API contracts table (the `/sessions/*` rows) and:
 *  - D9 (events are append-only; undo is a void marker)
 *  - D10 (two writes for a benchmark review, one for practice)
 *  - D20 (the one `SessionResponse` shape)
 *  - D21 (idempotent creates; `expectedEventCount` counts every stored row)
 *  - D26 (clock gaps: an unresolved `clock_gap` event re-opens the prompt)
 *  - D27 (recall `startedAt` is server-aligned time)
 *  - D29 (a transition `reason` is stored only on `pause`)
 *  - D30 (practice `targetSeconds` is a client choice; benchmarks always 1200)
 *  - D31 (the review row exists from session start)
 *  - D32 (amendments are append-only; stored eligibility is never rewritten)
 */
import { Type, type Static } from '@sinclair/typebox'

import { FIRST_SWITCH_CAP_SECONDS } from '../domain/types.js'
import {
  AccommodationSchema,
  ClockGapResolutionSchema,
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
  SessionEventTypeSchema,
  SessionKindSchema,
  SessionLifecycleSchema,
  TimeSourceSchema,
  TimerQualitySchema,
  TransitionTypeSchema,
  UuidSchema,
} from './common.js'

// ---------------------------------------------------------------------------
// Observed conditions (D7.5): live on the attempt, defaulted from the slot.
// ---------------------------------------------------------------------------

export const ObservedConditionsSchema = Obj({
  deviceFormat: Type.Union([Type.String(), Type.Null()]),
  language: Type.Union([Type.String(), Type.Null()]),
  materialLevel: Type.Union([Type.String(), Type.Null()]),
  accommodations: Type.Array(AccommodationSchema),
})
export type ObservedConditionsValue = Static<typeof ObservedConditionsSchema>

// ---------------------------------------------------------------------------
// POST /sessions
// ---------------------------------------------------------------------------

/**
 * D30: `targetSeconds` on start may be any 300..1500 step-300 value on the
 * wire — the server stores it as given for `practice` and requires exactly
 * 1200 for `benchmark` (a domain rule, not expressible in this schema alone).
 */
export const CreateSessionBody = Obj({
  programId: UuidSchema,
  kind: SessionKindSchema,
  slotId: Type.Optional(UuidSchema),
  intendedOutput: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  targetSeconds: Type.Optional(
    Type.Integer({ minimum: 300, maximum: 1500, multipleOf: 300 }),
  ),
  replacementReason: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  conditions: Type.Optional(ObservedConditionsSchema),
})
export type CreateSessionBodyValue = Static<typeof CreateSessionBody>

// ---------------------------------------------------------------------------
// Events: append-only batch, void, and the two `details` shapes.
// ---------------------------------------------------------------------------

/**
 * `reason` is nullable, not merely optional (task 5.4.2): a server-written
 * `pause`/`resume` row (design.md D29) always carries a `reason` key — a
 * `resume` row, and a `pause` with no supplied reason, store it as an
 * explicit `null` rather than omitting the key, so a reader never has to
 * distinguish "this event type never has a reason" from "this one happened
 * to have none". Client-submitted event types (`off_task`, `external`,
 * `agent_check`, `visibility`) never populate this field either way.
 *
 * `hidden` is `visibility`'s own field (D39, opt-in `preferences.
 * visibilityContext`): `useSessionEvents.ts`'s `visibilitychange` listener
 * posts `{ hidden: document.hidden }` — omitted here (as with `alsoOffTask`/
 * `reason`) this rejected EVERY opt-in `visibility` event outright (`Obj`'s
 * `additionalProperties: false`, confirmed empirically: `POST .../events`
 * 400 `malformed_request`, `details.hidden: "is not an accepted field"`),
 * silently breaking D39's whole opt-in feature since it was implemented.
 */
export const EventDetailsSchema = Obj({
  alsoOffTask: Type.Optional(Type.Boolean()),
  reason: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 100 }), Type.Null()])),
  hidden: Type.Optional(Type.Boolean()),
})
export type EventDetailsValue = Static<typeof EventDetailsSchema>

/**
 * D26: `resolution` is optional on the wire — an absent resolution means the
 * gap is unresolved, and a `clock_gap` event in that state re-opens the
 * prompt on reload. `gapSeconds` is ALSO optional here at the wire-shape
 * level (task 5.3.1): whether a `clock_gap` event must actually carry one is
 * a domain rule enforced by the events route (`apps/api/src/services/
 * sessionEvents.ts`, `sessionEvents.test.ts`'s "clock_gap without
 * details.gapSeconds -> 422"), the same way `EventDetailsSchema.alsoOffTask`
 * stays schema-optional while `agent_check` requires it as a domain 422 —
 * both are "this specific event type needs this specific companion field"
 * rules, never a JSON-shape rule, and a missing one names the offending
 * `clientEventId` in `fieldErrors` rather than failing generically.
 */
export const ClockGapDetailsSchema = Obj({
  gapSeconds: Type.Optional(Type.Integer({ minimum: 0 })),
  resolution: Type.Optional(ClockGapResolutionSchema),
})
export type ClockGapDetailsValue = Static<typeof ClockGapDetailsSchema>

/**
 * Every `SessionEventType` a CLIENT may submit in a batch except `clock_gap`,
 * which carries its own details shape below. `pause` and `resume` are
 * deliberately excluded (task 5.3.1): those two lifecycle rows are written
 * only by the transitions route (5.4.2), so a client-submitted `pause`/
 * `resume` fails this union outright — 400 `malformed_request` from the
 * contract itself, never a domain check. `SessionEventTypeSchema`
 * (`common.ts`, `Lit(SESSION_EVENT_TYPES)`) is the full six-member set used
 * to read one BACK (`EventResponse.type`), where a stored `pause`/`resume`
 * row is exactly as legitimate to serialize as any other type.
 */
const NON_CLOCK_GAP_EVENT_TYPES = [
  'off_task',
  'external',
  'agent_check',
  'visibility',
] as const

/**
 * One event in a batch. A `clock_gap` event is required to carry
 * `ClockGapDetailsSchema` (`gapSeconds`, optional `resolution`); every other
 * event type carries the general, optional `EventDetailsSchema`
 * (`alsoOffTask` for `agent_check`, `reason` for `pause` — D29).
 */
export const EventInput = Type.Union([
  Obj({
    clientEventId: UuidSchema,
    type: Lit(NON_CLOCK_GAP_EVENT_TYPES),
    elapsedMs: Type.Integer({ minimum: 0 }),
    occurredAt: IsoTimestampSchema,
    details: Type.Optional(EventDetailsSchema),
  }),
  Obj({
    clientEventId: UuidSchema,
    type: Type.Literal('clock_gap'),
    elapsedMs: Type.Integer({ minimum: 0 }),
    occurredAt: IsoTimestampSchema,
    details: ClockGapDetailsSchema,
  }),
])
export type EventInputValue = Static<typeof EventInput>

export const EventsBatchBody = Obj({
  events: Type.Array(EventInput, { minItems: 1, maxItems: 100 }),
})
export type EventsBatchBodyValue = Static<typeof EventsBatchBody>

export const EventsBatchResponse = Obj({
  accepted: Type.Array(UuidSchema),
  duplicates: Type.Array(UuidSchema),
  reconciliationWarning: Type.Optional(Type.String()),
})
export type EventsBatchResponseValue = Static<typeof EventsBatchResponse>

/**
 * The two request-side `details` shapes, widened with one RESPONSE-only field
 * (task 5.3.1, D21): `reconciliation_warning: true` is stamped by the server
 * onto a late event's stored `details` (a batch posted after the session was
 * already `finalized`/`abandoned`) — never a client input, so it is added
 * only here, never to `EventDetailsSchema`/`ClockGapDetailsSchema` themselves
 * (a client-submitted `details.reconciliation_warning` on `POST
 * .../events` still fails `additionalProperties: false` there, 400
 * `malformed_request`, exactly as before this widening).
 */
const EventDetailsResponseSchema = Obj({
  alsoOffTask: Type.Optional(Type.Boolean()),
  reason: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 100 }), Type.Null()])),
  hidden: Type.Optional(Type.Boolean()),
  reconciliation_warning: Type.Optional(Type.Literal(true)),
})
const ClockGapDetailsResponseSchema = Obj({
  gapSeconds: Type.Optional(Type.Integer({ minimum: 0 })),
  resolution: Type.Optional(ClockGapResolutionSchema),
  reconciliation_warning: Type.Optional(Type.Literal(true)),
})

/**
 * `details` is never `null` on the wire — a stored row with no submitted
 * details round-trips as `{}` (a valid `EventDetailsResponseSchema`),
 * matching the `session_events.details jsonb` column, which (unlike
 * `elapsed_ms` and `voided_at`) carries no `NULL` branch in the database
 * model.
 */
export const EventResponse = Obj({
  id: UuidSchema,
  clientEventId: UuidSchema,
  type: SessionEventTypeSchema,
  elapsedMs: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  occurredAt: IsoTimestampSchema,
  receivedAt: IsoTimestampSchema,
  details: Type.Union([EventDetailsResponseSchema, ClockGapDetailsResponseSchema]),
  voidedAt: Type.Union([IsoTimestampSchema, Type.Null()]),
})
export type EventResponseValue = Static<typeof EventResponse>

// ---------------------------------------------------------------------------
// Transitions, clock-gap resolution, agent plan
// ---------------------------------------------------------------------------

/**
 * D29: `reason` is stored only on a `pause` transition (as
 * `details.reason`); it is accepted and silently ignored for `end` and
 * `abandon` (schema-legal for every `TransitionType`, since the domain rule
 * about which types keep it lives in the service, not here).
 */
export const TransitionBody = Obj({
  expectedVersion: Type.Integer({ minimum: 1 }),
  type: TransitionTypeSchema,
  reason: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
})
export type TransitionBodyValue = Static<typeof TransitionBody>

/** `resolution` is required here (unlike the in-event `ClockGapDetailsSchema`): this call IS the resolution. */
export const ClockGapBody = Obj({
  gapSeconds: Type.Integer({ minimum: 0 }),
  resolution: ClockGapResolutionSchema,
})
export type ClockGapBodyValue = Static<typeof ClockGapBody>

export const AgentPlanBody = Obj({
  // `minimum: 0`, not 1 (unlike `TransitionBody`/`PatchProgramBody`): unlike
  // every other `expectedVersion` field, `agent_plans` has no row until the
  // first PUT creates it (5.1.3/agentPlans.ts's own comment: "created
  // lazily by the first PUT rather than at session start"). `expectedVersion:
  // 0` is what that first write sends — the same "0 means create" contract
  // `PutDayBody` (contracts/days.ts) already establishes for its own
  // lazily-created row.
  expectedVersion: Type.Integer({ minimum: 0 }),
  workstream: Type.Optional(Type.String({ maxLength: 200 })),
  waitingTask: Type.Optional(Type.String({ maxLength: 200 })),
  reviewCheckpoint: Type.Optional(Type.Literal('end_of_block')),
  resumeNote: Type.Optional(Type.String({ maxLength: 500 })),
})
export type AgentPlanBodyValue = Static<typeof AgentPlanBody>

export const AgentPlanResponse = Obj({
  sessionId: UuidSchema,
  workstream: Type.Union([Type.String(), Type.Null()]),
  waitingTask: Type.Union([Type.String(), Type.Null()]),
  reviewCheckpoint: Type.Union([Type.Literal('end_of_block'), Type.Null()]),
  resumeNote: Type.Union([Type.String(), Type.Null()]),
  reviewAt: Type.Union([IsoTimestampSchema, Type.Null()]),
  version: Type.Integer({ minimum: 1 }),
})
export type AgentPlanResponseValue = Static<typeof AgentPlanResponse>

// ---------------------------------------------------------------------------
// Recall (D10, D27): the first of the two benchmark-review writes.
// ---------------------------------------------------------------------------

const RecallPointSchema = Type.String({ maxLength: 500 })

/** D27: `startedAt` is sent in server-aligned time; the API checks it against `ended_at`/`now`. */
export const RecallBody = Obj({
  points: Type.Tuple([
    RecallPointSchema,
    RecallPointSchema,
    RecallPointSchema,
    RecallPointSchema,
    RecallPointSchema,
  ]),
  startedAt: IsoTimestampSchema,
  durationSeconds: Type.Integer({ minimum: 0 }),
})
export type RecallBodyValue = Static<typeof RecallBody>

const RecallScoreEntrySchema = Type.Union([Type.Literal(0), Type.Literal(1), Type.Null()])
const RecallScoreTuple = Type.Tuple([
  RecallScoreEntrySchema,
  RecallScoreEntrySchema,
  RecallScoreEntrySchema,
  RecallScoreEntrySchema,
  RecallScoreEntrySchema,
])

/**
 * Response-only (task 5.8.3 fix): `Type.Integer({ minimum: 0, maximum: 1 })`
 * rather than `Type.Union([Type.Literal(0), Type.Literal(1)])`. Both accept
 * exactly the same two values on the wire, but `fast-json-stringify` 7.0.1
 * cannot serialize a tuple item schema built from an `anyOf` of numeric
 * `const`s — every response carrying a real (non-null, `scoreRecall`-
 * produced) `recallScores` array crashed with "Item at 0 does not match
 * schema definition." regardless of which entries were 0 or 1, a latent bug
 * only 5.8.3 ever exercises (recall lock itself never scores; only finalize
 * does). A plain ranged integer has no such `anyOf` and serializes fine.
 */
const LockedRecallScoreEntrySchema = Type.Integer({ minimum: 0, maximum: 1 })
const LockedRecallScoreTuple = Type.Tuple([
  LockedRecallScoreEntrySchema,
  LockedRecallScoreEntrySchema,
  LockedRecallScoreEntrySchema,
  LockedRecallScoreEntrySchema,
  LockedRecallScoreEntrySchema,
])

// ---------------------------------------------------------------------------
// Review input (D10, D31) and finalize (D21): the second benchmark-review
// write, and practice's only review write.
// ---------------------------------------------------------------------------

/**
 * What the CLIENT may submit at finalize. Deliberately excludes `eligible`,
 * `exclusionReasons`, `recallScore`, `points` (and `realm`) — every one of
 * those is server-derived or locked by the separate `recall` write, never a
 * client input (D4, D10).
 */
export const ReviewInputSchema = Obj({
  episodeCount: Type.Optional(ReportedCountSchema),
  countMethod: Type.Optional(CountMethodSchema),
  firstSwitchEstimateSeconds: Type.Optional(
    Type.Integer({ minimum: 1, maximum: FIRST_SWITCH_CAP_SECONDS - 1 }),
  ),
  externalCount: Type.Optional(ReportedCountSchema),
  unplannedAgentChecks: Type.Optional(ReportedCountSchema),
  mindWanderingCount: Type.Optional(ReportedCountSchema),
  outputQuality: Type.Optional(OutputQualitySchema),
  outputNote: Type.Optional(Type.String({ maxLength: 200 })),
  reviewNote: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
  materiallyDisrupted: Type.Optional(Type.Boolean()),
  disruptionNote: Type.Optional(Type.String({ maxLength: 2000 })),
  recallScores: Type.Optional(RecallScoreTuple),
  conditions: Type.Optional(ObservedConditionsSchema),
})
export type ReviewInputValue = Static<typeof ReviewInputSchema>

/** D21: `expectedEventCount` is every stored `session_events` row, voided rows included. */
export const FinalizeBody = Obj({
  expectedEventCount: Type.Integer({ minimum: 0 }),
  lastBatch: Type.Optional(EventsBatchBody),
  review: ReviewInputSchema,
})
export type FinalizeBodyValue = Static<typeof FinalizeBody>

// ---------------------------------------------------------------------------
// FirstSwitch on the wire: only `known` carries `seconds`.
// ---------------------------------------------------------------------------

export const FirstSwitchSchema = Type.Union([
  Obj({ kind: Type.Literal('none_capped') }),
  Obj({
    kind: Type.Literal('known'),
    seconds: Type.Integer({ minimum: 0, maximum: FIRST_SWITCH_CAP_SECONDS - 1 }),
  }),
  Obj({ kind: Type.Literal('unknown') }),
])
export type FirstSwitchValue = Static<typeof FirstSwitchSchema>

// ---------------------------------------------------------------------------
// ReviewResponse: every count nullable, never 0 for blank (D7.1).
// ---------------------------------------------------------------------------

export const ReviewResponse = Obj({
  sessionId: UuidSchema,
  episodeCount: ReportedCountSchema,
  countMethod: Type.Union([CountMethodSchema, Type.Null()]),
  firstSwitch: Type.Union([FirstSwitchSchema, Type.Null()]),
  firstSwitchMethod: Type.Union([FirstSwitchMethodSchema, Type.Null()]),
  externalCount: ReportedCountSchema,
  unplannedAgentChecks: ReportedCountSchema,
  mindWanderingCount: ReportedCountSchema,
  outputQuality: Type.Union([OutputQualitySchema, Type.Null()]),
  outputNote: Type.Union([Type.String(), Type.Null()]),
  reviewNote: Type.Union([Type.String(), Type.Null()]),
  materiallyDisrupted: Type.Union([Type.Boolean(), Type.Null()]),
  disruptionNote: Type.Union([Type.String(), Type.Null()]),
  recallPoints: Type.Union([
    Type.Tuple([
      RecallPointSchema,
      RecallPointSchema,
      RecallPointSchema,
      RecallPointSchema,
      RecallPointSchema,
    ]),
    Type.Null(),
  ]),
  recallStartedAt: Type.Union([IsoTimestampSchema, Type.Null()]),
  recallLockedAt: Type.Union([IsoTimestampSchema, Type.Null()]),
  recallDelaySeconds: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  recallDurationSeconds: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  recallFlags: Type.Array(RecallFlagSchema),
  recallScores: Type.Union([LockedRecallScoreTuple, Type.Null()]),
  recallScore: ReportedCountSchema,
  conditions: ObservedConditionsSchema,
  finalizedAt: Type.Union([IsoTimestampSchema, Type.Null()]),
  version: Type.Integer({ minimum: 1 }),
})
export type ReviewResponseValue = Static<typeof ReviewResponse>

// ---------------------------------------------------------------------------
// Amendments (D32): append-only; never rewrite stored eligibility.
// ---------------------------------------------------------------------------

export const AmendmentBody = Obj({
  reason: Type.String({ minLength: 1, maxLength: 2000 }),
  excludeFromReport: Type.Boolean(),
})
export type AmendmentBodyValue = Static<typeof AmendmentBody>

export const AmendmentResponse = Obj({
  id: UuidSchema,
  sessionId: UuidSchema,
  reason: Type.String(),
  excludeFromReport: Type.Boolean(),
  createdAt: IsoTimestampSchema,
})
export type AmendmentResponseValue = Static<typeof AmendmentResponse>

// ---------------------------------------------------------------------------
// SessionResponse (D20): the one shape POST /sessions, GET /sessions/active,
// GET /sessions/{id}, transitions, clock-gap and finalize all return. Never
// carries a userId.
// ---------------------------------------------------------------------------

export const SessionResponse = Obj({
  id: UuidSchema,
  programId: UuidSchema,
  slotId: Type.Union([UuidSchema, Type.Null()]),
  revisionId: UuidSchema,
  realm: RealmSchema,
  kind: SessionKindSchema,
  lifecycle: SessionLifecycleSchema,
  targetSeconds: Type.Integer({ minimum: 0 }),
  startedAt: IsoTimestampSchema,
  endedAt: Type.Union([IsoTimestampSchema, Type.Null()]),
  pausedSeconds: Type.Integer({ minimum: 0 }),
  currentPauseStartedAt: Type.Union([IsoTimestampSchema, Type.Null()]),
  localDate: LocalDateSchema,
  intendedOutput: Type.Union([Type.String(), Type.Null()]),
  timeSource: TimeSourceSchema,
  timerQuality: TimerQualitySchema,
  clockGapSeconds: ReportedCountSchema,
  completeInterval: Type.Union([Type.Boolean(), Type.Null()]),
  eligible: Type.Union([Type.Boolean(), Type.Null()]),
  exclusionReasons: Type.Array(ExclusionReasonSchema),
  replacementReason: Type.Union([Type.String(), Type.Null()]),
  version: Type.Integer({ minimum: 1 }),
  serverNow: IsoTimestampSchema,
  timing: Obj({
    elapsedSeconds: Type.Integer({ minimum: 0 }),
    remainingSeconds: Type.Integer(),
    deadlineReached: Type.Boolean(),
    isPaused: Type.Boolean(),
  }),
  /** No combined/total field (D11): offTask and agentChecks overlap by design. */
  tallies: Obj({
    offTask: Type.Integer({ minimum: 0 }),
    external: Type.Integer({ minimum: 0 }),
    agentChecks: Type.Integer({ minimum: 0 }),
  }),
  eventCount: Type.Integer({ minimum: 0 }),
  events: Type.Array(EventResponse),
  /** D31: this row exists from session start; never absent, never null. */
  review: ReviewResponse,
  agentPlan: Type.Union([AgentPlanResponse, Type.Null()]),
  amendments: Type.Array(AmendmentResponse),
})
export type SessionResponseValue = Static<typeof SessionResponse>

export const FinalizeResponse = Obj({
  session: SessionResponse,
  review: ReviewResponse,
  eligible: Type.Union([Type.Boolean(), Type.Null()]),
  exclusionReasons: Type.Array(ExclusionReasonSchema),
})
export type FinalizeResponseValue = Static<typeof FinalizeResponse>

// ---------------------------------------------------------------------------
// Route params
// ---------------------------------------------------------------------------

export const SessionIdParams = Obj({ id: UuidSchema })
export type SessionIdParamsValue = Static<typeof SessionIdParams>

export const EventIdParams = Obj({ id: UuidSchema, clientEventId: UuidSchema })
export type EventIdParamsValue = Static<typeof EventIdParams>
