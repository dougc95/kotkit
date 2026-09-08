import type { FastifyInstance } from 'fastify'
import { eq, getTableName, isTable } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.js'
import type { AppConfig } from '../../src/config.js'
import { ConfigError } from '../../src/config.js'
import { DomainError, NotFoundError } from '../../src/errors.js'
import { DEFAULT_PREFERENCES } from '../../src/preferences.js'
import * as schema from '../../src/db/schema/index.js'
import { userProfiles } from '../../src/db/schema/userProfiles.js'
import {
  LOCAL_DEMO_PRINCIPAL_ID,
  assertOwnedBy,
  assertOwnRealm,
  deriveContext,
  ensurePrincipalProfile,
  ownerStamp,
  type RequestContext,
} from '../../src/plugins/identity.js'
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

/**
 * `identity`'s `onRequest` hook must be exercised over real HTTP so the
 * `x-principal-id` / `x-realm` header-ignoring behavior (test 9) and the
 * per-request offset lookup (test 10) are genuine — `buildTestApp` (3.2.1)
 * cannot be used here because it calls `ready()` before a caller gets a
 * chance to register the ctx test route, so this mirrors it directly
 * (same pattern as errors.test.ts's `buildErrorsTestApp` and
 * headers.test.ts's `buildHeaderTestApp`), including a `truncateAll` that
 * duplicates buildTestApp.truncateAll's (3.2.3-extended) shape by calling
 * the very same `ensurePrincipalProfile` export.
 */
async function buildIdentityTestApp(): Promise<{
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

describe('identity.ts (unit)', () => {
  it('(1) deriveContext offset 0 -> timeSource measured, now === realNow', () => {
    const realNow = new Date('2026-09-06T12:00:00.000Z')
    const ctx = deriveContext({ identityMode: 'local-demo', offsetSeconds: 0, realNow })
    expect(ctx.timeSource).toBe('measured')
    expect(ctx.now.getTime()).toBe(realNow.getTime())
  })

  it('(2) deriveContext offset 86400 -> timeSource demo_clock, now = realNow + 1 day', () => {
    const realNow = new Date('2026-09-06T12:00:00.000Z')
    const ctx = deriveContext({ identityMode: 'local-demo', offsetSeconds: 86400, realNow })
    expect(ctx.timeSource).toBe('demo_clock')
    expect(ctx.now.getTime()).toBe(realNow.getTime() + 86400 * 1000)
  })

  it('(3) deriveContext negative offset -> timeSource demo_clock', () => {
    const realNow = new Date('2026-09-06T12:00:00.000Z')
    const ctx = deriveContext({ identityMode: 'local-demo', offsetSeconds: -600, realNow })
    expect(ctx.timeSource).toBe('demo_clock')
    expect(ctx.now.getTime()).toBe(realNow.getTime() - 600 * 1000)
  })

  it('(4) deriveContext identityMode "real" throws ConfigError', () => {
    expect(() =>
      deriveContext({ identityMode: 'real', offsetSeconds: 0, realNow: new Date() }),
    ).toThrow(ConfigError)
  })

  it('(5) ownerStamp returns { userId: local-demo, realm: demo }', () => {
    const ctx = deriveContext({ identityMode: 'local-demo', offsetSeconds: 0, realNow: new Date() })
    expect(ownerStamp(ctx)).toEqual({ userId: 'local-demo', realm: 'demo' })
  })

  it('(6) assertOwnRealm throws DomainError(realm_mismatch) for pilot, passes for demo', () => {
    const ctx: RequestContext = deriveContext({
      identityMode: 'local-demo',
      offsetSeconds: 0,
      realNow: new Date(),
    })

    let thrown: unknown
    try {
      assertOwnRealm(ctx, 'pilot')
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(DomainError)
    expect((thrown as DomainError).code).toBe('realm_mismatch')

    expect(() => assertOwnRealm(ctx, 'demo')).not.toThrow()
  })

  it('(7) assertOwnedBy throws NotFoundError 404 "Not found" for another owner, passes for local-demo', () => {
    const ctx: RequestContext = deriveContext({
      identityMode: 'local-demo',
      offsetSeconds: 0,
      realNow: new Date(),
    })

    let thrown: unknown
    try {
      assertOwnedBy(ctx, { user_id: 'other-user' })
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(NotFoundError)
    expect((thrown as NotFoundError).status).toBe(404)
    expect((thrown as NotFoundError).message).toBe('Not found')

    expect(() => assertOwnedBy(ctx, { user_id: 'local-demo' })).not.toThrow()
  })
})

describe('identity plugin (integration, attention_lab_test)', () => {
  let app: FastifyInstance
  let truncateAll: () => Promise<void>
  let close: () => Promise<void>

  beforeAll(async () => {
    const built = await buildIdentityTestApp()
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

  it('(8) GET /__test/ctx returns the fixed local-demo context, timeSource measured', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/__test/ctx' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      principalId: string
      realm: string
      identityMode: string
      demoClockOffsetSeconds: number
      timeSource: string
    }
    expect(body.principalId).toBe(LOCAL_DEMO_PRINCIPAL_ID)
    expect(body.realm).toBe('demo')
    expect(body.identityMode).toBe('local-demo')
    expect(body.demoClockOffsetSeconds).toBe(0)
    expect(body.timeSource).toBe('measured')
  })

  it('(9) client-supplied x-principal-id / x-realm headers are ignored', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/__test/ctx',
      headers: { 'x-principal-id': 'someone-else', 'x-realm': 'pilot' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { principalId: string; realm: string }
    expect(body.principalId).toBe(LOCAL_DEMO_PRINCIPAL_ID)
    expect(body.realm).toBe('demo')
  })

  it('(10) after UPDATE demo_clock_offset_seconds = 1209600 the next request reflects it', async () => {
    await app.sql`UPDATE user_profiles SET demo_clock_offset_seconds = 1209600 WHERE id = ${LOCAL_DEMO_PRINCIPAL_ID}`

    const res = await app.inject({ method: 'GET', url: '/api/v1/__test/ctx' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { now: string; realNowMs: number; timeSource: string; demoClockOffsetSeconds: number }

    const diffSeconds = (new Date(body.now).getTime() - body.realNowMs) / 1000
    expect(diffSeconds).toBeGreaterThan(1209600 - 2)
    expect(diffSeconds).toBeLessThan(1209600 + 2)
    expect(body.timeSource).toBe('demo_clock')
    expect(body.demoClockOffsetSeconds).toBe(1209600)
  })

  it('(11) on an empty database the local-demo profile row exists immediately after app.ready()', async () => {
    // beforeEach already truncated + re-seeded via the shared app; delete the
    // row again so this test observes a genuinely profile-less database, the
    // same as a fresh migration.
    await app.db.delete(userProfiles).where(eq(userProfiles.id, LOCAL_DEMO_PRINCIPAL_ID))

    const freshApp = await buildApp(testConfig())
    await freshApp.ready()
    try {
      const rows = await freshApp.db
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.id, LOCAL_DEMO_PRINCIPAL_ID))
      expect(rows).toHaveLength(1)
      expect(rows[0]?.timezone).toBe('UTC')
      expect(rows[0]?.preferences).toEqual(DEFAULT_PREFERENCES)
    } finally {
      await freshApp.close()
    }
  })

  it('(12) after truncateAll() the ctx route still returns 200 with principalId local-demo (profile re-seeded)', async () => {
    await truncateAll()

    const res = await app.inject({ method: 'GET', url: '/api/v1/__test/ctx' })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { principalId: string }).principalId).toBe(LOCAL_DEMO_PRINCIPAL_ID)
  })
})
