import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.js'
import type { AppConfig } from '../../src/config.js'
import { createLogger } from '../../src/logging.js'
import { requestHash } from '../../src/idempotency/requestHash.js'
import { IDEMPOTENCY_KEY_HEADER, requireIdempotencyKey } from '../../src/idempotency/keyHook.js'
import { resolveTestDatabaseUrl } from '../helpers/testDb.js'

const HEX_64 = /^[0-9a-f]{64}$/

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
 * Builds the real app plus one test-only route carrying the
 * `requireIdempotencyKey` preHandler, so the hook is exercised exactly as an
 * (IK)-marked route would use it — see headers.test.ts / errors.test.ts for
 * the same "route added before `ready()`" pattern.
 */
async function buildHashTestApp(): Promise<{ app: FastifyInstance }> {
  const loggerInstance = createLogger({ level: 'info' })
  const app = await buildApp(testConfig(), { loggerInstance })

  await app.register(
    async (instance) => {
      instance.post(
        '/__test/idem-key',
        { preHandler: requireIdempotencyKey },
        async (request) => ({ idempotencyKey: request.idempotencyKey }),
      )
    },
    { prefix: '/api/v1' },
  )

  await app.ready()
  return { app }
}

describe('requestHash.ts (unit)', () => {
  it('(1) key order in a flat object never changes the hash', () => {
    const a = requestHash('op', {}, { a: 1, b: 2 })
    const b = requestHash('op', {}, { b: 2, a: 1 })
    expect(a).toBe(b)
  })

  it('(2) key order at any nesting depth never changes the hash', () => {
    const a = requestHash('op', {}, { outer: { a: 1, b: { x: 1, y: 2 } } })
    const b = requestHash('op', {}, { outer: { b: { y: 2, x: 1 }, a: 1 } })
    expect(a).toBe(b)
  })

  it('(3) array order changes the hash — an array is data, not a set', () => {
    const a = requestHash('op', {}, { list: [1, 2, 3] })
    const b = requestHash('op', {}, { list: [3, 2, 1] })
    expect(a).not.toBe(b)
  })

  it('(4) unknown != zero != absent: {episodeCount:null}, {episodeCount:0} and {} hash three different ways', () => {
    const unknown = requestHash('op', {}, { episodeCount: null })
    const zero = requestHash('op', {}, { episodeCount: 0 })
    const absent = requestHash('op', {}, {})

    expect(unknown).not.toBe(zero)
    expect(unknown).not.toBe(absent)
    expect(zero).not.toBe(absent)
  })

  it('(5) same body, different operation -> different hash', () => {
    const a = requestHash('op.one', {}, { a: 1 })
    const b = requestHash('op.two', {}, { a: 1 })
    expect(a).not.toBe(b)
  })

  it('(6) same body, different params -> different hash', () => {
    const a = requestHash('op', { id: '1' }, { a: 1 })
    const b = requestHash('op', { id: '2' }, { a: 1 })
    expect(a).not.toBe(b)
  })

  it('(7) output is 64 lowercase hex characters', () => {
    const hash = requestHash('op', {}, { a: 1 })
    expect(hash).toMatch(HEX_64)
  })

  it('(8) a fixed vector matches a stored expected hash across runs', () => {
    const hash = requestHash(
      'test.fixture',
      { id: 'abc-123' },
      { episodeCount: 3, note: 'hello world', tags: ['x', 'y'] },
    )
    expect(hash).toBe('b337e53d74ece688f7a8a772346cc837041974a0838b699a707215788b4c2062')
  })
})

describe('requireIdempotencyKey preHandler (integration, against attention_lab_test)', () => {
  it('(9) a missing Idempotency-Key header -> 400 malformed_request with fieldErrors', async () => {
    const { app } = await buildHashTestApp()
    const res = await app.inject({ method: 'POST', url: '/api/v1/__test/idem-key', payload: {} })
    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.code).toBe('malformed_request')
    expect(body.fieldErrors['Idempotency-Key']).toBe('must be a UUID')
    await app.close()
  })

  it("(10) an Idempotency-Key header of 'abc' -> 400", async () => {
    const { app } = await buildHashTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/__test/idem-key',
      payload: {},
      headers: { [IDEMPOTENCY_KEY_HEADER]: 'abc' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().fieldErrors['Idempotency-Key']).toBe('must be a UUID')
    await app.close()
  })

  it('(11) an upper-case IDEMPOTENCY-KEY header with a valid UUID -> 200, request.idempotencyKey equals it', async () => {
    const { app } = await buildHashTestApp()
    const key = randomUUID()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/__test/idem-key',
      payload: {},
      headers: { 'IDEMPOTENCY-KEY': key },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().idempotencyKey).toBe(key)
    await app.close()
  })
})
