import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ConfigError } from '../../src/config.js'
import { isApiPath, resolveWebDistDir } from '../../src/plugins/staticWeb.js'
import { buildTestApp } from '../helpers/buildTestApp.js'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const INDEX_MARKER = '<!-- ATTENTION-LAB-INDEX -->'

describe('isApiPath / resolveWebDistDir (unit)', () => {
  it('(1) isApiPath is true for /api/v1/me with and without a query string', () => {
    expect(isApiPath('/api/v1/me')).toBe(true)
    expect(isApiPath('/api/v1/me?x=1')).toBe(true)
  })

  it('(2) isApiPath is true for /api and /api/', () => {
    expect(isApiPath('/api')).toBe(true)
    expect(isApiPath('/api/')).toBe(true)
  })

  it('(3) isApiPath is false for /apix/y, /progress and /', () => {
    expect(isApiPath('/apix/y')).toBe(false)
    expect(isApiPath('/progress')).toBe(false)
    expect(isApiPath('/')).toBe(false)
  })

  it('(4) resolveWebDistDir on a directory without index.html throws ConfigError naming WEB_DIST_DIR', () => {
    const dir = mkdtempSync(join(tmpdir(), 'attention-lab-static-empty-'))
    try {
      expect(() => resolveWebDistDir(dir)).toThrow(ConfigError)
      expect(() => resolveWebDistDir(dir)).toThrow('WEB_DIST_DIR')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('staticWeb plugin (integration, attention_lab_test)', () => {
  let distDir: string

  beforeAll(() => {
    distDir = mkdtempSync(join(tmpdir(), 'attention-lab-static-dist-'))
    writeFileSync(join(distDir, 'index.html'), INDEX_MARKER)
    mkdirSync(join(distDir, 'assets'))
    writeFileSync(join(distDir, 'assets', 'app.js'), 'console.log("attention-lab");')
  })

  afterAll(() => {
    rmSync(distDir, { recursive: true, force: true })
  })

  describe('with WEB_DIST_DIR set', () => {
    let app: FastifyInstance
    let truncateAll: () => Promise<void>
    let close: () => Promise<void>

    beforeAll(async () => {
      const built = await buildTestApp({ webDistDir: distDir })
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

    it('(5) GET / serves index.html', async () => {
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toMatch(/text\/html/)
      expect(res.body).toContain(INDEX_MARKER)
    })

    it('(6) GET /assets/app.js serves the built asset', async () => {
      const res = await app.inject({ method: 'GET', url: '/assets/app.js' })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toMatch(/javascript/)
      expect(res.body).toBe('console.log("attention-lab");')
    })

    it('(7) a deep link (GET /progress) falls back to index.html with x-request-id', async () => {
      const res = await app.inject({ method: 'GET', url: '/progress' })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toMatch(/text\/html/)
      expect(res.body).toContain(INDEX_MARKER)
      expect(res.headers['x-request-id']).toMatch(UUID_V4)
    })

    it('(8) a nested deep link (GET /benchmark/abc/recall) falls back to index.html', async () => {
      const res = await app.inject({ method: 'GET', url: '/benchmark/abc/recall' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain(INDEX_MARKER)
    })

    it('(9) GET /api/v1/me is never shadowed by static serving', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/me' })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toMatch(/application\/json/)
      const body = res.json() as { principalId: string }
      expect(body.principalId).toBe('local-demo')
    })

    it('(10) an unmatched /api path gets the JSON 404 envelope, not the SPA fallback', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/nope' })
      expect(res.statusCode).toBe(404)
      const body = res.json() as { code: string }
      expect(body.code).toBe('not_found')
      expect(res.headers['cache-control']).toBe('no-store')
      expect(res.body).not.toContain(INDEX_MARKER)
    })

    it('(11) a non-GET/HEAD method to a non-API path gets the JSON 404 envelope, not the SPA fallback', async () => {
      const res = await app.inject({ method: 'POST', url: '/progress' })
      expect(res.statusCode).toBe(404)
      const body = res.json() as { code: string }
      expect(body.code).toBe('not_found')
      expect(res.body).not.toContain(INDEX_MARKER)
    })
  })

  describe('with WEB_DIST_DIR unset', () => {
    let app: FastifyInstance
    let close: () => Promise<void>

    beforeAll(async () => {
      const built = await buildTestApp()
      app = built.app
      close = built.close
    })

    afterAll(async () => {
      await close()
    })

    it('(12) a non-API GET still gets the plain JSON 404 envelope, not html', async () => {
      const res = await app.inject({ method: 'GET', url: '/progress' })
      expect(res.statusCode).toBe(404)
      expect(res.headers['content-type']).toMatch(/application\/json/)
      const body = res.json() as { code: string }
      expect(body.code).toBe('not_found')
    })
  })
})
