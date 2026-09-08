/**
 * The client-side error hierarchy for `src/lib/api/client.ts` (task 7.4.1;
 * design.md D18, D19). Every non-2xx response from the API becomes exactly
 * one of the subclasses below, built from the D18 error envelope
 * `{ code, message, fieldErrors?, details?, retryable, requestId }`:
 *
 *  - 400/422 -> `ValidationError` (keeps `fieldErrors`)
 *  - 404     -> `NotFoundError`
 *  - 409     -> `ConflictError` (keeps the full parsed body, `details`
 *               included — e.g. `{ activeSessionId }` for
 *               `active_session_exists`, `{ expected, stored }` for
 *               `event_count_mismatch`, per D18)
 *  - 429     -> `RateLimitError`
 *  - >= 500, or a body that does not parse as the D18 envelope shape at all
 *              -> `ServerError` (`retryable` taken from the body when it
 *              parsed; defaults to `true` when it did not)
 *  - a fetch rejection or a client-side timeout -> `NetworkError`
 *    (`retryable: true`), built directly by `client.ts` rather than by
 *    `mapApiError` below, since there is no HTTP response to map.
 *
 * `requestId` is carried on every instance for diagnostics only and is
 * never interpolated into `message` (app-shell: "Implementation details are
 * not user-facing" — a request id is exactly such a detail).
 */

/** The D18 error envelope shape, as sent by the API on any non-2xx response. */
export interface ApiErrorEnvelope {
  code: string
  message: string
  fieldErrors?: Record<string, string>
  details?: Record<string, unknown>
  retryable: boolean
  requestId: string
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly retryable: boolean
  readonly requestId: string
  readonly fieldErrors?: Record<string, string>
  readonly details?: Record<string, unknown>

  constructor(status: number, envelope: ApiErrorEnvelope) {
    super(envelope.message)
    this.name = new.target.name
    this.status = status
    this.code = envelope.code
    this.retryable = envelope.retryable
    this.requestId = envelope.requestId
    if (envelope.fieldErrors !== undefined) {
      this.fieldErrors = envelope.fieldErrors
    }
    if (envelope.details !== undefined) {
      this.details = envelope.details
    }
  }
}

/** 400 `malformed_request` and every 422 domain-inconsistency code (D19). */
export class ValidationError extends ApiError {}

/** 404 `not_found` — missing or not owned by the acting principal. */
export class NotFoundError extends ApiError {}

/** Every 409 conflict code (stale version, active session, frozen slot, ...). */
export class ConflictError extends ApiError {}

/** 429 `write_limit`. Reserved: no route in this change actually returns it. */
export class RateLimitError extends ApiError {}

/** Any status >= 500, or a non-2xx response whose body is not a D18 envelope. */
export class ServerError extends ApiError {}

/**
 * A fetch rejection (offline, DNS failure, ...) or the client-side
 * `AbortSignal.timeout` firing. There is no HTTP status and no server-issued
 * `requestId` in this case, so `status` is `0` and `requestId` is `''` —
 * never fabricated.
 */
export class NetworkError extends ApiError {
  constructor(message: string, cause?: unknown) {
    super(0, { code: 'network_error', message, retryable: true, requestId: '' })
    if (cause !== undefined) {
      this.cause = cause
    }
  }
}

function isApiErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as Record<string, unknown>
  return (
    typeof record.code === 'string' &&
    typeof record.message === 'string' &&
    typeof record.retryable === 'boolean' &&
    typeof record.requestId === 'string'
  )
}

/**
 * Maps an HTTP status and a parsed response body to the right `ApiError`
 * subclass (D19's status grouping). Pass `rawBody: null` when the response
 * body could not be parsed as JSON at all — that case, like any status >=
 * 500, always becomes `ServerError` with `retryable: true`, since there is
 * no trustworthy envelope to read a narrower `retryable` from.
 */
export function mapApiError(status: number, rawBody: unknown): ApiError {
  if (!isApiErrorEnvelope(rawBody)) {
    return new ServerError(status, {
      code: 'server_error',
      message: `Request failed with status ${status}.`,
      retryable: true,
      requestId: '',
    })
  }

  if (status >= 500) {
    return new ServerError(status, rawBody)
  }
  if (status === 400 || status === 422) {
    return new ValidationError(status, rawBody)
  }
  if (status === 404) {
    return new NotFoundError(status, rawBody)
  }
  if (status === 409) {
    return new ConflictError(status, rawBody)
  }
  if (status === 429) {
    return new RateLimitError(status, rawBody)
  }

  // No other status appears in the D19 vocabulary; treat defensively as a
  // server error rather than silently mis-typing it as one of the above.
  return new ServerError(status, rawBody)
}
