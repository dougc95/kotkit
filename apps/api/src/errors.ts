/**
 * Error classes, the D18 envelope builder (`toEnvelope`), the AJV
 * field-error mapper and the log sanitizer — the vocabulary
 * `plugins/errors.ts` turns into HTTP responses and log lines. Every piece
 * here is a pure function or a plain `Error` subclass, deliberately kept
 * free of Fastify so it is unit-testable without building an app.
 *
 * See design.md D18 (envelope shape) and D19 (the error-code vocabulary and
 * its HTTP status mapping) and identity-realm "Private data is never
 * written to logs or stored insecurely".
 */
import { REALM_MISMATCH_MESSAGE, RealmMixingError, type ErrorCode } from '@attention-lab/shared'

// ---------------------------------------------------------------------------
// D19 code groupings
// ---------------------------------------------------------------------------

/** The 409 slice of the D19 vocabulary, in the same order as shared's ERROR_CODES. */
export const CONFLICT_CODES = [
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
] as const satisfies readonly ErrorCode[]
export type ConflictCode = (typeof CONFLICT_CODES)[number]

/** The 422 slice of the D19 vocabulary, in the same order as shared's ERROR_CODES. */
export const DOMAIN_CODES = [
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
] as const satisfies readonly ErrorCode[]
export type DomainCode = (typeof DOMAIN_CODES)[number]

// ---------------------------------------------------------------------------
// AppError and its constructors
// ---------------------------------------------------------------------------

export interface AppErrorOptions {
  fieldErrors?: Record<string, string>
  details?: Record<string, unknown>
  retryable?: boolean
}

/** `retryable` default per D19: true for 429, 5xx and 'event_count_mismatch'; false otherwise. */
function defaultRetryable(status: number, code: ErrorCode): boolean {
  if (status === 429) return true
  if (status >= 500) return true
  if (code === 'event_count_mismatch') return true
  return false
}

/** The base of every domain-thrown HTTP error. */
export class AppError extends Error {
  readonly status: number
  readonly code: ErrorCode
  readonly fieldErrors?: Record<string, string>
  readonly details?: Record<string, unknown>
  readonly retryable: boolean

  constructor(status: number, code: ErrorCode, message: string, opts: AppErrorOptions = {}) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.code = code
    if (opts.fieldErrors !== undefined) this.fieldErrors = opts.fieldErrors
    if (opts.details !== undefined) this.details = opts.details
    this.retryable = opts.retryable ?? defaultRetryable(status, code)
  }
}

/** 400 malformed_request. */
export class MalformedError extends AppError {
  constructor(message: string, fieldErrors?: Record<string, string>) {
    super(400, 'malformed_request', message, fieldErrors !== undefined ? { fieldErrors } : {})
    this.name = 'MalformedError'
  }
}

/**
 * 404 not_found, always the same fixed message — used for a genuinely
 * missing resource AND one that exists but belongs to a different
 * principal, so the two are indistinguishable from the response
 * (identity-realm "Every resource is scoped to its owner": existence is
 * never disclosed, and this is never a 403).
 */
export class NotFoundError extends AppError {
  constructor() {
    super(404, 'not_found', 'Not found')
    this.name = 'NotFoundError'
  }
}

/** 409, one of the D19 conflict codes. */
export class ConflictError extends AppError {
  constructor(code: ConflictCode, message: string, opts: AppErrorOptions = {}) {
    super(409, code, message, opts)
    this.name = 'ConflictError'
  }
}

/** 422, one of the D19 domain codes. */
export class DomainError extends AppError {
  constructor(code: DomainCode, message: string, opts: AppErrorOptions = {}) {
    super(422, code, message, opts)
    this.name = 'DomainError'
  }
}

/**
 * 429 write_limit. The code is reserved (D19) — no limiter is implemented in
 * this change and no route throws this; the class exists only so the code
 * is exercisable and typed end to end.
 */
export class WriteLimitError extends AppError {
  constructor() {
    super(429, 'write_limit', 'Too many write requests. Please wait before retrying.')
    this.name = 'WriteLimitError'
  }
}

// ---------------------------------------------------------------------------
// Envelope (D18)
// ---------------------------------------------------------------------------

/**
 * The wire shape of the D18 envelope minus `requestId`: `toEnvelope` never
 * knows the current request, only the error, so the plugin (the one place
 * that has both) stamps `requestId` on afterward.
 */
export interface ErrorEnvelopeBody {
  code: string
  message: string
  fieldErrors?: Record<string, string>
  details?: Record<string, unknown>
  retryable: boolean
}

export interface ToEnvelopeResult {
  status: number
  body: ErrorEnvelopeBody
}

/**
 * Pure error -> envelope mapping, unit-testable without Fastify: an
 * `AppError` keeps its own status/code/message/fieldErrors/details/
 * retryable; a `RealmMixingError` (thrown by `assertSameRealm` in
 * packages/shared, whose own `.message` names the two realms) is always
 * flattened to the fixed, realm-blind `REALM_MISMATCH_MESSAGE` — the realm
 * values are never echoed to the client; anything else is an unexpected
 * 500 with a generic message.
 */
