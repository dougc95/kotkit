import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'
import {
  ERROR_CODES,
  ERROR_CODE_STATUS,
  ErrorResponse,
  REALM_MISMATCH_MESSAGE,
  RealmMixingError,
} from '@attention-lab/shared'
import { buildApp } from '../../src/app.js'
import type { AppConfig } from '../../src/config.js'
import {
  CONFLICT_CODES,
  ConflictError,
  DOMAIN_CODES,
  DomainError,
  MalformedError,
  NotFoundError,
  WriteLimitError,
  fieldErrorsFromValidation,
  sanitizeErrorForLog,
  toEnvelope,
  type AjvErrorLike,
} from '../../src/errors.js'
import { captureLogs, type CapturedLogs } from '../helpers/captureLogs.js'
import { createLogger } from '../../src/logging.js'
import { resolveTestDatabaseUrl } from '../helpers/testDb.js'

const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    identityMode: 'local-demo',
    host: '127.0.0.1',
    port: 0,
    databaseUrl: resolveTestDatabaseUrl(process.env),
    logLevel: 'info',
    ...overrides,
  }
}

/**
 * Builds the real app plus six test-only routes under /api/v1 that exercise
 * every mapping the errors plugin makes: a schema-validation failure (two
 * routes), each AppError subclass, RealmMixingError and an unexpected Error.
 * Routes must be added before `ready()`, same as headers.test.ts's own
 * `buildHeaderTestApp`.
 */
async function buildErrorsTestApp(): Promise<{ app: FastifyInstance; logs: CapturedLogs }> {
  const logs = captureLogs()
  const loggerInstance = createLogger({ level: 'info', destination: logs })
  const app = await buildApp(testConfig(), { loggerInstance })

  await app.register(
    async (instance) => {
      instance.post(
        '/__test/errors/validate',
        { schema: { body: Type.Object({ baselineDate: Type.String() }, { additionalProperties: false }) } },
        async () => ({ ok: true }),
      )

      instance.post(
        '/__test/errors/review',
        {
          schema: {
            body: Type.Object(
              {
                review: Type.Object(
                  { episodeCount: Type.Union([Type.Integer(), Type.Null()]) },
                  { additionalProperties: false },
                ),
              },
              { additionalProperties: false },
            ),
          },
        },
        async (request) => {
          const body = request.body as { review: { episodeCount: number | null } }
          return { episodeCount: body.review.episodeCount }
        },
      )

      instance.get('/__test/errors/not-found', async () => {
        throw new NotFoundError()
      })

      instance.get('/__test/errors/conflict', async () => {
        throw new ConflictError(
          'idempotency_mismatch',
          'This request was already sent with different content.',
        )
      })

      instance.get('/__test/errors/realm', async () => {
        throw new RealmMixingError(
          "Refusing to compare a 'demo' record with a 'pilot' record. " +
            'Simulated and real results are never combined.',
        )
      })

      instance.get('/__test/errors/write-limit', async () => {
        throw new WriteLimitError()
      })

      instance.get('/__test/errors/boom', async () => {
        throw new Error('boom SECRET')
      })
    },
    { prefix: '/api/v1' },
  )

  await app.ready()
  return { app, logs }
}

