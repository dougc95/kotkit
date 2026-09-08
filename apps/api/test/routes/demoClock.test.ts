import Fastify, { type FastifyInstance } from 'fastify'
import { getTableName, isTable } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.js'
import type { AppConfig } from '../../src/config.js'
import { ConfigError } from '../../src/config.js'
import { ensurePrincipalProfile } from '../../src/plugins/identity.js'
import demoRoutes from '../../src/routes/demo.js'
import * as schema from '../../src/db/schema/index.js'
import { registerCtxTestRoute } from '../helpers/testRoutes.js'
import { resolveTestDatabaseUrl } from '../helpers/testDb.js'

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    identityMode: 'local-demo',
    host: '127.0.0.1',
    port: 0,
    databaseUrl: resolveTestDatabaseUrl(process.env),
    logLevel: 'silent',
    ...overrides,
  }
}

describe('routes/demo.ts POST /demo/clock (unit)', () => {
  it("(1) registering demoRoutes on an app whose config.identityMode is 'real' throws ConfigError", async () => {
    const app = Fastify()
    app.decorate('config', {
      identityMode: 'real',
      host: '127.0.0.1',
      port: 0,
      databaseUrl: 'unused',
      logLevel: 'silent',
    } as AppConfig)

    // `await app.register(...)` itself triggers avvio's boot (Fastify's
    // `register` returns the instance, which is thenable and starts booting
    // as soon as it is awaited) — so the plugin's throw would otherwise
    // surface here rather than at a later `app.ready()`. Registering without
    // awaiting, then asserting on `ready()`, is what actually exercises "app
    // whose config.identityMode is 'real' rejects with ConfigError" as a
    // rejection rather than a raw synchronous throw out of this test body.
    app.register(demoRoutes)

    await expect(app.ready()).rejects.toBeInstanceOf(ConfigError)
  })

  it('(2) a local-demo app has POST /api/v1/demo/clock registered', async () => {
    const app = Fastify()
    app.decorate('config', testConfig())

    await app.register(
      async (api) => {
        await api.register(demoRoutes)
      },
      { prefix: '/api/v1' },
    )
    await app.ready()

    expect(app.hasRoute({ method: 'POST', url: '/api/v1/demo/clock' })).toBe(true)
    await app.close()
  })
})

/**
 * The `onRequest` per-request offset lookup and `GET /__test/ctx`
 * (registerCtxTestRoute, 3.2.3) both need real HTTP against a fully-built
 * app, so this mirrors identity.test.ts's `buildIdentityTestApp`
 * (design.md D16: `buildTestApp` calls `ready()` before a caller gets a
 * chance to register a test-only route).
 */
async function buildDemoTestApp(): Promise<{
  app: FastifyInstance
  truncateAll(): Promise<void>
  close(): Promise<void>
}> {
  const app = await buildApp(testConfig())
  await registerCtxTestRoute(app)
  await app.ready()

  async function truncateAll(): Promise<void> {
    const tableNames = (Object.values(schema) as unknown[]).filter(isTable).map((table) => getTableName(table))
    if (tableNames.length > 0) {
      const identifiers = tableNames.map((name) => `"${name}"`).join(', ')
      await app.sql.unsafe(`TRUNCATE TABLE ${identifiers} RESTART IDENTITY CASCADE`)
    }
    await ensurePrincipalProfile(app.db)
  }

  return { app, truncateAll, close: () => app.close() }
}

describe('POST /demo/clock (integration, attention_lab_test)', () => {
  let app: FastifyInstance
  let truncateAll: () => Promise<void>
  let close: () => Promise<void>

  beforeAll(async () => {
    const built = await buildDemoTestApp()
    app = built.app
    truncateAll = built.truncateAll
    close = built.close
  })

  afterAll(async () => {
    await close()
  })

  beforeEach(async () => {
    await truncateAll()
  })

  it('(3) POST { offsetSeconds: 1209600 } -> 200 { demoClockOffsetSeconds: 1209600 }', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/demo/clock',
      payload: { offsetSeconds: 1209600 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ demoClockOffsetSeconds: 1209600 })
  })

  it('(4) GET /me shows demoClockOffsetSeconds 1209600 after the clock is set', async () => {
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/v1/demo/clock',
      payload: { offsetSeconds: 1209600 },
    })
    expect(postRes.statusCode).toBe(200)

    const getRes = await app.inject({ method: 'GET', url: '/api/v1/me' })
    expect(getRes.statusCode).toBe(200)
    expect((getRes.json() as { demoClockOffsetSeconds: number }).demoClockOffsetSeconds).toBe(1209600)
  })

  it("(5) the ctx route shows now - realNow within 2s of 1209600 and timeSource 'demo_clock'", async () => {
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/v1/demo/clock',
      payload: { offsetSeconds: 1209600 },
    })
    expect(postRes.statusCode).toBe(200)

    const ctxRes = await app.inject({ method: 'GET', url: '/api/v1/__test/ctx' })
    expect(ctxRes.statusCode).toBe(200)
    const body = ctxRes.json() as { now: string; realNowMs: number; timeSource: string }

    const diffSeconds = (new Date(body.now).getTime() - body.realNowMs) / 1000
    expect(diffSeconds).toBeGreaterThan(1209600 - 2)
    expect(diffSeconds).toBeLessThan(1209600 + 2)
    expect(body.timeSource).toBe('demo_clock')
  })

  it("(6) POST { offsetSeconds: 0 } after a nonzero offset -> timeSource back to 'measured'", async () => {
    const setNonzero = await app.inject({
      method: 'POST',
      url: '/api/v1/demo/clock',
      payload: { offsetSeconds: 500000 },
    })
    expect(setNonzero.statusCode).toBe(200)

    const resetRes = await app.inject({
      method: 'POST',
      url: '/api/v1/demo/clock',
      payload: { offsetSeconds: 0 },
    })
    expect(resetRes.statusCode).toBe(200)
    expect(resetRes.json()).toEqual({ demoClockOffsetSeconds: 0 })

    const ctxRes = await app.inject({ method: 'GET', url: '/api/v1/__test/ctx' })
    const body = ctxRes.json() as { timeSource: string; demoClockOffsetSeconds: number }
    expect(body.timeSource).toBe('measured')
    expect(body.demoClockOffsetSeconds).toBe(0)
  })

  it('(7) POST { offsetSeconds: 1.5 } -> 400 fieldErrors.offsetSeconds', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/demo/clock',
      payload: { offsetSeconds: 1.5 },
    })
    expect(res.statusCode).toBe(400)
    const body = res.json() as { fieldErrors?: Record<string, string> }
    expect(body.fieldErrors?.offsetSeconds).toBeDefined()
  })

  it("(8) POST { offsetSeconds: 10, realm: 'pilot' } -> 400 fieldErrors.realm and offset unchanged", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/demo/clock',
      payload: { offsetSeconds: 10, realm: 'pilot' },
    })
    expect(res.statusCode).toBe(400)
    const body = res.json() as { fieldErrors?: Record<string, string> }
    expect(body.fieldErrors?.realm).toBeDefined()

    const getRes = await app.inject({ method: 'GET', url: '/api/v1/me' })
    expect((getRes.json() as { demoClockOffsetSeconds: number }).demoClockOffsetSeconds).toBe(0)
  })

  it('(9) empty body -> 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/demo/clock', payload: {} })
    expect(res.statusCode).toBe(400)
  })

  it('(10) response carries cache-control no-store', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/demo/clock',
      payload: { offsetSeconds: 0 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
  })
})