export function toEnvelope(err: unknown): ToEnvelopeResult {
  if (err instanceof AppError) {
    return {
      status: err.status,
      body: {
        code: err.code,
        message: err.message,
        retryable: err.retryable,
        ...(err.fieldErrors !== undefined ? { fieldErrors: err.fieldErrors } : {}),
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    }
  }

  if (err instanceof RealmMixingError) {
    return {
      status: 422,
      body: {
        code: 'realm_mismatch',
        message: REALM_MISMATCH_MESSAGE,
        retryable: false,
      },
    }
  }

  return {
    status: 500,
    body: {
      code: 'internal_error',
      message: 'Something went wrong. Please try again.',
      retryable: true,
    },
  }
}

// ---------------------------------------------------------------------------
// AJV validation -> fieldErrors
// ---------------------------------------------------------------------------

/** The subset of an AJV error object this mapper reads. */
export interface AjvErrorLike {
  keyword: string
  instancePath: string
  params?: Record<string, unknown>
  message?: string
}

function dottedPath(instancePath: string): string {
  return instancePath
    .split('/')
    .filter((segment) => segment.length > 0)
    .join('.')
}

/**
 * `required` and `additionalProperties` errors put the offending property
 * name in `params`, not in `instancePath` (which points at the *containing*
 * object — `''` for the request body root), so those two keywords append
 * the field name onto the dotted path themselves; every other keyword's
 * `instancePath` already names the failing field directly.
 */
function fieldKeyFor(error: AjvErrorLike): string {
  const base = dottedPath(error.instancePath)

  if (error.keyword === 'required') {
    const missing = typeof error.params?.missingProperty === 'string' ? error.params.missingProperty : ''
    if (!missing) return base
    return base ? `${base}.${missing}` : missing
  }

  if (error.keyword === 'additionalProperties') {
    const extra = typeof error.params?.additionalProperty === 'string' ? error.params.additionalProperty : ''
    if (!extra) return base
    return base ? `${base}.${extra}` : extra
  }

  return base
}

/** A fixed, AJV-keyword-derived plain word — never AJV's own rendered `message` and never a submitted value. */
function fieldMessageFor(error: AjvErrorLike): string {
  switch (error.keyword) {
    case 'required':
      return 'is required'
    case 'additionalProperties':
      return 'is not an accepted field'
    case 'type': {
      const expected = typeof error.params?.type === 'string' ? error.params.type : undefined
      return expected ? `must be ${expected}` : 'has an invalid type'
    }
    case 'pattern':
    case 'format':
      return 'has an invalid format'
    case 'minimum':
    case 'exclusiveMinimum':
    case 'maximum':
    case 'exclusiveMaximum':
      return 'is out of range'
    case 'enum':
      return 'is not an accepted value'
    default:
      return 'is invalid'
  }
}

/**
 * Maps a Fastify/AJV `error.validation` array to `{ dottedPath: message }`
 * — e.g. a type failure at `/review/episodeCount` becomes key
 * `'review.episodeCount'`. Every message is a fixed plain word; none of them
 * — and no key — is ever built from the submitted value.
 */
export function fieldErrorsFromValidation(errors: readonly AjvErrorLike[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const error of errors) {
    const key = fieldKeyFor(error)
    if (!key) continue
    result[key] = fieldMessageFor(error)
  }
  return result
}

// ---------------------------------------------------------------------------
// Log sanitizer
// ---------------------------------------------------------------------------

export interface SanitizedError {
  name: string
  sqlstate?: string
  stackTop: string
}

function extractSqlstate(err: unknown): string | undefined {
  if (err !== null && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code
    // Postgres SQLSTATE codes are exactly 5 alphanumeric characters (e.g.
    // '23514'); this rules out unrelated `.code` values some errors carry
    // (Node's 'ENOENT', etc.) without needing a driver-specific import.
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code
  }
  // Drizzle wraps every driver error in its own `DrizzleQueryError`, whose
  // top-level `.code` is undefined and whose `.message` embeds the raw query
  // params (which is exactly the private free text this function exists to
  // keep out of the log) — the real `postgres-js` `PostgresError`, with its
  // own `.code`, lives one level down as `.cause`. Unwrapping it here (rather
  // than reading `.message`) is what lets the log line carry a genuine
  // SQLSTATE without ever touching that params text.
  if (err instanceof Error && err.cause !== undefined) {
    return extractSqlstate(err.cause)
  }
  return undefined
}

/**
 * `err.stack` always starts with `"<Name>: <message>"`, but that header can
 * itself span more than one line — Drizzle's own `DrizzleQueryError` embeds
 * the raw query params on a line of their own right under the "Failed
 * query: ..." line, which is exactly the private free text (a note, a recall
 * point) this module exists to keep out of the log. So this never trusts a
 * fixed line index; it scans for the first line that actually looks like a
 * stack frame (`"at ..."`) and returns nothing rather than a message
 * fragment when no such line exists.
 */
function firstStackFrame(stack: string): string {
  const lines = stack.split('\n')
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.trim()
    if (line !== undefined && /^at\s/.test(line)) return line
  }
  return ''
}

/**
 * The ONLY shape this codebase ever logs an error as: the constructor name,
 * a Postgres SQLSTATE if the error carries one, and the first genuine stack
 * FRAME — never `.message`, `.detail`, `.hint`, `.where` or `.query`, since
 * a postgres-js constraint-violation error's `detail` echoes the failing
 * row's values verbatim, which can be a private note (identity-realm
 * "Private data is never written to logs or stored insecurely").
 */
export function sanitizeErrorForLog(err: unknown): SanitizedError {
  const name = err instanceof Error ? err.name : Object.prototype.toString.call(err)

  const stackTop = err instanceof Error && typeof err.stack === 'string' ? firstStackFrame(err.stack) : ''

  const sqlstate = extractSqlstate(err)
  return sqlstate !== undefined ? { name, sqlstate, stackTop } : { name, stackTop }
}
