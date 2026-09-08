import type { FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.js'
import { createLogger, reqSerializer, resSerializer, LOG_REDACT_PATHS } from '../../src/logging.js'
import type { AppConfig } from '../../src/config.js'
import { captureLogs, type CapturedLogs } from '../helpers/captureLogs.js'
import { resolveTestDatabaseUrl } from '../helpers/testDb.js'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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
 * Builds the real app plus three test-only routes under /api/v1 — private,
 * public (config.public opt-out) and throwing — registered as a sibling to
 * app.ts's own (still-empty) /api/v1 prefix block. Routes must be added
 * before `ready()`, so this bypasses `buildTestApp` (which readies
 * internally) and calls `buildApp` directly, same as db.test.ts's own
 * `registered twice` case does.
 */
async function buildHeaderTestApp(): Promise<{ app: FastifyInstance; logs: CapturedLogs }> {
  const logs = captureLogs()
  const loggerInstance = createLogger({ level: 'info', destination: logs })
  const app = await buildApp(testConfig(), { loggerInstance })

  await app.register(
    async (instance) => {
      instance.get('/__test/private', async () => ({ ok: true }))
      instance.get('/__test/public', { config: { public: true } }, async () => ({ ok: true }))
      instance.get('/__test/throw', async () => {
        throw new Error('boom')
      })
    },
    { prefix: '/api/v1' },
  )

  await app.ready()
  return { app, logs }
}

describe('logging.ts serializers and redact paths (unit)', () => {
  it('(1) req serializer emits only id, method, url, route', () => {
    const result = reqSerializer({
      id: 'req-1',
      method: 'GET',
      url: '/api/v1/__test/private',
      routeOptions: { url: '/api/v1/__test/private' },
      ...({
        headers: { authorization: 'Bearer secret', cookie: 'sid=abc' },
        query: { q: 'note text' },
        params: { id: '1' },
        body: { note: 'private note text' },
      } as Record<string, unknown>),
    })

    expect(Object.keys(result).sort()).toEqual(['id', 'method', 'route', 'url'])
    expect(result).toEqual({
      id: 'req-1',
      method: 'GET',
      url: '/api/v1/__test/private',
      route: '/api/v1/__test/private',
    })
  })

  it('(2) res serializer emits only statusCode', () => {
    const result = resSerializer({
      statusCode: 200,
      ...({ headers: { 'set-cookie': 'sid=abc' } } as Record<string, unknown>),
    })
    expect(Object.keys(result)).toEqual(['statusCode'])
    expect(result).toEqual({ statusCode: 200 })
  })

  it('(3) createLogger redact paths include authorization and cookie headers', () => {
    expect(LOG_REDACT_PATHS).toContain('req.headers.authorization')
    expect(LOG_REDACT_PATHS).toContain('req.headers.cookie')
  })
})

describe('requestId / requestLog / noStore plugins (integration, against attention_lab_test)', () => {
  it('(4) every response carries x-request-id matching the UUID v4 regex', async () => {
    const { app } = await buildHeaderTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/__test/private' })
    expect(res.headers['x-request-id']).toMatch(UUID_V4)
    await app.close()
  })

  it('(5) two consecutive requests get different ids', async () => {
    const { app } = await buildHeaderTestApp()
    const res1 = await app.inject({ method: 'GET', url: '/api/v1/__test/private' })
    const res2 = await app.inject({ method: 'GET', url: '/api/v1/__test/private' })
    expect(res1.headers['x-request-id']).not.toBe(res2.headers['x-request-id'])
    await app.close()
  })

  it('(6) a client-supplied x-request-id is never echoed back', async () => {
    const { app } = await buildHeaderTestApp()
    const supplied = 'attacker-supplied'
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/__test/private',
      headers: { 'x-request-id': supplied },
    })
    expect(res.headers['x-request-id']).not.toBe(supplied)
    expect(res.headers['x-request-id']).toMatch(UUID_V4)
    await app.close()
  })

  it('(7) unknown route 404 carries x-request-id and cache-control: no-store', async () => {
    const { app } = await buildHeaderTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/__test/does-not-exist' })
    expect(res.statusCode).toBe(404)
    expect(res.headers['x-request-id']).toMatch(UUID_V4)
    expect(res.headers['cache-control']).toBe('no-store')
    await app.close()
  })

  it('(8) a private route carries cache-control: no-store', async () => {
    const { app } = await buildHeaderTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/__test/private' })
    expect(res.headers['cache-control']).toBe('no-store')
    await app.close()
  })

  it('(9) a config.public route carries no cache-control: no-store', async () => {
    const { app } = await buildHeaderTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/__test/public' })
    expect(res.headers['cache-control']).toBeUndefined()
    await app.close()
  })

  it('(10) a throwing handler still gets both headers on its 500', async () => {
    const { app } = await buildHeaderTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/__test/throw' })
    expect(res.statusCode).toBe(500)
    expect(res.headers['x-request-id']).toMatch(UUID_V4)
    expect(res.headers['cache-control']).toBe('no-store')
    await app.close()
  })

  it('(11) exactly one log entry per request, with the right fields and no private keys', async () => {
    const { app, logs } = await buildHeaderTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/__test/private' })
    const reqId = res.headers['x-request-id'] as string

    const entries = logs.entriesWith(reqId)
    expect(entries).toHaveLength(1)

    const [entry] = entries
    expect(entry?.method).toBe('GET')
    expect(entry?.url).toBe('/api/v1/__test/private')
    expect(entry?.route).toBe('/api/v1/__test/private')
    expect(entry?.statusCode).toBe(200)
    expect(typeof entry?.responseTime).toBe('number')

    const text = JSON.stringify(entry)
    expect(text).not.toContain('"headers"')
    expect(text).not.toContain('"query"')
    expect(text).not.toContain('"params"')
    expect(text).not.toContain('"body"')

    await app.close()
  })
})
