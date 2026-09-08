/**
 * Contract primitives shared by every route-group schema file, plus the
 * error envelope and the D19 error-code vocabulary.
 *
 * Two rules hold across this whole directory:
 *  - Every request/response object is built with `Obj(...)`, which always
 *    forces `additionalProperties: false` (D22: "AJV is configured
 *    `coerceTypes: false, removeAdditional: false, useDefaults: false` so
 *    `null` is never coerced to 0 and unknown keys are 400"). A schema that
 *    genuinely needs to accept arbitrary keys (headers; the error envelope's
 *    `details`) says so with a bare `Type.Object(...)`, never with `Obj`.
 *  - Every literal union that already has a domain source of truth (the
 *    `as const` arrays in `domain/types.ts`, added by 2.7.1) is turned into
 *    a wire schema with `Lit(...)`, never retyped by hand here. That is what
 *    keeps a contract literal from drifting away from the domain literal it
 *    describes.
 *
 * See design.md D18 (error envelope shape) and D19 (the error-code
 * vocabulary and its HTTP status mapping).
 */
import { Type, type ObjectOptions, type Static, type TLiteral, type TObject, type TProperties, type TUnion } from '@sinclair/typebox'

import {
  ACCOMMODATIONS,
  BENCHMARK_PHASES,
  BLOCK_STATUSES,
  CHECKIN_FIELDS,
  CHECKIN_STATUSES,
  CLOCK_GAP_RESOLUTIONS,
  COUNT_METHODS,
  EXCLUSION_REASONS,
  FEED_DEVICES,
  FEED_SOURCES,
  FIRST_SWITCH_KINDS,
  FIRST_SWITCH_METHODS,
  IDENTITY_MODES,
  MEASUREMENT_SCOPES,
  OUTPUT_QUALITIES,
  PROGRAM_STATUSES,
  REALMS,
  RECALL_FLAGS,
  RESULT_STATES,
  SESSION_EVENT_TYPES,
  SESSION_KINDS,
  SESSION_LIFECYCLES,
  SLOT_LABELS,
  TIME_SOURCES,
  TIMER_QUALITIES,
  TRANSITION_TYPES,
} from '../domain/types.js'

// ---------------------------------------------------------------------------
// Object and literal-union primitives
// ---------------------------------------------------------------------------

/**
 * `Type.Object` with `additionalProperties` always forced to `false`,
 * whatever `options` says. This is the one constructor every request body
 * and response payload in `contracts/*` is built with, so an unrecognized
 * key is a 400 (`malformed_request`) rather than a value that is silently
 * dropped or silently accepted.
 */
export function Obj<T extends TProperties>(properties: T, options: ObjectOptions = {}): TObject<T> {
  return Type.Object(properties, { ...options, additionalProperties: false })
}

/**
 * A `Type.Union` of `Type.Literal`s built directly from a domain `as const`
 * array (e.g. `EXCLUSION_REASONS`), so the wire schema and the domain union
 * type can never drift apart — there is exactly one place that lists the
 * members.
 */
export function Lit<T extends readonly string[]>(values: T): TUnion<TLiteral<T[number]>[]> {
  return Type.Union(values.map((value) => Type.Literal(value))) as TUnion<TLiteral<T[number]>[]>
}

// ---------------------------------------------------------------------------
// Primitive value schemas
// ---------------------------------------------------------------------------

/**
 * The wire form of `ReportedCount`: a non-negative integer, or `null` for
 * "not reported". `null` is a valid member on purpose — see
 * `domain/types.ts` on why an unreported count is never coalesced to 0.
 */
export const ReportedCountSchema = Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])
export type ReportedCountValue = Static<typeof ReportedCountSchema>

/** `LocalDate` (`YYYY-MM-DD`), matching `domain/calendar.ts`'s `LocalDate`. */
export const LocalDateSchema = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })
export type LocalDateValue = Static<typeof LocalDateSchema>

/**
 * A RFC 4122 UUID. Deliberately a `pattern`, not `format: 'uuid'`: TypeBox's
 * own `Value.Check` (used by the shared package's unit tests) does not
 * validate unregistered `format` keywords — it treats every string as
 * failing them — so a `format`-only schema would silently accept nothing in
 * this package's own tests while behaving differently again under whatever
 * validator the API wires up. A `pattern` behaves identically everywhere.
 */
export const UuidSchema = Type.String({
  pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
})
export type UuidValue = Static<typeof UuidSchema>

/** An ISO-8601 timestamp with an explicit offset or `Z`. */
export const IsoTimestampSchema = Type.String({
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})$',
})
export type IsoTimestampValue = Static<typeof IsoTimestampSchema>

/**
 * The `Idempotency-Key` header shape for idempotent mutations (POST
 * `/programs`, `/sessions`, `/sessions/{id}/recall`,
 * `/sessions/{id}/finalize`). Headers legitimately carry other keys (host,
 * content-type, ...), so this is a bare `Type.Object`, not `Obj`.
 */
export const IdempotencyKeyHeader = Type.Object(
  { 'idempotency-key': UuidSchema },
  { additionalProperties: true },
)
export type IdempotencyKeyHeaderValue = Static<typeof IdempotencyKeyHeader>

// ---------------------------------------------------------------------------
// Error vocabulary (D19) and envelope (D18)
// ---------------------------------------------------------------------------

/**
 * The full D19 error-code vocabulary, grouped by HTTP status below in the
 * same order: 400 (1), 404 (1), 409 (14), 422 (20), 429 (1) — 37 codes.
 */
