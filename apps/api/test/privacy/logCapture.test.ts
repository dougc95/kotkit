import { Type, type Static } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.js'
import type { AppConfig } from '../../src/config.js'
import { DomainError } from '../../src/errors.js'
import { dailyCheckins } from '../../src/db/schema/dailyCheckins.js'
import { programs } from '../../src/db/schema/programs.js'
import { createLogger } from '../../src/logging.js'
import { captureLogs, type CapturedLogs } from '../helpers/captureLogs.js'
import { resolveTestDatabaseUrl } from '../helpers/testDb.js'

/**
 * 3.6.1: an end-to-end privacy assertion, not a unit suite — the pure pieces
 * it exercises (captureLogs parsing, the 3.2.2 serializers, sanitizeErrorForLog
 * and fieldErrorsFromValidation) already have their own unit tests in 3.2.1,
 * 3.2.2 and 3.2.4. This file only proves the wiring: whatever a request
 * carries as private free text (a note, a recall point) never reaches the
 * response OR the log output, on every one of the three error paths
 * (validation, domain, database) plus the one success path.
 *
 * See design.md identity-realm "Private data is never written to logs or
 * stored insecurely" and D18/D19 (the envelope and error-code vocabulary the
 * `mode: 'domain'` branch below exercises with `impossible_offset`).
 */

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

const PrivacyTestBody = Type.Object(
  {
    note: Type.String({ minLength: 1 }),
    points: Type.Tuple([
      Type.String(),
      Type.String(),
      Type.String(),
      Type.String(),
      Type.String(),
    ]),
    count: Type.Union([Type.Integer(), Type.Null()]),
    mode: Type.Union([Type.Literal('domain'), Type.Literal('db')]),
  },
  { additionalProperties: false },
)
type PrivacyTestBodyValue = Static<typeof PrivacyTestBody>

/**
 * Builds the real app plus one test-only route, `POST /api/v1/__test/privacy`,
 * that exists only to exercise the log path on all three error kinds this
 * unit is named for: a schema-validation failure (bad `points` length, before
 * the handler ever runs), a thrown `DomainError` (`mode: 'domain'`, the D19
 * code `impossible_offset` — the route exists only to exercise the log path,
 * it is not a real offset check), and a genuine Postgres error (`mode: 'db'`,
 * a `daily_checkins` row with `stress: 11` violating the
 * `daily_checkins_stress_range` CHECK constraint, whose Postgres `DETAIL`
 * echoes the failing row — including the private `note` text — so the test
 * can prove `sanitizeErrorForLog` keeps that text out of the log even though
 * the raw driver error carries it).
 *
 * `receivedBodies` records every body the handler actually saw, so a test can
 * check what reached the handler (case (c): `count: null` arrives as `null`,
 * never coerced to `0`) independent of what the response envelope carries.
 *
 * Routes must be registered before `ready()` (same constraint every other
 * test-only route in this codebase follows — see plugins/errors.test.ts's
 * `buildErrorsTestApp`), so this calls `buildApp` directly rather than
 * `buildTestApp` (which readies internally); the `captureLogs` destination
 * used here is the same helper `buildTestApp` wires (3.2.1).
 */
async function buildPrivacyTestApp(): Promise<{
  app: FastifyInstance
  logs: CapturedLogs
  receivedBodies: PrivacyTestBodyValue[]
}> {
  const logs = captureLogs()
  const loggerInstance = createLogger({ level: 'info', destination: logs })
  const app = await buildApp(testConfig(), { loggerInstance })

  const receivedBodies: PrivacyTestBodyValue[] = []

  await app.register(
    async (instance) => {
      instance.post(
        '/__test/privacy',
        { schema: { body: PrivacyTestBody } },
        async (request) => {
          const body = request.body as PrivacyTestBodyValue
          receivedBodies.push(body)

          if (body.mode === 'domain') {
            throw new DomainError('impossible_offset', 'Offset is outside the interval.')
          }

          // mode === 'db': a fresh, terminal-status program (never in
          // draft/baseline_ready/active, so it never collides with the
          // one-open-program-per-user partial index regardless of what other
          // test files have left in attention_lab_test) to satisfy
          // daily_checkins' FK, then a checkin row whose out-of-range stress
          // trips the CHECK constraint and whose note carries this request's
          // marker into Postgres's own DETAIL text.
          const { ctx } = request
          const [program] = await app.db
            .insert(programs)
            .values({
              userId: ctx.principalId,
              realm: ctx.realm,
              baselineDate: '2026-01-01',
              timezone: 'UTC',
              status: 'archived',
              leisureAllowanceMin: 20,
            })
            .returning({ id: programs.id })

          await app.db.insert(dailyCheckins).values({
            programId: program!.id,
            realm: ctx.realm,
            localDate: '2026-01-01',
            stress: 11,
            note: body.note,
          })

          // Unreachable when mode is 'db' (the insert above always throws),
          // kept only so the handler has a well-typed success return.
          return { count: body.count }
        },
      )
    },
    { prefix: '/api/v1' },
  )

  await app.ready()
  return { app, logs, receivedBodies }
}