describe('errors.ts (unit)', () => {
  it('(1) toEnvelope(MalformedError) -> 400 malformed_request, retryable false', () => {
    const { status, body } = toEnvelope(new MalformedError('The request could not be validated.'))
    expect(status).toBe(400)
    expect(body.code).toBe('malformed_request')
    expect(body.retryable).toBe(false)
  })

  it('(2) toEnvelope(NotFoundError) -> 404 not_found, message "Not found"', () => {
    const { status, body } = toEnvelope(new NotFoundError())
    expect(status).toBe(404)
    expect(body.code).toBe('not_found')
    expect(body.message).toBe('Not found')
  })

  it('(3) ConflictError retryable defaults: false for active_session_exists, true for event_count_mismatch', () => {
    const active = toEnvelope(
      new ConflictError('active_session_exists', 'An unfinished session already exists.'),
    )
    expect(active.body.retryable).toBe(false)

    const mismatch = toEnvelope(
      new ConflictError('event_count_mismatch', 'The stored event count does not match.'),
    )
    expect(mismatch.body.retryable).toBe(true)
  })

  it('(4) DomainError -> 422 retryable false; WriteLimitError -> 429 retryable true', () => {
    const domain = toEnvelope(
      new DomainError('feed_subset_violation', 'Feed rows must stay within the platform total.'),
    )
    expect(domain.status).toBe(422)
    expect(domain.body.retryable).toBe(false)

    const limited = toEnvelope(new WriteLimitError())
    expect(limited.status).toBe(429)
    expect(limited.body.retryable).toBe(true)
  })

  it('(5) an explicit retryable option overrides the default', () => {
    const { body } = toEnvelope(
      new ConflictError('stale_version', 'This record changed since you loaded it.', {
        retryable: true,
      }),
    )
    expect(body.retryable).toBe(true)
  })

  it('(6) fieldErrorsFromValidation maps type/additionalProperties/required and never echoes a submitted value', () => {
    type SampleAjvError = AjvErrorLike & { data?: unknown }

    const errors: SampleAjvError[] = [
      {
        keyword: 'type',
        instancePath: '/review/episodeCount',
        params: { type: 'integer' },
        message: 'must be integer',
        data: 'SECRET-VALUE',
      },
      {
        keyword: 'additionalProperties',
        instancePath: '',
        params: { additionalProperty: 'realm' },
        message: 'must NOT have additional properties',
        data: { realm: 'SECRET-VALUE' },
      },
      {
        keyword: 'required',
        instancePath: '',
        params: { missingProperty: 'baselineDate' },
        message: 'must have required property baselineDate',
      },
    ]

    const result = fieldErrorsFromValidation(errors)

    expect(Object.keys(result).sort()).toEqual(['baselineDate', 'realm', 'review.episodeCount'])
    expect(result['review.episodeCount']).toBe('must be integer')
    expect(result.realm).toBe('is not an accepted field')
    expect(result.baselineDate).toBe('is required')
    expect(JSON.stringify(result)).not.toContain('SECRET-VALUE')
  })

  it('(7) RealmMixingError -> 422 realm_mismatch with a message naming neither realm', () => {
    const err = new RealmMixingError(
      "Refusing to compare a 'demo' record with a 'pilot' record. " +
        'Simulated and real results are never combined.',
    )
    const { status, body } = toEnvelope(err)
    expect(status).toBe(422)
    expect(body.code).toBe('realm_mismatch')
    expect(body.message).toBe(REALM_MISMATCH_MESSAGE)
    expect(body.message).not.toContain('demo')
    expect(body.message).not.toContain('pilot')
  })

  it('(8) sanitizeErrorForLog keeps only name, sqlstate and a stack frame — never message/detail', () => {
    const err = new Error('boom SECRET') as Error & { detail?: string; code?: string }
    err.detail = 'Failing row contains (SECRET-DETAIL)'
    err.code = '23514'

    const sanitized = sanitizeErrorForLog(err)

    expect(sanitized.name).toBe('Error')
    expect(sanitized.sqlstate).toBe('23514')
    expect(typeof sanitized.stackTop).toBe('string')
    expect(Object.keys(sanitized).sort()).toEqual(['name', 'sqlstate', 'stackTop'])

    const text = JSON.stringify(sanitized)
    expect(text).not.toContain('SECRET-DETAIL')
    expect(text).not.toContain('boom SECRET')
  })

  it('(9) details carriers appear verbatim under envelope.details', () => {
    const cases: Array<{ error: ConflictError; expected: Record<string, unknown> }> = [
      {
        error: new ConflictError('event_count_mismatch', 'msg', { details: { expected: 5, stored: 4 } }),
        expected: { expected: 5, stored: 4 },
      },
      {
        error: new ConflictError('active_session_exists', 'msg', {
          details: { activeSessionId: 'session-1' },
        }),
        expected: { activeSessionId: 'session-1' },
      },
      {
        error: new ConflictError('slot_frozen', 'msg', { details: { phase: 'baseline', label: 'A' } }),
        expected: { phase: 'baseline', label: 'A' },
      },
      {
        error: new ConflictError('program_exists', 'msg', {
          details: { existingProgramId: 'program-1', existingStatus: 'active' },
        }),
        expected: { existingProgramId: 'program-1', existingStatus: 'active' },
      },
      {
        error: new ConflictError('stale_version', 'msg', { details: { current: { version: 2 } } }),
        expected: { current: { version: 2 } },
      },
    ]

    for (const { error, expected } of cases) {
      const { body } = toEnvelope(error)
      expect(body.details).toEqual(expected)
    }
  })

  it('(10) CONFLICT_CODES / DOMAIN_CODES match the D19 status groupings; ErrorResponse.details is optional', () => {
    const expectedConflict = ERROR_CODES.filter((code) => ERROR_CODE_STATUS[code] === 409)
    const expectedDomain = ERROR_CODES.filter((code) => ERROR_CODE_STATUS[code] === 422)

    expect(CONFLICT_CODES).toEqual(expectedConflict)
    expect(DOMAIN_CODES).toEqual(expectedDomain)

    expect(ErrorResponse.required).not.toContain('details')
    expect(ErrorResponse.required).not.toContain('fieldErrors')
    expect(ErrorResponse.properties.details).toBeDefined()
  })
})

