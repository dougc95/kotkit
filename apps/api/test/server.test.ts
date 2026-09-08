import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { isEntryModule } from '../src/server.js'
import type { AppConfig } from '../src/config.js'

/**
 * A minimal local-demo config for exercising buildApp directly. `port: 0`
 * so nothing here ever binds a fixed port; databaseUrl is unused because no
 * plugin reads it yet (3.2.1 adds the db plugin).
 */
function testConfig(): AppConfig {
  return {
    identityMode: 'local-demo',
    host: '127.0.0.1',
    port: 0,
    databaseUrl: process.env.DATABASE_URL_TEST ?? 'postgres://unused/unused_test',
    logLevel: 'silent',
  }
}

describe('buildApp', () => {
  it('returns 404 for an unknown route (no routes registered yet)', async () => {
    const app = await buildApp(testConfig())
    const res = await app.inject({ method: 'GET', url: '/api/v1/anything' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('never listens on its own', async () => {
    const app = await buildApp(testConfig())
    expect(app.server.listening).toBe(false)
    await app.close()
  })
})

describe('isEntryModule', () => {
  it('is true only when moduleUrl matches argv1 as a file URL', () => {
    const entryPath = '/some/dir/server.ts'
    const otherPath = '/some/dir/other.ts'
    const entryUrl = pathToFileURL(entryPath).href
    expect(isEntryModule(entryUrl, entryPath)).toBe(true)
    expect(isEntryModule(entryUrl, otherPath)).toBe(false)
    expect(isEntryModule(entryUrl, undefined)).toBe(false)
  })
})