describe('log-privacy assertions (3.6.1, integration against attention_lab_test)', () => {
  let app: FastifyInstance
  let logs: CapturedLogs
  let receivedBodies: PrivacyTestBodyValue[]

  beforeAll(async () => {
    ;({ app, logs, receivedBodies } = await buildPrivacyTestApp())
  })

  afterAll(async () => {
    await app.close()
  })

  it('(a) a validation failure never echoes or logs the submitted note or point text', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/__test/privacy',
      payload: {
        note: 'SECRET-NOTE-9f3a',
        points: ['a', 'b', 'c', 'd', 'e', 'SECRET-POINT-11aa'],
        count: null,
        mode: 'domain',
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().fieldErrors).toHaveProperty('points')

    expect(res.body).not.toContain('SECRET-NOTE-9f3a')
    expect(res.body).not.toContain('SECRET-POINT-11aa')
    expect(logs.text()).not.toContain('SECRET-NOTE-9f3a')
    expect(logs.text()).not.toContain('SECRET-POINT-11aa')
  })

  it('(b) a thrown DomainError logs reqId/code/statusCode/route and no marker', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/__test/privacy',
      payload: {
        note: 'SECRET-NOTE-domain-7c1e',
        points: ['a', 'b', 'c', 'd', 'SECRET-POINT-domain-7c1e'],
        count: 3,
        mode: 'domain',
      },
    })

    expect(res.statusCode).toBe(422)
    const reqId = res.headers['x-request-id'] as string
    expect(res.json().requestId).toBe(reqId)

    const entries = logs.entriesWith(reqId)
    const errorEntry = entries.find((entry) => entry.msg === 'request error')
    expect(errorEntry).toBeDefined()
    expect(errorEntry?.reqId).toBe(reqId)
    expect(errorEntry?.code).toBe('impossible_offset')
    expect(errorEntry?.statusCode).toBe(422)
    expect(errorEntry?.route).toBe('/api/v1/__test/privacy')

    expect(res.body).not.toContain('SECRET-NOTE-domain-7c1e')
    expect(JSON.stringify(entries)).not.toContain('SECRET-NOTE-domain-7c1e')
    expect(JSON.stringify(entries)).not.toContain('SECRET-POINT-domain-7c1e')
  })

  it('(c) count: null passes validation and reaches the handler as null, not 0', async () => {
    receivedBodies.length = 0

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/__test/privacy',
      payload: { note: 'x', points: ['a', 'b', 'c', 'd', 'e'], count: null, mode: 'domain' },
    })

    // 422, not 400: the body passed schema validation and reached the
    // handler, which then threw the domain error.
    expect(res.statusCode).toBe(422)
    expect(receivedBodies).toHaveLength(1)
    expect(receivedBodies[0]?.count).toBeNull()
    expect(receivedBodies[0]?.count).not.toBe(0)
  })

  it('(d) a Postgres check-constraint failure (23514) never leaks its DETAIL, even though the driver error carries it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/__test/privacy',
      payload: {
        note: 'SECRET-NOTE-db-52ab',
        points: ['a', 'b', 'c', 'd', 'e'],
        count: null,
        mode: 'db',
      },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().code).toBe('internal_error')
    expect(res.body).not.toContain('SECRET-NOTE-db-52ab')

    const reqId = res.headers['x-request-id'] as string
    const entries = logs.entriesWith(reqId)
    const errorEntry = entries.find((entry) => entry.msg === 'request error')
    expect(errorEntry).toBeDefined()
    expect(errorEntry?.statusCode).toBe(500)
    expect((errorEntry?.err as { sqlstate?: string } | undefined)?.sqlstate).toBe('23514')

    expect(JSON.stringify(entries)).not.toContain('SECRET-NOTE-db-52ab')
  })

  it('(e) no log entry across the run carries a body, query, headers, cookie or authorization key', () => {
    expect(logs.entries().length).toBeGreaterThan(0)
    for (const entry of logs.entries()) {
      expect(entry).not.toHaveProperty('body')
      expect(entry).not.toHaveProperty('query')
      expect(entry).not.toHaveProperty('headers')
      expect(entry).not.toHaveProperty('cookie')
      expect(entry).not.toHaveProperty('authorization')
    }
  })

  it('(f) every request in the run produced exactly one completion entry, with no other per-request entries', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/me' })
    expect(res.statusCode).toBe(200)

    const meReqId = res.headers['x-request-id'] as string
    const meEntries = logs.entriesWith(meReqId)
    expect(meEntries).toHaveLength(1)
    expect(meEntries[0]?.msg).toBe('request completed')
    expect(meEntries[0]).toMatchObject({ method: 'GET', url: '/api/v1/me' })
    expect(typeof meEntries[0]?.statusCode).toBe('number')
    expect(typeof meEntries[0]?.responseTime).toBe('number')

    // Group every captured entry (across the whole run, (a)-(f)) by reqId:
    // each group has exactly one 'request completed' entry (the observability
    // NFR's single completion line) and, for an errored request, at most one
    // additional 'request error' entry -- never a third, per-tick line.
    const byReqId = new Map<string, Record<string, unknown>[]>()
    for (const entry of logs.entries()) {
      const reqId = entry.reqId
      if (typeof reqId !== 'string') continue
      const group = byReqId.get(reqId) ?? []
      group.push(entry)
      byReqId.set(reqId, group)
    }

    expect(byReqId.size).toBeGreaterThanOrEqual(5)

    for (const group of byReqId.values()) {
      const completions = group.filter((entry) => entry.msg === 'request completed')
      expect(completions).toHaveLength(1)

      const unexpected = group.filter(
        (entry) => entry.msg !== 'request completed' && entry.msg !== 'request error',
      )
      expect(unexpected).toHaveLength(0)
      expect(group.length).toBeLessThanOrEqual(2)
    }
  })
})
