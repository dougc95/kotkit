/**
 * The `preHandler` every (IK)-marked route (design.md's API contract table:
 * `POST /programs` 4.1.2, `POST /sessions` 5.1.1/5.1.2, `POST
 * /sessions/{id}/recall` 5.7.2, `POST /sessions/{id}/finalize` 5.8.1) is
 * registered with. It only checks the header shape (present, a UUID) and
 * decorates `request.idempotencyKey`; `withIdempotency` (3.4.2) is what
 * actually dedupes against `mutation_receipts`.
 *
 * Fastify lowercases every incoming header name before `request.headers` is
 * built, so reading the lower-case key here matches a client that sent
 * `Idempotency-Key`, `IDEMPOTENCY-KEY`, or any other casing.
 */
import type { FastifyRequest } from 'fastify'
import { MalformedError } from '../errors.js'

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key'

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

/**
 * Fastify preHandlers may return a value or a Promise<void>; this one only
 * ever throws or returns, so it is declared as returning `void`.
 */
export async function requireIdempotencyKey(request: FastifyRequest): Promise<void> {
  const rawHeader = request.headers[IDEMPOTENCY_KEY_HEADER]
  const value = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader

  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new MalformedError('The Idempotency-Key header must be a UUID.', {
      'Idempotency-Key': 'must be a UUID',
    })
  }

  request.idempotencyKey = value
}