export const ERROR_CODES = [
  // 400
  'malformed_request',
  // 404
  'not_found',
  // 409
  'program_exists',
  'active_session_exists',
  'idempotency_mismatch',
  'stale_version',
  'slot_frozen',
  'event_count_mismatch',
  'already_finalized',
  'session_not_active',
  'session_not_ended',
  'interval_not_ended',
  'recall_locked',
  'not_finalized',
  'invalid_status_transition',
  'program_terminal',
  // 422
  'realm_mismatch',
  'feed_subset_violation',
  'feed_platform_conflict',
  'duplicate_feed_row',
  'baseline_times_too_close',
  'readiness_regression',
  'before_slot_date',
  'slot_full',
  'replacement_reason_required',
  'eligible_attempt_not_retaken',
  'practice_only',
  'benchmark_only',
  'benchmark_only_field',
  'practice_only_field',
  'impossible_offset',
  'invalid_transition',
  'recall_before_interval_end',
  'recall_not_locked',
  'effective_day_in_past',
  'date_locked',
  // 429
  'write_limit',
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]

type ErrorStatus = 400 | 404 | 409 | 422 | 429

/** Every `ErrorCode`'s HTTP status, per the D19 grouping. */
export const ERROR_CODE_STATUS: Record<ErrorCode, ErrorStatus> = {
  malformed_request: 400,
  not_found: 404,
  program_exists: 409,
  active_session_exists: 409,
  idempotency_mismatch: 409,
  stale_version: 409,
  slot_frozen: 409,
  event_count_mismatch: 409,
  already_finalized: 409,
  session_not_active: 409,
  session_not_ended: 409,
  interval_not_ended: 409,
  recall_locked: 409,
  not_finalized: 409,
  invalid_status_transition: 409,
  program_terminal: 409,
  realm_mismatch: 422,
  feed_subset_violation: 422,
  feed_platform_conflict: 422,
  duplicate_feed_row: 422,
  baseline_times_too_close: 422,
  readiness_regression: 422,
  before_slot_date: 422,
  slot_full: 422,
  replacement_reason_required: 422,
  eligible_attempt_not_retaken: 422,
  practice_only: 422,
  benchmark_only: 422,
  benchmark_only_field: 422,
  practice_only_field: 422,
  impossible_offset: 422,
  invalid_transition: 422,
  recall_before_interval_end: 422,
  recall_not_locked: 422,
  effective_day_in_past: 422,
  date_locked: 422,
  write_limit: 429,
}

/**
 * The fixed message for `realm_mismatch` (D7.6 / D19): it never echoes the
 * realms involved, so a demo/pilot mixing attempt cannot leak which realm
 * held which record.
 */
export const REALM_MISMATCH_MESSAGE = 'Simulated and real results are never combined.'

/**
 * The one response shape every non-2xx route returns (D18). `details` is
 * deliberately the one open object in this whole barrel — a small
 * structured payload (`activeSessionId`, `expected`/`stored`, `current`,
 * `phase`/`label`, `existingProgramId`/`existingStatus`, ...) and never note
 * text; `fieldErrors` maps a field path to a short code, never a value echo.
 */
export const ErrorResponse = Obj({
  code: Lit(ERROR_CODES),
  message: Type.String(),
  fieldErrors: Type.Optional(Type.Record(Type.String(), Type.String())),
  details: Type.Optional(Type.Object({}, { additionalProperties: true })),
  retryable: Type.Boolean(),
  requestId: Type.String(),
})
export type ErrorResponseValue = Static<typeof ErrorResponse>

// ---------------------------------------------------------------------------
// Shared literal-union schemas, one per domain const array
// ---------------------------------------------------------------------------

/** Responses only — no request body accepts a caller-supplied realm. */
export const RealmSchema = Lit(REALMS)

export const BenchmarkPhaseSchema = Lit(BENCHMARK_PHASES)
export const SlotLabelSchema = Lit(SLOT_LABELS)
export const SessionKindSchema = Lit(SESSION_KINDS)
export const SessionLifecycleSchema = Lit(SESSION_LIFECYCLES)
export const ProgramStatusSchema = Lit(PROGRAM_STATUSES)
export const TimeSourceSchema = Lit(TIME_SOURCES)
export const TimerQualitySchema = Lit(TIMER_QUALITIES)
export const CountMethodSchema = Lit(COUNT_METHODS)
export const OutputQualitySchema = Lit(OUTPUT_QUALITIES)
export const ExclusionReasonSchema = Lit(EXCLUSION_REASONS)
export const FirstSwitchKindSchema = Lit(FIRST_SWITCH_KINDS)
export const FirstSwitchMethodSchema = Lit(FIRST_SWITCH_METHODS)
export const SessionEventTypeSchema = Lit(SESSION_EVENT_TYPES)
export const RecallFlagSchema = Lit(RECALL_FLAGS)
export const FeedDeviceSchema = Lit(FEED_DEVICES)
export const MeasurementScopeSchema = Lit(MEASUREMENT_SCOPES)
export const FeedSourceSchema = Lit(FEED_SOURCES)
export const CheckinStatusSchema = Lit(CHECKIN_STATUSES)
export const CheckinFieldSchema = Lit(CHECKIN_FIELDS)
export const ResultStateSchema = Lit(RESULT_STATES)
export const IdentityModeSchema = Lit(IDENTITY_MODES)
export const TransitionTypeSchema = Lit(TRANSITION_TYPES)
export const ClockGapResolutionSchema = Lit(CLOCK_GAP_RESOLUTIONS)
export const BlockStatusSchema = Lit(BLOCK_STATUSES)
export const AccommodationSchema = Lit(ACCOMMODATIONS)
