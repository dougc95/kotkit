import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.js'
import dbPlugin from '../../src/plugins/db.js'
import type { AppConfig } from '../../src/config.js'
import { buildTestApp } from '../helpers/buildTestApp.js'
import { captureLogs } from '../helpers/captureLogs.js'
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

describe('resolveTestDatabaseUrl', () => {
  it('(1) throws naming DATABASE_URL_TEST when it is unset', () => {
    expect(() => resolveTestDatabaseUrl({})).toThrow('DATABASE_URL_TEST')
  })

  it('(2) throws when the database name does not end in "_test"', () => {
    expect(() =>
      resolveTestDatabaseUrl({
        DATABASE_URL_TEST: 'postgres://u:p@127.0.0.1:55432/attention_lab',
      }),
    ).toThrow('must end in "_test"')
  })
})

describe('captureLogs', () => {
  it('(3) parses JSON lines into entries, filters entriesWith(reqId), and text() holds them all', () => {
    const logs = captureLogs()

    logs.write(`${JSON.stringify({ reqId: 'abc', msg: 'one' })}\n`)
    logs.write(`${JSON.stringify({ reqId: 'xyz', msg: 'two' })}\n`)
    logs.write(`${JSON.stringify({ reqId: 'abc', msg: 'three' })}\n`)

    const entries = logs.entries()
    expect(entries).toHaveLength(3)
    expect(entries.map((e) => e.msg)).toEqual(['one', 'two', 'three'])

    const abcEntries = logs.entriesWith('abc')
    expect(abcEntries).toHaveLength(2)
    expect(abcEntries.map((e) => e.msg)).toEqual(['one', 'three'])

    const text = logs.text()
    expect(text).toContain('"msg":"one"')
    expect(text).toContain('"msg":"two"')
    expect(text).toContain('"msg":"three"')
  })
})

describe('db plugin (against attention_lab_test)', () => {
  it('(4) exposes app.db and app.sql after ready(); registering the db plugin twice is refused', async () => {
    const app = await buildApp(testConfig())

    // buildApp already registered dbPlugin once (app.ts, root level). A
    // second registration, attempted before our own ready() call, hits
    // fastify-plugin's skip-override guard: the same instance is decorated
    // twice, and Fastify's decorate() refuses a duplicate key.
    await expect(app.register(dbPlugin)).rejects.toThrow(/db/i)

    // The first (successful) registration's decorations survive the second
    // registration's failure.
    expect(app.db).toBeDefined()
    expect(app.sql).toBeDefined()

    await app.close()
  })

  it('(5) app.sql`select 1 as one` returns [{ one: 1 }]', async () => {
    const { app, close } = await buildTestApp()
    const rows = await app.sql`select 1 as one`
    expect(Array.from(rows)).toEqual([{ one: 1 }])
    await close()
  })

  it("(6) db.execute(sql`select current_database()`) returns 'attention_lab_test'", async () => {
    const { db, close } = await buildTestApp()
    const rows = await db.execute(sql`select current_database()`)
    const [first] = Array.from(rows) as Array<{ current_database: string }>
    expect(first?.current_database).toBe('attention_lab_test')
    await close()
  })

  it('(7) after close() a further query rejects', async () => {
    const { app, close } = await buildTestApp()
    await close()
    await expect(app.sql`select 1`).rejects.toThrow()
  })

  it('(8) two sequential buildTestApp()/close() cycles succeed', async () => {
    const first = await buildTestApp()
    expect((await first.app.sql`select 1 as one`)[0]).toEqual({ one: 1 })
    await first.close()

    const second = await buildTestApp()
    expect((await second.app.sql`select 1 as one`)[0]).toEqual({ one: 1 })
    await second.close()
  })
})
