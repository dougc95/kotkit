import fp from 'fastify-plugin'
import {
  MalformedError,
  NotFoundError,
  fieldErrorsFromValidation,
  sanitizeErrorForLog,
  toEnvelope,
  type AjvErrorLike,
} from '../errors.js'

/**
 * Fastify (via its AJV type provider) attaches `.validation` to a schema
 * failure; every other thrown error lacks it. A structural check, not an
 * `instanceof`, since Fastify's own `FastifyError` and AJV's error objects
 * are plain-object shaped, not classes this file owns.
 */
function hasValidationErrors(error: unknown): error is { validation: AjvErrorLike[] } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'validation' in error &&
    Array.isArray((error as { validation?: unknown }).validation) &&
    (error as { validation: unknown[] }).validation.length > 0
  )
}

/**
 * The one place every thrown error becomes the D18 envelope
 * (`{ code, message, fieldErrors?, details?, retryable, requestId }`):
 *  - a schema-validation failure (`error.validation`) becomes 400
 *    `malformed_request` with `fieldErrors` built by `fieldErrorsFromValidation`;
 *  - an `AppError` subclass (errors.ts) keeps its own status/code/message;
 *  - a `RealmMixingError` (packages/shared's `assertSameRealm`) becomes 422
 *    `realm_mismatch` with the fixed, realm-blind message — `toEnvelope`
 *    handles both of the last two;
 *  - anything else is an unexpected 500, logged through
 *    `sanitizeErrorForLog` and never with the raw error.
 *
 * 4xx errors are logged at `info` with only `{ code, statusCode, route }` —
 * never the request body, query, headers, or the error's own message, which
 * can carry a private note (identity-realm "Private data is never written
 * to logs or stored insecurely"). `setNotFoundHandler` sends the identical
 * envelope shape for an unmatched route.
 *
 * Registered directly on the root instance in app.ts (design.md D16): a
 * handler set here still applies to routes registered later inside a
 * prefixed child scope (e.g. `/api/v1`), since a child context inherits its
 * parent's error/not-found handlers unless it sets its own.
 */
export default fp(
  async function errorsPlugin(app) {
    app.setErrorHandler((error, request, reply) => {
      const route = request.routeOptions?.url ?? null

      const mapped = hasValidationErrors(error)
        ? new MalformedError(
            'The request could not be validated.',
            fieldErrorsFromValidation(error.validation),
          )
        : error

      const { status, body } = toEnvelope(mapped)

      if (status >= 500) {
        request.log.error(
          { code: body.code, statusCode: status, route, err: sanitizeErrorForLog(mapped) },
          'request error',
        )
      } else {
        request.log.info({ code: body.code, statusCode: status, route }, 'request error')
      }

      return reply.code(status).send({ ...body, requestId: request.id })
    })

    app.setNotFoundHandler((request, reply) => {
      const route = request.routeOptions?.url ?? null
      const { status, body } = toEnvelope(new NotFoundError())

      request.log.info({ code: body.code, statusCode: status, route }, 'request error')

      return reply.code(status).send({ ...body, requestId: request.id })
    })
  },
  { name: 'errors' },
)