describe('errors plugin (integration, against attention_lab_test)', () => {
  it('(11) an unaccepted field -> 400 with fieldErrors on that field, and the value never reaches the response', async () => {
    const { app } = await buildErrorsTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/__test/errors/validate',
      payload: { realm: 'pilot', baselineDate: '2026-09-06' },
    })
    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.fieldErrors.realm).toBe('is not an accepted field')
    expect(JSON.stringify(body)).not.toContain('pilot')
    await app.close()
  })

  it('(12) a missing required field -> 400 with fieldErrors.baselineDate: "is required"', async () => {
    const { app } = await buildErrorsTestApp()
    const res = await app.inject({ method: 'POST', url: '/api/v1/__test/errors/validate', payload: {} })
    expect(res.statusCode).toBe(400)
    expect(res.json().fieldErrors.baselineDate).toBe('is required')
    await app.close()
  })

  it('(13) a nullable count reaches the handler as null, and a string is never coerced', async () => {
    const { app } = await buildErrorsTestApp()

    const nullRes = await app.inject({
      method: 'POST',
      url: '/api/v1/__test/errors/review',
      payload: { review: { episodeCount: null } },
    })
    expect(nullRes.statusCode).toBe(200)
    expect(nullRes.json()).toEqual({ episodeCount: null })

    const stringRes = await app.inject({
      method: 'POST',
      url: '/api/v1/__test/errors/review',
      payload: { review: { episodeCount: '3' } },
    })
    expect(stringRes.statusCode).toBe(400)

    await app.close()
  })

  it('(14) a thrown NotFoundError -> 404 envelope with message "Not found"', async () => {
    const { app } = await buildErrorsTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/__test/errors/not-found' })
    expect(res.statusCode).toBe(404)
    expect(res.json().message).toBe('Not found')
    await app.close()
  })

  it('(15) a thrown ConflictError(idempotency_mismatch) -> 409, message names no UUID', async () => {
    const { app } = await buildErrorsTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/__test/errors/conflict' })
    expect(res.statusCode).toBe(409)
    expect(res.json().message).not.toMatch(UUID_ANYWHERE)
    await app.close()
  })

  it('(16) a thrown RealmMixingError -> 422 realm_mismatch with the fixed message', async () => {
    const { app } = await buildErrorsTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/__test/errors/realm' })
    expect(res.statusCode).toBe(422)
    const body = res.json()
    expect(body.code).toBe('realm_mismatch')
    expect(body.message).toBe(REALM_MISMATCH_MESSAGE)
    await app.close()
  })

  it('(17) a thrown WriteLimitError -> 429, retryable true', async () => {
    const { app } = await buildErrorsTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/__test/errors/write-limit' })
    expect(res.statusCode).toBe(429)
    expect(res.json().retryable).toBe(true)
    await app.close()
  })

  it('(18) an unexpected Error -> 500 generic message; the log entry never carries the private text', async () => {
    const { app, logs } = await buildErrorsTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/__test/errors/boom' })
    expect(res.statusCode).toBe(500)
    const body = res.json()
    expect(body.code).toBe('internal_error')
    expect(body.message).not.toContain('SECRET')

    const reqId = res.headers['x-request-id'] as string
    const errorEntry = logs.entriesWith(reqId).find((entry) => entry.code === 'internal_error')
    expect(errorEntry).toBeDefined()
    expect(errorEntry?.statusCode).toBe(500)
    expect((errorEntry?.err as { name?: string } | undefined)?.name).toBe('Error')
    expect(JSON.stringify(errorEntry)).not.toContain('SECRET')

    await app.close()
  })

  it('(19) an unknown route -> 404 envelope', async () => {
    const { app } = await buildErrorsTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/__test/errors/does-not-exist' })
    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('not_found')
    await app.close()
  })

  it('(20) every error response carries body.requestId === headers["x-request-id"]', async () => {
    const { app } = await buildErrorsTestApp()
    const urls = [
      '/api/v1/__test/errors/not-found',
      '/api/v1/__test/errors/conflict',
      '/api/v1/__test/errors/realm',
      '/api/v1/__test/errors/write-limit',
      '/api/v1/__test/errors/boom',
      '/api/v1/__test/errors/does-not-exist',
    ]
    for (const url of urls) {
      const res = await app.inject({ method: 'GET', url })
      expect(res.json().requestId).toBe(res.headers['x-request-id'])
    }
    await app.close()
  })

  it('(21) fieldErrors and details are absent (not null) when not applicable', async () => {
    const { app } = await buildErrorsTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/__test/errors/not-found' })
    const body = res.json()
    expect(body).not.toHaveProperty('fieldErrors')
    expect(body).not.toHaveProperty('details')
    await app.close()
  })

  it('(22) every error response carries cache-control: no-store', async () => {
    const { app } = await buildErrorsTestApp()
    const urls = [
      '/api/v1/__test/errors/not-found',
      '/api/v1/__test/errors/conflict',
      '/api/v1/__test/errors/realm',
      '/api/v1/__test/errors/write-limit',
      '/api/v1/__test/errors/boom',
      '/api/v1/__test/errors/does-not-exist',
    ]
    for (const url of urls) {
      const res = await app.inject({ method: 'GET', url })
      expect(res.headers['cache-control']).toBe('no-store')
    }
    await app.close()
  })
})
