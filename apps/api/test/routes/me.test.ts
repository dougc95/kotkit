import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, isIanaTimeZone, mergePreferences } from '../../src/preferences.js'
import { buildTestApp } from '../helpers/buildTestApp.js'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('preferences.ts (unit)', () => {
  it('(1) isIanaTimeZone(America/Costa_Rica) is true', () => {
    expect(isIanaTimeZone('America/Costa_Rica')).toBe(true)
  })

  it("(2) isIanaTimeZone('Costa Rica') is false", () => {
    expect(isIanaTimeZone('Costa Rica')).toBe(false)
  })

  it("(3) isIanaTimeZone is case-sensitive: 'utc' false, 'UTC' true", () => {
    expect(isIanaTimeZone('utc')).toBe(false)
    expect(isIanaTimeZone('UTC')).toBe(true)
  })

  it('(4) mergePreferences keeps keys absent from the patch and overrides present ones', () => {
    const current = {
      hideTimerDefault: false,
      endChime: false,
      visibilityContext: false,
      milestoneAnnouncements: false,
    }
    const merged = mergePreferences(current, { endChime: true })
    expect(merged).toEqual({
      hideTimerDefault: false,
      endChime: true,
      visibilityContext: false,
      milestoneAnnouncements: false,
    })
  })

  it('(5) mergePreferences ignores undefined values', () => {
    const current = {
      hideTimerDefault: true,
      endChime: false,
      visibilityContext: false,
      milestoneAnnouncements: false,
    }
    const merged = mergePreferences(current, { hideTimerDefault: undefined, endChime: true })
    expect(merged).toEqual({
      hideTimerDefault: true,
      endChime: true,
      visibilityContext: false,
      milestoneAnnouncements: false,
    })
  })

  it('(6) DEFAULT_PREFERENCES.visibilityContext and .milestoneAnnouncements are false', () => {
    expect(DEFAULT_PREFERENCES.visibilityContext).toBe(false)
    expect(DEFAULT_PREFERENCES.milestoneAnnouncements).toBe(false)
  })
})

describe('GET /me, PATCH /me/preferences (integration, attention_lab_test)', () => {
  let app: FastifyInstance
  let truncateAll: () => Promise<void>
  let close: () => Promise<void>

  beforeAll(async () => {
    const built = await buildTestApp()
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

  it('(7) GET /api/v1/me returns the fixed local-demo profile with default preferences', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/me' })

    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['x-request-id']).toMatch(UUID_V4)

    const body = res.json() as {
      principalId: string
      identityMode: string
      realm: string
      timezone: string
      preferences: Record<string, boolean>
      demoClockOffsetSeconds: number
    }
    expect(body.principalId).toBe('local-demo')
    expect(body.identityMode).toBe('local-demo')
    expect(body.realm).toBe('demo')
    expect(body.timezone).toBe('UTC')
    expect(body.demoClockOffsetSeconds).toBe(0)
    expect(body.preferences).toEqual(DEFAULT_PREFERENCES)
    expect(Object.keys(body.preferences).sort()).toEqual(
      ['endChime', 'hideTimerDefault', 'milestoneAnnouncements', 'visibilityContext'].sort(),
    )
  })

  it('(8) PATCH { timezone } -> 200, and a following GET shows it', async () => {
    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/preferences',
      payload: { timezone: 'Europe/Madrid' },
    })
    expect(patchRes.statusCode).toBe(200)
    expect((patchRes.json() as { timezone: string }).timezone).toBe('Europe/Madrid')

    const getRes = await app.inject({ method: 'GET', url: '/api/v1/me' })
    expect((getRes.json() as { timezone: string }).timezone).toBe('Europe/Madrid')
  })

  it('(9) PATCH { timezone: "Mars/Olympus" } -> 400 with fieldErrors.timezone', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/preferences',
      payload: { timezone: 'Mars/Olympus' },
    })
    expect(res.statusCode).toBe(400)
    const body = res.json() as { fieldErrors?: Record<string, string> }
    expect(body.fieldErrors?.timezone).toBe('must be an IANA time zone name')
  })

  it('(10) PATCH { endChime: true } -> timezone unchanged and hideTimerDefault still false', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/preferences',
      payload: { endChime: true },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { timezone: string; preferences: Record<string, boolean> }
    expect(body.timezone).toBe('UTC')
    expect(body.preferences.hideTimerDefault).toBe(false)
    expect(body.preferences.endChime).toBe(true)
  })

  it('(11) PATCH { realm: "pilot" } -> 400 fieldErrors.realm and the profile unchanged', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/preferences',
      payload: { realm: 'pilot' },
    })
    expect(res.statusCode).toBe(400)
    const body = res.json() as { fieldErrors?: Record<string, string> }
    expect(body.fieldErrors?.realm).toBeDefined()

    const getRes = await app.inject({ method: 'GET', url: '/api/v1/me' })
    const getBody = getRes.json() as { timezone: string; preferences: Record<string, boolean> }
    expect(getBody.timezone).toBe('UTC')
    expect(getBody.preferences).toEqual(DEFAULT_PREFERENCES)
  })

  it('(12) PATCH { principalId: "x" } -> 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/preferences',
      payload: { principalId: 'x' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('(13) PATCH {} -> 200 unchanged', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/v1/me/preferences', payload: {} })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { timezone: string; preferences: Record<string, boolean> }
    expect(body.timezone).toBe('UTC')
    expect(body.preferences).toEqual(DEFAULT_PREFERENCES)
  })

  it('(14) PATCH { milestoneAnnouncements: true } -> 200 with the other three keys unchanged', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/preferences',
      payload: { milestoneAnnouncements: true },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { preferences: Record<string, boolean> }
    expect(body.preferences).toEqual({
      hideTimerDefault: false,
      endChime: false,
      visibilityContext: false,
      milestoneAnnouncements: true,
    })
  })
})
